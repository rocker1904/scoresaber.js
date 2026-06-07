import {defineConfig} from 'tsup';
import {readFileSync} from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {version: string};

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    target: 'node22',
    outDir: 'build',
    sourcemap: true,
    // Inlined so the client can report its own version in the User-Agent without
    // reading package.json at runtime (which is awkward across ESM/CJS).
    define: {__VERSION__: JSON.stringify(pkg.version)},
});
