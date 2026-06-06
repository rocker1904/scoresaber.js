import type {HttpClient} from './http';
import type {RealmsResponse, RealmDetail} from './types';

export class RealmsResource {
    constructor(private readonly http: HttpClient) {}

    /** List all known realms (Quest vs PCVR vs historical realms). */
    public list(): Promise<RealmsResponse> {
        return this.http.get<RealmsResponse>('realms');
    }

    /** Details for a single realm. */
    public get(realmId: number): Promise<RealmDetail> {
        return this.http.get<RealmDetail>(`realms/${realmId}`);
    }
}
