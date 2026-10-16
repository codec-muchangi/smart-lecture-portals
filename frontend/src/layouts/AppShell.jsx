import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../app/AuthContext.jsx'
import { api } from '../services/apiClient.js'

/*
 * Smart Lecture Portal: application shell (sidebar + top bar)
 * Place at: src/layouts/AppShell.jsx  (replaces the existing file)
 *
 * - routes.jsx renders <AppShell role={role} /> and this shell draws the
 *   current page through <Outlet />.
 * - Self-contained: styles are scoped under `.slps` and injected by this
 *   component, so no Tailwind or extra CSS file is needed.
 * - Data: the unread badge reads GET /notifications (Phase 7) and the term
 *   chip reads GET /courses. If /notifications is not live yet, the bell simply
 *   shows no badge.
 * - Lecturer items that live inside a course (grading, attendance,
 *   reports) open My Courses, where a course is chosen
 *   first, exactly like the course tabs described in docs/FRONTEND.md.
 */

const FONT_LINKS = [
  {
    id: 'slp-font-jakarta',
    href: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap',
  },
  {
    id: 'slp-font-symbols',
    href: 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap',
  },
  {
    id: 'slp-font-mono',
    href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap',
  },
]

// `to` is a route under the role's base path. `course: true` means the item lives inside a course.
const NAV = {
  lecturer: [
    { label: 'Dashboard', icon: 'grid_view', to: '', end: true },
    { label: 'My Courses', icon: 'menu_book', to: 'courses' },
    { label: 'Materials Management', icon: 'folder_open', to: 'materials' },
    { label: 'Assignments & Grading', icon: 'assignment_turned_in', course: true },
    { label: 'Attendance Tracker', icon: 'how_to_reg', course: true },
    { label: 'Marks & Assessment', icon: 'grade', to: 'marks' },
    { label: 'Announcements', icon: 'campaign', to: 'announcements' },
    { label: 'Timetable & Schedule', icon: 'calendar_today', to: 'timetable' },
    { label: 'Academic Reports', icon: 'analytics', course: true },
    { label: 'Settings', icon: 'settings', to: 'settings' },
  ],
  student: [
    { label: 'Dashboard', icon: 'grid_view', to: '', end: true },
    { label: 'My Enrolled Courses', icon: 'menu_book', to: 'courses' },
    { label: 'Materials Hub', icon: 'folder_shared', course: true },
    { label: 'Assignments & Submissions', icon: 'assignment', course: true },
    { label: 'Attendance Tracker', icon: 'fact_check', to: 'attendance' },
    { label: 'Marks & Results', icon: 'analytics', to: 'marks' },
    { label: 'Announcements', icon: 'campaign', to: 'announcements' },
    { label: 'Timetable & Schedule', icon: 'calendar_today', to: 'timetable' },
    { label: 'Profile & Settings', icon: 'settings', to: 'profile' },
  ],
}

const PAGE_TITLES = {
  '': 'Dashboard',
  courses: 'My Courses',
  materials: 'Materials',
  assignments: 'Assignments',
  attendance: 'Attendance',
  marks: 'Marks',
  announcements: 'Announcements',
  notifications: 'Notifications',
  timetable: 'Timetable',
  profile: 'Profile',
  settings: 'Settings',
}

const PORTAL_LABELS = { lecturer: 'Faculty Portal', student: 'Student Portal' }

function renderIcon(name, size) {
  return (
    <span
      className="material-symbols-outlined"
      aria-hidden="true"
      style={size ? { fontSize: size } : undefined}
    >
      {name}
    </span>
  )
}

// The API may return a bare array or a paginated object; accept both.
function toList(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.items)) return data.items
  return []
}

// The database already stores "Semester 1"; only add the word when it is missing.
function formatSemester(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  return /^semester/i.test(text) ? text : `Semester ${text}`
}

function AppShell({ role }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [term, setTerm] = useState('')

  const base = `/${role}`
  const items = NAV[role] ?? NAV.student
  const portalLabel = PORTAL_LABELS[role] ?? 'Portal'
  const details = user?.details ?? {}
  const unit = details.department ?? details.program ?? ''
  const identifier = details.staff_number ?? details.registration_number ?? ''
  const name = [details.title, user?.full_name].filter(Boolean).join(' ') || user?.email || 'Account'
  const detailLine = [unit && (details.department ? `Dept. of ${unit}` : unit), identifier && `#${identifier}`]
    .filter(Boolean)
    .join(' ')
  const segment = pathname.slice(base.length + 1).split('/')[0]
  const pageTitle = PAGE_TITLES[segment] ?? 'Portal'

  // Same query keys as the dashboard, so the data is fetched once and shared.
  const coursesQuery = useQuery({
    queryKey: ['courses', 'assigned'],
    queryFn: () => api('/courses?page_size=100'),
  })
  const notificationsQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api('/notifications'),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  })
  const currentTerm = toList(coursesQuery.data)[0]
  const unread = notificationsQuery.isSuccess
    ? toList(notificationsQuery.data).filter((item) => !item.is_read).length
    : 0

  useEffect(() => {
    FONT_LINKS.forEach(({ id, href }) => {
      if (document.getElementById(id)) return
      const link = document.createElement('link')
      link.id = id
      link.rel = 'stylesheet'
      link.href = href
      document.head.appendChild(link)
    })
  }, [])

  // Escape closes the mobile drawer.
  useEffect(() => {
    if (!menuOpen) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])

  const closeMenu = () => setMenuOpen(false)

  const handleSearch = (event) => {
    event.preventDefault()
    const query = term.trim()
    navigate(query ? `${base}/courses?q=${encodeURIComponent(query)}` : `${base}/courses`)
  }

  const handleSignOut = async () => {
    closeMenu()
    await logout()
  }

  return (
    <div className="slps">
      <style>{STYLES}</style>

      {menuOpen && <div className="slps-overlay" onClick={closeMenu} aria-hidden="true" />}

      <aside className={`slps-sidebar ${menuOpen ? 'is-open' : ''}`} id="slps-sidebar">
        <Link to={base} className="slps-brand" onClick={closeMenu}>
          <span className="slps-brand-mark">{renderIcon('school', 22)}</span>
          <span className="slps-brand-text">
            <span className="slps-brand-name">Smart Lecture</span>
            <span className="slps-brand-sub">{portalLabel}</span>
          </span>
        </Link>

        <p className="slps-group-label">Academic Modules</p>

        <nav className="slps-nav" aria-label="Main">
          {items.map((item) => {
            const content = (
              <>
                {renderIcon(item.icon, 20)}
                <span>{item.label}</span>
              </>
            )
            if (item.course) {
              return (
                <Link
                  key={item.label}
                  to={`${base}/courses`}
                  className="slps-link"
                  onClick={closeMenu}
                  title="Choose a course first"
                >
                  {content}
                </Link>
              )
            }
            return (
              <NavLink
                key={item.label}
                to={item.to ? `${base}/${item.to}` : base}
                end={item.end}
                onClick={closeMenu}
                className={({ isActive }) => `slps-link ${isActive ? 'is-active' : ''}`}
              >
                {content}
              </NavLink>
            )
          })}
        </nav>

        <div className="slps-foot">
          <button type="button" className="slps-signout" onClick={handleSignOut}>
            {renderIcon('logout', 20)}
            <span>Sign out</span>
          </button>
          {currentTerm && (
            <div className="slps-term">
              <span className="slps-term-dot" aria-hidden="true" />
              <span className="slps-term-text">
                <span className="slps-term-name">{formatSemester(currentTerm.semester)}</span>
                <span className="slps-term-year">{currentTerm.academic_year}</span>
              </span>
            </div>
          )}
        </div>
      </aside>

      <div className="slps-body">
        <header className="slps-header">
          <div className="slps-header-left">
            <button
              type="button"
              className="slps-menu-btn"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              aria-controls="slps-sidebar"
            >
              {renderIcon(menuOpen ? 'close' : 'menu', 22)}
            </button>
            <nav className="slps-crumb" aria-label="Breadcrumb">
              <span className="slps-crumb-lead">
                {renderIcon('account_balance', 16)}
                <span className="slps-crumb-org">{unit || portalLabel}</span>
                {renderIcon('chevron_right', 16)}
              </span>
              <span className="slps-crumb-page">{pageTitle}</span>
            </nav>
          </div>

          <div className="slps-header-right">
            <form className="slps-search" role="search" onSubmit={handleSearch}>
              {renderIcon('search', 18)}
              <input
                type="search"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder={role === 'student' ? 'Search modules, lectures, exams...' : 'Search courses'}
                aria-label="Search courses"
                maxLength={100}
              />
            </form>

            {role === 'lecturer' && (
              <Link
                to={`${base}/courses`}
                className="slps-cta"
                aria-label="New Material"
                title="Choose a course to add material"
              >
                {renderIcon('add', 18)}
                <span>New Material</span>
              </Link>
            )}

            <Link
              to={`${base}/notifications`}
              className="slps-bell"
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            >
              {renderIcon('notifications', 20)}
              {unread > 0 && <span className="slps-badge">{unread > 99 ? '99+' : unread}</span>}
            </Link>

            <span className="slps-divider" aria-hidden="true" />

            <Link to={`${base}/profile`} className="slps-user">
              <span className="slps-user-text">
                <span className="slps-user-name">{name}</span>
                {detailLine && <span className="slps-user-detail">{detailLine}</span>}
              </span>
              <span className="slps-avatar">{renderIcon('person', 18)}</span>
            </Link>
          </div>
        </header>

        <main className="slps-main">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default AppShell

const STYLES = `
.slps {
  --primary: #a03223;
  --on-primary: #ffffff;
  --primary-container: #c14a38;
  --on-primary-container: #fff5f3;
  --error: #ba1a1a;
  --on-error: #ffffff;
  --surface: #fef7ff;
  --surface-low: #faf0fe;
  --surface-mid: #f4ebf8;
  --surface-high: #eee5f2;
  --surface-highest: #e8dfec;
  --surface-lowest: #ffffff;
  --on-surface: #1e1a23;
  --on-surface-variant: #58413e;
  --outline: #8b716d;
  --sidebar-w: 288px;
  --header-h: 80px;
  font-family: 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  background: var(--surface);
  color: var(--on-surface);
  line-height: 1.5;
  text-align: left;
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
}
.slps *, .slps *::before, .slps *::after { box-sizing: border-box; }
/* :where() keeps the reset at low specificity so the class rules below can override it */
.slps :where(p, ul, ol) { margin: 0; padding: 0; }
.slps :where(ul, ol) { list-style: none; }
.slps a { color: inherit; text-decoration: none; }
.slps button, .slps input { font-family: inherit; }
.slps .material-symbols-outlined {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  font-size: 24px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  flex: 0 0 auto;
  -webkit-font-feature-settings: 'liga';
  font-feature-settings: 'liga';
  -webkit-font-smoothing: antialiased;
}
.slps a:focus-visible, .slps button:focus-visible {
  outline: 3px solid var(--primary-container);
  outline-offset: 2px;
  border-radius: 10px;
}

/* Sidebar */
.slps-sidebar {
  position: fixed; top: 0; left: 0; z-index: 50; width: var(--sidebar-w); height: 100%;
  display: flex; flex-direction: column; background: var(--surface-lowest);
  box-shadow: 0 1px 8px rgba(31, 27, 36, 0.06);
  transform: translateX(-100%); transition: transform 0.25s ease; overflow-y: auto;
}
.slps-sidebar.is-open { transform: translateX(0); }
.slps-brand {
  height: var(--header-h); flex: 0 0 auto; padding: 0 1.5rem; display: flex; align-items: center; gap: 0.5rem;
}
.slps-brand-mark {
  width: 40px; height: 40px; border-radius: 12px; background: var(--primary); color: var(--on-primary);
  display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(160, 50, 35, 0.25);
}
.slps-brand-text { display: flex; flex-direction: column; }
.slps-brand-name { font-size: 16px; line-height: 20px; font-weight: 600; letter-spacing: -0.005em; }
.slps-brand-sub {
  font-size: 11px; line-height: 14px; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--on-surface-variant);
}
.slps-group-label {
  margin-top: 0.5rem; padding: 0.5rem 1.5rem;
  font-size: 11px; line-height: 14px; font-weight: 600; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--outline);
}
.slps-nav { flex: 1 1 auto; padding: 0 1rem; display: flex; flex-direction: column; gap: 4px; }
.slps-link {
  display: flex; align-items: center; gap: 0.75rem; padding: 10px 16px; border-radius: 12px;
  font-size: 14px; line-height: 22px; font-weight: 400; color: var(--on-surface-variant);
  transition: background 0.15s, color 0.15s, box-shadow 0.15s;
}
.slps-link:hover { background: var(--surface-high); color: var(--on-surface); }
.slps-link.is-active {
  background: var(--primary-container); color: var(--on-primary-container);
  font-weight: 600; box-shadow: 0 2px 8px rgba(193, 74, 56, 0.18);
}
.slps-link.is-active:hover { background: var(--primary-container); color: var(--on-primary-container); }
.slps-foot { flex: 0 0 auto; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
.slps-signout {
  width: 100%; padding: 10px 16px; border: 0; border-radius: 12px; cursor: pointer;
  background: var(--surface-low); color: var(--on-surface);
  display: flex; align-items: center; gap: 0.75rem;
  font-size: 14px; line-height: 22px; font-weight: 600; transition: background 0.15s;
}
.slps-signout:hover { background: var(--surface-high); }
.slps-signout .material-symbols-outlined { color: var(--primary); }
.slps-term {
  display: flex; align-items: center; gap: 0.5rem; padding: 10px 16px; border-radius: 12px;
  background: var(--surface-mid);
}
.slps-term-dot { width: 8px; height: 8px; border-radius: 999px; background: var(--primary); flex: 0 0 auto; }
.slps-term-text { display: flex; flex-direction: column; min-width: 0; }
.slps-term-name { font-size: 13px; line-height: 18px; font-weight: 600; }
.slps-term-year { font-size: 11px; line-height: 14px; font-weight: 600; letter-spacing: 0.04em; color: var(--on-surface-variant); }
.slps-overlay { position: fixed; inset: 0; z-index: 45; background: rgba(30, 26, 35, 0.4); }

/* Header */
.slps-body { min-height: 100vh; display: flex; flex-direction: column; }
.slps-header {
  position: fixed; top: 0; left: 0; right: 0; z-index: 40; height: var(--header-h);
  padding: 0 1rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  background: rgba(255, 255, 255, 0.9); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px);
  box-shadow: 0 1px 8px rgba(31, 27, 36, 0.05);
}
.slps-header-left, .slps-header-right { display: flex; align-items: center; gap: 1rem; min-width: 0; }
.slps-menu-btn {
  width: 40px; height: 40px; border: 0; border-radius: 999px; cursor: pointer; flex: 0 0 auto;
  background: var(--surface-low); color: var(--on-surface-variant);
  display: inline-flex; align-items: center; justify-content: center;
}
.slps-crumb {
  display: flex; align-items: center; gap: 0.375rem; min-width: 0;
  font-size: 13px; line-height: 18px; font-weight: 500; color: var(--on-surface-variant);
}
.slps-crumb .material-symbols-outlined { color: var(--outline); }
.slps-crumb-lead { display: none; align-items: center; gap: 0.375rem; min-width: 0; }
.slps-crumb-org { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slps-crumb-page { color: var(--on-surface); font-weight: 600; white-space: nowrap; }
.slps-search {
  display: none; align-items: center; gap: 0.5rem; width: 220px; height: 40px; padding: 0 14px;
  border-radius: 999px; background: var(--surface-low); color: var(--outline);
  transition: box-shadow 0.15s;
}
.slps-search:focus-within { box-shadow: 0 0 0 2px var(--primary-container); }
.slps-search input {
  flex: 1 1 auto; min-width: 0; border: 0; outline: 0; background: transparent;
  font-size: 13px; line-height: 18px; color: var(--on-surface);
}
.slps-search input::placeholder { color: var(--outline); }
.slps-cta {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.25rem; height: 40px; padding: 0 12px;
  border-radius: 999px; background: var(--primary); color: var(--on-primary);
  font-size: 13px; line-height: 18px; font-weight: 600; box-shadow: 0 2px 8px rgba(160, 50, 35, 0.25);
  transition: background 0.15s; white-space: nowrap;
}
.slps-cta:hover { background: var(--primary-container); }
.slps-cta span:last-child { display: none; }
.slps-bell {
  position: relative; width: 40px; height: 40px; border-radius: 999px; background: var(--surface-low); flex: 0 0 auto;
  color: var(--on-surface-variant); display: inline-flex; align-items: center; justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.slps-bell:hover { background: var(--surface-high); color: var(--on-surface); }
.slps-badge {
  position: absolute; top: 2px; right: 2px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 999px;
  background: var(--error); color: var(--on-error); font-size: 10px; line-height: 18px; font-weight: 700; text-align: center;
}
.slps-divider { display: none; width: 1px; height: 32px; background: var(--surface-highest); }
.slps-user { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
.slps-user-text { display: none; flex-direction: column; text-align: right; min-width: 0; }
.slps-user-name {
  font-size: 15px; line-height: 20px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  transition: color 0.15s;
}
.slps-user:hover .slps-user-name { color: var(--primary); }
.slps-user-detail {
  font-size: 11px; line-height: 14px; font-weight: 600; letter-spacing: 0.02em; color: var(--on-surface-variant);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.slps-avatar {
  width: 36px; height: 36px; border-radius: 999px; background: var(--primary); color: var(--on-primary);
  display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
}

/* Content */
.slps-main { flex: 1 1 auto; width: 100%; padding: calc(var(--header-h) + 1.5rem) 1rem 3rem; }

@media (min-width: 640px) {
  .slps-header { padding: 0 1.5rem; }
  .slps-main { padding-left: 1.5rem; padding-right: 1.5rem; }
  .slps-crumb-lead { display: flex; }
  .slps-user-text { display: flex; }
  .slps-divider { display: block; }
  .slps-cta { padding: 0 16px; }
  .slps-cta span:last-child { display: inline; }
}
@media (min-width: 1024px) {
  .slps-sidebar { transform: none; transition: none; }
  .slps-overlay { display: none; }
  .slps-body { padding-left: var(--sidebar-w); }
  .slps-header { left: var(--sidebar-w); }
  .slps-menu-btn { display: none; }
  .slps-search { display: flex; }
}
@media (min-width: 1280px) {
  .slps-search { width: 288px; }
}
@media (prefers-reduced-motion: reduce) {
  .slps-sidebar { transition: none; }
  .slps *, .slps *::before, .slps *::after { transition: none !important; }
}
`
