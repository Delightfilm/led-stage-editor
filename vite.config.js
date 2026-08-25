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
import { projectFootageVisibilityFixPlugin } from './scripts/projectFootageVisibilityFixPlugin.js'
import { projectFootageDeletePlugin } from './scripts/projectFootageDeletePlugin.js'
import { managementMenuPlugin } from './scripts/managementMenuPlugin.js'
import { workspaceUiPolishPlugin } from './scripts/workspaceUiPolishPlugin.js'
import { managementSerialSafetyPlugin } from './scripts/managementSerialSafetyPlugin.js'
import { managementFirmwarePanelPlugin } from './scripts/managementFirmwarePanelPlugin.js'
import { managementEsp32FirmwarePanelPlugin } from './scripts/managementEsp32FirmwarePanelPlugin.js'
import { managementABModePlugin } from './scripts/managementABModePlugin.js'
import { managementFormationStagePlugin } from './scripts/managementFormationStagePlugin.js'
import { liveMonitorPlugin } from './scripts/liveMonitorPlugin.js'
import { managementLiveCueFixPlugin } from './scripts/managementLiveCueFixPlugin.js'
import { managementOneClickLivePlugin } from './scripts/managementOneClickLivePlugin.js'
import { managementSerialRecoveryPlugin } from './scripts/managementSerialRecoveryPlugin.js'
import { managementTelemetryHeartbeatPlugin } from './scripts/managementTelemetryHeartbeatPlugin.js'
import { managementRehearsalUiPlugin } from './scripts/managementRehearsalUiPlugin.js'
import { managementAutonomousHandoffPlugin } from './scripts/managementAutonomousHandoffPlugin.js'
import { managementAutonomousV062Plugin } from './scripts/managementAutonomousV062Plugin.js'
import { managementAutonomousV063Plugin } from './scripts/managementAutonomousV063Plugin.js'
import { managementV063FailClosedPlugin } from './scripts/managementV063FailClosedPlugin.js'
import { managementResilientJoinV064Plugin } from './scripts/managementResilientJoinV064Plugin.js'
import { managementSafetyV065FirmwarePlugin } from './scripts/managementSafetyV065FirmwarePlugin.js'
import { managementSafetyV065WebPlugin } from './scripts/managementSafetyV065WebPlugin.js'
import { managementV066FirmwareGeneratorFixPlugin } from './scripts/managementV066FirmwareGeneratorFixPlugin.js'
import { managementV067FirmwareGeneratorFixPlugin } from './scripts/managementV067FirmwareGeneratorFixPlugin.js'
import { managementV068FirmwareGeneratorFixPlugin } from './scripts/managementV068FirmwareGeneratorFixPlugin.js'
import { managementV069MasterSramPlugin } from './scripts/managementV069MasterSramPlugin.js'
import { managementV0610AClockDiagnosticsPlugin } from './scripts/managementV0610AClockDiagnosticsPlugin.js'
import { managementV0611PerformanceLockPlugin } from './scripts/managementV0611PerformanceLockPlugin.js'
import { managementFirmwareHardenPlugin } from './scripts/managementFirmwareHardenPlugin.js'
import { managementAutonomousFirmwareV062Plugin } from './scripts/managementAutonomousFirmwareV062Plugin.js'
import { managementStableClockV063Plugin } from './scripts/managementStableClockV063Plugin.js'
import { managementFirmwareSequenceDurationPlugin } from './scripts/managementFirmwareSequenceDurationPlugin.js'
import { managementFrameScrubPlugin } from './scripts/managementFrameScrubPlugin.js'
import { managementFirmwareDurationBridgePlugin } from './scripts/managementFirmwareDurationBridgePlugin.js'
import { managementSafetyV065FinalGuardPlugin } from './scripts/managementSafetyV065FinalGuardPlugin.js'
import { managementSafetyV065BundleAuditPlugin } from './scripts/managementSafetyV065BundleAuditPlugin.js'

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
    workspaceUiPolishPlugin(),
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
    projectFootageVisibilityFixPlugin(),
    projectFootageDeletePlugin(),
    scopeManagementPlugin(managementFirmwarePanelPlugin()),
    scopeManagementPlugin(managementEsp32FirmwarePanelPlugin()),
    scopeManagementPlugin(managementABModePlugin()),
    managementFormationStagePlugin(),
    scopeManagementPlugin(liveMonitorPlugin()),
    scopeManagementPlugin(managementSerialSafetyPlugin()),
    managementLiveCueFixPlugin(),
    managementOneClickLivePlugin(),
    managementSerialRecoveryPlugin(),
    managementTelemetryHeartbeatPlugin(),
    managementRehearsalUiPlugin(),
    managementAutonomousHandoffPlugin(),
    managementAutonomousV062Plugin(),
    managementAutonomousV063Plugin(),
    managementFirmwareHardenPlugin(),
    managementAutonomousFirmwareV062Plugin(),
    managementStableClockV063Plugin(),
    managementV063FailClosedPlugin(),
    managementResilientJoinV064Plugin(),
    managementSafetyV065FirmwarePlugin(),
    managementSafetyV065WebPlugin(),
    managementV066FirmwareGeneratorFixPlugin(),
    managementV067FirmwareGeneratorFixPlugin(),
    managementV068FirmwareGeneratorFixPlugin(),
    managementV069MasterSramPlugin(),
    managementV0610AClockDiagnosticsPlugin(),
    managementV0611PerformanceLockPlugin(),
    managementFirmwareSequenceDurationPlugin(),
    managementFrameScrubPlugin(),
    managementFirmwareDurationBridgePlugin(),
    managementSafetyV065FinalGuardPlugin(),
    react(),
    managementSafetyV065BundleAuditPlugin(),
  ],
})