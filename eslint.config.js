import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';

export default ts.config(
  js.configs.recommended,
  ...ts.configs.strict,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        __APP_VERSION__: 'readonly',
      },
    },
  },
  {
    ignores: [
      '**/dist/',
      '**/node_modules/',
      '**/out/',
      'TiltLauncher.app/',
      '*.mjs',
      // UI has its own eslint.config.js (Svelte-specific)
      'packages/ui/',
      // Build artifacts
      'packages/shell-tauri/src-tauri/target/',
      'packages/shell-tauri/src-tauri/gen/',
    ],
  },
);
