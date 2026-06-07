import type {HttpClient, RequestOptions} from './http';
import {paginate} from './paginate';
import type {
    LeaderboardInfo,
    LeaderboardListing,
    LeaderboardInfoCollection,
    LeaderboardScoreCollection,
    LeaderboardScore,
    LeaderboardByHashResponse,
    LeaderboardByHashDifficulty,
    LeaderboardsListQuery,
    LeaderboardScoresQuery,
    LeaderboardScoresByHashQuery,
} from './types';

/** Leaderboards: listings, scores, and lookup by map hash. */
export class LeaderboardsResource {
    /** @internal */
    constructor(private readonly http: HttpClient) {}

    /** Single leaderboard's metadata + map info. */
    public get(leaderboardId: number, req?: RequestOptions): Promise<LeaderboardInfo> {
        return this.http.get<LeaderboardInfo>(`leaderboards/${leaderboardId}`, {}, req);
    }

    /** Single page of the leaderboard listings. */
    public listPage(opts: LeaderboardsListQuery = {}, req?: RequestOptions): Promise<LeaderboardInfoCollection> {
        return this.http.get<LeaderboardInfoCollection>('leaderboards', opts, req);
    }

    /** AsyncIterable over the leaderboard listings — paginates lazily. */
    public list(opts: Omit<LeaderboardsListQuery, 'page'> = {}, req?: RequestOptions): AsyncIterable<LeaderboardListing> {
        return paginate<LeaderboardListing>(async (page) => {
            const env = await this.listPage({...opts, page}, req);
            return {data: env.data, metadata: env.metadata};
        });
    }

    /** Single page of a leaderboard's scores. */
    public scoresPage(leaderboardId: number, opts: LeaderboardScoresQuery = {}, req?: RequestOptions): Promise<LeaderboardScoreCollection> {
        return this.http.get<LeaderboardScoreCollection>(`leaderboards/${leaderboardId}/scores`, opts, req);
    }

    /** AsyncIterable over a leaderboard's scores — paginates lazily. */
    public scores(
        leaderboardId: number,
        opts: Omit<LeaderboardScoresQuery, 'page'> = {},
        req?: RequestOptions,
    ): AsyncIterable<LeaderboardScore> {
        return paginate<LeaderboardScore>(async (page) => {
            const env = await this.scoresPage(leaderboardId, {...opts, page}, req);
            return {data: env.data, metadata: env.metadata};
        });
    }

    /** All difficulties available for a map identified by hash. */
    public byHash(hash: string, req?: RequestOptions): Promise<LeaderboardByHashResponse> {
        return this.http.get<LeaderboardByHashResponse>(`leaderboards/hash/${encodeURIComponent(hash)}`, {}, req);
    }

    /** Single difficulty of a map identified by hash + mode + difficulty. */
    public byHashDifficulty(hash: string, mode: string, difficulty: string, req?: RequestOptions): Promise<LeaderboardByHashDifficulty> {
        return this.http.get<LeaderboardByHashDifficulty>(
            `leaderboards/hash/${encodeURIComponent(hash)}/${encodeURIComponent(mode)}/${encodeURIComponent(difficulty)}`,
            {},
            req,
        );
    }

    /** Scores for a specific difficulty of a hashed map. */
    public scoresPageByHash(
        hash: string,
        mode: string,
        difficulty: string,
        opts: LeaderboardScoresByHashQuery = {},
        req?: RequestOptions,
    ): Promise<LeaderboardScoreCollection> {
        return this.http.get<LeaderboardScoreCollection>(
            `leaderboards/hash/${encodeURIComponent(hash)}/${encodeURIComponent(mode)}/${encodeURIComponent(difficulty)}/scores`,
            opts,
            req,
        );
    }

    /** AsyncIterable over scores for a hashed-map difficulty. */
    public scoresByHash(
        hash: string,
        mode: string,
        difficulty: string,
        opts: Omit<LeaderboardScoresByHashQuery, 'page'> = {},
        req?: RequestOptions,
    ): AsyncIterable<LeaderboardScore> {
        return paginate<LeaderboardScore>(async (page) => {
            const env = await this.scoresPageByHash(hash, mode, difficulty, {...opts, page}, req);
            return {data: env.data, metadata: env.metadata};
        });
    }
}
