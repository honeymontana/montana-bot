module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    project: './tsconfig.json',
  },
  plugins: ['@typescript-eslint', 'prettier'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:prettier/recommended', // Must be last to override other configs
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: [
    '.eslintrc.js',
    'jest.config.js',
    'dist',
    'coverage',
    'node_modules',
    'src/__tests__/**/*.ts',
  ],
  rules: {
    // TypeScript
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
    '@typescript-eslint/prefer-nullish-coalescing': 'warn',
    '@typescript-eslint/prefer-optional-chain': 'warn',
    '@typescript-eslint/strict-boolean-expressions': 'off',

    // General Code Quality
    'no-console': ['warn', { allow: ['warn', 'error'] }], // Allow console.warn/error, warn on others
    'prefer-const': 'error',
    'no-var': 'error',
    'eqeqeq': ['error', 'always'],
    'no-throw-literal': 'error',
    'prefer-template': 'warn',
    'no-duplicate-imports': 'error',
    'no-return-await': 'error',

    // Prettier (will auto-format)
    'prettier/prettier': 'warn',
  },
};