import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nrf24CompressedLiveCodePlugin } from './scripts/nrf24CompressedLiveCodePlugin.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [nrf24CompressedLiveCodePlugin(), react()],
})
