import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
    {ignores: ['build/', 'src/generated/', 'coverage/', 'node_modules/']},
    {
        files: ['src/**/*.ts', 'test/**/*.ts'],
        extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
        languageOptions: {
            // tsconfig.test.json includes both src/** and test/**.
            parserOptions: {project: './tsconfig.test.json', tsconfigRootDir: import.meta.dirname},
        },
    },
    {
        // Tests deliberately exercise loose shapes and fire-and-forget calls.
        files: ['test/**/*.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-floating-promises': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/require-await': 'off',
            '@typescript-eslint/prefer-promise-reject-errors': 'off',
        },
    },
    prettier,
);
