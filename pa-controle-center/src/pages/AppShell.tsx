import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom'
import { clearStoredSecret, getStoredSecret } from '../api/paAdmin'

export function AppShell() {
  const navigate = useNavigate()
  const authed = Boolean(getStoredSecret())

  if (!authed) {
    return <Navigate to="/unlock" replace />
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">PA</span>
          <div>
            <strong>Ivorix</strong>
            <small>Control Center</small>
          </div>
        </div>
        <nav>
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/chats">Chats</NavLink>
          <NavLink to="/groups">Groups</NavLink>
          <NavLink to="/support">Support</NavLink>
          <NavLink to="/leads">Leads</NavLink>
          <NavLink to="/atrium">Atrium</NavLink>
        </nav>
        <button
          type="button"
          className="ghost lock-btn"
          onClick={() => {
            clearStoredSecret()
            navigate('/unlock')
          }}
        >
          Lock
        </button>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
