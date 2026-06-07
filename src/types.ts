/**
 * Named re-exports of API response types, derived from the OpenAPI spec.
 *
 * Prefer these aliases over reaching into `paths[...]` directly so the public
 * surface is stable across spec regenerations.
 */
import type {paths} from './generated/openapi-types';

type GetResponse<P extends keyof paths> = paths[P] extends {
    get: {responses: {200: {content: {'application/json': infer T}}}};
}
    ? T
    : never;

type Unwrap<T> = T extends {data: infer D} ? D : never;
type ItemOf<T> = T extends ReadonlyArray<infer U> ? U : never;

type QueryOf<P extends keyof paths> = paths[P] extends {get: {parameters: {query?: infer Q}}} ? NonNullable<Q> : never;

// Players
export type Player = GetResponse<'/api/v2/players/{id}'>;
export type BasicPlayer = GetResponse<'/api/v2/players/{id}/basic'>;
export type PlayerCollection = GetResponse<'/api/v2/players'>;
// The ranking-list item is a reduced player (no bio/badges/timestamps), so it is
// its own type — never widen it to the full `Player` from `/players/{id}`.
export type PlayerListing = ItemOf<Unwrap<PlayerCollection>>;
export type PlayerAliasesResponse = GetResponse<'/api/v2/players/{id}/aliases'>;
export type PlayerAlias = ItemOf<PlayerAliasesResponse>;
export type PlayerHistoryResponse = GetResponse<'/api/v2/players/{id}/history'>;
export type PlayerHistoryEntry = ItemOf<PlayerHistoryResponse>;
export type PlayerGlobalHistoryResponse = GetResponse<'/api/v2/players/{id}/global-history'>;
export type PlayerGlobalHistoryEntry = ItemOf<PlayerGlobalHistoryResponse>;

// Leaderboards
export type LeaderboardInfo = GetResponse<'/api/v2/leaderboards/{id}'>;
export type LeaderboardInfoCollection = GetResponse<'/api/v2/leaderboards'>;
// The listing item type, distinct from the single-board `LeaderboardInfo`
// (mirrors PlayerListing/MapListing — never widen the listing item).
export type LeaderboardListing = ItemOf<Unwrap<LeaderboardInfoCollection>>;
export type LeaderboardScoreCollection = GetResponse<'/api/v2/leaderboards/{id}/scores'>;
export type LeaderboardScore = ItemOf<Unwrap<LeaderboardScoreCollection>>;
export type LeaderboardByHashResponse = GetResponse<'/api/v2/leaderboards/hash/{hash}'>;
export type LeaderboardDifficulty = ItemOf<LeaderboardByHashResponse>;
export type LeaderboardByHashDifficulty = GetResponse<'/api/v2/leaderboards/hash/{hash}/{mode}/{difficulty}'>;

// Player scores
export type PlayerScoreCollection = GetResponse<'/api/v2/players/{id}/scores'>;
export type PlayerScore = ItemOf<Unwrap<PlayerScoreCollection>>;

// Scores
export type ScoreDetails = GetResponse<'/api/v2/scores/{id}'>;
export type ScoreHistory = GetResponse<'/api/v2/scores/{id}/history'>;
export type ScoreStats = GetResponse<'/api/v2/scores/{id}/stats'>;

// Maps
export type MapCollection = GetResponse<'/api/v2/maps'>;
export type MapListing = ItemOf<Unwrap<MapCollection>>;
export type MapInfo = GetResponse<'/api/v2/maps/{id}'>;

// Realms
export type RealmsResponse = GetResponse<'/api/v2/realms'>;
export type Realm = ItemOf<RealmsResponse>;
export type RealmDetail = GetResponse<'/api/v2/realms/{id}'>;

// Ranking queue
export type RankingRequestCollection = GetResponse<'/api/v2/ranking/requests'>;
export type RankingRequest = ItemOf<Unwrap<RankingRequestCollection>>;
export type RankingRequestDetail = GetResponse<'/api/v2/ranking/requests/{id}'>;

// Per-call request options, derived directly from the spec so they cannot
// drift from the real endpoint parameters. `realmId` is omitted because the
// client applies it globally via the `realmId` constructor option.
export type PlayersListQuery = Omit<QueryOf<'/api/v2/players'>, 'realmId'>;
export type PlayerScoresQuery = Omit<QueryOf<'/api/v2/players/{id}/scores'>, 'realmId'>;
export type LeaderboardsListQuery = Omit<QueryOf<'/api/v2/leaderboards'>, 'realmId'>;
export type LeaderboardScoresQuery = Omit<QueryOf<'/api/v2/leaderboards/{id}/scores'>, 'realmId'>;
// The by-hash scores endpoint accepts an extra `includePlayerScore` param the
// by-id one doesn't, so it gets its own query type rather than reusing the above.
export type LeaderboardScoresByHashQuery = Omit<QueryOf<'/api/v2/leaderboards/hash/{hash}/{mode}/{difficulty}/scores'>, 'realmId'>;
export type MapsListQuery = Omit<QueryOf<'/api/v2/maps'>, 'realmId'>;
export type RankingQueueQuery = Omit<QueryOf<'/api/v2/ranking/requests'>, 'realmId'>;

/** Re-export the raw spec path types for advanced consumers (escape hatch). */
export type {paths} from './generated/openapi-types';
