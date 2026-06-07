import type {HttpClient, RequestOptions} from './http';
import type {ScoreDetails, ScoreHistory, ScoreStats} from './types';

/** Individual scores: details, history, stats, and replays. */
export class ScoresResource {
    /** @internal */
    constructor(private readonly http: HttpClient) {}

    /** Details for a single score (the leaderboard entry plus map info). */
    public get(scoreId: number, req?: RequestOptions): Promise<ScoreDetails> {
        return this.http.get<ScoreDetails>(`scores/${scoreId}`, {}, req);
    }

    /** Historic data points for a score (improvements over time). */
    public history(scoreId: number, req?: RequestOptions): Promise<ScoreHistory> {
        return this.http.get<ScoreHistory>(`scores/${scoreId}/history`, {}, req);
    }

    /** Per-score statistics (note counts, accuracy breakdown, hit/miss). */
    public stats(scoreId: number, req?: RequestOptions): Promise<ScoreStats> {
        return this.http.get<ScoreStats>(`scores/${scoreId}/stats`, {}, req);
    }

    /** Raw replay binary for a score (.bsor). */
    public replay(scoreId: number, req?: RequestOptions): Promise<ArrayBuffer> {
        return this.http.getBinary(`scores/${scoreId}/replay`, {}, req);
    }
}
