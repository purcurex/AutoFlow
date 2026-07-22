import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', 'coverage/**', 'backend/public/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/essential'],
  {
    files: ['backend/**/*.ts'],
    languageOptions: {
      globals: globals.node,
      parser: tseslint.parser,
      parserOptions: { sourceType: 'module' },
    },
  },
  {
    files: ['frontend/**/*.{ts,vue}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
        sourceType: 'module',
      },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
]
