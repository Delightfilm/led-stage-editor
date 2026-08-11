import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nrf24LiveCodePlugin } from './scripts/nrf24LiveCodePlugin.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [nrf24LiveCodePlugin(), react()],
})
