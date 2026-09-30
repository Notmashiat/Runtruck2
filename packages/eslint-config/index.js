// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const IGNORES = ['**/dist/**', '**/.next/**', '**/coverage/**', '**/drizzle/**', '**/next-env.d.ts', '**/*.js', '**/*.mjs', '**/*.cjs'];

/**
 * Strict, type-aware rules shared by every TypeScript package (architecture §39:
 * strict TypeScript, no `any` without justification).
 * @param {string} tsconfigRootDir the package directory (pass import.meta.dirname)
 */
export function base(tsconfigRootDir) {
  return tseslint.config(
    { ignores: IGNORES },
    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    {
      languageOptions: {
        globals: { ...globals.node },
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
        '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        // Nest's DI relies on classes that only hold decorated members.
        '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      },
    },
    {
      files: ['**/*.test.ts', '**/*.spec.ts', '**/test/**/*.ts', '**/tests/**/*.ts'],
      // Tests assert on untyped JSON (supertest response bodies).
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
      },
    },
  );
}

/**
 * NestJS: parameter decorators and constructor injection need type imports kept
 * as values (emitDecoratorMetadata), so consistent-type-imports must not rewrite them.
 * @param {string} tsconfigRootDir
 */
export function nest(tsconfigRootDir) {
  return [
    ...base(tsconfigRootDir),
    {
      rules: {
        '@typescript-eslint/consistent-type-imports': 'off',
        '@typescript-eslint/no-extraneous-class': 'off',
      },
    },
  ];
}
