import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Canonical permission constants live in server/src/shared (TaskFlow spec).
      '@shared': path.resolve(__dirname, '../server/src/shared'),
    },
  },
  server: {
    headers: {
      // Allow PA Control Center to embed Atrium
      'Content-Security-Policy':
        "frame-ancestors 'self' http://localhost:5174 http://127.0.0.1:5174",
    },
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      },
    },
  },
})
