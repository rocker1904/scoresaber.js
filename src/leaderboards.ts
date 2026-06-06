import type {HttpClient} from './http';
import {paginate} from './paginate';
import type {
    LeaderboardInfo, LeaderboardInfoCollection,
    LeaderboardScoreCollection, LeaderboardScore,
    LeaderboardByHashResponse, LeaderboardByHashDifficulty,
} from './types';

export interface LeaderboardsListOpts {
    page?: number;
    limit?: number;
    ranked?: boolean;
    qualified?: boolean;
    loved?: boolean;
    minStar?: number;
    maxStar?: number;
    category?: number;
    sort?: string;
    sortDirection?: 'asc' | 'desc';
    search?: string;
}

export interface LeaderboardScoresOpts {
    page?: number;
    limit?: number;
    countries?: string;
    scope?: 'country' | 'friends' | 'global';
    search?: string;
    sort?: string;
    sortDirection?: 'asc' | 'desc';
    hideNA?: boolean;
}

export class LeaderboardsResource {
    constructor(private readonly http: HttpClient) {}

    /** Single leaderboard's metadata + map info. */
    public get(leaderboardId: number): Promise<LeaderboardInfo> {
        return this.http.get<LeaderboardInfo>(`leaderboards/${leaderboardId}`);
    }

    public listPage(opts: LeaderboardsListOpts = {}): Promise<LeaderboardInfoCollection> {
        return this.http.get<LeaderboardInfoCollection>('leaderboards', opts);
    }

    public list(opts: Omit<LeaderboardsListOpts, 'page'> = {}): AsyncIterable<LeaderboardInfo> {
        return paginate<LeaderboardInfo>(async (page) => {
            const env = await this.listPage({...opts, page});
            return {data: env.data as LeaderboardInfo[], metadata: env.metadata};
        });
    }

    public scoresPage(leaderboardId: number, opts: LeaderboardScoresOpts = {}): Promise<LeaderboardScoreCollection> {
        return this.http.get<LeaderboardScoreCollection>(`leaderboards/${leaderboardId}/scores`, opts);
    }

    public scores(leaderboardId: number, opts: Omit<LeaderboardScoresOpts, 'page'> = {}): AsyncIterable<LeaderboardScore> {
        return paginate<LeaderboardScore>(async (page) => {
            const env = await this.scoresPage(leaderboardId, {...opts, page});
            return {data: env.data as LeaderboardScore[], metadata: env.metadata};
        });
    }

    /** All difficulties available for a map identified by hash. */
    public byHash(hash: string): Promise<LeaderboardByHashResponse> {
        return this.http.get<LeaderboardByHashResponse>(`leaderboards/hash/${encodeURIComponent(hash)}`);
    }

    /** Single difficulty of a map identified by hash + mode + difficulty. */
    public byHashDifficulty(hash: string, mode: string, difficulty: string): Promise<LeaderboardByHashDifficulty> {
        return this.http.get<LeaderboardByHashDifficulty>(
            `leaderboards/hash/${encodeURIComponent(hash)}/${encodeURIComponent(mode)}/${encodeURIComponent(difficulty)}`,
        );
    }

    /** Scores for a specific difficulty of a hashed map. */
    public scoresPageByHash(hash: string, mode: string, difficulty: string, opts: LeaderboardScoresOpts = {}): Promise<LeaderboardScoreCollection> {
        return this.http.get<LeaderboardScoreCollection>(
            `leaderboards/hash/${encodeURIComponent(hash)}/${encodeURIComponent(mode)}/${encodeURIComponent(difficulty)}/scores`,
            opts,
        );
    }

    /** AsyncIterable over scores for a hashed-map difficulty. */
    public scoresByHash(hash: string, mode: string, difficulty: string, opts: Omit<LeaderboardScoresOpts, 'page'> = {}): AsyncIterable<LeaderboardScore> {
        return paginate<LeaderboardScore>(async (page) => {
            const env = await this.scoresPageByHash(hash, mode, difficulty, {...opts, page});
            return {data: env.data as LeaderboardScore[], metadata: env.metadata};
        });
    }
}
