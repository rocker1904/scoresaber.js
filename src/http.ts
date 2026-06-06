import {RateLimiter} from './rate-limit';
import {ScoreSaberAPIError} from './errors';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type QueryValue = string | number | boolean | undefined | null;
export type QueryRecord = Readonly<Record<string, QueryValue>>;

export interface HttpClientOpts {
    baseUrl: string;
    rateLimiter: RateLimiter;
    fetchImpl: FetchLike;
    defaultQuery?: QueryRecord;
}

/** Encodes a query record, dropping undefined / null / empty-string values. */
function buildQuery(params: QueryRecord): string {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || v === '') continue;
        usp.set(k, String(v));
    }
    const s = usp.toString();
    return s ? `?${s}` : '';
}

/**
 * Thin HTTP layer: rate-limit gating, URL construction, error mapping.
 * Resource namespaces use this; consumers do not see it directly.
 */
export class HttpClient {
    constructor(private readonly opts: HttpClientOpts) {}

    private async send(path: string, query: object): Promise<Response> {
        await this.opts.rateLimiter.checkin();
        const merged = {...this.opts.defaultQuery, ...(query as QueryRecord)};
        const url = `${this.opts.baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}${buildQuery(merged)}`;
        const response = await this.opts.fetchImpl(url, {method: 'GET'});
        this.opts.rateLimiter.update(response.headers);
        if (!response.ok) {
            let body: unknown;
            try {
                body = await response.json();
            } catch {
                throw new ScoreSaberAPIError(response.status, 'UNKNOWN', `Request failed: ${response.status} ${response.statusText}`);
            }
            const e = body as {code?: string; message?: string; details?: unknown};
            throw new ScoreSaberAPIError(response.status, e.code ?? 'UNKNOWN', e.message ?? response.statusText, e.details);
        }
        return response;
    }

    public async get<T>(path: string, query: object = {}): Promise<T> {
        const response = await this.send(path, query);
        return (await response.json()) as T;
    }

    /** Fetch a binary response (e.g. replay files). */
    public async getBinary(path: string, query: object = {}): Promise<ArrayBuffer> {
        const response = await this.send(path, query);
        return await response.arrayBuffer();
    }
}
