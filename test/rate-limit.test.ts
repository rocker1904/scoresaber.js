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
    test('starts with a default budget so the first request is not blocked', async () => {
        const rl = new RateLimiter(true);
        assert.equal(rl.short.remaining, 25); // conservative default until the server reports its limit
        assert.equal(rl.short.limit, 25);
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

    test('exposes a per-bucket limit, learned from the header', () => {
        const rl = new RateLimiter(true);
        assert.equal(rl.short.limit, 25); // default before any response
        rl.update(
            makeHeaders({
                'x-ratelimit-limit-short': '30',
                'x-ratelimit-remaining-short': '29',
                'x-ratelimit-reset-short': '1',
            }),
        );
        assert.equal(rl.short.limit, 30);
        assert.equal(rl.short.remaining, 29);
    });

    test('an optimistic server snapshot cannot lower used within a window (no overshoot)', () => {
        const rl = new RateLimiter(true);
        // Establish a window: used jumps to 20 of 25, resets in 60s.
        rl.update(makeHeaders({'x-ratelimit-remaining-short': '5', 'x-ratelimit-reset-short': '60'}));
        assert.equal(rl.short.used, 20);
        // A later response in the SAME window reports a rosier remaining (server-used 8).
        rl.update(makeHeaders({'x-ratelimit-remaining-short': '17', 'x-ratelimit-reset-short': '59'}));
        assert.equal(rl.short.used, 20); // max rule: not lowered to 8
        assert.equal(rl.short.remaining, 5);
    });

    test('a window rollover accepts the server refill', () => {
        const rl = new RateLimiter(true);
        // Exhausted, window already expired.
        rl.update(makeHeaders({'x-ratelimit-remaining-short': '0', 'x-ratelimit-reset-short': '0'}));
        // Next response is a fresh window with budget again.
        rl.update(makeHeaders({'x-ratelimit-remaining-short': '24', 'x-ratelimit-reset-short': '1'}));
        assert.equal(rl.short.used, 1);
        assert.equal(rl.short.remaining, 24);
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
        assert.equal(rl.short.used, 1); // window rolled over, then this request reserved one
        assert.equal(rl.short.remaining, 24); // 25 default limit - 1 used
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

    test('update keeps a bucket at its default ceiling when its headers are absent', () => {
        const rl = new RateLimiter(true);
        rl.update(makeHeaders({'x-ratelimit-remaining-long': '300', 'x-ratelimit-reset-long': '60'}));
        assert.equal(rl.long.remaining, 300);
        assert.equal(rl.medium.remaining, 100); // default ceiling, untouched
        assert.equal(rl.short.remaining, 25); // default ceiling, untouched
    });

    test('cold start throttles a concurrent burst to the default ceiling', async () => {
        const rl = new RateLimiter(false); // throw rather than wait, so we can count what passes
        // No update() yet: limits are the conservative defaults. short = 25.
        const attempts = Array.from({length: 27}, () => rl.checkin());
        const results = await Promise.allSettled(attempts);
        const passed = results.filter((r) => r.status === 'fulfilled').length;
        assert.equal(passed, 25); // exactly the default short ceiling; the rest throw
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
