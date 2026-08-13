import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { managementSerialSafetyPlugin } from './scripts/managementSerialSafetyPlugin.js'
import { managementFirmwarePanelPlugin } from './scripts/managementFirmwarePanelPlugin.js'
import { managementABModePlugin } from './scripts/managementABModePlugin.js'
import { liveMonitorPlugin } from './scripts/liveMonitorPlugin.js'

export default defineConfig({
  // Firmware bundle must be injected before the A/B mode helpers because
  // the A/B controls read firmwareBundle during render.
  plugins: [managementFirmwarePanelPlugin(), managementABModePlugin(), liveMonitorPlugin(), managementSerialSafetyPlugin(), react()],
})
