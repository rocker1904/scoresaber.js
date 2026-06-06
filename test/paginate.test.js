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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const node_test_1 = require("node:test");
const paginate_1 = require("../src/paginate");
(0, node_test_1.describe)('paginate', () => {
    (0, node_test_1.test)('stops at totalPages from metadata', () => __awaiter(void 0, void 0, void 0, function* () {
        const calls = [];
        const it = (0, paginate_1.paginate)((page) => {
            calls.push(page);
            return Promise.resolve({
                data: [page * 10, page * 10 + 1],
                metadata: { page, itemsPerPage: 2, totalItems: 6, totalPages: 3 },
            });
        });
        const all = yield (0, paginate_1.collect)(it);
        node_assert_1.strict.deepEqual(calls, [1, 2, 3]);
        node_assert_1.strict.deepEqual(all, [10, 11, 20, 21, 30, 31]);
    }));
    (0, node_test_1.test)('stops when a page returns empty data and metadata is absent', () => __awaiter(void 0, void 0, void 0, function* () {
        let page = 0;
        const it = (0, paginate_1.paginate)(() => {
            page++;
            return Promise.resolve({ data: page > 2 ? [] : [`p${page}-a`, `p${page}-b`] });
        });
        const all = yield (0, paginate_1.collect)(it);
        node_assert_1.strict.deepEqual(all, ['p1-a', 'p1-b', 'p2-a', 'p2-b']);
    }));
    (0, node_test_1.test)('consumer break halts further fetches', () => __awaiter(void 0, void 0, void 0, function* () {
        var _a, e_1, _b, _c;
        let fetched = 0;
        const it = (0, paginate_1.paginate)((page) => {
            fetched++;
            return Promise.resolve({
                data: Array.from({ length: 5 }, (_, i) => page * 100 + i),
                metadata: { page, itemsPerPage: 5, totalItems: 100, totalPages: 20 },
            });
        });
        const taken = [];
        try {
            for (var _d = true, it_1 = __asyncValues(it), it_1_1; it_1_1 = yield it_1.next(), _a = it_1_1.done, !_a; _d = true) {
                _c = it_1_1.value;
                _d = false;
                const x = _c;
                taken.push(x);
                if (taken.length === 3)
                    break;
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (!_d && !_a && (_b = it_1.return)) yield _b.call(it_1);
            }
            finally { if (e_1) throw e_1.error; }
        }
        node_assert_1.strict.deepEqual(taken, [100, 101, 102]);
        node_assert_1.strict.equal(fetched, 1, 'should not fetch a second page after break');
    }));
    (0, node_test_1.test)('collect respects optional limit', () => __awaiter(void 0, void 0, void 0, function* () {
        const it = (0, paginate_1.paginate)((page) => Promise.resolve({
            data: [page, page + 0.5],
            metadata: { page, itemsPerPage: 2, totalItems: 1000, totalPages: 500 },
        }));
        const first4 = yield (0, paginate_1.collect)(it, 4);
        node_assert_1.strict.deepEqual(first4, [1, 1.5, 2, 2.5]);
    }));
});
