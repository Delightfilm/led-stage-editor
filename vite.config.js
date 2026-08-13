import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { managementSerialSafetyPlugin } from './scripts/managementSerialSafetyPlugin.js'

export default defineConfig({
  plugins: [managementSerialSafetyPlugin(), react()],
})
