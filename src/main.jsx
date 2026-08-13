import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const ManagementApp = lazy(() => import('./ManagementApp.jsx'))
const workspace = new URLSearchParams(window.location.search).get('workspace')
const RootApp = workspace === 'management' ? ManagementApp : App

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Suspense fallback={<div>LED STAGE MANAGEMENT 로딩 중…</div>}>
      <RootApp />
    </Suspense>
  </StrictMode>,
)
