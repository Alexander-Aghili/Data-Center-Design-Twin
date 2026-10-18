import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const server = 'http://localhost:4317'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': server,
      '/ws': { target: server, ws: true },
    },
  },
})
