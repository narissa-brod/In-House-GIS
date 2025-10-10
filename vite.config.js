import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  build: {
    // Optimize chunk sizes
    rollupOptions: {
      output: {
        manualChunks: {
          'maplibre': ['maplibre-gl'],
          'deck': ['@deck.gl/core', '@deck.gl/layers', '@deck.gl/geo-layers', '@deck.gl/mapbox'],
          'supabase': ['@supabase/supabase-js']
        }
      }
    },
    // Increase chunk size warning limit
    chunkSizeWarningLimit: 1000,
    // Enable minification
    minify: 'esbuild', // esbuild is faster than terser
    target: 'es2020'
  },
  // Optimize dependencies
  optimizeDeps: {
    include: ['maplibre-gl', '@deck.gl/core', '@deck.gl/layers', '@supabase/supabase-js', 'vue']
  },
  server: {
    // Improve dev server performance
    fs: {
      strict: false
    }
  }
})
