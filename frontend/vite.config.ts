import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/uploads': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/zrender')) return 'charts-renderer'
          if (id.includes('node_modules/echarts')) return 'charts-echarts'
          if (id.includes('node_modules/@tiptap') || id.includes('node_modules/prosemirror')) return 'editor-tiptap'
          if (id.includes('node_modules/@codemirror') || id.includes('node_modules/codemirror')) return 'editor-codemirror'
          if (id.includes('node_modules/lowlight') || id.includes('node_modules/highlight.js')) return 'editor-highlight'
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    css: true,
    include: ['src/**/*.test.ts']
  }
})
