import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { analysisPlugin } from './server/analysisPlugin.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), analysisPlugin()],
})
