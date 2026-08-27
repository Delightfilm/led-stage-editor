import baseConfig from './vite.config.js'
import { syncLiveMicInputFixPlugin } from './scripts/syncLiveMicInputFixPlugin.js'
import { syncLiveAudioWorkletFixPlugin } from './scripts/syncLiveAudioWorkletFixPlugin.js'

export default {
  ...baseConfig,
  plugins: [
    syncLiveMicInputFixPlugin(),
    syncLiveAudioWorkletFixPlugin(),
    ...(baseConfig.plugins || []),
  ],
}
