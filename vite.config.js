import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // Libraries rarely change → separate files that phones keep cached across app updates
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|cookie|set-cookie-parser)[\\/]/, priority: 30 },
            { name: 'supabase', test: /node_modules[\\/](@supabase|tslib|ws|isows)[\\/]/, priority: 20 },
            { name: 'ui', test: /node_modules[\\/](lucide-react|react-hot-toast|goober)[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
})
