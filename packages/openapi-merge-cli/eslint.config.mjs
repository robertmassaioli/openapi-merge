// ESLint flat config. Replaces .eslintrc.js + .eslintignore, neither of which
// ESLint 9+ reads by default.
//
// Equivalent to the previous setup: eslint:recommended plus
// @typescript-eslint's eslint-recommended and recommended sets. The unified
// `typescript-eslint` package supplies the parser and plugin together, which is
// why the separate @typescript-eslint/parser and /eslint-plugin devDependencies
// are gone.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Replaces .eslintignore. `dist` is build output and `coverage` is written by
  // `bun test --coverage`; neither is ours to lint.
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },

  {
    // Replaces the `--ext` flag, which ESLint 9 removed: which files are linted
    // is now the config's job.
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        // The suites call describe/it/expect/fail as globals rather than
        // importing them, which keeps them runnable under any Jest-compatible
        // runner. See ai-planning/proposal-code-coverage.md §A2.
        ...globals.jest,
      },
    },
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
);
