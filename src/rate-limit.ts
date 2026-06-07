import {RateLimitedError} from './errors';

export type BucketName = 'long' | 'medium' | 'short';

/** Snapshot of one rate-limit bucket. */
export interface BucketState {
    /** Requests remaining in the current window: `max(0, limit - used)`. */
    remaining: number;
    /** Unix milliseconds when the window resets. `0` until first learned. */
    resetAt: number;
    /** Window ceiling: a conservative default until the server reports it. */
    limit: number;
    /** Requests counted against the current window. */
    used: number;
}

/** Read-only view of the limiter's tracked state — what `client.rateLimit` exposes. */
export interface RateLimitView {
    readonly long: Readonly<BucketState>;
    readonly medium: Readonly<BucketState>;
    readonly short: Readonly<BucketState>;
    /** Whether the client waits for the window to refresh (vs. throwing) when exhausted. */
    readonly waitForRateLimit: boolean;
}

const BUCKETS: BucketName[] = ['long', 'medium', 'short'];

// Upper bound on a bucket's reset horizon. Clamps pathological / hostile
// `x-ratelimit-reset-*` values so a huge number can't overflow setTimeout's
// 32-bit range and busy-spin the wait loop. Real windows are seconds–minutes.
const MAX_RESET_MS = 24 * 60 * 60 * 1000;

// When a bucket is exhausted but we don't yet know its reset time (cold start,
// before any response has populated `resetAt`), re-check after this interval — by
// when an in-flight request's response should have set the real reset.
const COLD_RECHECK_MS = 500;

// Conservative ceilings used only until the server reports its real limits, so a
// cold-start burst is throttled from the very first request rather than flooding
// before we learn the limit. These mirror the observed ScoreSaber tiers and are
// overwritten by the authoritative `x-ratelimit-limit-*` header on the first
// response; a different deployment self-corrects the same way.
const DEFAULT_LIMITS: Readonly<Record<BucketName, number>> = {long: 400, medium: 100, short: 25};

/** Mutable per-bucket state. `used` is monotonic within a window; rollover zeroes it. */
interface Bucket {
    limit: number;
    used: number;
    resetAt: number;
}

/** Resolve when `p` settles or `signal` aborts, whichever first. Never rejects; the caller re-checks the signal. */
function abortable(p: Promise<void>, signal?: AbortSignal): Promise<void> {
    if (signal === undefined) return p;
    if (signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
        const onAbort = () => resolve();
        signal.addEventListener('abort', onAbort, {once: true});
        const clear = () => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        };
        p.then(clear, clear);
    });
}

/** Resolve after `ms`, or early if `signal` aborts. The caller re-checks the signal. */
function waitFor(ms: number, signal?: AbortSignal): Promise<void> {
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

function parseFinite(value: string | null): number | undefined {
    if (value === null || value === '') return undefined;
    const n = Number(value);
    // `Number.isFinite` (not `!isNaN`) so an `Infinity` / absurd header can't push
    // state out of setTimeout's range and busy-spin the wait loop.
    return Number.isFinite(n) ? n : undefined;
}

/**
 * Tracks the three tiered ScoreSaber rate-limit buckets from response headers and
 * either waits for them to refresh or throws, depending on configuration.
 *
 * Each bucket counts `used` requests monotonically within a window. The server's
 * headers may only ever push `used` UP within a window (never down), so an
 * in-flight burst's reservations can't be erased by a stale optimistic snapshot —
 * which makes overshooting a window impossible by construction, even under
 * concurrent callers sharing one client. A window rollover (its reset time having
 * passed) zeroes `used` and the next response's refill is accepted.
 *
 * The exact header contract is not part of the published OpenAPI spec, so the
 * limiter is best-effort: until the first response is seen, each bucket uses a
 * conservative default ceiling so a cold-start burst is still throttled.
 */
export class RateLimiter implements RateLimitView {
    private readonly buckets: Record<BucketName, Bucket> = {
        long: {limit: DEFAULT_LIMITS.long, used: 0, resetAt: 0},
        medium: {limit: DEFAULT_LIMITS.medium, used: 0, resetAt: 0},
        short: {limit: DEFAULT_LIMITS.short, used: 0, resetAt: 0},
    };

    private gate: Promise<void> = Promise.resolve();

    constructor(public readonly waitForRateLimit: boolean) {}

    public get long(): Readonly<BucketState> {
        return this.view('long');
    }
    public get medium(): Readonly<BucketState> {
        return this.view('medium');
    }
    public get short(): Readonly<BucketState> {
        return this.view('short');
    }

    private view(name: BucketName): Readonly<BucketState> {
        const b = this.buckets[name];
        return {remaining: Math.max(0, b.limit - b.used), resetAt: b.resetAt, limit: b.limit, used: b.used};
    }

    /** A window whose reset time has passed is empty again. */
    private rollover(b: Bucket, now: number): void {
        if (b.resetAt > 0 && now >= b.resetAt) {
            b.used = 0;
            b.resetAt = 0;
        }
    }

    /**
     * Reserve one request before sending. Concurrent callers are serialised through
     * `gate` so they can't all pass a bucket that has a single request left; each
     * caller increments every bucket's `used` as it passes. Header updates later
     * raise these estimates toward the server's authoritative counts but never lower
     * them within a window.
     *
     * A caller `signal` cancels the wait promptly (throwing its reason), so an
     * aborted request doesn't block until the window resets.
     */
    public async checkin(signal?: AbortSignal): Promise<void> {
        if (signal?.aborted) throw signal.reason;
        const {wait, release} = this.acquire();
        try {
            // Wait for our turn in the queue, bailing promptly if the caller aborts.
            await abortable(wait, signal);
            if (signal?.aborted) throw signal.reason;
            for (;;) {
                const now = Date.now();
                let waitMs = 0;
                let exhausted: BucketName | undefined;
                for (const name of BUCKETS) {
                    const b = this.buckets[name];
                    this.rollover(b, now);
                    if (b.used >= b.limit) {
                        // Known reset → wait exactly that long; unknown (cold start,
                        // resetAt 0) → a short re-check, by when an in-flight response
                        // should have populated the real reset.
                        const wait = b.resetAt > now ? b.resetAt - now : COLD_RECHECK_MS;
                        if (wait > waitMs) {
                            waitMs = wait;
                            exhausted = name;
                        }
                    }
                }
                if (exhausted === undefined) {
                    for (const name of BUCKETS) this.buckets[name].used += 1;
                    return;
                }
                if (!this.waitForRateLimit) {
                    throw new RateLimitedError({bucket: exhausted, resetAt: this.buckets[exhausted].resetAt});
                }
                await waitFor(waitMs + 100, signal);
                if (signal?.aborted) throw signal.reason;
            }
        } finally {
            release();
        }
    }

    /**
     * Update buckets from response headers. Within a window the server may only push
     * `used` UP (the max rule); on a rollover the server's fresh, lower count is
     * adopted. `limit` is learned from `x-ratelimit-limit-*` when present.
     */
    public update(headers: Headers): void {
        const now = Date.now();
        for (const name of BUCKETS) {
            const b = this.buckets[name];

            const limit = parseFinite(headers.get(`x-ratelimit-limit-${name}`));
            if (limit !== undefined) b.limit = limit;

            // A window we were tracking whose reset has passed (or one never seen) is fresh:
            // accept the server's lower count rather than holding a stale higher `used`.
            const rolledOver = b.resetAt === 0 || now >= b.resetAt;

            const remaining = parseFinite(headers.get(`x-ratelimit-remaining-${name}`));
            if (remaining !== undefined) {
                const serverUsed = Math.max(0, b.limit - remaining);
                b.used = rolledOver ? serverUsed : Math.max(b.used, serverUsed);
            }

            const reset = parseFinite(headers.get(`x-ratelimit-reset-${name}`));
            if (reset !== undefined) {
                const serverResetAt = now + Math.min(Math.max(0, reset * 1000), MAX_RESET_MS);
                // Within a window we keep the later reset. This assumes the header counts
                // DOWN toward the window end (ScoreSaber sends seconds-remaining), so
                // successive `serverResetAt` values land at roughly the same instant and
                // `now >= resetAt` eventually fires. A fixed-TTL header (constant value
                // every response) would instead keep pushing `resetAt` forward and stall
                // the rollover — not the observed contract, but the assumption is here.
                b.resetAt = rolledOver ? serverResetAt : Math.max(b.resetAt, serverResetAt);
            }
        }
    }

    /**
     * Longest wait (ms) among buckets that are exhausted with a known future reset, or
     * `0` if none. Used by the HTTP layer to wait out a server 429 for the time the
     * buckets say is needed.
     *
     * Not a pure getter: it applies lazy rollover (zeroing buckets whose window has
     * passed), like `checkin`, so the figure reflects current state.
     */
    public exhaustedWaitMs(now = Date.now()): number {
        let waitMs = 0;
        for (const name of BUCKETS) {
            const b = this.buckets[name];
            this.rollover(b, now);
            if (b.used >= b.limit && b.resetAt > now) waitMs = Math.max(waitMs, b.resetAt - now);
        }
        return waitMs;
    }

    /**
     * Reserve a slot in the serialised checkin chain. `wait` resolves when it is this
     * caller's turn; `release` frees the slot for the next caller and MUST always be
     * called (even if this caller aborts before its turn), or the chain stalls.
     */
    private acquire(): {wait: Promise<void>; release: () => void} {
        let release!: () => void;
        const next = new Promise<void>((resolve) => {
            release = resolve;
        });
        const prev = this.gate;
        this.gate = prev.then(() => next);
        return {wait: prev, release};
    }
}
