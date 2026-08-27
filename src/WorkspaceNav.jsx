import React from 'react'

const tabs = [
  { key: 'timeline', label: 'TIMELINE', href: '/' },
  { key: 'management', label: 'MANAGEMENT', href: '/?workspace=management' },
  { key: 'sync-live', label: 'SYNC LIVE', href: '/?workspace=sync-live' },
]

export default function WorkspaceNav({ active = 'timeline' }) {
  return (
    <nav aria-label="workspace" style={{
      position: 'fixed', top: 8, right: 10, zIndex: 10000,
      display: 'flex', gap: 4, padding: 4,
      background: 'rgba(10,13,20,.94)', border: '1px solid #2a3247', borderRadius: 10,
      boxShadow: '0 8px 24px rgba(0,0,0,.35)', backdropFilter: 'blur(10px)',
      fontFamily: 'Pretendard, Apple SD Gothic Neo, Malgun Gothic, sans-serif',
    }}>
      {tabs.map((tab) => (
        <a key={tab.key} href={tab.href} style={{
          color: active === tab.key ? '#fff' : '#aeb8cf',
          textDecoration: 'none', fontSize: 11, fontWeight: 800, letterSpacing: '.04em',
          padding: '6px 9px', borderRadius: 7,
          border: `1px solid ${active === tab.key ? '#7059ff' : 'transparent'}`,
          background: active === tab.key ? 'linear-gradient(135deg,#5c46e8,#392f8f)' : 'transparent',
        }}>
          {tab.label}
        </a>
      ))}
    </nav>
  )
}
