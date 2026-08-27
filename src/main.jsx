import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import WorkspaceNav from './WorkspaceNav.jsx'

const ManagementApp = lazy(() => import('./ManagementApp.jsx'))
const SyncLiveApp = lazy(() => import('./SyncLiveAppV3.jsx'))
const NrfDiagnosticApp = lazy(() => import('./NrfDiagnosticApp.jsx'))
const workspace = new URLSearchParams(window.location.search).get('workspace')
const currentWorkspace = workspace === 'management'
  ? 'management'
  : workspace === 'sync-live'
    ? 'sync-live'
    : workspace === 'nrf-diagnostic'
      ? 'nrf-diagnostic'
      : 'timeline'
const RootApp = workspace === 'management'
  ? ManagementApp
  : workspace === 'sync-live'
    ? SyncLiveApp
    : workspace === 'nrf-diagnostic'
      ? NrfDiagnosticApp
      : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {currentWorkspace !== 'sync-live' ? <WorkspaceNav current={currentWorkspace} /> : null}
    <Suspense fallback={<div>LED STAGE MANAGEMENT 로딩 중…</div>}>
      <RootApp />
    </Suspense>
  </StrictMode>,
)
