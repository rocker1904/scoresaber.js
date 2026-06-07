// Refresh spec/openapi.json from the live ScoreSaber docs.
//
// There is no clean JSON endpoint: the spec is embedded as the `content` value
// passed to Scalar.createApiReference(...) inside the docs HTML. We locate that
// object and brace-match it out. If the page structure changes and extraction
// fails, this exits non-zero so the maintainer can drop the spec in by hand
// rather than committing garbage.
import {writeFileSync} from 'node:fs';
import path from 'node:path';

const DOCS_URL = 'https://scoresaber.com/api/docs';
const OUT = path.join(process.cwd(), 'spec', 'openapi.json');

function fail(msg) {
    console.error(`fetch-spec: ${msg}`);
    console.error('Update spec/openapi.json manually from https://scoresaber.com/api/docs, then run `npm run gen:types`.');
    process.exit(1);
}

/** Brace-match a JSON object/value starting at `start` (the opening `{`). */
function extractObject(text, start) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return undefined;
}

const res = await fetch(DOCS_URL, {headers: {'user-agent': 'scoresaber.js spec-sync'}});
if (!res.ok) fail(`GET ${DOCS_URL} -> ${res.status} ${res.statusText}`);
const html = await res.text();

const anchor = html.indexOf('Scalar.createApiReference');
if (anchor === -1) fail('could not find the Scalar config in the docs page');

const contentKey = html.indexOf('"content":', anchor);
if (contentKey === -1) fail('could not find the `content` key holding the spec');

const objStart = html.indexOf('{', contentKey);
const raw = objStart === -1 ? undefined : extractObject(html, objStart);
if (!raw) fail('could not brace-match the spec object');

let spec;
try {
    spec = JSON.parse(raw);
} catch (err) {
    fail(`extracted text is not valid JSON: ${err.message}`);
}

if (!spec.openapi || !spec.paths || typeof spec.paths !== 'object') {
    fail('extracted object does not look like an OpenAPI spec (missing openapi/paths)');
}
// The first `"content":` after the anchor could be a decoy object; require a known
// v2 path so we fail loudly rather than commit some other openapi-shaped object.
const SENTINEL_PATH = '/api/v2/players';
if (!(SENTINEL_PATH in spec.paths)) {
    fail(`extracted spec is missing the sentinel path ${SENTINEL_PATH} — likely matched the wrong object`);
}

writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`fetch-spec: wrote ${OUT} (openapi ${spec.openapi}, ${Object.keys(spec.paths).length} paths)`);
