export default [
  {
    ignores: ['vendor/**', 'css/tailwind.css', 'node_modules/**']
  },
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        AbortController: 'readonly',
        Image: 'readonly',
        WebSocket: 'readonly',
        Notification: 'readonly',
        CustomEvent: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        self: 'readonly',
        caches: 'readonly',
        clients: 'readonly',
        indexedDB: 'readonly',
        location: 'readonly',
        HTMLElement: 'readonly',
        confirm: 'readonly',
        Response: 'readonly',
        Headers: 'readonly',
        Request: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        Event: 'readonly',
        Map: 'readonly',
        Set: 'readonly',
        Promise: 'readonly',
        JSON: 'readonly',
        Math: 'readonly',
        Date: 'readonly',
        Number: 'readonly',
        String: 'readonly',
        Array: 'readonly',
        Object: 'readonly',
        Error: 'readonly',
        TypeError: 'readonly',
        parseInt: 'readonly',
        parseFloat: 'readonly',
        encodeURIComponent: 'readonly',
        decodeURIComponent: 'readonly',
        isNaN: 'readonly',
        structuredClone: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_|^(error|err|radarErr)$'
      }],
      'no-undef': 'error',
      'no-var': 'error',
      'prefer-const': 'warn',
      eqeqeq: ['warn', 'smart']
    }
  }
];
