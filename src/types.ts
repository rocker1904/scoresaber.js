/**
 * Named re-exports of API response types, derived from the OpenAPI spec.
 *
 * Prefer these aliases over reaching into `paths[...]` directly so the public
 * surface is stable across spec regenerations.
 */
import type {paths} from './generated/openapi-types';

type GetResponse<P extends keyof paths> = paths[P] extends {
    get: {responses: {200: {content: {'application/json': infer T}}}};
} ? T : never;

type Unwrap<T> = T extends {data: infer D} ? D : never;
type ItemOf<T> = T extends ReadonlyArray<infer U> ? U : never;

// Players
export type Player = GetResponse<'/api/v2/players/{id}'>;
export type BasicPlayer = GetResponse<'/api/v2/players/{id}/basic'>;
export type PlayerCollection = GetResponse<'/api/v2/players'>;
export type PlayerAliasesResponse = GetResponse<'/api/v2/players/{id}/aliases'>;
export type PlayerAlias = ItemOf<PlayerAliasesResponse>;
export type PlayerHistoryResponse = GetResponse<'/api/v2/players/{id}/history'>;
export type PlayerHistoryEntry = ItemOf<PlayerHistoryResponse>;
export type PlayerGlobalHistoryResponse = GetResponse<'/api/v2/players/{id}/global-history'>;
export type PlayerGlobalHistoryEntry = ItemOf<PlayerGlobalHistoryResponse>;

// Leaderboards
export type LeaderboardInfo = GetResponse<'/api/v2/leaderboards/{id}'>;
export type LeaderboardInfoCollection = GetResponse<'/api/v2/leaderboards'>;
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
export type MapInfo = GetResponse<'/api/v2/maps/{id}'>;

// Realms
export type RealmsResponse = GetResponse<'/api/v2/realms'>;
export type Realm = ItemOf<RealmsResponse>;
export type RealmDetail = GetResponse<'/api/v2/realms/{id}'>;

// Ranking queue
export type RankingRequestCollection = GetResponse<'/api/v2/ranking/requests'>;
export type RankingRequest = ItemOf<Unwrap<RankingRequestCollection>>;
export type RankingRequestDetail = GetResponse<'/api/v2/ranking/requests/{id}'>;

/** Re-export the raw spec types for advanced consumers. */
export type {paths, components} from './generated/openapi-types';
