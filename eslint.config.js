import { defineConfig } from 'eslint/config'
import { neostandard } from 'neostandard'
import typescriptEslint from 'typescript-eslint'
import unicorn from 'eslint-plugin-unicorn'

const typedFiles = ['packages/**/*.ts', 'scripts/**/*.ts']
const codeFiles = ['**/*.{js,mjs,ts}']

export default defineConfig([
  {
    // The shared fixtures are data; their plugin source compiles in its own test against an installed jlv.
    ignores: ['**/node_modules/**', '**/dist/**', '.test-dist/**', '.artifacts/**', 'packages/format-fixtures/fixtures/**']
  },
  {
    linterOptions: { reportUnusedDisableDirectives: 'error', reportUnusedInlineConfigs: 'error' }
  },
  ...neostandard({ ts: true, noJsx: true }),
  {
    files: typedFiles,
    extends: [typescriptEslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
    }
  },
  { files: codeFiles, extends: [unicorn.configs.recommended] },
  {
    files: codeFiles,
    rules: {
      // Iterator.zip is not available in any Node 22 release.
      'unicorn/prefer-iterator-zip': 'off',
      // Promise.try is not available in any Node 22 release.
      'unicorn/prefer-promise-try': 'off'
    }
  },
  {
    files: typedFiles,
    rules: {
      // TSDoc comments must retain their standard layout in public declarations.
      'unicorn/no-asterisk-prefix-in-documentation-comments': 'off'
    }
  },
  {
    files: ['packages/jlv/src/tui/blessed-boundary.ts', 'packages/**/test/**/*.ts',
      'packages/format-fixtures/src/**/*.ts'],
    rules: {
      // Blessed callbacks and JSON regression fixtures legitimately contain null.
      'unicorn/no-null': 'off'
    }
  },
  {
    files: ['packages/**/test/**/*.ts'],
    rules: {
      // node:test registers suites, tests and hooks synchronously; the runner tracks their promises.
      '@typescript-eslint/no-floating-promises': ['error', {
        allowForKnownSafeCalls: [{
          from: 'package',
          package: 'node:test',
          name: ['after', 'afterEach', 'before', 'beforeEach', 'describe', 'it', 'suite', 'test']
        }]
      }]
    }
  },
  {
    files: codeFiles,
    rules: {
      // Plan section 4.1 names the application and configuration modules with the full words; Unicorn 77 would shorten
      // them to app and config.
      'unicorn/name-replacements': ['error', { replacements: { application: false, configuration: false } }]
    }
  },
  {
    files: ['eslint.config.js'],
    rules: {
      // ESLint's flat config composes presets when its configuration module loads.
      'unicorn/no-top-level-side-effects': 'off'
    }
  }
])
