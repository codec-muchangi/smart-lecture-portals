import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../app/AuthContext.jsx'

const NAV = {
  student: [['', 'Dashboard'], ['courses', 'My Courses'], ['attendance', 'Attendance'], ['marks', 'Marks'],
    ['announcements', 'Announcements'], ['notifications', 'Notifications'], ['timetable', 'Timetable'], ['profile', 'Profile'], ['settings', 'Settings']],
  lecturer: [['', 'Dashboard'], ['courses', 'My Courses'], ['notifications', 'Notifications'], ['timetable', 'Timetable'],
    ['profile', 'Profile'], ['settings', 'Settings']],
}

export default function AppShell({ role }) {
  const { user, logout } = useAuth()
  return (
    <div className="shell">
      <nav aria-label="Main">
        <strong>Smart Lecture Portal</strong>
        {NAV[role].map(([to, label]) => (
          <NavLink key={label} to={`/${role}${to ? `/${to}` : ''}`} end={to === ''}>{label}</NavLink>
        ))}
        <button onClick={logout}>Sign out ({user.full_name})</button>
      </nav>
      <main><Outlet /></main>
    </div>
  )
}
