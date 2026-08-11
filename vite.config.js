import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudVersionHistoryPlugin } from './scripts/cloudVersionHistoryPlugin.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [cloudVersionHistoryPlugin(), react()],
})
