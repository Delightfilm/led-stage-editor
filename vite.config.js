import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { managementSerialSafetyPlugin } from './scripts/managementSerialSafetyPlugin.js'
import { managementFirmwarePanelPlugin } from './scripts/managementFirmwarePanelPlugin.js'
import { managementABModePlugin } from './scripts/managementABModePlugin.js'

export default defineConfig({
  plugins: [managementABModePlugin(), managementFirmwarePanelPlugin(), managementSerialSafetyPlugin(), react()],
})
