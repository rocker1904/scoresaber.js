import {strict as assert} from 'node:assert';
import {test, describe} from 'node:test';
import {RateLimiter} from '../src/rate-limit';
import {RateLimitedError} from '../src/errors';

function makeHeaders(values: Record<string, string>): Headers {
    const h = new Headers();
    for (const [k, v] of Object.entries(values)) h.set(k, v);
    return h;
}

describe('RateLimiter', () => {
    test('starts with infinite remaining so first request is not blocked', async () => {
        const rl = new RateLimiter(true);
        const before = Date.now();
        await rl.checkin();
        assert.ok(Date.now() - before < 50, 'first checkin should return immediately');
    });

    test('update parses tiered headers into per-bucket state', () => {
        const rl = new RateLimiter(true);
        rl.update(makeHeaders({
            'x-ratelimit-remaining-long': '399',
            'x-ratelimit-reset-long': '60',
            'x-ratelimit-remaining-medium': '98',
            'x-ratelimit-reset-medium': '10',
            'x-ratelimit-remaining-short': '24',
            'x-ratelimit-reset-short': '1',
        }));
        assert.equal(rl.long.remaining, 399);
        assert.equal(rl.medium.remaining, 98);
        assert.equal(rl.short.remaining, 24);
        // resetAt should be roughly now + N seconds
        const now = Date.now();
        assert.ok(Math.abs(rl.long.resetAt - (now + 60_000)) < 1000);
        assert.ok(Math.abs(rl.short.resetAt - (now + 1000)) < 1000);
    });

    test('throws RateLimitedError when a bucket is exhausted and waitForRateLimit=false', async () => {
        const rl = new RateLimiter(false);
        rl.update(makeHeaders({
            'x-ratelimit-remaining-short': '0',
            'x-ratelimit-reset-short': '2',
        }));
        await assert.rejects(() => rl.checkin(), (err: unknown) => {
            assert.ok(err instanceof RateLimitedError);
            assert.equal(err.bucket, 'short');
            return true;
        });
    });

    test('waits and then proceeds when waitForRateLimit=true and a bucket exhausts briefly', async () => {
        const rl = new RateLimiter(true);
        rl.update(makeHeaders({
            'x-ratelimit-remaining-short': '0',
            'x-ratelimit-reset-short': '0', // already expired
        }));
        const before = Date.now();
        await rl.checkin();
        // resetAt is in the past, so checkin should return ~immediately (no wait loop)
        assert.ok(Date.now() - before < 200);
    });

    test('does not block when remaining > 0 even if resetAt is in the future', async () => {
        const rl = new RateLimiter(false);
        rl.update(makeHeaders({
            'x-ratelimit-remaining-short': '1',
            'x-ratelimit-reset-short': '60',
        }));
        const before = Date.now();
        await rl.checkin();
        assert.ok(Date.now() - before < 50);
    });
});
