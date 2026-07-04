/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: ['next/core-web-vitals', '../../.eslintrc.js'],
  rules: {
    // next/core-web-vitals already covers React-specific rules
  },
};
