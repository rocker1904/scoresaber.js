/** Structured error thrown for non-2xx responses from the ScoreSaber API. */
export class ScoreSaberAPIError extends Error {
    public readonly status: number;
    public readonly code: string;
    public readonly details?: unknown;

    constructor(status: number, code: string, message: string, details?: unknown) {
        super(message);
        this.name = 'ScoreSaberAPIError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

/** Thrown when a rate-limit bucket is exhausted and `waitForRateLimit` is disabled. */
export class RateLimitedError extends Error {
    public readonly bucket: 'long' | 'medium' | 'short';
    public readonly resetAt: number;

    constructor(bucket: 'long' | 'medium' | 'short', resetAt: number) {
        super(`Rate limit (${bucket}) exhausted; resets at ${new Date(resetAt).toISOString()}`);
        this.name = 'RateLimitedError';
        this.bucket = bucket;
        this.resetAt = resetAt;
    }
}
