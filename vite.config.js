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
import { premiereVideoBuildGuardPlugin } from './scripts/premiereVideoBuildGuardPlugin.js'

// https://vite.dev/config/
// production deployment trigger: 10ms solid cue timing
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
    premiereWorkspaceCleanupPlugin(),
    choreographyFormationPlugin(),
    formationMemorySidebarPlugin(),
    formationWidthResizePlugin(),
    fineBlockTimingPlugin(),
    premiereVideoBuildGuardPlugin(),
    react(),
  ],
})
