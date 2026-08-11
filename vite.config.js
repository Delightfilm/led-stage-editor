import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudResumePlugin } from './scripts/cloudResumePlugin.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [cloudResumePlugin(), react()],
})
