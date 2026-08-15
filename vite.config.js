import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudAudioStoragePlugin } from './scripts/cloudAudioStoragePlugin.js'
import { disableTutorialPlugin } from './scripts/disableTutorialPlugin.js'
import { defaultRelayPinPlugin } from './scripts/defaultRelayPinPlugin.js'
import { premiereVideoEditorPrePlugin } from './scripts/premiereVideoEditorPrePlugin.js'
import { premiereTimelinePolishPlugin } from './scripts/premiereTimelinePolishPlugin.js'
import { premiereTimelineProPlugin } from './scripts/premiereTimelineProPlugin.js'
import { premiereShiftSnapFixPlugin } from './scripts/premiereShiftSnapFixPlugin.js'
import { premiereTimelineViewportPlugin } from './scripts/premiereTimelineViewportPlugin.js'
import { cloudMediaStoragePlugin } from './scripts/cloudMediaStoragePlugin.js'
import { premiereEditingWorkflowPlugin } from './scripts/premiereEditingWorkflowPlugin.js'
import { premiereProgramAspectFixPlugin } from './scripts/premiereProgramAspectFixPlugin.js'
import { premiereSingleTrackOverwritePlugin } from './scripts/premiereSingleTrackOverwritePlugin.js'
import { premiereWorkspaceCleanupPlugin } from './scripts/premiereWorkspaceCleanupPlugin.js'
import { choreographyFormationPlugin } from './scripts/choreographyFormationPlugin.js'
import { formationMemorySidebarPlugin } from './scripts/formationMemorySidebarPlugin.js'
import { formationWidthResizePlugin } from './scripts/formationWidthResizePlugin.js'
import { fineBlockTimingPlugin } from './scripts/fineBlockTimingPlugin.js'
import { defaultTimelineOpenPlugin } from './scripts/defaultTimelineOpenPlugin.js'
import { premiereVideoBuildGuardPlugin } from './scripts/premiereVideoBuildGuardPlugin.js'
import { managementIntegrationPlugin } from './scripts/managementIntegrationPlugin.js'
import { managementSequenceDataPlugin } from './scripts/managementSequenceDataPlugin.js'
import { managementFormationSyncFixPlugin } from './scripts/managementFormationSyncFixPlugin.js'
import { accountTransferPlugin } from './scripts/accountTransferPlugin.js'
import { premiereSequenceManagerCompatPlugin } from './scripts/premiereSequenceManagerCompatPlugin.js'
import { projectLinkedMediaUxPlugin } from './scripts/projectLinkedMediaUxPlugin.js'
import { multiProjectManagerPlugin } from './scripts/multiProjectManagerPlugin.js'
import { managementMenuPlugin } from './scripts/managementMenuPlugin.js'
import { managementSerialSafetyPlugin } from './scripts/managementSerialSafetyPlugin.js'
import { managementFirmwarePanelPlugin } from './scripts/managementFirmwarePanelPlugin.js'
import { managementABModePlugin } from './scripts/managementABModePlugin.js'
import { managementFormationStagePlugin } from './scripts/managementFormationStagePlugin.js'
import { liveMonitorPlugin } from './scripts/liveMonitorPlugin.js'
import { managementLiveCueFixPlugin } from './scripts/managementLiveCueFixPlugin.js'
import { managementOneClickLivePlugin } from './scripts/managementOneClickLivePlugin.js'
import { managementSerialRecoveryPlugin } from './scripts/managementSerialRecoveryPlugin.js'
import { managementTelemetryHeartbeatPlugin } from './scripts/managementTelemetryHeartbeatPlugin.js'
import { managementRehearsalUiPlugin } from './scripts/managementRehearsalUiPlugin.js'
import { managementFirmwareHardenPlugin } from './scripts/managementFirmwareHardenPlugin.js'
import { managementFirmwareSequenceDurationPlugin } from './scripts/managementFirmwareSequenceDurationPlugin.js'
import { managementFrameScrubPlugin } from './scripts/managementFrameScrubPlugin.js'
import { managementFirmwareDurationBridgePlugin } from './scripts/managementFirmwareDurationBridgePlugin.js'

const scopeManagementPlugin = (plugin) => ({
  ...plugin,
  name: `${plugin.name}-management-workspace`,
  transform(code, id, ...rest) {
    if (!id.includes('src/ManagementApp.jsx')) return null
    const fakeId = id.replace('src/ManagementApp.jsx', 'src/App.jsx')
    return plugin.transform.call(this, code, fakeId, ...rest)
  },
})

export default defineConfig({
  plugins: [
    defaultRelayPinPlugin(),
    disableTutorialPlugin(),
    cloudAudioStoragePlugin(),
    premiereVideoEditorPrePlugin(),
    premiereTimelinePolishPlugin(),
    premiereTimelineProPlugin(),
    premiereShiftSnapFixPlugin(),
    premiereTimelineViewportPlugin(),
    cloudMediaStoragePlugin(),
    premiereEditingWorkflowPlugin(),
    premiereProgramAspectFixPlugin(),
    premiereSingleTrackOverwritePlugin(),
    managementMenuPlugin(),
    premiereWorkspaceCleanupPlugin(),
    choreographyFormationPlugin(),
    formationMemorySidebarPlugin(),
    formationWidthResizePlugin(),
    fineBlockTimingPlugin(),
    defaultTimelineOpenPlugin(),
    premiereVideoBuildGuardPlugin(),
    managementIntegrationPlugin(),
    managementSequenceDataPlugin(),
    managementFormationSyncFixPlugin(),
    accountTransferPlugin(),
    premiereSequenceManagerCompatPlugin(),
    projectLinkedMediaUxPlugin(),
    multiProjectManagerPlugin(),
    scopeManagementPlugin(managementFirmwarePanelPlugin()),
    scopeManagementPlugin(managementABModePlugin()),
    managementFormationStagePlugin(),
    scopeManagementPlugin(liveMonitorPlugin()),
    scopeManagementPlugin(managementSerialSafetyPlugin()),
    managementLiveCueFixPlugin(),
    managementOneClickLivePlugin(),
    managementSerialRecoveryPlugin(),
    managementTelemetryHeartbeatPlugin(),
    managementRehearsalUiPlugin(),
    managementFirmwareHardenPlugin(),
    managementFirmwareSequenceDurationPlugin(),
    managementFrameScrubPlugin(),
    managementFirmwareDurationBridgePlugin(),
    react(),
  ],
})