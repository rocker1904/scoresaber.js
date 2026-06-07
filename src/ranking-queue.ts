import type {HttpClient, RequestOptions} from './http';
import {paginate} from './paginate';
import type {RankingRequestCollection, RankingRequest, RankingRequestDetail, RankingQueueQuery} from './types';

/** The ranked-map request queue. */
export class RankingQueueResource {
    /** @internal */
    constructor(private readonly http: HttpClient) {}

    /** Single page of the ranking queue. */
    public listPage(opts: RankingQueueQuery = {}, req?: RequestOptions): Promise<RankingRequestCollection> {
        return this.http.get<RankingRequestCollection>('ranking/requests', opts, req);
    }

    /** AsyncIterable over the ranking queue — paginates lazily. */
    public list(opts: Omit<RankingQueueQuery, 'page'> = {}, req?: RequestOptions): AsyncIterable<RankingRequest> {
        return paginate<RankingRequest>(async (page) => {
            const env = await this.listPage({...opts, page}, req);
            return {data: env.data, metadata: env.metadata};
        });
    }

    /** Single ranking request by id (includes replacement chain fields). */
    public get(requestId: number, req?: RequestOptions): Promise<RankingRequestDetail> {
        return this.http.get<RankingRequestDetail>(`ranking/requests/${requestId}`, {}, req);
    }
}
