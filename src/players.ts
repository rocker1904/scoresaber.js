import type {HttpClient} from './http';
import {paginate} from './paginate';
import type {
    Player, BasicPlayer, PlayerCollection,
    PlayerScoreCollection, PlayerScore,
    PlayerAliasesResponse, PlayerHistoryResponse, PlayerGlobalHistoryResponse,
} from './types';

export interface PlayersListOpts {
    page?: number;
    limit?: number;
    countries?: string;
    search?: string;
    sort?: string;
    sortDirection?: 'asc' | 'desc';
}

export interface PlayerScoresOpts {
    page?: number;
    limit?: number;
    sort?: 'top' | 'recent';
    leaderboardId?: number;
    from?: string;
    to?: string;
}

export class PlayersResource {
    constructor(private readonly http: HttpClient) {}

    /** Full player profile, including stats. */
    public get(playerId: string): Promise<Player> {
        return this.http.get<Player>(`players/${encodeURIComponent(playerId)}`);
    }

    /** Player identity + stats only (faster than `.get`). */
    public getBasic(playerId: string): Promise<BasicPlayer> {
        return this.http.get<BasicPlayer>(`players/${encodeURIComponent(playerId)}/basic`);
    }

    /** Single page of the players ranking list. */
    public listPage(opts: PlayersListOpts = {}): Promise<PlayerCollection> {
        return this.http.get<PlayerCollection>('players', opts);
    }

    /** AsyncIterable over the players ranking list — paginates lazily. */
    public list(opts: Omit<PlayersListOpts, 'page'> = {}): AsyncIterable<Player> {
        return paginate<Player>(async (page) => {
            const env = await this.listPage({...opts, page});
            return {data: env.data as Player[], metadata: env.metadata};
        });
    }

    /** Player at an exact global or regional rank. */
    public async atRank(rank: number, opts: Omit<PlayersListOpts, 'page' | 'limit'> = {}): Promise<Player> {
        const limit = 50;
        const page = Math.ceil(rank / limit);
        const env = await this.listPage({...opts, page, limit});
        const idx = (rank - 1) % limit;
        return env.data[idx] as Player;
    }

    /** Single page of a player's scores. */
    public scoresPage(playerId: string, opts: PlayerScoresOpts = {}): Promise<PlayerScoreCollection> {
        return this.http.get<PlayerScoreCollection>(`players/${encodeURIComponent(playerId)}/scores`, opts);
    }

    /** AsyncIterable over a player's scores — paginates lazily. */
    public scores(playerId: string, opts: Omit<PlayerScoresOpts, 'page'> = {}): AsyncIterable<PlayerScore> {
        return paginate<PlayerScore>(async (page) => {
            const env = await this.scoresPage(playerId, {limit: 100, ...opts, page});
            return {data: env.data as PlayerScore[], metadata: env.metadata};
        });
    }

    /** Total registered players on the platform. */
    public async count(): Promise<number> {
        const r = await this.http.get<{count: number}>('players/count');
        return r.count;
    }

    /** All recorded name aliases for a player. */
    public aliases(playerId: string): Promise<PlayerAliasesResponse> {
        return this.http.get<PlayerAliasesResponse>(`players/${encodeURIComponent(playerId)}/aliases`);
    }

    /** Historic stat snapshots for the player. */
    public history(playerId: string): Promise<PlayerHistoryResponse> {
        return this.http.get<PlayerHistoryResponse>(`players/${encodeURIComponent(playerId)}/history`);
    }

    /** Historic global rank for the player. */
    public globalHistory(playerId: string): Promise<PlayerGlobalHistoryResponse> {
        return this.http.get<PlayerGlobalHistoryResponse>(`players/${encodeURIComponent(playerId)}/global-history`);
    }
}
