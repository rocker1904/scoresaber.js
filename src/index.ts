export {ScoreSaberClient, SCORESABER_WS_URL} from './client';
export type {ScoreSaberClientOptions, RealmScope} from './client';

export {ScoreSaberError, ScoreSaberAPIError, RateLimitedError, ScoreSaberTimeoutError, ScoreSaberNetworkError} from './errors';
export type {FetchLike, RequestOptions, RequestHookContext, ResponseHookContext} from './http';
export type {RateLimitView, BucketState, BucketName} from './rate-limit';
export {collect, pages, paginate} from './paginate';
export type {PagedEnvelope} from './paginate';

// Resource namespaces are not exported standalone: their instances live on
// `ScoreSaberClient` (e.g. `client.players`). To annotate one, use an indexed
// access type, e.g. `ScoreSaberClient['players']`.

export type {
    Player,
    PlayerListing,
    BasicPlayer,
    PlayerCollection,
    PlayerAlias,
    PlayerAliasesResponse,
    PlayerHistoryEntry,
    PlayerHistoryResponse,
    PlayerGlobalHistoryEntry,
    PlayerGlobalHistoryResponse,
    PlayerScore,
    PlayerScoreCollection,
    LeaderboardInfo,
    LeaderboardListing,
    LeaderboardInfoCollection,
    LeaderboardScore,
    LeaderboardScoreCollection,
    LeaderboardDifficulty,
    LeaderboardByHashResponse,
    LeaderboardByHashDifficulty,
    ScoreDetails,
    ScoreHistory,
    ScoreStats,
    MapInfo,
    MapCollection,
    MapListing,
    Realm,
    RealmsResponse,
    RealmDetail,
    RankingRequest,
    RankingRequestCollection,
    RankingRequestDetail,
    // Per-call query/filter option types (the shapes accepted by list/scores methods).
    PlayersListQuery,
    PlayerScoresQuery,
    LeaderboardsListQuery,
    LeaderboardScoresQuery,
    LeaderboardScoresByHashQuery,
    MapsListQuery,
    RankingQueueQuery,
    // Advanced escape hatch: the raw generated spec types. Use the named aliases
    // above for the wrapped endpoints; `paths` also covers endpoints this client
    // does not implement (admin/auth/etc). (`components` is omitted — the spec
    // inlines all schemas, so it resolves to `never`.)
    paths,
} from './types';
