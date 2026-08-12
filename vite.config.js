import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudAudioStoragePlugin } from './scripts/cloudAudioStoragePlugin.js'
import { disableTutorialPlugin } from './scripts/disableTutorialPlugin.js'
import { defaultRelayPinPlugin } from './scripts/defaultRelayPinPlugin.js'
import { premiereVideoEditorPrePlugin } from './scripts/premiereVideoEditorPrePlugin.js'
import { premiereTimelinePolishPlugin } from './scripts/premiereTimelinePolishPlugin.js'
import { premiereTimelineProPlugin } from './scripts/premiereTimelineProPlugin.js'
import { cloudMediaStoragePlugin } from './scripts/cloudMediaStoragePlugin.js'
import { premiereVideoBuildGuardPlugin } from './scripts/premiereVideoBuildGuardPlugin.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    defaultRelayPinPlugin(),
    disableTutorialPlugin(),
    cloudAudioStoragePlugin(),
    premiereVideoEditorPrePlugin(),
    premiereTimelinePolishPlugin(),
    premiereTimelineProPlugin(),
    cloudMediaStoragePlugin(),
    premiereVideoBuildGuardPlugin(),
    react(),
  ],
})
