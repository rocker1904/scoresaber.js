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
        rl.update(
            makeHeaders({
                'x-ratelimit-remaining-long': '399',
                'x-ratelimit-reset-long': '60',
                'x-ratelimit-remaining-medium': '98',
                'x-ratelimit-reset-medium': '10',
                'x-ratelimit-remaining-short': '24',
                'x-ratelimit-reset-short': '1',
            }),
        );
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
        rl.update(
            makeHeaders({
                'x-ratelimit-remaining-short': '0',
                'x-ratelimit-reset-short': '2',
            }),
        );
        await assert.rejects(
            () => rl.checkin(),
            (err: unknown) => {
                assert.ok(err instanceof RateLimitedError);
                assert.equal(err.bucket, 'short');
                return true;
            },
        );
    });

    test('waits and then proceeds when waitForRateLimit=true and a bucket exhausts briefly', async () => {
        const rl = new RateLimiter(true);
        rl.update(
            makeHeaders({
                'x-ratelimit-remaining-short': '0',
                'x-ratelimit-reset-short': '0', // already expired
            }),
        );
        const before = Date.now();
        await rl.checkin();
        // resetAt is in the past, so checkin should return ~immediately (no wait loop)
        assert.ok(Date.now() - before < 200);
    });

    test('blocks until a future reset, then proceeds, when waitForRateLimit=true', async () => {
        const rl = new RateLimiter(true);
        // ~300ms in the future (the header is parsed as seconds * 1000).
        rl.update(makeHeaders({'x-ratelimit-remaining-short': '0', 'x-ratelimit-reset-short': '0.3'}));
        const before = Date.now();
        await rl.checkin();
        const waited = Date.now() - before;
        // It must actually enter the wait loop (not return immediately) and then resolve.
        assert.ok(waited >= 250, `expected to block until the window reset, only waited ${waited}ms`);
        assert.equal(rl.short.remaining, -1); // decremented once it finally passes
    });

    test('update ignores non-finite reset headers (no busy-spin from Infinity)', () => {
        const rl = new RateLimiter(true);
        rl.update(makeHeaders({'x-ratelimit-remaining-short': '0', 'x-ratelimit-reset-short': 'Infinity'}));
        // A bad header must not push resetAt out of setTimeout's range.
        assert.ok(Number.isFinite(rl.short.resetAt), 'resetAt should stay finite');
        assert.equal(rl.short.resetAt, 0); // untouched
    });

    test('clamps an absurdly large finite reset so it cannot overflow setTimeout / busy-spin', () => {
        const rl = new RateLimiter(true);
        const now = Date.now();
        rl.update(makeHeaders({'x-ratelimit-remaining-short': '0', 'x-ratelimit-reset-short': '9e15'}));
        assert.ok(Number.isFinite(rl.short.resetAt));
        // Clamped to within ~24h, well inside setTimeout's 32-bit range.
        assert.ok(rl.short.resetAt <= now + 24 * 60 * 60 * 1000 + 1000, `resetAt should be clamped, got ${rl.short.resetAt}`);
    });

    test('update leaves buckets unbounded when their headers are absent', () => {
        const rl = new RateLimiter(true);
        rl.update(makeHeaders({'x-ratelimit-remaining-long': '300', 'x-ratelimit-reset-long': '60'}));
        assert.equal(rl.long.remaining, 300);
        assert.equal(rl.medium.remaining, Infinity);
        assert.equal(rl.short.remaining, Infinity);
    });

    test('reserves capacity so concurrent checkins cannot oversubscribe a bucket', async () => {
        const rl = new RateLimiter(false);
        rl.update(
            makeHeaders({
                'x-ratelimit-remaining-short': '1',
                'x-ratelimit-reset-short': '60',
            }),
        );
        const results = await Promise.allSettled([rl.checkin(), rl.checkin()]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        const rejected = results.filter((r) => r.status === 'rejected');
        assert.equal(rejected.length, 1);
        assert.ok(rejected[0].reason instanceof RateLimitedError);
        assert.equal(rl.short.remaining, 0);
    });

    test('checkin aborts promptly when the caller signal fires during the wait', async () => {
        const rl = new RateLimiter(true);
        // Exhausted with a reset 10s out — without abort support this would block ~10s.
        rl.update(makeHeaders({'x-ratelimit-remaining-short': '0', 'x-ratelimit-reset-short': '10'}));
        const controller = new AbortController();
        const reason = new Error('cancelled during wait');
        const before = Date.now();
        setTimeout(() => controller.abort(reason), 20);
        await assert.rejects(
            () => rl.checkin(controller.signal),
            (err: unknown) => err === reason,
        );
        assert.ok(Date.now() - before < 500, 'should abort well before the 10s reset window');
    });

    test('a checkin queued behind another caller still aborts promptly', async () => {
        const rl = new RateLimiter(true);
        // Caller A: exhausted with a far reset, so A holds the gate while it waits.
        rl.update(makeHeaders({'x-ratelimit-remaining-short': '0', 'x-ratelimit-reset-short': '10'}));
        const aController = new AbortController();
        const a = rl.checkin(aController.signal); // enters the wait loop, holds the gate

        // Caller B queues behind A and aborts while still waiting for the gate.
        const bController = new AbortController();
        const reason = new Error('B cancelled while queued');
        const before = Date.now();
        setTimeout(() => bController.abort(reason), 20);
        await assert.rejects(
            () => rl.checkin(bController.signal),
            (err: unknown) => err === reason,
        );
        assert.ok(Date.now() - before < 500, 'B should not wait out A’s 10s window');

        aController.abort(new Error('cleanup')); // release A so it doesn't dangle
        await a.catch(() => undefined);
    });

    test('does not block when remaining > 0 even if resetAt is in the future', async () => {
        const rl = new RateLimiter(false);
        rl.update(
            makeHeaders({
                'x-ratelimit-remaining-short': '1',
                'x-ratelimit-reset-short': '60',
            }),
        );
        const before = Date.now();
        await rl.checkin();
        assert.ok(Date.now() - before < 50);
    });
});
