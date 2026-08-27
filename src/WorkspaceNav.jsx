import React from 'react'
import './WorkspaceNav.css'

const items = [
  { key: 'timeline', label: 'TIMELINE', href: '/' },
  { key: 'management', label: 'MANAGEMENT', href: '/?workspace=management' },
  { key: 'sync-live', label: 'SYNC LIVE', href: '/?workspace=sync-live' },
  { key: 'nrf-diagnostic', label: 'NRF DIAGNOSTIC', href: '/?workspace=nrf-diagnostic' },
]

export default function WorkspaceNav({ current }) {
  return (
    <nav className="workspace-nav" aria-label="Workspace navigation">
      {items.map((item) => (
        <a
          key={item.key}
          className={`workspace-nav__item ${current === item.key ? 'is-active' : ''}`}
          href={item.href}
        >
          {item.label}
        </a>
      ))}
    </nav>
  )
}
