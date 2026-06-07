// Post-build smoke test: both module systems must load and expose the public API
// through the package `exports` map. Run after `npm run build` in CI.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);

const cjs = require('../build/index.js');
assert.equal(typeof cjs.ScoreSaberClient, 'function', 'CJS: ScoreSaberClient missing');
assert.equal(typeof cjs.ScoreSaberTimeoutError, 'function', 'CJS: error types missing');
assert.equal(typeof cjs.pages, 'function', 'CJS: pages() missing');
assert.equal(typeof cjs.paginate, 'function', 'CJS: paginate() missing');

const esm = await import('../build/index.mjs');
assert.equal(typeof esm.ScoreSaberClient, 'function', 'ESM: ScoreSaberClient missing');

// The User-Agent must carry the injected version, not the dev fallback.
let ua = '';
const client = new cjs.ScoreSaberClient({
    fetch: async (_url, init) => {
        ua = new Headers(init.headers).get('user-agent') ?? '';
        return new Response('{}', {headers: {'content-type': 'application/json'}});
    },
});
await client.health();
assert.match(ua, /^scoresaber\.js\/\d+\.\d+\.\d+/, `User-Agent not versioned: ${ua}`);

console.log('exports smoke OK —', ua);
