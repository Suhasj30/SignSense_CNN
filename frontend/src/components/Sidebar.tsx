import {
  AudioLines,
  ChevronLeft,
  Hand,
  History,
  LayoutDashboard,
  Settings,
} from 'lucide-react'
import type { View } from '../types'

interface SidebarProps {
  activeView: View
  onNavigate: (view: View) => void
  collapsed: boolean
  onToggle: () => void
}

const navigation: { view: View; label: string; icon: typeof LayoutDashboard }[] = [
  { view: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { view: 'history', label: 'Translation history', icon: History },
  { view: 'settings', label: 'Settings', icon: Settings },
]

export function Sidebar({ activeView, onNavigate, collapsed, onToggle }: SidebarProps) {
  return (
    <aside className={`sidebar${collapsed ? ' is-collapsed' : ''}`}>
      <button className="brand" onClick={() => onNavigate('dashboard')} aria-label="SignSense dashboard">
        <span className="brand-mark">
          <Hand size={21} strokeWidth={2.2} />
          <AudioLines className="brand-signal" size={13} strokeWidth={2.4} />
        </span>
        {!collapsed && (
          <span className="brand-copy">
            <strong>SignSense</strong>
            <small>Sign language, understood.</small>
          </span>
        )}
      </button>

      <div className="nav-caption">{!collapsed && 'WORKSPACE'}</div>
      <nav className="primary-nav" aria-label="Main navigation">
        {navigation.map(({ view, label, icon: Icon }) => (
          <button
            key={view}
            className={`nav-item${activeView === view ? ' active' : ''}`}
            onClick={() => onNavigate(view)}
            aria-current={activeView === view ? 'page' : undefined}
            title={collapsed ? label : undefined}
          >
            <Icon size={19} strokeWidth={1.9} />
            {!collapsed && <span>{label}</span>}
            {!collapsed && activeView === view && <span className="nav-active-dot" />}
          </button>
        ))}
      </nav>

      <div className="sidebar-bottom">
        {!collapsed && (
          <div className="sidebar-note">
            <span className="note-icon"><AudioLines size={17} /></span>
            <strong>Communication, made clearer.</strong>
            <p>Turn every sign into a voice.</p>
          </div>
        )}
        <button className="collapse-button" onClick={onToggle} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <ChevronLeft size={17} className={collapsed ? 'rotate-icon' : ''} />
          {!collapsed && <span>Collapse menu</span>}
        </button>
      </div>
    </aside>
  )
}
