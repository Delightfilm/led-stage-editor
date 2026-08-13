import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { managementSerialSafetyPlugin } from './scripts/managementSerialSafetyPlugin.js'
import { managementFirmwarePanelPlugin } from './scripts/managementFirmwarePanelPlugin.js'

export default defineConfig({
  plugins: [managementFirmwarePanelPlugin(), managementSerialSafetyPlugin(), react()],
})
