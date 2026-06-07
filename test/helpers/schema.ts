/**
 * Validates live API responses against the response schemas in the OpenAPI
 * spec, so the generated types (and our hand-written option types) can't quietly
 * drift from what the server actually returns.
 *
 * The spec is OpenAPI 3.0, which differs from plain JSON Schema in two ways we
 * normalise here: `nullable: true` becomes a `null` union, and
 * `additionalProperties: false` is relaxed so undocumented-but-harmless extra
 * fields don't fail the check — we care that the documented shape holds, not
 * that the payload is byte-identical to the spec.
 */
import {readFileSync} from 'node:fs';
import path from 'node:path';
import Ajv, {type ValidateFunction} from 'ajv';

interface OpenApiDoc {
    paths: Record<string, unknown>;
}

const raw = JSON.parse(readFileSync(path.join(process.cwd(), 'spec', 'openapi.json'), 'utf8')) as OpenApiDoc;

function normalize(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(normalize);
    if (node === null || typeof node !== 'object') return node;

    const input = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
        if (key === 'nullable') continue;
        if (key === 'additionalProperties' && value === false) continue;
        out[key] = normalize(value);
    }
    if (input.nullable === true && typeof out.type === 'string') {
        out.type = [out.type, 'null'];
    }
    return out;
}

const spec = normalize(raw) as Record<string, unknown>;

const ajv = new Ajv({strict: false, allErrors: true, validateFormats: false});
ajv.addSchema(spec, 'openapi');

function escapePointer(segment: string): string {
    return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Compile a validator for an endpoint's JSON response body. */
export function validatorFor(specPath: string, status = '200'): ValidateFunction {
    const ref =
        `openapi#/paths/${escapePointer(specPath)}/get/responses/${status}` + `/content/${escapePointer('application/json')}/schema`;
    return ajv.getSchema(ref) ?? ajv.compile({$ref: ref});
}
