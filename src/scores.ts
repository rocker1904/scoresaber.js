import type {HttpClient} from './http';
import type {ScoreDetails, ScoreHistory, ScoreStats} from './types';

export class ScoresResource {
    constructor(private readonly http: HttpClient) {}

    /** Details for a single score (the leaderboard entry plus map info). */
    public get(scoreId: number): Promise<ScoreDetails> {
        return this.http.get<ScoreDetails>(`scores/${scoreId}`);
    }

    /** Historic data points for a score (improvements over time). */
    public history(scoreId: number): Promise<ScoreHistory> {
        return this.http.get<ScoreHistory>(`scores/${scoreId}/history`);
    }

    /** Per-score statistics (note counts, accuracy breakdown, hit/miss). */
    public stats(scoreId: number): Promise<ScoreStats> {
        return this.http.get<ScoreStats>(`scores/${scoreId}/stats`);
    }

    /** Raw replay binary for a score (.bsor). */
    public replay(scoreId: number): Promise<ArrayBuffer> {
        return this.http.getBinary(`scores/${scoreId}/replay`);
    }
}
