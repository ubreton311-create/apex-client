import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api-n8n': {
        target: 'https://bretudev.app.n8n.cloud',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-n8n/, '')
      }
    }
  }
})
