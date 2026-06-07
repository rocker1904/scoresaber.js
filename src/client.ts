import {HttpClient, FetchLike, RequestHookContext, ResponseHookContext, RequestOptions} from './http';
import {RateLimiter} from './rate-limit';
import type {RateLimitView} from './rate-limit';
import {PlayersResource} from './players';
import {LeaderboardsResource} from './leaderboards';
import {ScoresResource} from './scores';
import {RankingQueueResource} from './ranking-queue';
import {MapsResource} from './maps';
import {RealmsResource} from './realms';

declare const __VERSION__: string | undefined;
const VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.0-dev';

export interface ScoreSaberClientOptions {
    /** Default `https://scoresaber.com/api/v2`. */
    baseUrl?: string;
    /**
     * Default realm filter for every request (the API's active realm if unset).
     * Override per call via `RequestOptions.realmId`, or scope a batch with
     * `client.realm(id)` — both keep the single shared rate-limit budget.
     */
    realmId?: number;
    /**
     * Block until the rate-limit window refreshes when a bucket is exhausted, and wait
     * out a server `429` (until it clears) rather than throwing. Defaults to `true`.
     * Set `false` to throw `RateLimitedError` instead of waiting.
     */
    waitForRateLimit?: boolean;
    /** Inject a fetch implementation (testing, custom agents). Defaults to global `fetch`. */
    fetch?: FetchLike;
    /**
     * Abort a request attempt after this many milliseconds. Defaults to `30000`.
     * This bounds each network attempt, not the whole call — it does not cap time
     * spent waiting on the rate limiter (governed by `waitForRateLimit`) or retry
     * backoff. To cancel a request that is waiting, pass a `signal`.
     */
    timeoutMs?: number;
    /**
     * Retries on 5xx and transient network errors. Defaults to `2`. A `429` under
     * `waitForRateLimit` is waited out separately and is not bounded by this.
     */
    maxRetries?: number;
    /** Override the default `User-Agent` header. */
    userAgent?: string;
    /** Reject responses whose Content-Length exceeds this many bytes. */
    maxResponseBytes?: number;
    /** Called before each request attempt (logging, metrics). */
    onRequest?: (ctx: RequestHookContext) => void;
    /**
     * Called after each response is received (logging, metrics). The client still
     * consumes `ctx.response` body afterwards, so read it via `ctx.response.clone()`.
     */
    onResponse?: (ctx: ResponseHookContext) => void;
}

const DEFAULT_BASE_URL = 'https://scoresaber.com/api/v2';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_USER_AGENT = `scoresaber.js/${VERSION} (+https://github.com/rocker1904/scoresaber.js)`;

/** WebSocket URL for the live score feed. The endpoint is unchanged from v1. */
export const SCORESABER_WS_URL = 'wss://scoresaber.com/ws';

/** Client for the ScoreSaber v2 API; construct once and reuse. */
export class ScoreSaberClient {
    /** Read-only view of the tracked rate-limit buckets. */
    public readonly rateLimit: RateLimitView;
    public readonly players: PlayersResource;
    public readonly leaderboards: LeaderboardsResource;
    public readonly scores: ScoresResource;
    public readonly rankingQueue: RankingQueueResource;
    public readonly maps: MapsResource;
    public readonly realms: RealmsResource;
    private readonly http: HttpClient;

    constructor(opts: ScoreSaberClientOptions = {}) {
        const rateLimiter = new RateLimiter(opts.waitForRateLimit ?? true);
        this.rateLimit = rateLimiter;
        this.http = new HttpClient({
            baseUrl: opts.baseUrl ?? DEFAULT_BASE_URL,
            rateLimiter,
            fetchImpl: opts.fetch ?? ((input, init) => globalThis.fetch(input, init)),
            userAgent: opts.userAgent ?? DEFAULT_USER_AGENT,
            defaultQuery: opts.realmId !== undefined ? {realmId: opts.realmId} : undefined,
            timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            maxRetries: opts.maxRetries ?? DEFAULT_MAX_RETRIES,
            maxResponseBytes: opts.maxResponseBytes,
            onRequest: opts.onRequest,
            onResponse: opts.onResponse,
        });
        const resources = makeResources(this.http);
        this.players = resources.players;
        this.leaderboards = resources.leaderboards;
        this.scores = resources.scores;
        this.rankingQueue = resources.rankingQueue;
        this.maps = resources.maps;
        this.realms = resources.realms;
    }

    /**
     * A realm-scoped view over this same client: every call applies `realmId` and
     * shares this client's rate-limit budget, so multiple realms stay coordinated
     * (unlike constructing a second client). Hold the returned handle to reuse it.
     *
     * A per-call `realmId` in `RequestOptions` still overrides the scope.
     */
    public realm(realmId: number): RealmScope {
        return makeResources(this.http.withDefaultQuery({realmId}));
    }

    /** Liveness check — returns the API's health payload. */
    public health(req?: RequestOptions): Promise<Record<string, unknown>> {
        return this.http.get<Record<string, unknown>>('health', {}, req);
    }
}

/** The resource namespaces scoped to a realm — returned by {@link ScoreSaberClient.realm}. */
export type RealmScope = Pick<ScoreSaberClient, 'players' | 'leaderboards' | 'scores' | 'rankingQueue' | 'maps' | 'realms'>;

function makeResources(http: HttpClient): RealmScope {
    return {
        players: new PlayersResource(http),
        leaderboards: new LeaderboardsResource(http),
        scores: new ScoresResource(http),
        rankingQueue: new RankingQueueResource(http),
        maps: new MapsResource(http),
        realms: new RealmsResource(http),
    };
}
