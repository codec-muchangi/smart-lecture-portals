import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/apiClient.js'
import { COURSE_STYLES, ErrorCard, PhasePanel, Skeleton, renderIcon, useClock, useCourseFonts } from '../../components/courseKit.jsx'
import { timeAgo, toList } from '../../utils/format.js'

/*
 * Smart Lecture Portal: student Notifications & Activity Alerts
 * Place at: src/pages/student/StudentNotifications.jsx
 *
 * Route (see routes.jsx):
 *   /student/notifications   your alerts, newest first
 *
 * - Renders inside AppShell, which already draws the sidebar and top bar.
 * - Built on the contract in docs/API.md (Notifications). Endpoints used:
 *     GET   /notifications            your own alerts (same query key as the bell and the dashboard)
 *     PATCH /notifications/{id}/read  mark one alert read
 *     POST  /notifications/read-all   mark every alert read
 * - A notification is { id, type, title, message, link, is_read, created_at, read_at } where type is one of
 *   assignment_published, marks_released, grade_released, material_added, announcement, general.
 * - Notifications arrive in Phase 7. Until the server answers GET /notifications the page says so plainly
 *   and shows no figures. It never invents alerts, scores, deadlines, course codes or lecturers: the API
 *   does not send them, so every number and label below is counted from the alerts it received.
 * - "Open" buttons only appear when the alert carries a link to a page inside this portal.
 */

const NOT_READY = [404, 405, 501]
const READ_KEY = ['notifications']

const TYPES = {
  assignment_published: { label: 'New Assignment Brief', filter: 'assignment', tone: 'primary', icon: 'assignment', action: 'View assignment', actionIcon: 'arrow_forward', solid: true },
  marks_released: { label: 'Released Marks', filter: 'marks', tone: 'rose', icon: 'verified', action: 'Inspect grade & feedback', actionIcon: 'insights', solid: true },
  grade_released: { label: 'Grade Released', filter: 'marks', tone: 'rose', icon: 'verified', action: 'Inspect grade & feedback', actionIcon: 'insights', solid: true },
  material_added: { label: 'New Material Upload', filter: 'materials', tone: 'plum', icon: 'folder_special', action: 'Open materials', actionIcon: 'folder_open', solid: false },
  announcement: { label: 'Course Announcement', filter: 'announcement', tone: 'plain', icon: 'campaign', action: 'View course notice', actionIcon: 'open_in_new', solid: false },
  general: { label: 'Notice', filter: 'general', tone: 'plain', icon: 'notifications', action: 'Open', actionIcon: 'arrow_forward', solid: false },
}
const typeOf = (item) => TYPES[item?.type] ?? TYPES.general

const PILLS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'assignment', label: 'Assignments' },
  { id: 'marks', label: 'Marks & Results' },
  { id: 'materials', label: 'Materials' },
  { id: 'announcement', label: 'Announcements' },
]
const SORTS = [
  { id: 'newest', label: 'Newest First' },
  { id: 'oldest', label: 'Oldest First' },
  { id: 'unread', label: 'Unread Priority' },
  { id: 'type', label: 'Alert Type' },
]

const isNotReady = (error) => NOT_READY.includes(error?.status)
const errorText = (error, fallback) => error?.message || fallback
const stamp = (value) => {
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}
const pad = (value) => String(value).padStart(2, '0')
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

// "Today at 10:15 (2 hours ago)", "Yesterday at 16:45", "Feb 15, 2026 at 11:30"
function describeTime(value, now) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return ''
  const current = new Date(now)
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (sameDay(date, current)) return `Today at ${clock} (${timeAgo(value, now).toLowerCase()})`
  const yesterday = new Date(current.getFullYear(), current.getMonth(), current.getDate() - 1)
  if (sameDay(date, yesterday)) return `Yesterday at ${clock}`
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at ${clock}`
}

const isPortalLink = (link) => typeof link === 'string' && /^\/(?!\/)/.test(link.trim())

// The list may be a bare array or { items, total }; keep whichever shape the server used.
function patchList(data, change) {
  if (Array.isArray(data)) return data.map(change)
  if (Array.isArray(data?.items)) return { ...data, items: data.items.map(change) }
  return data
}

const NOTIFICATION_STYLES = `
.slpn-head { display: flex; flex-direction: column; gap: 1rem; }
.slpn-title-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; }
.slpn-title { margin: 0; font-size: 26px; line-height: 34px; font-weight: 700; letter-spacing: -0.02em; }
.slpn-pending { padding: 2px 10px; border-radius: 999px; background: rgba(160, 50, 35, 0.1); color: var(--primary); font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; }
.slpn-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.slpn-actions .slpc-btn { height: 40px; padding: 0 16px; }
.slpn-icon-btn { width: 40px; height: 40px; border: 0; border-radius: 999px; background: var(--surface-lowest); color: var(--on-surface-variant); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 1px 3px rgba(30, 26, 35, 0.12); transition: box-shadow 0.2s, color 0.2s; }
.slpn-icon-btn:hover:not(:disabled) { color: var(--on-surface); box-shadow: 0 2px 6px rgba(30, 26, 35, 0.16); }
.slpn-icon-btn:disabled { opacity: 0.6; cursor: progress; }
.slpn-spin .material-symbols-outlined { animation: slpn-spin 0.8s linear infinite; }
@keyframes slpn-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .slpn-spin .material-symbols-outlined { animation: none; } }
.slpn-stat-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.5rem; }
.slpn-stat-num { font-size: 32px; line-height: 40px; font-weight: 800; letter-spacing: -0.02em; }
.slpn-stat-word { font-size: 16px; line-height: 24px; font-weight: 500; }
.slpn-stat-word.is-primary { color: var(--primary); }
.slpn-stat-sub { margin: 0.25rem 0 0; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); overflow-wrap: anywhere; }
.slpn-stat-card { position: relative; overflow: hidden; }
.slpn-stat-card::after { content: ''; position: absolute; right: -12px; top: -12px; width: 64px; height: 64px; border-radius: 999px; background: rgba(160, 50, 35, 0.05); pointer-events: none; }
.slpn-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.slpn-main { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.slpn-filters { display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem; }
.slpn-filter-row { display: flex; flex-direction: column; gap: 0.5rem; }
.slpn-filters .slpc-search, .slpn-filters .slpc-select { height: 44px; border-radius: 12px; }
.slpn-filters .slpc-select { width: 100%; padding: 0 12px; }
.slpn-pills { display: flex; align-items: center; gap: 0.25rem; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none; }
.slpn-pills::-webkit-scrollbar { display: none; }
.slpn-pill { flex: 0 0 auto; padding: 7px 14px; border: 0; border-radius: 999px; background: var(--surface-low); color: var(--on-surface-variant); font-size: 12px; line-height: 16px; font-weight: 600; white-space: nowrap; cursor: pointer; font-family: inherit; transition: background 0.2s, color 0.2s; }
.slpn-pill:hover { background: var(--surface-mid); color: var(--on-surface); }
.slpn-pill.is-active { background: var(--primary); color: var(--on-primary); box-shadow: 0 1px 2px rgba(30, 26, 35, 0.2); }
.slpn-feed { display: flex; flex-direction: column; gap: 0.5rem; margin: 0; padding: 0; list-style: none; }
.slpn-item { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 0.5rem; padding: 1.25rem 1.25rem 1.25rem 1.5rem; border-radius: 16px; background: var(--surface-lowest); box-shadow: 0 1px 3px rgba(30, 26, 35, 0.08); transition: box-shadow 0.2s, background 0.2s; }
.slpn-item:hover { box-shadow: 0 4px 12px rgba(30, 26, 35, 0.1); }
.slpn-item.is-read { background: rgba(250, 240, 254, 0.7); box-shadow: none; }
.slpn-item.is-read:hover { background: var(--surface-low); }
.slpn-bar { position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: var(--primary); }
.slpn-meta { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.25rem 0.75rem; }
.slpn-meta-left { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; min-width: 0; }
.slpn-dot { width: 8px; height: 8px; border-radius: 999px; background: var(--primary); flex: 0 0 auto; }
.slpn-badge { padding: 2px 10px; border-radius: 999px; font-size: 11px; line-height: 14px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; background: var(--surface-high); color: var(--on-surface); }
.slpn-badge.is-primary { background: rgba(160, 50, 35, 0.1); color: var(--primary); }
.slpn-badge.is-rose { background: var(--secondary-fixed, #ffdadb); color: var(--on-secondary-fixed-variant, #7f2733); }
.slpn-badge.is-plum { background: var(--surface-highest, #e8dfec); color: var(--tertiary); }
.slpn-item.is-read .slpn-badge { background: var(--surface-high); color: var(--on-surface-variant); }
.slpn-time { display: inline-flex; align-items: center; gap: 0.375rem; font-size: 13px; line-height: 18px; font-weight: 500; color: var(--on-surface-variant); }
.slpn-time .material-symbols-outlined { flex: 0 0 auto; }
.slpn-item.is-unread .slpn-time { color: var(--primary); }
.slpn-item.is-unread .slpn-time .material-symbols-outlined { color: var(--primary); }
.slpn-item-title { margin: 0; font-size: 18px; line-height: 26px; font-weight: 700; letter-spacing: -0.005em; overflow-wrap: anywhere; }
.slpn-item.is-read .slpn-item-title { font-weight: 600; }
.slpn-item-text { margin: 0; font-size: 14px; line-height: 22px; color: var(--on-surface-variant); overflow-wrap: anywhere; white-space: pre-line; }
.slpn-item-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; padding-top: 0.25rem; }
.slpn-open { display: inline-flex; align-items: center; gap: 0.375rem; height: 36px; padding: 0 14px; border-radius: 999px; background: var(--surface-low); color: var(--on-surface); font-size: 12px; line-height: 16px; font-weight: 600; transition: background 0.2s; }
.slpn-open:hover { background: var(--surface-mid); }
.slpn-open.is-solid { background: var(--primary); color: var(--on-primary); box-shadow: 0 1px 2px rgba(30, 26, 35, 0.2); }
.slpn-open.is-solid:hover { background: var(--surface-tint); }
.slpn-open .material-symbols-outlined { color: inherit; }
.slpn-tick { width: 36px; height: 36px; border: 0; border-radius: 12px; background: transparent; color: var(--on-surface-variant); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.2s, color 0.2s; }
.slpn-tick:hover:not(:disabled) { color: var(--primary); background: var(--surface-low); }
.slpn-tick:disabled { opacity: 0.6; cursor: progress; }
.slpn-archived { font-size: 11px; line-height: 14px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpn-end { padding: 1rem; text-align: center; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpn-side { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.slpn-note { display: flex; flex-direction: column; gap: 0.5rem; padding: 1.25rem; }
.slpn-note h2 { margin: 0; display: inline-flex; align-items: center; gap: 0.5rem; font-size: 16px; line-height: 24px; font-weight: 700; color: var(--primary); }
.slpn-note p { margin: 0; font-size: 13px; line-height: 20px; color: var(--on-surface-variant); }
.slpn-help { background: var(--surface-low); box-shadow: none; }
.slpn-help h3 { margin: 0; font-size: 16px; line-height: 24px; font-weight: 700; color: var(--on-surface); }
.slpn-help .slpn-kicker { font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--primary); }
.slpn-help a { display: inline-flex; align-items: center; gap: 0.375rem; margin-top: 0.25rem; font-size: 12px; line-height: 16px; font-weight: 700; color: var(--primary); }
.slpn-help a:hover { text-decoration: underline; }
.slpn-help a .material-symbols-outlined { color: inherit; }
.slpn-alert { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.75rem 1rem; border-radius: 12px; background: var(--error-container); color: var(--on-error-container); font-size: 13px; line-height: 18px; }
@media (min-width: 640px) {
  .slpn-filter-row { flex-direction: row; align-items: center; }
  .slpn-filter-row .slpc-search { flex: 1 1 auto; }
  .slpn-filter-row .slpc-select { width: 190px; flex: 0 0 auto; }
}
@media (min-width: 768px) {
  .slpn-head { flex-direction: row; align-items: flex-end; justify-content: space-between; }
}
@media (min-width: 1024px) {
  .slpn-title { font-size: 32px; line-height: 40px; }
}
@media (min-width: 1180px) {
  .slpn-split { grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr); }
}
@media (max-width: 479px) {
  .slpn-item { padding: 1rem 1rem 1rem 1.25rem; }
  .slpn-item-title { font-size: 16px; line-height: 24px; }
}
`

/* ---------- pieces ---------- */

function Alert({ item, now, busy, onRead }) {
  const meta = typeOf(item)
  const unread = !item.is_read
  const when = describeTime(item.created_at, now)
  const readWhen = item.read_at ? describeTime(item.read_at, now) : ''
  const link = isPortalLink(item.link) ? item.link.trim() : null
  return (
    <li>
      <article className={`slpn-item ${unread ? 'is-unread' : 'is-read'}`} data-type={item.type}>
        {unread && <div className="slpn-bar" aria-hidden="true" />}
        <div className="slpn-meta">
          <div className="slpn-meta-left">
            {unread && <span className="slpn-dot" title="Unread" aria-label="Unread" />}
            <span className={`slpn-badge is-${meta.tone}`}>{meta.label}</span>
          </div>
          <span className="slpn-time">
            {renderIcon(unread ? 'schedule' : 'done', 16)}
            <span>{unread ? when : readWhen ? `Read ${readWhen}` : when}</span>
          </span>
        </div>
        <h3 className="slpn-item-title">{item.title}</h3>
        {item.message && <p className="slpn-item-text">{item.message}</p>}
        <div className="slpn-item-foot">
          {link ? (
            <Link to={link} className={`slpn-open ${unread && meta.solid ? 'is-solid' : ''}`}>
              <span>{meta.action}</span>
              {renderIcon(meta.actionIcon, 16)}
            </Link>
          ) : (
            <span />
          )}
          {unread ? (
            <button type="button" className="slpn-tick" onClick={() => onRead(item.id)} disabled={busy} title="Mark as read" aria-label={`Mark as read: ${item.title}`}>
              {renderIcon('check', 20)}
            </button>
          ) : (
            <span className="slpn-archived">Read</span>
          )}
        </div>
      </article>
    </li>
  )
}

/* ---------- page ---------- */

export default function StudentNotifications() {
  useCourseFonts()
  const now = useClock()
  const queryClient = useQueryClient()

  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('newest')
  const [search, setSearch] = useState('')

  const feed = useQuery({
    queryKey: READ_KEY,
    queryFn: () => api('/notifications'),
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  })

  const markOne = useMutation({
    mutationFn: (id) => api(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' }),
    onSuccess: (_result, id) => {
      const readAt = new Date().toISOString()
      queryClient.setQueryData(READ_KEY, (data) => patchList(data, (item) => (item.id === id ? { ...item, is_read: true, read_at: item.read_at ?? readAt } : item)))
    },
  })
  const markAll = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => {
      const readAt = new Date().toISOString()
      queryClient.setQueryData(READ_KEY, (data) => patchList(data, (item) => (item.is_read ? item : { ...item, is_read: true, read_at: readAt })))
    },
  })

  const ready = feed.isSuccess
  const notReady = feed.isError && isNotReady(feed.error)
  const failed = feed.isError && !notReady

  const all = ready ? toList(feed.data) : []
  const unreadCount = all.filter((item) => !item.is_read).length
  const ofFilter = (id) => all.filter((item) => typeOf(item).filter === id)
  const counts = {
    all: all.length,
    unread: unreadCount,
    assignment: ofFilter('assignment').length,
    marks: ofFilter('marks').length,
    materials: ofFilter('materials').length,
    announcement: ofFilter('announcement').length,
  }

  const needle = search.trim().toLowerCase()
  const shown = all
    .filter((item) => (filter === 'all' ? true : filter === 'unread' ? !item.is_read : typeOf(item).filter === filter))
    .filter((item) => !needle || `${item.title ?? ''} ${item.message ?? ''} ${typeOf(item).label}`.toLowerCase().includes(needle))
    .sort((a, b) => {
      if (sort === 'oldest') return stamp(a.created_at) - stamp(b.created_at)
      if (sort === 'unread') return Number(Boolean(a.is_read)) - Number(Boolean(b.is_read)) || stamp(b.created_at) - stamp(a.created_at)
      if (sort === 'type') return typeOf(a).label.localeCompare(typeOf(b).label) || stamp(b.created_at) - stamp(a.created_at)
      return stamp(b.created_at) - stamp(a.created_at)
    })

  const latestOf = (items) => [...items].sort((a, b) => stamp(b.created_at) - stamp(a.created_at))[0]
  const unreadAnnouncements = ofFilter('announcement').filter((item) => !item.is_read)
  const unreadMarks = ofFilter('marks').filter((item) => !item.is_read)
  const weekAgo = now - 7 * 86400000
  const lastWeek = all.filter((item) => stamp(item.created_at) >= weekAgo)
  const newest = latestOf(all)

  const total = typeof feed.data?.total === 'number' ? feed.data.total : all.length
  const error = markOne.error || markAll.error

  const refresh = () => {
    markOne.reset()
    markAll.reset()
    feed.refetch()
  }

  return (
    <div className="slpc" aria-label="Notifications and activity alerts">
      <style>{COURSE_STYLES}</style>
      <style>{NOTIFICATION_STYLES}</style>

      <div className="slpc-stack slpc-gap-lg">
        <div className="slpc-stack" style={{ gap: '0.25rem' }}>
          <nav className="slpc-trail" aria-label="Breadcrumb">
            <Link to="/student" className="slpc-trail-link">
              {renderIcon('dashboard', 16)}
              Student Dashboard
            </Link>
            <span className="slpc-trail-sep">/</span>
            <span className="slpc-trail-current">Notifications &amp; Activity Alerts</span>
          </nav>

          <div className="slpn-head" style={{ paddingTop: '0.25rem' }}>
            <div className="slpc-stack" style={{ gap: '0.25rem' }}>
              <div className="slpn-title-row">
                <h1 className="slpn-title">Notifications</h1>
                {ready && unreadCount > 0 && <span className="slpn-pending">{unreadCount} Pending</span>}
              </div>
              <p className="slpc-lead" style={{ maxWidth: 720 }}>
                Academic alerts, coursework updates, released marks and course notices for the courses you are enrolled in.
              </p>
            </div>
            <div className="slpn-actions">
              <button type="button" className="slpc-btn slpc-btn-primary" onClick={() => markAll.mutate()} disabled={!ready || unreadCount === 0 || markAll.isPending}>
                {renderIcon(ready && unreadCount === 0 ? 'done' : 'done_all', 18)}
                {markAll.isPending ? 'Marking…' : ready && unreadCount === 0 ? 'All Cleared' : 'Mark All as Read'}
              </button>
              <Link to="/student/settings" className="slpc-btn slpc-btn-soft">
                {renderIcon('tune', 18)}
                Preferences
              </Link>
              <button type="button" className={`slpn-icon-btn ${feed.isFetching ? 'slpn-spin' : ''}`} onClick={refresh} title="Refresh feed" aria-label="Refresh feed" disabled={feed.isFetching}>
                {renderIcon('refresh', 18)}
              </button>
            </div>
          </div>
        </div>

        <div className="slpc-stats" aria-label="Notification summary">
          <div className="slpc-card slpc-stat slpn-stat-card">
            <div className="slpc-stat-top">
              <span className="slpc-stat-label" style={{ color: 'var(--primary)' }}>
                Priority action
              </span>
              <span className="slpc-stat-icon is-fixed">{renderIcon('mark_email_unread', 18)}</span>
            </div>
            <div>
              <div className="slpn-stat-line">
                <span className="slpn-stat-num">{ready ? unreadCount : '—'}</span>
                <span className="slpn-stat-word is-primary">Unread</span>
              </div>
              <p className="slpn-stat-sub">{ready ? (unreadCount === 0 ? 'You are all caught up' : 'Alerts you have not opened yet') : 'Waiting for notifications'}</p>
            </div>
          </div>

          <div className="slpc-card slpc-stat">
            <div className="slpc-stat-top">
              <span className="slpc-stat-label">Faculty broadcasts</span>
              <span className="slpc-stat-icon is-warm">{renderIcon('campaign', 18)}</span>
            </div>
            <div>
              <div className="slpn-stat-line">
                <span className="slpn-stat-num">{ready ? unreadAnnouncements.length : '—'}</span>
                <span className="slpn-stat-word">{unreadAnnouncements.length === 1 ? 'New Dispatch' : 'New Dispatches'}</span>
              </div>
              <p className="slpn-stat-sub">{ready ? (unreadAnnouncements.length > 0 ? latestOf(unreadAnnouncements).title : 'No unread course announcements') : 'Waiting for notifications'}</p>
            </div>
          </div>

          <div className="slpc-card slpc-stat">
            <div className="slpc-stat-top">
              <span className="slpc-stat-label">Ledger updates</span>
              <span className="slpc-stat-icon is-mid">{renderIcon('verified', 18)}</span>
            </div>
            <div>
              <div className="slpn-stat-line">
                <span className="slpn-stat-num">{ready ? unreadMarks.length : '—'}</span>
                <span className="slpn-stat-word">{unreadMarks.length === 1 ? 'Released Mark' : 'Released Marks'}</span>
              </div>
              <p className="slpn-stat-sub">{ready ? (unreadMarks.length > 0 ? latestOf(unreadMarks).title : 'No unread marks or grades') : 'Waiting for notifications'}</p>
            </div>
          </div>

          <div className="slpc-card slpc-stat">
            <div className="slpc-stat-top">
              <span className="slpc-stat-label">Last 7 days</span>
              <span className="slpc-stat-icon is-mid">{renderIcon('timer', 18)}</span>
            </div>
            <div>
              <div className="slpn-stat-line">
                <span className="slpn-stat-num">{ready ? lastWeek.length : '—'}</span>
                <span className="slpn-stat-word is-primary">{lastWeek.length === 1 ? 'Alert' : 'Alerts'}</span>
              </div>
              <p className="slpn-stat-sub">{ready ? (newest ? `Latest ${timeAgo(newest.created_at, now).toLowerCase()}` : 'Nothing received yet') : 'Waiting for notifications'}</p>
            </div>
          </div>
        </div>

        <div className="slpn-split">
          <div className="slpn-main">
            <section className="slpc-card slpn-filters" aria-label="Filter notifications">
              <div className="slpn-filter-row">
                <label className="slpc-search">
                  {renderIcon('search', 18)}
                  <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search alerts by title or keyword" aria-label="Search alerts" />
                </label>
                <select className="slpc-select" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort alerts">
                  {SORTS.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="slpn-pills" role="group" aria-label="Alert type">
                {PILLS.map((entry) => (
                  <button key={entry.id} type="button" className={`slpn-pill ${filter === entry.id ? 'is-active' : ''}`} onClick={() => setFilter(entry.id)} aria-pressed={filter === entry.id}>
                    {entry.label}
                    {ready ? ` (${counts[entry.id]})` : ''}
                  </button>
                ))}
              </div>
            </section>

            {error && (
              <div className="slpn-alert" role="alert">
                <span>{errorText(error, 'That change could not be saved. Please try again.')}</span>
                <button type="button" className="slpc-btn slpc-btn-soft" onClick={refresh}>
                  Refresh
                </button>
              </div>
            )}

            {feed.isPending && <Skeleton height={260} label="Loading notifications" />}
            {failed && <ErrorCard message={errorText(feed.error, 'Your notifications could not be loaded.')} onRetry={() => feed.refetch()} />}
            {notReady && (
              <PhasePanel icon="notifications" title="Notifications are not switched on yet" phase="Phase 7">
                The notification service is not available on the server yet. This page is ready: once it is enabled, your alerts will appear here.
              </PhasePanel>
            )}
            {ready && all.length === 0 && <p className="slpc-card slpc-empty">You have no notifications yet. New assignments, marks, materials and announcements will show up here.</p>}
            {ready && all.length > 0 && shown.length === 0 && <p className="slpc-card slpc-empty">No alerts match these filters.</p>}

            {ready && shown.length > 0 && (
              <ul className="slpn-feed" aria-label="Notifications">
                {shown.map((item) => (
                  <Alert key={item.id} item={item} now={now} busy={markOne.isPending && markOne.variables === item.id} onRead={(id) => markOne.mutate(id)} />
                ))}
              </ul>
            )}

            {ready && all.length > 0 && (
              <div className="slpc-card slpn-end">
                Showing {shown.length} of {total} {total === 1 ? 'alert' : 'alerts'}
                {total > all.length ? ` (the latest ${all.length} are loaded)` : ''}.
              </div>
            )}
          </div>

          <div className="slpn-side">
            <section className="slpc-card slpn-note" aria-label="Who sees these alerts">
              <h2>
                {renderIcon('security', 20)}
                Scoped Authorization
              </h2>
              <p>These alerts are private to you. You only receive them for courses you are actively enrolled in, and nobody else can read or clear them.</p>
            </section>
            <section className="slpc-card slpn-note slpn-help" aria-label="Questions about a mark">
              <span className="slpn-kicker">Question about a mark?</span>
              <h3>Check your results first</h3>
              <p>Every released mark and its feedback are in Marks &amp; Results. If something looks wrong, speak to your course lecturer.</p>
              <Link to="/student/marks">
                <span>Open Marks &amp; Results</span>
                {renderIcon('arrow_forward', 16)}
              </Link>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
