import baseConfig from './vite.config.js'
import { syncLiveMicInputFixPlugin } from './scripts/syncLiveMicInputFixPlugin.js'

export default {
  ...baseConfig,
  plugins: [
    syncLiveMicInputFixPlugin(),
    ...(baseConfig.plugins || []),
  ],
}
