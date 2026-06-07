import {RateLimitedError} from './errors';

export type BucketName = 'long' | 'medium' | 'short';

/** Snapshot of one rate-limit bucket. */
export interface BucketState {
    /** Requests remaining in the current window. */
    remaining: number;
    /** Unix milliseconds when the window resets. `0` until first response. */
    resetAt: number;
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

/**
 * Tracks the three tiered ScoreSaber rate-limit buckets from response headers
 * and either waits for them to refresh or throws, depending on configuration.
 *
 * The exact header contract is not part of the published OpenAPI spec, so the
 * limiter is best-effort: absent or unrecognised headers leave the buckets
 * unbounded (no gating) rather than guessing.
 */
export class RateLimiter implements RateLimitView {
    public readonly long: BucketState = {remaining: Infinity, resetAt: 0};
    public readonly medium: BucketState = {remaining: Infinity, resetAt: 0};
    public readonly short: BucketState = {remaining: Infinity, resetAt: 0};

    private gate: Promise<void> = Promise.resolve();

    constructor(public readonly waitForRateLimit: boolean) {}

    /**
     * Reserve one request before sending. Concurrent callers are serialised
     * through `gate` so they can't all pass a bucket that has a single request
     * left; each caller decrements every bucket as it passes. Header updates
     * later overwrite these estimates with the server's authoritative counts.
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
                    const b = this[name];
                    if (b.remaining <= 0 && b.resetAt > now && b.resetAt - now > waitMs) {
                        waitMs = b.resetAt - now;
                        exhausted = name;
                    }
                }
                if (exhausted === undefined) {
                    for (const name of BUCKETS) this[name].remaining -= 1;
                    return;
                }
                if (!this.waitForRateLimit) {
                    throw new RateLimitedError({bucket: exhausted, resetAt: this[exhausted].resetAt});
                }
                await waitFor(waitMs + 100, signal);
                if (signal?.aborted) throw signal.reason;
            }
        } finally {
            release();
        }
    }

    /** Update buckets from response headers. */
    public update(headers: Headers): void {
        const now = Date.now();
        for (const name of BUCKETS) {
            const remaining = headers.get(`x-ratelimit-remaining-${name}`);
            const reset = headers.get(`x-ratelimit-reset-${name}`);
            // `Number.isFinite` (not `!isNaN`) plus a max clamp so an `Infinity`
            // or absurdly large header can't push `resetAt` past setTimeout's range
            // and busy-spin the wait loop. Real windows are seconds–minutes.
            if (remaining !== null && remaining !== '' && Number.isFinite(Number(remaining))) {
                this[name].remaining = Number(remaining);
            }
            if (reset !== null && reset !== '' && Number.isFinite(Number(reset))) {
                this[name].resetAt = now + Math.min(Math.max(0, Number(reset) * 1000), MAX_RESET_MS);
            }
        }
    }

    /**
     * Reserve a slot in the serialised checkin chain. `wait` resolves when it is
     * this caller's turn; `release` frees the slot for the next caller and MUST
     * always be called (even if this caller aborts before its turn), or the chain
     * stalls.
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
