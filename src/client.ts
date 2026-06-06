import {HttpClient, FetchLike} from './http';
import {RateLimiter} from './rate-limit';
import {PlayersResource} from './players';
import {LeaderboardsResource} from './leaderboards';
import {ScoresResource} from './scores';
import {RankingQueueResource} from './ranking-queue';
import {MapsResource} from './maps';
import {RealmsResource} from './realms';

export interface ScoreSaberClientOptions {
    /** Default `https://scoresaber.com/api/v2`. */
    baseUrl?: string;
    /** Apply a realmId filter to every request (defaults to the API's active realm). */
    realmId?: number;
    /** Block until the rate-limit window refreshes when a bucket is exhausted. Defaults to `true`. */
    waitForRateLimit?: boolean;
    /** Inject a fetch implementation (testing, custom agents). Defaults to global `fetch`. */
    fetch?: FetchLike;
}

const DEFAULT_BASE_URL = 'https://scoresaber.com/api/v2';

/** WebSocket URL for the live score feed. The endpoint is unchanged from v1. */
export const SCORESABER_WS_URL = 'wss://scoresaber.com/ws';

export class ScoreSaberClient {
    public readonly rateLimit: RateLimiter;
    public readonly players: PlayersResource;
    public readonly leaderboards: LeaderboardsResource;
    public readonly scores: ScoresResource;
    public readonly rankingQueue: RankingQueueResource;
    public readonly maps: MapsResource;
    public readonly realms: RealmsResource;
    private readonly http: HttpClient;

    constructor(opts: ScoreSaberClientOptions = {}) {
        this.rateLimit = new RateLimiter(opts.waitForRateLimit ?? true);
        this.http = new HttpClient({
            baseUrl: opts.baseUrl ?? DEFAULT_BASE_URL,
            rateLimiter: this.rateLimit,
            fetchImpl: opts.fetch ?? ((input, init) => globalThis.fetch(input, init)),
            defaultQuery: opts.realmId !== undefined ? {realmId: opts.realmId} : undefined,
        });
        this.players = new PlayersResource(this.http);
        this.leaderboards = new LeaderboardsResource(this.http);
        this.scores = new ScoresResource(this.http);
        this.rankingQueue = new RankingQueueResource(this.http);
        this.maps = new MapsResource(this.http);
        this.realms = new RealmsResource(this.http);
    }

    /** Liveness check — returns the API's health payload. */
    public health(): Promise<unknown> {
        return this.http.get<unknown>('health');
    }
}
