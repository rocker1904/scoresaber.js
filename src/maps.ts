import type {HttpClient} from './http';
import {paginate} from './paginate';
import type {MapCollection, MapInfo} from './types';

export interface MapsListOpts {
    page?: number;
    limit?: number;
    search?: string;
    sort?: string;
    sortDirection?: 'asc' | 'desc';
}

type MapItem = MapCollection extends {data: ReadonlyArray<infer I>} ? I : never;

export class MapsResource {
    constructor(private readonly http: HttpClient) {}

    public listPage(opts: MapsListOpts = {}): Promise<MapCollection> {
        return this.http.get<MapCollection>('maps', opts);
    }

    public list(opts: Omit<MapsListOpts, 'page'> = {}): AsyncIterable<MapItem> {
        return paginate<MapItem>(async (page) => {
            const env = await this.listPage({...opts, page});
            return {data: env.data as MapItem[], metadata: env.metadata};
        });
    }

    public get(mapId: number): Promise<MapInfo> {
        return this.http.get<MapInfo>(`maps/${mapId}`);
    }
}
