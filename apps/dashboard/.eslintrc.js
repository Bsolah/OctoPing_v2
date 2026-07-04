/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: ['next/core-web-vitals', '../../.eslintrc.js'],
  settings: {
    next: {
      // Monorepo: lint-staged runs from repo root; point Next plugin at this app
      rootDir: __dirname,
    },
  },
  rules: {
    // App Router only — no pages/ directory
    '@next/next/no-html-link-for-pages': 'off',
  },
};
