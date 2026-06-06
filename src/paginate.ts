/** Envelope returned by every list endpoint. */
export interface PagedEnvelope<T> {
    data: T[];
    metadata?: {
        page: number;
        itemsPerPage: number;
        totalItems: number;
        totalPages: number;
    };
}

/**
 * Wraps a per-page fetcher in an async iterator. Stops when:
 *   - metadata reports the current page is the last, OR
 *   - a page returns no items, OR
 *   - the consumer breaks out.
 */
export async function* paginate<T>(
    fetchPage: (page: number) => Promise<PagedEnvelope<T>>,
    startPage = 1,
): AsyncGenerator<T, void, undefined> {
    let page = startPage;
    for (;;) {
        const envelope = await fetchPage(page);
        for (const item of envelope.data) yield item;
        if (envelope.data.length === 0) return;
        const meta = envelope.metadata;
        if (meta && page >= meta.totalPages) return;
        page++;
    }
}

/** Materialize an async iterable into an array (use sparingly — unbounded fetches). */
export async function collect<T>(it: AsyncIterable<T>, limit?: number): Promise<T[]> {
    const out: T[] = [];
    for await (const x of it) {
        out.push(x);
        if (limit !== undefined && out.length >= limit) break;
    }
    return out;
}
