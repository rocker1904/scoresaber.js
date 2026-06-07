import type {HttpClient, RequestOptions} from './http';
import {paginate} from './paginate';
import type {
    Player,
    PlayerListing,
    BasicPlayer,
    PlayerCollection,
    PlayerScoreCollection,
    PlayerScore,
    PlayerAliasesResponse,
    PlayerHistoryResponse,
    PlayerGlobalHistoryResponse,
    PlayersListQuery,
    PlayerScoresQuery,
} from './types';

/** Player profiles, rankings, scores, history, and aliases. */
export class PlayersResource {
    /** @internal */
    constructor(private readonly http: HttpClient) {}

    /** Full player profile, including stats. */
    public get(playerId: string, req?: RequestOptions): Promise<Player> {
        return this.http.get<Player>(`players/${encodeURIComponent(playerId)}`, {}, req);
    }

    /** Player identity + stats only (faster than `.get`). */
    public getBasic(playerId: string, req?: RequestOptions): Promise<BasicPlayer> {
        return this.http.get<BasicPlayer>(`players/${encodeURIComponent(playerId)}/basic`, {}, req);
    }

    /** Single page of the players ranking list. */
    public listPage(opts: PlayersListQuery = {}, req?: RequestOptions): Promise<PlayerCollection> {
        return this.http.get<PlayerCollection>('players', opts, req);
    }

    /** AsyncIterable over the players ranking list — paginates lazily. */
    public list(opts: Omit<PlayersListQuery, 'page'> = {}, req?: RequestOptions): AsyncIterable<PlayerListing> {
        return paginate<PlayerListing>(async (page) => {
            const env = await this.listPage({...opts, page}, req);
            return {data: env.data, metadata: env.metadata};
        });
    }

    /** Player at an exact global or regional rank. */
    public async atRank(rank: number, opts: Omit<PlayersListQuery, 'page' | 'limit'> = {}, req?: RequestOptions): Promise<PlayerListing> {
        if (!Number.isInteger(rank) || rank < 1) {
            throw new RangeError(`rank must be a positive integer, got ${rank}`);
        }
        const limit = 50;
        const page = Math.ceil(rank / limit);
        const env = await this.listPage({...opts, page, limit}, req);
        const player = env.data[(rank - 1) % limit];
        if (player === undefined) {
            throw new RangeError(`no player at rank ${rank}`);
        }
        return player;
    }

    /** Single page of a player's scores. */
    public scoresPage(playerId: string, opts: PlayerScoresQuery = {}, req?: RequestOptions): Promise<PlayerScoreCollection> {
        return this.http.get<PlayerScoreCollection>(`players/${encodeURIComponent(playerId)}/scores`, opts, req);
    }

    /** AsyncIterable over a player's scores — paginates lazily. */
    public scores(playerId: string, opts: Omit<PlayerScoresQuery, 'page'> = {}, req?: RequestOptions): AsyncIterable<PlayerScore> {
        return paginate<PlayerScore>(async (page) => {
            const env = await this.scoresPage(playerId, {...opts, page}, req);
            return {data: env.data, metadata: env.metadata};
        });
    }

    /** Total registered players on the platform. */
    public async count(req?: RequestOptions): Promise<number> {
        const r = await this.http.get<{count: number}>('players/count', {}, req);
        return r.count;
    }

    /** All recorded name aliases for a player. */
    public aliases(playerId: string, req?: RequestOptions): Promise<PlayerAliasesResponse> {
        return this.http.get<PlayerAliasesResponse>(`players/${encodeURIComponent(playerId)}/aliases`, {}, req);
    }

    /** Historic stat snapshots for the player. */
    public history(playerId: string, req?: RequestOptions): Promise<PlayerHistoryResponse> {
        return this.http.get<PlayerHistoryResponse>(`players/${encodeURIComponent(playerId)}/history`, {}, req);
    }

    /** Historic global rank for the player. */
    public globalHistory(playerId: string, req?: RequestOptions): Promise<PlayerGlobalHistoryResponse> {
        return this.http.get<PlayerGlobalHistoryResponse>(`players/${encodeURIComponent(playerId)}/global-history`, {}, req);
    }
}
