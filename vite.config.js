import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudAudioStoragePlugin } from './scripts/cloudAudioStoragePlugin.js'
import { disableTutorialPlugin } from './scripts/disableTutorialPlugin.js'
import { defaultRelayPinPlugin } from './scripts/defaultRelayPinPlugin.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [defaultRelayPinPlugin(), disableTutorialPlugin(), cloudAudioStoragePlugin(), react()],
})
