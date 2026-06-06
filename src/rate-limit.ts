import {RateLimitedError} from './errors';

export type BucketName = 'long' | 'medium' | 'short';

/** Snapshot of one rate-limit bucket. */
export interface BucketState {
    /** Requests remaining in the current window. */
    remaining: number;
    /** Unix milliseconds when the window resets. `0` until first response. */
    resetAt: number;
}

const BUCKETS: BucketName[] = ['long', 'medium', 'short'];

/**
 * Tracks the three tiered ScoreSaber rate-limit buckets from response headers
 * and either waits for them to refresh or throws, depending on configuration.
 */
export class RateLimiter {
    public readonly long: BucketState = {remaining: Infinity, resetAt: 0};
    public readonly medium: BucketState = {remaining: Infinity, resetAt: 0};
    public readonly short: BucketState = {remaining: Infinity, resetAt: 0};

    constructor(private readonly waitForRateLimit: boolean) {}

    /**
     * Block (or throw) before a request if any bucket is exhausted.
     * Returns when there is at least one request available in every bucket.
     */
    public async checkin(): Promise<void> {
        for (;;) {
            const now = Date.now();
            let waitMs = 0;
            let exhausted: BucketName | undefined;
            for (const name of BUCKETS) {
                const b = this[name];
                if (b.remaining <= 0 && b.resetAt > now) {
                    const ms = b.resetAt - now;
                    if (ms > waitMs) {
                        waitMs = ms;
                        exhausted = name;
                    }
                }
            }
            if (exhausted === undefined) return;
            if (!this.waitForRateLimit) {
                throw new RateLimitedError(exhausted, this[exhausted].resetAt);
            }
            await new Promise((resolve) => setTimeout(resolve, waitMs + 100));
        }
    }

    /** Update buckets from response headers. */
    public update(headers: Headers): void {
        const now = Date.now();
        for (const name of BUCKETS) {
            const remaining = Number(headers.get(`x-ratelimit-remaining-${name}`));
            const resetIn = Number(headers.get(`x-ratelimit-reset-${name}`));
            if (!Number.isNaN(remaining)) this[name].remaining = remaining;
            if (!Number.isNaN(resetIn)) this[name].resetAt = now + resetIn * 1000;
        }
    }
}
