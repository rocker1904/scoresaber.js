import {RateLimiter} from './rate-limit';
import {ScoreSaberError, ScoreSaberAPIError, ScoreSaberNetworkError, ScoreSaberTimeoutError, RateLimitedError} from './errors';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type QueryValue = string | number | boolean | readonly string[] | undefined | null;
export type QueryRecord = Readonly<Record<string, QueryValue>>;

/** Per-call request options threaded through every resource method. */
export interface RequestOptions {
    /** Caller-supplied cancellation signal, composed with the client timeout. */
    signal?: AbortSignal;
    /** Extra headers for this request (override the defaults, e.g. User-Agent). */
    headers?: Record<string, string>;
    /**
     * Realm filter for this request; overrides the client/scope default realm.
     * Omit to inherit that default — to target the API's active realm regardless,
     * use a client (or `realm` handle) without a realm set.
     */
    realmId?: number;
}

export interface RequestHookContext {
    url: string;
    method: string;
    headers: Record<string, string>;
    attempt: number;
}

export interface ResponseHookContext {
    url: string;
    status: number;
    response: Response;
    attempt: number;
}

export interface HttpClientOpts {
    baseUrl: string;
    rateLimiter: RateLimiter;
    fetchImpl: FetchLike;
    userAgent: string;
    defaultQuery?: QueryRecord;
    /** Per-request timeout in milliseconds. */
    timeoutMs: number;
    /** Retries on 5xx and transient network errors (a `429` under `waitForRateLimit` is waited out separately). */
    maxRetries: number;
    /** Reject responses whose Content-Length exceeds this many bytes. */
    maxResponseBytes?: number;
    onRequest?: (ctx: RequestHookContext) => void;
    onResponse?: (ctx: ResponseHookContext) => void;
}

const RETRY_BASE_MS = 500;
const RETRY_CAP_MS = 10_000;
// Upper bound for any server-suggested wait (Retry-After). Caps pathological /
// hostile values so they can't overflow setTimeout's 32-bit range.
const MAX_WAIT_MS = 24 * 60 * 60 * 1000;
// Floor for a rate-limit wait. The 429 retry loop is unbounded under
// `waitForRateLimit`; a server pinning `Retry-After: 0` (or a sub-ms bucket reset)
// would otherwise make it hammer the API every macrotask. This keeps the worst case
// to a sane rate while still effectively "retry promptly".
const MIN_RATE_LIMIT_WAIT_MS = 50;

/** Encodes a query record, dropping undefined / null / empty values. Arrays are comma-joined. */
function buildQuery(params: QueryRecord): string {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || v === '') continue;
        if (Array.isArray(v)) {
            if (v.length > 0) usp.set(k, v.join(','));
        } else {
            usp.set(k, String(v));
        }
    }
    const s = usp.toString();
    return s ? `?${s}` : '';
}

/** Parse a `Retry-After` header (delta-seconds or HTTP-date) into milliseconds. */
function parseRetryAfterMs(value: string | null): number | undefined {
    if (!value) return undefined;
    const seconds = Number(value);
    // `Number.isFinite` (not `!isNaN`) plus a max clamp so `Infinity`/huge values
    // can't overflow setTimeout or `new Date(...)` downstream.
    if (Number.isFinite(seconds)) return Math.min(Math.max(0, seconds * 1000), MAX_WAIT_MS);
    const date = Date.parse(value);
    if (!Number.isNaN(date)) return Math.min(Math.max(0, date - Date.now()), MAX_WAIT_MS);
    return undefined;
}

/** Exponential backoff with full jitter. */
function jitteredBackoffMs(attempt: number): number {
    return Math.random() * Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** attempt);
}

/** Resolve after `ms`, or early if `signal` aborts. Callers re-check the signal afterwards. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal?.aborted) return resolve();
        const onAbort = () => {
            clearTimeout(timer);
            resolve();
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, {once: true});
    });
}

/**
 * Thin HTTP layer: rate-limit gating, URL construction, retries, error mapping.
 * Resource namespaces use this; consumers do not see it directly.
 */
export class HttpClient {
    constructor(private readonly opts: HttpClientOpts) {}

    /**
     * Derive a sibling that shares this client's rate limiter (and all other
     * config) but applies a different default query — used for realm scoping so
     * every realm goes through one coordinated rate-limit budget.
     */
    public withDefaultQuery(defaultQuery: QueryRecord): HttpClient {
        return new HttpClient({...this.opts, defaultQuery});
    }

    private async send(path: string, query: object, req?: RequestOptions): Promise<Response> {
        const merged: Record<string, QueryValue> = {...this.opts.defaultQuery, ...(query as QueryRecord)};
        // A per-call realmId overrides the client/realm-scope default.
        if (req?.realmId !== undefined) merged.realmId = req.realmId;
        const url = `${this.opts.baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}${buildQuery(merged)}`;
        // Lowercase caller header names so they override the defaults case-insensitively
        // (otherwise a caller's `User-Agent` would append to, not replace, ours).
        const headers: Record<string, string> = {'user-agent': this.opts.userAgent};
        for (const [k, v] of Object.entries(req?.headers ?? {})) {
            headers[k.toLowerCase()] = v;
        }

        // Reserve capacity once per logical request, not per attempt — retries
        // reuse the reservation rather than decrementing every bucket again.
        await this.opts.rateLimiter.checkin(req?.signal);

        let transientRetries = 0; // governs 5xx / network retries — NOT rate-limit waits
        for (let attempt = 0; ; attempt++) {
            const timeoutSignal = AbortSignal.timeout(this.opts.timeoutMs);
            const signal = req?.signal ? AbortSignal.any([req.signal, timeoutSignal]) : timeoutSignal;

            this.opts.onRequest?.({url, method: 'GET', headers, attempt});

            let response: Response;
            try {
                response = await this.opts.fetchImpl(url, {method: 'GET', headers, signal});
            } catch (err) {
                if (req?.signal?.aborted) throw req.signal.reason; // caller cancelled — don't mask it
                if (timeoutSignal.aborted) throw new ScoreSaberTimeoutError(url, this.opts.timeoutMs, {cause: err});
                if (transientRetries < this.opts.maxRetries) {
                    transientRetries++;
                    await sleep(jitteredBackoffMs(attempt), req?.signal);
                    if (req?.signal?.aborted) throw req.signal.reason ?? err;
                    continue;
                }
                throw new ScoreSaberNetworkError(url, {cause: err});
            }

            this.opts.rateLimiter.update(response.headers);
            this.opts.onResponse?.({url, status: response.status, response, attempt});

            if (this.opts.maxResponseBytes !== undefined) {
                const len = Number(response.headers.get('content-length'));
                if (!Number.isNaN(len) && len > this.opts.maxResponseBytes) {
                    await response.body?.cancel();
                    throw new ScoreSaberError(
                        `Response from ${url} (${len} bytes) exceeds maxResponseBytes (${this.opts.maxResponseBytes})`,
                    );
                }
            }

            // A 429 under waitForRateLimit is waited out and retried without bound — the
            // limit is transient and self-clearing, so it must not consume maxRetries.
            // Wait the time the server (Retry-After) or the tracked buckets say is needed,
            // falling back to backoff only when neither is known.
            if (response.status === 429 && this.opts.rateLimiter.waitForRateLimit) {
                await response.body?.cancel();
                const suggested =
                    parseRetryAfterMs(response.headers.get('retry-after')) ??
                    (this.opts.rateLimiter.exhaustedWaitMs() || jitteredBackoffMs(attempt));
                const waitMs = Math.max(MIN_RATE_LIMIT_WAIT_MS, suggested);
                await sleep(waitMs, req?.signal);
                if (req?.signal?.aborted) throw req.signal.reason;
                continue;
            }

            // Transient 5xx: bounded by maxRetries.
            if (response.status >= 500 && transientRetries < this.opts.maxRetries) {
                transientRetries++;
                await response.body?.cancel();
                await sleep(jitteredBackoffMs(attempt), req?.signal);
                if (req?.signal?.aborted) throw req.signal.reason;
                continue;
            }

            if (!response.ok) {
                // A 429 reaching here means waitForRateLimit is off: surface it as
                // RateLimitedError so callers have a single rate-limit type to catch,
                // matching the proactive path in RateLimiter.checkin.
                if (response.status === 429) {
                    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
                    await response.body?.cancel();
                    throw new RateLimitedError({
                        resetAt: retryAfterMs !== undefined ? Date.now() + retryAfterMs : 0,
                        status: 429,
                        url,
                    });
                }
                let body: unknown;
                try {
                    body = await response.json();
                } catch {
                    throw new ScoreSaberAPIError({
                        status: response.status,
                        code: 'UNKNOWN',
                        message: `Request failed: ${response.status} ${response.statusText}`,
                        url,
                    });
                }
                const e = body as {code?: string; message?: string; details?: unknown};
                throw new ScoreSaberAPIError({
                    status: response.status,
                    code: e.code ?? 'UNKNOWN',
                    message: e.message ?? response.statusText,
                    url,
                    details: e.details,
                });
            }
            return response;
        }
    }

    public async get<T>(path: string, query: object = {}, req?: RequestOptions): Promise<T> {
        const response = await this.send(path, query, req);
        // Read as text (streamed under the byte cap) and parse here so a malformed
        // or empty body surfaces as a ScoreSaberError rather than a raw SyntaxError.
        const text =
            this.opts.maxResponseBytes === undefined ? await response.text() : new TextDecoder().decode(await this.readBytes(response));
        try {
            return JSON.parse(text) as T;
        } catch (err) {
            throw new ScoreSaberError(`Invalid JSON in response from ${response.url || path}`, {cause: err});
        }
    }

    /** Fetch a binary response (e.g. replay files). */
    public async getBinary(path: string, query: object = {}, req?: RequestOptions): Promise<ArrayBuffer> {
        const response = await this.send(path, query, req);
        return this.readBytes(response);
    }

    /**
     * Read a body fully. When `maxResponseBytes` is set, stream it and abort once
     * the running total exceeds the cap — this enforces the limit even when the
     * server omits (or lies about) `Content-Length`, which the header pre-check
     * in `send` can't catch.
     */
    private async readBytes(response: Response): Promise<ArrayBuffer> {
        const max = this.opts.maxResponseBytes;
        if (max === undefined || response.body === null) {
            return response.arrayBuffer();
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (;;) {
            const {done, value} = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > max) {
                await reader.cancel();
                throw new ScoreSaberError(`Response body exceeds maxResponseBytes (${max})`);
            }
            chunks.push(value);
        }
        const out = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            out.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return out.buffer;
    }
}
