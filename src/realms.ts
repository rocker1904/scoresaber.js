import type {HttpClient, RequestOptions} from './http';
import type {RealmsResponse, RealmDetail} from './types';

/** Realms (e.g. PCVR, Quest): listing and lookup. */
export class RealmsResource {
    /** @internal */
    constructor(private readonly http: HttpClient) {}

    /** List all known realms (Quest vs PCVR vs historical realms). */
    public list(req?: RequestOptions): Promise<RealmsResponse> {
        return this.http.get<RealmsResponse>('realms', {}, req);
    }

    /** Details for a single realm. */
    public get(realmId: number, req?: RequestOptions): Promise<RealmDetail> {
        return this.http.get<RealmDetail>(`realms/${realmId}`, {}, req);
    }
}
