import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudAudioStoragePlugin } from './scripts/cloudAudioStoragePlugin.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [cloudAudioStoragePlugin(), react()],
})
