import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext.jsx'

export function RequireAuth() {
  const { user, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <p role="status">Loading…</p>
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />
  return <Outlet />
}

// UX-only guard. The backend enforces authorization.
export function RequireRole({ role }) {
  const { user } = useAuth()
  if (user.role !== role) return <Navigate to={`/${user.role}`} replace />
  return <Outlet />
}
