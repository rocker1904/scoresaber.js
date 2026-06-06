import type {HttpClient} from './http';
import {paginate} from './paginate';
import type {RankingRequestCollection, RankingRequest, RankingRequestDetail} from './types';

export interface RankingQueueOpts {
    page?: number;
    limit?: number;
}

export class RankingQueueResource {
    constructor(private readonly http: HttpClient) {}

    public listPage(opts: RankingQueueOpts = {}): Promise<RankingRequestCollection> {
        return this.http.get<RankingRequestCollection>('ranking/requests', opts);
    }

    public list(opts: Omit<RankingQueueOpts, 'page'> = {}): AsyncIterable<RankingRequest> {
        return paginate<RankingRequest>(async (page) => {
            const env = await this.listPage({...opts, page});
            return {data: env.data as RankingRequest[], metadata: env.metadata};
        });
    }

    /** Single ranking request by id (includes replacement chain fields). */
    public get(requestId: number): Promise<RankingRequestDetail> {
        return this.http.get<RankingRequestDetail>(`ranking/requests/${requestId}`);
    }
}
