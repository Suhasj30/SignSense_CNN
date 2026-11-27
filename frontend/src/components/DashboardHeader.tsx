import { Camera, CircleCheck, Cpu, Menu, X } from 'lucide-react'
import type { BackendHealth } from '../hooks/useBackendHealth'
import type { View } from '../types'

const pageCopy: Record<View, { title: string; subtitle: string }> = {
  dashboard: {
    title: 'Sign language translator',
    subtitle: 'A more natural way to turn signs into conversation.',
  },
  history: {
    title: 'Translation history',
    subtitle: 'Your recent phrases, ready when you need them.',
  },
  settings: {
    title: 'Preferences',
    subtitle: 'Make SignSense work the way you communicate.',
  },
}

interface DashboardHeaderProps {
  view: View
  cameraActive: boolean
  backendHealth: BackendHealth
  onMobileMenu: () => void
  mobileMenuOpen: boolean
}

export function DashboardHeader({
  view,
  cameraActive,
  backendHealth,
  onMobileMenu,
  mobileMenuOpen,
}: DashboardHeaderProps) {
  const copy = pageCopy[view]
  const backendLabel =
    backendHealth.state === 'checking'
      ? 'Checking backend'
      : backendHealth.state === 'online'
        ? `CNN online · ${backendHealth.device.toUpperCase()}`
        : 'CNN backend offline'

  return (
    <header className="page-header">
      <button className="mobile-menu-button" onClick={onMobileMenu} aria-label="Toggle navigation">
        {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
      </button>
      <div className="page-heading">
        <span className="eyebrow">AI-POWERED SIGN LANGUAGE RECOGNITION</span>
        <h1>{copy.title}</h1>
        <p>{copy.subtitle}</p>
      </div>
      <div className="header-status">
        <div
          className={`status-pill${backendHealth.state === 'online' ? ' is-online' : ''}`}
          role="status"
          title={backendHealth.error || backendLabel}
        >
          <Cpu size={15} />
          <span><i /> {backendLabel}</span>
        </div>
        <div className={`status-pill${cameraActive ? ' is-online' : ''}`}>
          {cameraActive ? <CircleCheck size={15} /> : <Camera size={15} />}
          <span>{cameraActive ? 'Camera connected' : 'Camera off'}</span>
        </div>
      </div>
    </header>
  )
}
