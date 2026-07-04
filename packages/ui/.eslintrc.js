/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: ['../../.eslintrc.js'],
  env: {
    browser: true,
  },
  settings: {
    react: {
      version: 'detect',
    },
  },
};
