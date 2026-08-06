import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // public/api, .vitepress/{cache,dist,generated} are all generated; docs-api
  // and node_modules are dependencies. None of it is ours to lint.
  { ignores: ['.vitepress/cache/**', '.vitepress/dist/**', '.vitepress/generated/**', 'public/**', 'node_modules/**'] },

  {
    files: ['**/*.{js,mjs,cjs,ts,mts}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
);
