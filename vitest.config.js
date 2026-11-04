import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js':
        fileURLToPath(new URL('./tests/helpers/firebase-database.js', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.{js,jsx}', 'tests/integration/**/*.test.{js,jsx}'],
    clearMocks: true,
  },
});
