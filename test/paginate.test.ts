import {strict as assert} from 'node:assert';
import {test, describe} from 'node:test';
import {paginate, collect} from '../src/paginate';

describe('paginate', () => {
    test('stops at totalPages from metadata', async () => {
        const calls: number[] = [];
        const it = paginate<number>((page) => {
            calls.push(page);
            return Promise.resolve({
                data: [page * 10, page * 10 + 1],
                metadata: {page, itemsPerPage: 2, totalItems: 6, totalPages: 3},
            });
        });
        const all = await collect(it);
        assert.deepEqual(calls, [1, 2, 3]);
        assert.deepEqual(all, [10, 11, 20, 21, 30, 31]);
    });

    test('stops when a page returns empty data and metadata is absent', async () => {
        let page = 0;
        const it = paginate<string>(() => {
            page++;
            return Promise.resolve({data: page > 2 ? [] : [`p${page}-a`, `p${page}-b`]});
        });
        const all = await collect(it);
        assert.deepEqual(all, ['p1-a', 'p1-b', 'p2-a', 'p2-b']);
    });

    test('consumer break halts further fetches', async () => {
        let fetched = 0;
        const it = paginate<number>((page) => {
            fetched++;
            return Promise.resolve({
                data: Array.from({length: 5}, (_, i) => page * 100 + i),
                metadata: {page, itemsPerPage: 5, totalItems: 100, totalPages: 20},
            });
        });
        const taken: number[] = [];
        for await (const x of it) {
            taken.push(x);
            if (taken.length === 3) break;
        }
        assert.deepEqual(taken, [100, 101, 102]);
        assert.equal(fetched, 1, 'should not fetch a second page after break');
    });

    test('collect respects optional limit', async () => {
        const it = paginate<number>((page) => Promise.resolve({
            data: [page, page + 0.5],
            metadata: {page, itemsPerPage: 2, totalItems: 1000, totalPages: 500},
        }));
        const first4 = await collect(it, 4);
        assert.deepEqual(first4, [1, 1.5, 2, 2.5]);
    });
});
