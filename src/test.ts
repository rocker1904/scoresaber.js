// eslint-disable-next-line @typescript-eslint/no-unused-vars
import ScoreSaberAPI from "./main";
async function noTopLevelAsyncAwait() {
    const top1k = ScoreSaberAPI.fetchPlayerByRank(1001);
    console.log(await (top1k))
    console.log('Done!');
    //process.exit();
}

void noTopLevelAsyncAwait();
