import baseConfig from './vite.config.js'
import { syncLiveMicInputFixPlugin } from './scripts/syncLiveMicInputFixPlugin.js'
import { syncLiveAudioWorkletFixPlugin } from './scripts/syncLiveAudioWorkletFixPlugin.js'
import { syncLiveTimeLockV5Plugin } from './scripts/syncLiveTimeLockV5Plugin.js'
import { syncLiveNoiseV5Plugin } from './scripts/syncLiveNoiseV5Plugin.js'

export default {
  ...baseConfig,
  plugins: [
    syncLiveMicInputFixPlugin(),
    syncLiveAudioWorkletFixPlugin(),
    syncLiveTimeLockV5Plugin(),
    syncLiveNoiseV5Plugin(),
    ...(baseConfig.plugins || []),
  ],
}
