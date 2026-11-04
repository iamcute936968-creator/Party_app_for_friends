import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'

// https://vitejs.dev/config/
export default defineConfig(({ command }) => ({
  plugins: [react()],
  resolve: {
    // Playwright fixtures intercept CDN imports only in their explicit test server.
    alias: command === 'serve' && process.env.WATCH_PARTY_TEST_CDN === '1' ? [] : [
      { find: /^https:\/\/www\.gstatic\.com\/firebasejs\/10\.8\.0\/firebase-app\.js$/, replacement: 'firebase/app' },
      { find: /^https:\/\/www\.gstatic\.com\/firebasejs\/10\.8\.0\/firebase-database\.js$/, replacement: 'firebase/database' },
      { find: /^https:\/\/www\.gstatic\.com\/firebasejs\/10\.8\.0\/firebase-auth\.js$/, replacement: 'firebase/auth' },
    ]
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/database'],
          react: ['react', 'react-dom'],
        }
      }
    }
  },
  server: {
    host: true,
    port: 5175,
    // Dev-only: same-origin bridge to the local media proxy so the browser never
    // makes cross-origin LAN calls (immune to CORS and LAN-blocking extensions).
    proxy: {
      '/api': { target: process.env.MEDIA_PROXY_ORIGIN || 'http://127.0.0.1:3000', changeOrigin: false }
    },
    allowedHosts: [
      'localhost',
      '.trycloudflare.com',
      '.loca.lt',
      '.ngrok.io'
    ]
  }
}))
