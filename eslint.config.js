import convexPlugin from '@convex-dev/eslint-plugin';
import eslint from '@eslint/js';
import prettier from 'eslint-plugin-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...convexPlugin.configs.recommended,
  {
    ignores: ['dist', 'convex/_generated', '*.config.{js,ts}', '**/*.config.{js,ts}'], // Ignore build output and generated files
  },
  // Config files: no type-aware linting (not part of TypeScript projects)
  // {
  //   files: ['*.config.{js,ts}', '**/*.config.{js,ts}'],
  //   languageOptions: {
  //     ecmaVersion: 2020,
  //     globals: globals.node,
  //   },
  // },
  {
    files: ['**/*.{js,ts,tsx}'],
    // ignores: ['*.config.{js,ts}', '**/*.config.{js,ts}'], // Exclude config files
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json', './convex/tsconfig.json'],
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      prettier,
    },
    settings: {
      react: {
        version: 'detect', // Automatically detect React version for linting rules that depend on it
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/react-in-jsx-scope': 'off', // Not needed with React 17+ and Next.js
      'react/prop-types': 'off', // Not needed when using TypeScript for type checking
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }], // Enforce that only components are exported in React files
      '@typescript-eslint/no-explicit-any': ['off'], // Consider enabling with exceptions as needed
      'max-statements-per-line': ['error', { max: 1 }],
      'no-nested-ternary': 'error', // Disallow nested ternary expressions for better readability
      'no-unneeded-ternary': 'error', // Disallow ternary operators when simpler alternatives exist
      'no-var': 'error', // Enforce let/const over var
      'block-spacing': ['error', 'always'],
      'operator-assignment': ['error', 'always'],
      'operator-linebreak': ['error', 'none'],
      'max-depth': ['error', 3], // Nested blocks
      complexity: ['error', 8], // Cyclomatic complexity
      'max-nested-callbacks': ['error', 2], // Limit nested callbacks to 2 levels deep to improve readability
      'max-lines-per-function': ['error', 100], // Limit function length to 100 lines; for longer logic, break into smaller functions
      'max-params': ['error', 2], // Limit function parameters to 2; for more, use an options object
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
      'no-else-return': 'error', // Disallow else blocks after return statements for cleaner code
      'no-multiple-empty-lines': ['warn', { max: 1, maxEOF: 1 }],
      'no-magic-numbers': [
        // Disallow magic numbers except for commonly used ones and with exceptions for object properties, array indexes, and default parameter values
        'error',
        {
          detectObjects: false, // Don't require named constants for object properties
          enforceConst: true, // Require const for magic numbers to prevent reassignment
          ignore: [-1, 0, 1, 2, 3, 4, 5, 10, 12, 24, 60, 100, 1000], // Commonly used numbers that don't need to be named
          ignoreArrayIndexes: true, // Don't require named constants for array indexes
          ignoreDefaultValues: true, // Don't require named constants for default parameter values
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        // Enforce consistent handling of unused variables with exceptions for those prefixed with '_'
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'default',
          format: ['camelCase'],
        },
        {
          selector: 'import',
          format: ['camelCase', 'PascalCase'], // Allow PascalCase for component imports
        },
        {
          selector: 'variable',
          format: ['camelCase', 'PascalCase', 'UPPER_CASE'], // Allow PascalCase for React components and UPPER_CASE for constants
        },
        {
          selector: 'parameter',
          format: ['camelCase'],
          leadingUnderscore: 'allow', // Allow leading underscore for unused parameters
        },
        {
          selector: 'function',
          format: ['camelCase', 'PascalCase'], // Allow PascalCase for React components
        },
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
        {
          selector: 'typeParameter',
          format: ['PascalCase'],
          prefix: ['T', 'K', 'I'],
        },
        {
          selector: 'enumMember',
          format: ['UPPER_CASE'],
        },
        {
          selector: 'objectLiteralProperty',
          format: ['camelCase', 'UPPER_CASE', 'PascalCase'], // Allow UPPER_CASE for object literal properties (e.g., constants in config objects)
        },
        {
          selector: 'variable',
          types: ['boolean'],
          format: ['PascalCase'],
          prefix: ['can', 'did', 'has', 'is', 'must', 'needs', 'should', 'will'],
        },
      ],
      'prettier/prettier': [
        // Enforce Prettier formatting with specific options and import ordering rules
        'error',
        {
          tabWidth: 2,
          singleQuote: true,
          jsxSingleQuote: true,
          semi: true,
          printWidth: 110,
          arrowParens: 'always',
          trailingComma: 'all',
          endOfLine: 'auto',
          importOrder: [
            '^react(.*)$',
            '^@mui/material/(.*)$',
            '^@mui/icons-material/(.*)$',
            '<THIRD_PARTY_MODULES>',
            '^redux(.*)$',
            '^react-redux(.*)$',
            '^react-router-dom(.*)$',
            '^@ocome/shared(.*)$',
            '^pages/(.*)$',
            '^components/(.*)$',
            '^assets/(.*)$',
            '^types',
            '^[./]',
          ],
          importOrderSeparation: false,
          importOrderSortSpecifiers: true,
          plugins: ['@trivago/prettier-plugin-sort-imports'],
        },
      ],
    },
    // rules: {
    //   ...reactHooks.configs.recommended.rules,
    //   "react-refresh/only-export-components": [
    //     "warn",
    //     { allowConstantExport: true },
    //   ],
    //   // All of these overrides ease getting into
    //   // TypeScript, and can be removed for stricter
    //   // linting down the line.

    //   // Only warn on unused variables, and ignore variables starting with `_`
    //   "@typescript-eslint/no-unused-vars": [
    //     "warn",
    //     { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
    //   ],

    //   // Allow escaping the compiler
    //   "@typescript-eslint/ban-ts-comment": "error",

    //   // Allow explicit `any`s
    //   "@typescript-eslint/no-explicit-any": "off",

    //   // START: Allow implicit `any`s
    //   "@typescript-eslint/no-unsafe-argument": "off",
    //   "@typescript-eslint/no-unsafe-assignment": "off",
    //   "@typescript-eslint/no-unsafe-call": "off",
    //   "@typescript-eslint/no-unsafe-member-access": "off",
    //   "@typescript-eslint/no-unsafe-return": "off",
    //   // END: Allow implicit `any`s

    //   // Allow async functions without await
    //   // for consistency (esp. Convex `handler`s)
    //   "@typescript-eslint/require-await": "off",
    // },
  },
  // Stricter line limit for TypeScript files (utilities, types, etc.)
  {
    files: ['**/*.ts'],
    rules: {
      'max-lines': ['error', { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },
  // Stricter line limit for TSX files (React components with JSX markup)
  {
    files: ['**/*.tsx'],
    rules: {
      'max-lines': ['error', { max: 200, skipBlankLines: true, skipComments: true }],
    },
  },
]);
