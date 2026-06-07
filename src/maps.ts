import type {HttpClient, RequestOptions} from './http';
import {paginate} from './paginate';
import type {MapCollection, MapInfo, MapListing, MapsListQuery} from './types';

/** Map listings and individual maps. */
export class MapsResource {
    /** @internal */
    constructor(private readonly http: HttpClient) {}

    /** Single page of the map listings. */
    public listPage(opts: MapsListQuery = {}, req?: RequestOptions): Promise<MapCollection> {
        return this.http.get<MapCollection>('maps', opts, req);
    }

    /** AsyncIterable over the map listings — paginates lazily. */
    public list(opts: Omit<MapsListQuery, 'page'> = {}, req?: RequestOptions): AsyncIterable<MapListing> {
        return paginate<MapListing>(async (page) => {
            const env = await this.listPage({...opts, page}, req);
            return {data: env.data, metadata: env.metadata};
        });
    }

    /** Single map by id. */
    public get(mapId: number, req?: RequestOptions): Promise<MapInfo> {
        return this.http.get<MapInfo>(`maps/${mapId}`, {}, req);
    }
}
