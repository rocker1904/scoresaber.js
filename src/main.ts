import Axios from 'axios';
import { LeaderboardInfo, LeaderboardInfoCollection, ScoreCollection } from './types/LeaderboardData';
import { BasicPlayer, FullPlayer, Player, PlayerCollection, PlayerScore, PlayerScoreCollection } from './types/PlayerData';
import axiosRetry from 'axios-retry';
import { RankRequestListing } from './types/Ranking';

axiosRetry(Axios, {
    retries: 3,
});

export * from './types/AuthResponses';
export * from './types/CountryData';
export * from './types/Filter';
export * from './types/GenericResponses';
export * from './types/LeaderboardData';
export * from './types/Live';
export * from './types/PlayerData';
export * from './types/Ranking';
export * from './types/ScoreSaberTeam';
export * from './types/UserData';

export default class ScoreSaberAPI {
    private static SS_BASE_URL = 'https://scoresaber.com/api/';
    private static rateLimitRemaining = 400;
    private static rateLimitReset = -1; // Unix timestamp, initialised by the first request

    private static async fetchPage(relativePath: string): Promise<unknown> {
        // Initialise rate limit reset time if uninitialised
        if (this.rateLimitReset === -1) {
            this.rateLimitReset = Math.floor(Date.now() / 1000) + 61; // 61 not 60 just to be safe
            setTimeout(() => this.rateLimitRemaining = 400, this.rateLimitReset * 1000 - Date.now());
        }

        // When we run out of requests, wait until the limit resets
        while (this.rateLimitRemaining <= 10) {
            const expiresInMillis = this.rateLimitReset * 1000 - Date.now() + 1000;
            await new Promise(resolve => setTimeout(resolve, expiresInMillis));
        }


        // Make the request
        const response = await Axios.get(this.SS_BASE_URL + relativePath);
        this.rateLimitRemaining--;

        // Update the reset time if it changed
        if (!response.headers['x-ratelimit-reset']) {
            throw new Error('Request missing ratelimit reset header');
        }
        const ratelimitReset = parseInt(response.headers['x-ratelimit-reset']);
        if (this.rateLimitReset < ratelimitReset) {
            this.rateLimitReset = ratelimitReset;
            setTimeout(() => this.rateLimitRemaining = 400, this.rateLimitReset * 1000 - Date.now() + 500);
        }
        return response.data as unknown;
    }

    public static async fetchPlayerByRank(rank: number, region?: string): Promise<Player> {
        const pageNum = Math.ceil(rank / 50);
        let request = `players?page=${pageNum}`;
        if (region) request += `&countries=${region}`;
        const playerCollection = await this.fetchPage(request) as PlayerCollection;
        return playerCollection.players[rank % 50 - 1];
    }

    public static async fetchPlayersUnderRank(rank: number, region?: string): Promise<Player[]> {
        let players: Player[] = [];
        const totalPages = Math.ceil(rank / 50);
        for (let i = 0; i < totalPages; i++) {
            let request = `players?page=${i + 1}`;
            if (region) request += `&countries=${region}`;
            const playerCollection = await this.fetchPage(request) as PlayerCollection;
            players = players.concat(playerCollection.players);
        }
        return players;
    }

    public static async fetchBasicPlayer(playerId: string): Promise<BasicPlayer> {
        const basicPlayer = await this.fetchPage(`player/${playerId}/basic`) as BasicPlayer;
        return basicPlayer;
    }

    public static async fetchFullPlayer(playerId: string): Promise<FullPlayer> {
        const fullPlayer = await this.fetchPage(`player/${playerId}/full`) as FullPlayer;
        return fullPlayer;
    }

    public static async fetchScoresPage(playerId: string, pageNum: number): Promise<PlayerScoreCollection> {
        const scoresPage = await this.fetchPage(`player/${playerId}/scores?limit=100&sort=recent&page=${pageNum}`) as PlayerScoreCollection;
        return scoresPage;
    }

    public static async fetchLatestRankedMaps(): Promise<LeaderboardInfoCollection> {
        const latestRaknkedMaps = await this.fetchPage('leaderboards?ranked=true&category=1&sort=0') as LeaderboardInfoCollection;
        return latestRaknkedMaps;
    }

    public static async fetchLeaderboards(starMin: number, starMax: number, pageNum: number) {
        const leaderboards = await this.fetchPage(`leaderboards?ranked=true&minStar=${starMin}&maxStar=${starMax}&page=${pageNum}`) as LeaderboardInfoCollection;
        return leaderboards;
    }

    public static async fetchLeaderboardScores(leaderboardId: number, page = 1): Promise<ScoreCollection> {
        const scoreCollection = await this.fetchPage(`leaderboard/by-id/${leaderboardId}/scores?page=${page}`) as ScoreCollection;
        return scoreCollection;
    }

    public static async fetchLeaderboardInfo(leaderboardId: number): Promise<LeaderboardInfo> {
        const scoreCollection = await this.fetchPage(`leaderboard/by-id/${leaderboardId}/info`) as LeaderboardInfo;
        return scoreCollection;
    }

    public static async fetchRankedBetweenStars(starMin: number, starMax: number): Promise<LeaderboardInfo[]> {
        const firstleaderboard = await ScoreSaberAPI.fetchLeaderboards(starMin, starMax, 1);
        const totalPages = Math.ceil(firstleaderboard.metadata.total / firstleaderboard.metadata.itemsPerPage);
        let leaderboards = firstleaderboard.leaderboards;
        const promises = [];
        for (let i = 1; i <= totalPages; i++) {
            const promise = ScoreSaberAPI.fetchLeaderboards(starMin, starMax, i).then(leaderboardPage=>{
                leaderboards = leaderboards.concat(leaderboardPage.leaderboards);
            });

            promises.push(promise);
        }
        await Promise.all(promises);
        return leaderboards;
    }

    /** Fetches the ranking queue
    */
    public static async fetchRankingQueue(): Promise<RankRequestListing[]> {
        const topOfRankingQueue = await this.fetchPage('ranking/requests/top') as RankRequestListing[];
        const restOfRankingQueue = await this.fetchPage('ranking/requests/belowTop') as RankRequestListing[];
        return topOfRankingQueue.concat(restOfRankingQueue);
    }

    /** Fetches all of a player's scores
     * @param {string} playerID the ScoreSaber ID of the player
    */
    public static async fetchAllScores(playerID: string): Promise<PlayerScore[]> {
        const fullPlayer = await ScoreSaberAPI.fetchFullPlayer(playerID);
        const totalPages = Math.ceil(fullPlayer.scoreStats.totalPlayCount / 100);
        let playerScores = [] as PlayerScore[];
        const promises = [];
        for (let i = 1; i <= totalPages; i++) {
            const promise = ScoreSaberAPI.fetchScoresPage(playerID, i).then(scoresPage => {
                playerScores = playerScores.concat(scoresPage.playerScores);
            });
            promises.push(promise);
        }
        await Promise.all(promises);
        return playerScores;
    }
}
