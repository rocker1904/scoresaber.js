import type {BucketName} from './rate-limit';

/** Base class for every error this library throws, so consumers can catch broadly. */
export class ScoreSaberError extends Error {
    constructor(message: string, options?: {cause?: unknown}) {
        super(message, options);
        this.name = 'ScoreSaberError';
    }
}

/** Structured error thrown for non-2xx responses from the ScoreSaber API. */
export class ScoreSaberAPIError extends ScoreSaberError {
    public readonly status: number;
    public readonly code: string;
    public readonly url: string;
    public readonly details?: unknown;

    constructor(args: {status: number; code: string; message: string; url: string; details?: unknown}) {
        super(args.message);
        this.name = 'ScoreSaberAPIError';
        this.status = args.status;
        this.code = args.code;
        this.url = args.url;
        this.details = args.details;
    }
}

/**
 * Thrown when a request is rate limited. This covers two origins behind one type
 * so consumers only have to catch one thing:
 *   - proactive: a tracked bucket is exhausted and `waitForRateLimit` is disabled
 *     (thrown before sending — `bucket` is set, `status`/`url` are absent);
 *   - reactive: the server returned HTTP 429 and the client won't retry it
 *     (`status` is 429 and `url` is set; `bucket` is absent since the response
 *     doesn't say which tier tripped).
 */
export class RateLimitedError extends ScoreSaberError {
    /** The tracked bucket that tripped, or `undefined` for a server-sent 429. */
    public readonly bucket?: BucketName;
    /** Unix ms when the limit is expected to clear (from `Retry-After` or the bucket reset). `0` if unknown. */
    public readonly resetAt: number;
    /** HTTP status for a server-sent 429; `undefined` when thrown proactively. */
    public readonly status?: number;
    /** The request URL, present for a server-sent 429. */
    public readonly url?: string;

    constructor(args: {bucket?: BucketName; resetAt: number; status?: number; url?: string}) {
        const which = args.bucket ? ` (${args.bucket})` : '';
        // Guard the Date range (max 8.64e15 ms) so a non-finite/overflowing resetAt
        // can't turn this constructor into a RangeError that escapes the hierarchy.
        const when = args.resetAt > 0 && args.resetAt <= 8.64e15 ? `; resets at ${new Date(args.resetAt).toISOString()}` : '';
        super(`Rate limit${which} exhausted${when}`);
        this.name = 'RateLimitedError';
        this.bucket = args.bucket;
        this.resetAt = args.resetAt;
        this.status = args.status;
        this.url = args.url;
    }
}

/** Thrown when a request exceeds the configured `timeoutMs`. */
export class ScoreSaberTimeoutError extends ScoreSaberError {
    public readonly url: string;
    public readonly timeoutMs: number;

    constructor(url: string, timeoutMs: number, options?: {cause?: unknown}) {
        super(`Request to ${url} timed out after ${timeoutMs}ms`, options);
        this.name = 'ScoreSaberTimeoutError';
        this.url = url;
        this.timeoutMs = timeoutMs;
    }
}

/** Thrown when the underlying fetch fails (DNS, connection reset, offline, …). */
export class ScoreSaberNetworkError extends ScoreSaberError {
    public readonly url: string;

    constructor(url: string, options?: {cause?: unknown}) {
        super(`Network request to ${url} failed`, options);
        this.name = 'ScoreSaberNetworkError';
        this.url = url;
    }
}
