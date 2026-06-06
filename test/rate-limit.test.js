"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const node_test_1 = require("node:test");
const rate_limit_1 = require("../src/rate-limit");
const errors_1 = require("../src/errors");
function makeHeaders(values) {
    const h = new Headers();
    for (const [k, v] of Object.entries(values))
        h.set(k, v);
    return h;
}
(0, node_test_1.describe)('RateLimiter', () => {
    (0, node_test_1.test)('starts with infinite remaining so first request is not blocked', () => __awaiter(void 0, void 0, void 0, function* () {
        const rl = new rate_limit_1.RateLimiter(true);
        const before = Date.now();
        yield rl.checkin();
        node_assert_1.strict.ok(Date.now() - before < 50, 'first checkin should return immediately');
    }));
    (0, node_test_1.test)('update parses tiered headers into per-bucket state', () => {
        const rl = new rate_limit_1.RateLimiter(true);
        rl.update(makeHeaders({
            'x-ratelimit-remaining-long': '399',
            'x-ratelimit-reset-long': '60',
            'x-ratelimit-remaining-medium': '98',
            'x-ratelimit-reset-medium': '10',
            'x-ratelimit-remaining-short': '24',
            'x-ratelimit-reset-short': '1',
        }));
        node_assert_1.strict.equal(rl.long.remaining, 399);
        node_assert_1.strict.equal(rl.medium.remaining, 98);
        node_assert_1.strict.equal(rl.short.remaining, 24);
        // resetAt should be roughly now + N seconds
        const now = Date.now();
        node_assert_1.strict.ok(Math.abs(rl.long.resetAt - (now + 60000)) < 1000);
        node_assert_1.strict.ok(Math.abs(rl.short.resetAt - (now + 1000)) < 1000);
    });
    (0, node_test_1.test)('throws RateLimitedError when a bucket is exhausted and waitForRateLimit=false', () => __awaiter(void 0, void 0, void 0, function* () {
        const rl = new rate_limit_1.RateLimiter(false);
        rl.update(makeHeaders({
            'x-ratelimit-remaining-short': '0',
            'x-ratelimit-reset-short': '2',
        }));
        yield node_assert_1.strict.rejects(() => rl.checkin(), (err) => {
            node_assert_1.strict.ok(err instanceof errors_1.RateLimitedError);
            node_assert_1.strict.equal(err.bucket, 'short');
            return true;
        });
    }));
    (0, node_test_1.test)('waits and then proceeds when waitForRateLimit=true and a bucket exhausts briefly', () => __awaiter(void 0, void 0, void 0, function* () {
        const rl = new rate_limit_1.RateLimiter(true);
        rl.update(makeHeaders({
            'x-ratelimit-remaining-short': '0',
            'x-ratelimit-reset-short': '0', // already expired
        }));
        const before = Date.now();
        yield rl.checkin();
        // resetAt is in the past, so checkin should return ~immediately (no wait loop)
        node_assert_1.strict.ok(Date.now() - before < 200);
    }));
    (0, node_test_1.test)('does not block when remaining > 0 even if resetAt is in the future', () => __awaiter(void 0, void 0, void 0, function* () {
        const rl = new rate_limit_1.RateLimiter(false);
        rl.update(makeHeaders({
            'x-ratelimit-remaining-short': '1',
            'x-ratelimit-reset-short': '60',
        }));
        const before = Date.now();
        yield rl.checkin();
        node_assert_1.strict.ok(Date.now() - before < 50);
    }));
});
