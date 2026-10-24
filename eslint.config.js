import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['node_modules/**', 'dist/**', 'outputs/**', '**/*.test.ts', '**/*.test.tsx'] },
  {
    files: ['packages/web/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    plugins: { '@typescript-eslint': tseslint.plugin, 'react-hooks': hooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
          message: 'Render document content through React nodes.',
        },
        {
          selector: 'MemberExpression[property.name="innerHTML"]',
          message: 'Use DOM nodes or React rendering instead of innerHTML.',
        },
        {
          selector: 'MemberExpression[computed=true][property.value="innerHTML"]',
          message: 'Use DOM nodes or React rendering instead of innerHTML.',
        },
      ],
    },
  },
];
