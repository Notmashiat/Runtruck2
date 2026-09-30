import { base } from '@runtruck/eslint-config';
import nextVitals from 'eslint-config-next/core-web-vitals';

export default [
  ...base(import.meta.dirname),
  ...nextVitals,
  {
    rules: {
      // Handlers passed to DOM props commonly return promises (react-query mutations).
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
    },
  },
];
