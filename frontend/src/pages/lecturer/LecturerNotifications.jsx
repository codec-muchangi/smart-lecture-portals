import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/apiClient.js'
import { COURSES_KEY, COURSE_STYLES, ErrorCard, PhasePanel, Skeleton, fetchCourses, renderIcon, useClock, useCourseFonts } from '../../components/courseKit.jsx'
import { csvCell, downloadText } from '../../utils/timetable.js'
import { timeAgo, toList } from '../../utils/format.js'

/*
 * Smart Lecture Portal: lecturer Notifications & Dispatch Alerts
 * Place at: src/pages/lecturer/LecturerNotifications.jsx
 *
 * Route (see routes.jsx):
 *   /lecturer/notifications   your alerts plus live review and deadline signals
 *
 * - Renders inside AppShell, which already draws the sidebar and top bar.
 * - Built on the contract in docs/API.md. Endpoints used:
 *     GET   /notifications                    your own alerts (same query key as the bell)
 *     PATCH /notifications/{id}/read          mark one alert read
 *     POST  /notifications/read-all           mark every alert read
 *     GET   /courses                          the courses you teach
 *     GET   /courses/{id}/assignments         deadlines (published assignments)
 *     GET   /assignments/{id}                 submission_counts for the grading queue
 * - Two kinds of card appear in the feed:
 *     alerts    real notifications from the server (Phase 7). Until the server answers GET /notifications
 *               the page says so plainly; it never invents alerts.
 *     signals   computed live from your assignments: "closing within 24 hours" and "awaiting grading".
 *               They are counted from real data, carry no read state, and disappear by themselves once
 *               the deadline passes or the work is graded.
 * - Nothing here claims student identities, file hashes, virus scans or enrolment shortfalls: the API does
 *   not send them. A figure that cannot be counted (a failed request) shows "—", never a guess.
 * - Export downloads the cards currently listed as a CSV file.
 */

const NOT_READY = [404, 405, 501]
const READ_KEY = ['notifications']
const DAY = 86400000
const WATCH_KEY = 'lecturer-alert-watch'

const TYPES = {
  assignment_published: { label: 'Assignment', icon: 'assignment', tone: 'plain' },
  marks_released: { label: 'Marks', icon: 'verified', tone: 'plain' },
  grade_released: { label: 'Grades', icon: 'verified', tone: 'plain' },
  material_added: { label: 'Materials', icon: 'folder_special', tone: 'plain' },
  announcement: { label: 'Announcement', icon: 'campaign', tone: 'plain' },
  general: { label: 'Notice', icon: 'notifications', tone: 'plain' },
}
const typeOf = (item) => TYPES[item?.type] ?? TYPES.general

const PILLS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'review', label: 'Awaiting grading' },
  { id: 'deadline', label: 'Closing soon' },
  { id: 'alert', label: 'System alerts' },
]
const SORTS = [
  { id: 'newest', label: 'Newest First' },
  { id: 'oldest', label: 'Oldest First' },
  { id: 'unread', label: 'Unread Priority' },
]

const isNotReady = (error) => NOT_READY.includes(error?.status)
const errorText = (error, fallback) => error?.message || fallback
const stamp = (value) => {
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}
const pad = (value) => String(value).padStart(2, '0')
const isPortalLink = (link) => typeof link === 'string' && /^\/(?!\/)/.test(link.trim())
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

function when(value) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return ''
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
function countdown(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000))
  const hours = Math.floor(minutes / 60)
  return hours < 1 ? `${minutes}m` : `${hours}h ${pad(minutes % 60)}m`
}
function patchList(data, change) {
  if (Array.isArray(data)) return data.map(change)
  if (Array.isArray(data?.items)) return { ...data, items: data.items.map(change) }
  return data
}
const sumCounts = (counts) => {
  const total = { submitted: 0, late: 0, graded: 0, returned: 0 }
  counts.forEach((entry) => Object.keys(total).forEach((key) => (total[key] += Number(entry?.[key]) || 0)))
  return total
}

/*
 * One pass over every course you teach. Each request may fail on its own: a failed piece is recorded in
 * `failed`, so the rest of the page still renders and never shows a wrong number.
 */
async function loadWatch(courses) {
  const rows = []
  const failed = []
  await Promise.all(
    courses.map(async (course) => {
      let list
      try {
        list = toList(await api(`/courses/${course.id}/assignments?page_size=100`))
      } catch {
        failed.push(course.course_code)
        return
      }
      const published = list.filter((item) => item.state !== 'draft')
      const details = await Promise.allSettled(published.map((item) => api(`/assignments/${item.id}`)))
      let missing = false
      published.forEach((item, index) => {
        const result = details[index]
        if (result.status !== 'fulfilled') missing = true
        rows.push({
          id: String(item.id),
          courseId: course.id,
          code: course.course_code,
          courseName: course.course_name,
          title: String(item.title ?? ''),
          state: item.state,
          due_at: item.due_at,
          counts: result.status === 'fulfilled' ? (result.value?.submission_counts ?? null) : null,
        })
      })
      if (missing) failed.push(course.course_code)
    }),
  )
  rows.sort((a, b) => stamp(a.due_at) - stamp(b.due_at))
  return { rows, failed: [...new Set(failed)] }
}

const ALERT_STYLES = `
.slpo-head { display: flex; flex-direction: column; gap: 1rem; }
.slpo-title { margin: 0; font-size: 26px; line-height: 34px; font-weight: 700; letter-spacing: -0.02em; overflow-wrap: anywhere; }
.slpo-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.slpo-actions .slpc-btn { height: 40px; padding: 0 16px; }
.slpo-icon-btn { width: 40px; height: 40px; border: 0; border-radius: 999px; background: var(--surface-lowest); color: var(--on-surface-variant); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 1px 3px rgba(30, 26, 35, 0.12); transition: box-shadow 0.2s, color 0.2s; }
.slpo-icon-btn:hover:not(:disabled) { color: var(--on-surface); box-shadow: 0 2px 6px rgba(30, 26, 35, 0.16); }
.slpo-icon-btn:disabled { opacity: 0.6; cursor: progress; }
.slpo-spin .material-symbols-outlined { animation: slpo-spin 0.8s linear infinite; }
@keyframes slpo-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .slpo-spin .material-symbols-outlined { animation: none; } }
.slpo-stat { position: relative; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; gap: 0.75rem; padding: 1rem; }
.slpo-stat-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; }
.slpo-stat-label { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.375rem 0.5rem; font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpo-live { padding: 1px 8px; border-radius: 999px; background: rgba(160, 50, 35, 0.1); color: var(--primary); font-size: 10px; line-height: 14px; font-weight: 700; letter-spacing: 0.04em; }
.slpo-live.is-danger { background: var(--error-container); color: var(--on-error-container); }
.slpo-stat-icon { flex: 0 0 auto; width: 32px; height: 32px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; background: var(--surface-mid); color: var(--primary); }
.slpo-stat-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.5rem; }
.slpo-stat-num { font-size: 36px; line-height: 40px; font-weight: 800; letter-spacing: -0.02em; }
.slpo-stat-num.is-danger { color: var(--error); }
.slpo-stat-word { font-size: 16px; line-height: 24px; font-weight: 600; color: var(--primary); }
.slpo-stat-word.is-danger { color: var(--error); }
.slpo-stat-sub { margin: 0.25rem 0 0; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); overflow-wrap: anywhere; }
.slpo-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.slpo-main { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.slpo-filters { display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem; }
.slpo-filter-row { display: flex; flex-direction: column; gap: 0.5rem; }
.slpo-filters .slpc-search, .slpo-filters .slpc-select { height: 44px; border-radius: 12px; }
.slpo-filters .slpc-select { width: 100%; padding: 0 12px; }
.slpo-pills { display: flex; align-items: center; gap: 0.25rem; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none; }
.slpo-pills::-webkit-scrollbar { display: none; }
.slpo-pill { flex: 0 0 auto; padding: 7px 14px; border: 0; border-radius: 999px; background: var(--surface-low); color: var(--on-surface-variant); font-size: 12px; line-height: 16px; font-weight: 600; white-space: nowrap; cursor: pointer; font-family: inherit; transition: background 0.2s, color 0.2s; }
.slpo-pill:hover { background: var(--surface-mid); color: var(--on-surface); }
.slpo-pill.is-active { background: var(--primary); color: var(--on-primary); box-shadow: 0 1px 2px rgba(30, 26, 35, 0.2); }
.slpo-feed { display: flex; flex-direction: column; gap: 0.75rem; margin: 0; padding: 0; list-style: none; }
.slpo-item { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 0.5rem; padding: 1.25rem 1.25rem 1.25rem 1.5rem; border-radius: 16px; background: var(--surface-lowest); box-shadow: 0 1px 3px rgba(30, 26, 35, 0.08); transition: box-shadow 0.2s, background 0.2s; }
.slpo-item:hover { box-shadow: 0 4px 12px rgba(30, 26, 35, 0.1); }
.slpo-item.is-urgent { background: rgba(255, 218, 214, 0.35); }
.slpo-item.is-read { background: rgba(250, 240, 254, 0.7); box-shadow: none; }
.slpo-item.is-selected { box-shadow: 0 0 0 2px var(--primary-container), 0 4px 12px rgba(30, 26, 35, 0.1); }
.slpo-bar { position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: var(--primary); }
.slpo-bar.is-urgent { background: var(--error); }
.slpo-meta { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.25rem 0.75rem; }
.slpo-meta-left { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; min-width: 0; }
.slpo-dot { width: 8px; height: 8px; border-radius: 999px; background: var(--primary); flex: 0 0 auto; }
.slpo-dot.is-urgent { background: var(--error); }
.slpo-badge { padding: 2px 10px; border-radius: 999px; font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; background: var(--surface-high); color: var(--on-surface); }
.slpo-badge.is-primary { background: rgba(160, 50, 35, 0.1); color: var(--primary); }
.slpo-badge.is-urgent { background: var(--error-container); color: var(--on-error-container); }
.slpo-item.is-read .slpo-badge { color: var(--on-surface-variant); }
.slpo-code { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--primary); }
.slpo-time { display: inline-flex; align-items: center; gap: 0.375rem; font-size: 13px; line-height: 18px; font-weight: 500; color: var(--on-surface-variant); }
.slpo-time .material-symbols-outlined { flex: 0 0 auto; }
.slpo-item.is-unread .slpo-time, .slpo-item.is-urgent .slpo-time { color: var(--primary); }
.slpo-item-title { margin: 0; font-size: 18px; line-height: 26px; font-weight: 700; letter-spacing: -0.005em; }
.slpo-item-title button { all: unset; box-sizing: border-box; display: inline; cursor: pointer; overflow-wrap: anywhere; }
.slpo-item-title button:hover { color: var(--primary); }
.slpo-item-title button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 4px; }
.slpo-item.is-read .slpo-item-title { font-weight: 600; }
.slpo-item-text { margin: 0; font-size: 14px; line-height: 22px; color: var(--on-surface-variant); overflow-wrap: anywhere; white-space: pre-line; }
.slpo-item-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; padding-top: 0.25rem; }
.slpo-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; min-width: 0; }
.slpo-chip { display: inline-flex; align-items: center; gap: 0.375rem; padding: 5px 10px; border-radius: 8px; background: var(--surface-mid); color: var(--on-surface); font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 14px; font-weight: 600; }
.slpo-chip.is-urgent { background: var(--error-container); color: var(--on-error-container); }
.slpo-chip .material-symbols-outlined { color: inherit; }
.slpo-link { display: inline-flex; align-items: center; gap: 0.375rem; height: 36px; padding: 0 14px; border-radius: 999px; background: var(--surface-low); color: var(--on-surface); font-size: 12px; line-height: 16px; font-weight: 700; transition: background 0.2s; }
.slpo-link:hover { background: var(--surface-mid); }
.slpo-link.is-solid { background: var(--primary); color: var(--on-primary); box-shadow: 0 1px 2px rgba(30, 26, 35, 0.2); }
.slpo-link.is-solid:hover { background: var(--surface-tint); }
.slpo-link .material-symbols-outlined { color: inherit; }
.slpo-tick { width: 36px; height: 36px; border: 0; border-radius: 12px; background: transparent; color: var(--on-surface-variant); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.2s, color 0.2s; }
.slpo-tick:hover:not(:disabled) { color: var(--primary); background: var(--surface-low); }
.slpo-tick:disabled { opacity: 0.6; cursor: progress; }
.slpo-archived { font-size: 11px; line-height: 14px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpo-end { padding: 1rem; text-align: center; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpo-side { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.slpo-inspector { display: flex; flex-direction: column; gap: 1rem; padding: 1.25rem; scroll-margin-top: 5rem; }
.slpo-kicker { display: inline-flex; align-items: center; gap: 0.5rem; font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpo-inspector h3 { margin: 0; font-size: 20px; line-height: 28px; font-weight: 700; overflow-wrap: anywhere; }
.slpo-body { margin: 0; font-size: 14px; line-height: 22px; color: var(--on-surface-variant); white-space: pre-wrap; overflow-wrap: anywhere; }
.slpo-box { display: flex; flex-direction: column; gap: 0.5rem; margin: 0; padding: 1rem; border-radius: 12px; background: var(--surface-low); }
.slpo-row { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.25rem 1rem; font-size: 13px; line-height: 18px; }
.slpo-row dt { margin: 0; color: var(--on-surface-variant); }
.slpo-row dd { margin: 0; font-weight: 600; text-align: right; overflow-wrap: anywhere; }
.slpo-cta { display: flex; flex-direction: column; gap: 0.5rem; }
.slpo-cta .slpc-btn { justify-content: center; height: 44px; }
.slpo-note { display: flex; flex-direction: column; gap: 0.5rem; padding: 1.25rem; }
.slpo-note h2 { margin: 0; display: inline-flex; align-items: center; gap: 0.5rem; font-size: 16px; line-height: 24px; font-weight: 700; color: var(--primary); }
.slpo-note p { margin: 0; font-size: 13px; line-height: 20px; color: var(--on-surface-variant); }
.slpo-warn { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.75rem 1rem; border-radius: 12px; background: var(--error-container); color: var(--on-error-container); font-size: 13px; line-height: 18px; }
@media (min-width: 640px) {
  .slpo-filter-row { flex-direction: row; align-items: center; }
  .slpo-filter-row .slpc-search { flex: 1 1 auto; }
  .slpo-filter-row .slpc-select { width: 190px; flex: 0 0 auto; }
}
@media (min-width: 768px) {
  .slpo-head { flex-direction: row; align-items: flex-end; justify-content: space-between; }
}
@media (min-width: 1024px) {
  .slpo-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .slpo-title { font-size: 32px; line-height: 40px; }
}
@media (min-width: 1180px) {
  .slpo-split { grid-template-columns: minmax(0, 2fr) minmax(300px, 1fr); }
  .slpo-sticky { position: sticky; top: 5rem; }
}
@media (max-width: 479px) {
  .slpo-item { padding: 1rem 1rem 1rem 1.25rem; }
  .slpo-item-title { font-size: 16px; line-height: 24px; }
  .slpo-stat-num { font-size: 32px; }
}
@media print {
  .slpo-actions, .slpo-filters, .slpo-side { display: none; }
  .slpo-split { grid-template-columns: minmax(0, 1fr); }
}
`

/* ---------- pieces ---------- */

function Card({ card, selected, busy, onSelect, onRead }) {
  const urgent = card.kind === 'deadline'
  const unread = card.kind === 'alert' && !card.item.is_read
  const read = card.kind === 'alert' && card.item.is_read
  const state = urgent ? 'is-urgent' : unread ? 'is-unread' : read ? 'is-read' : ''
  return (
    <li>
      <article className={`slpo-item ${state} ${selected ? 'is-selected' : ''}`} data-kind={card.kind}>
        {(unread || card.kind !== 'alert') && <div className={`slpo-bar ${urgent ? 'is-urgent' : ''}`} aria-hidden="true" />}
        <div className="slpo-meta">
          <div className="slpo-meta-left">
            {(unread || card.kind !== 'alert') && <span className={`slpo-dot ${urgent ? 'is-urgent' : ''}`} aria-hidden="true" />}
            <span className={`slpo-badge ${urgent ? 'is-urgent' : card.kind === 'review' ? 'is-primary' : unread ? 'is-primary' : ''}`}>{card.badge}</span>
            {card.code && <span className="slpo-code">{card.code}</span>}
          </div>
          <span className="slpo-time">
            {renderIcon(card.kind === 'alert' ? (unread ? 'schedule' : 'done') : card.kind === 'deadline' ? 'timer' : 'pending_actions', 16)}
            <span>{card.when}</span>
          </span>
        </div>
        <h3 className="slpo-item-title">
          <button type="button" onClick={onSelect} aria-pressed={selected}>
            {card.title}
          </button>
        </h3>
        {card.text && <p className="slpo-item-text">{card.text}</p>}
        <div className="slpo-item-foot">
          <div className="slpo-chips">
            {card.chips.map((chip) => (
              <span key={chip.text} className={`slpo-chip ${chip.urgent ? 'is-urgent' : ''}`}>
                {chip.icon && renderIcon(chip.icon, 14)}
                {chip.text}
              </span>
            ))}
            {card.link && (
              <Link to={card.link.to} className={`slpo-link ${card.link.solid ? 'is-solid' : ''}`}>
                <span>{card.link.label}</span>
                {renderIcon('arrow_forward', 16)}
              </Link>
            )}
          </div>
          {card.kind === 'alert' &&
            (unread ? (
              <button type="button" className="slpo-tick" onClick={onRead} disabled={busy} title="Mark as read" aria-label={`Mark as read: ${card.title}`}>
                {renderIcon('check', 20)}
              </button>
            ) : (
              <span className="slpo-archived">Read</span>
            ))}
        </div>
      </article>
    </li>
  )
}

function Inspector({ card, busy, onRead }) {
  if (!card) {
    return (
      <section className="slpc-card slpo-inspector slpo-sticky" aria-label="Alert inspector">
        <span className="slpo-kicker">Alert inspector</span>
        <p className="slpc-empty">Select an alert to see its details here.</p>
      </section>
    )
  }
  return (
    <section className="slpc-card slpo-inspector slpo-sticky" aria-label="Alert inspector">
      <span className="slpo-kicker">
        {renderIcon('data_object', 16)}
        Alert inspector
      </span>
      <div>
        <h3>{card.title}</h3>
        {card.text && <p className="slpo-body">{card.text}</p>}
      </div>
      <dl className="slpo-box">
        {card.details.map(([label, value]) => (
          <div key={label} className="slpo-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="slpo-cta">
        {card.link && (
          <Link to={card.link.to} className="slpc-btn slpc-btn-primary">
            {renderIcon('arrow_forward', 18)}
            {card.link.label}
          </Link>
        )}
        {card.kind === 'alert' && !card.item.is_read && (
          <button type="button" className="slpc-btn slpc-btn-soft" onClick={onRead} disabled={busy}>
            {renderIcon('check', 18)}
            Mark as read
          </button>
        )}
      </div>
    </section>
  )
}

/* ---------- page ---------- */

export default function LecturerNotifications() {
  useCourseFonts()
  const now = useClock()
  const queryClient = useQueryClient()
  const inspectorRef = useRef(null)

  const [filter, setFilter] = useState('all')
  const [course, setCourse] = useState('all')
  const [sort, setSort] = useState('newest')
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState('')

  const feed = useQuery({ queryKey: READ_KEY, queryFn: () => api('/notifications'), retry: false, refetchOnWindowFocus: false, staleTime: 60_000 })
  const coursesQuery = useQuery({ queryKey: COURSES_KEY, queryFn: fetchCourses })
  const courses = toList(coursesQuery.data)
  const watch = useQuery({
    queryKey: [WATCH_KEY, courses.map((entry) => entry.id).join(',')],
    queryFn: () => loadWatch(courses),
    enabled: coursesQuery.isSuccess && courses.length > 0,
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
  const feedFailed = feed.isError && !notReady
  const alerts = ready ? toList(feed.data) : []
  const unreadCount = alerts.filter((item) => !item.is_read).length

  const rows = watch.data?.rows ?? []
  const failedCourses = watch.data?.failed ?? []
  const watchReady = watch.isSuccess || (coursesQuery.isSuccess && courses.length === 0)
  const watchFailed = watch.isError
  const countsKnown = watchReady && failedCourses.length === 0

  // Signals computed from real assignments.
  const closing = rows.filter((row) => row.state === 'open' && stamp(row.due_at) > now && stamp(row.due_at) - now <= DAY)
  const awaiting = rows.map((row) => ({ row, waiting: (Number(row.counts?.submitted) || 0) + (Number(row.counts?.late) || 0) })).filter((entry) => entry.waiting > 0)
  const pendingTotal = awaiting.reduce((sum, entry) => sum + entry.waiting, 0)
  const pendingCodes = [...new Set(awaiting.map((entry) => entry.row.code))]

  const cards = []
  closing.forEach((row) => {
    const counts = sumCounts([row.counts])
    const received = counts.submitted + counts.late
    cards.push({
      key: `d:${row.id}`,
      kind: 'deadline',
      badge: 'Closing soon',
      code: row.code,
      course: row.courseId,
      when: `Closes in ${countdown(stamp(row.due_at) - now)}`,
      title: `${row.title} closes ${new Date(row.due_at).toDateString() === new Date(now).toDateString() ? 'today' : 'tomorrow'}`,
      text: `${row.courseName}. The deadline is ${when(row.due_at)}.`,
      chips: [{ icon: 'timer', text: `T-minus ${countdown(stamp(row.due_at) - now)}`, urgent: true }, ...(row.counts ? [{ text: `${plural(received, 'submission')} received` }] : [])],
      link: { to: `/lecturer/assignments/${row.id}/submissions`, label: 'View submissions', solid: false },
      details: [
        ['Course', `${row.code} • ${row.courseName}`],
        ['Assignment', row.title],
        ['Deadline', when(row.due_at)],
        ['Closes in', countdown(stamp(row.due_at) - now)],
        ...(row.counts ? [['Submissions received', String(received)], ['Graded', String(counts.graded + counts.returned)]] : []),
      ],
      search: `${row.title} ${row.code} ${row.courseName}`,
    })
  })
  awaiting.forEach(({ row, waiting }) => {
    const counts = sumCounts([row.counts])
    cards.push({
      key: `r:${row.id}`,
      kind: 'review',
      badge: 'Awaiting grading',
      code: row.code,
      course: row.courseId,
      when: 'Live count',
      title: `${row.title}: ${plural(waiting, 'submission')} to grade`,
      text: `${row.courseName}. ${counts.late > 0 ? `${counts.submitted} on time and ${counts.late} late.` : 'All received on time.'}`,
      chips: [{ icon: 'rate_review', text: `${waiting} pending` }, ...(counts.graded + counts.returned > 0 ? [{ text: `${counts.graded + counts.returned} graded` }] : [])],
      link: { to: `/lecturer/assignments/${row.id}/submissions`, label: 'Grade submissions', solid: true },
      details: [
        ['Course', `${row.code} • ${row.courseName}`],
        ['Assignment', row.title],
        ['Awaiting grading', String(waiting)],
        ['On time', String(counts.submitted)],
        ['Late', String(counts.late)],
        ['Graded', String(counts.graded + counts.returned)],
        ['Deadline', when(row.due_at)],
      ],
      search: `${row.title} ${row.code} ${row.courseName}`,
    })
  })

  const alertCards = alerts.map((item) => {
    const meta = typeOf(item)
    const link = isPortalLink(item.link) ? item.link.trim() : null
    return {
      key: `n:${item.id}`,
      kind: 'alert',
      item,
      badge: meta.label,
      code: '',
      course: '',
      when: item.is_read && item.read_at ? `Read ${when(item.read_at)}` : timeAgo(item.created_at, now),
      title: String(item.title ?? ''),
      text: String(item.message ?? ''),
      chips: [],
      link: link ? { to: link, label: 'Open', solid: false } : null,
      details: [
        ['Type', meta.label],
        ['Status', item.is_read ? 'Read' : 'Unread'],
        ['Received', when(item.created_at)],
        ...(item.read_at ? [['Read', when(item.read_at)]] : []),
      ],
      search: `${item.title ?? ''} ${item.message ?? ''} ${meta.label}`,
    }
  })

  const counts = {
    all: cards.length + alertCards.length,
    unread: unreadCount,
    review: awaiting.length,
    deadline: closing.length,
    alert: alertCards.length,
  }

  const needle = search.trim().toLowerCase()
  const matches = (card) => !needle || card.search.toLowerCase().includes(needle)
  const inCourse = (card) => course === 'all' || card.course === course
  const signals = cards.filter((card) => (filter === 'all' || filter === card.kind) && inCourse(card) && matches(card))
  const notices = alertCards
    .filter((card) => (filter === 'all' || filter === 'alert' || (filter === 'unread' && !card.item.is_read)) && course === 'all' && matches(card))
    .sort((a, b) => {
      if (sort === 'oldest') return stamp(a.item.created_at) - stamp(b.item.created_at)
      if (sort === 'unread') return Number(Boolean(a.item.is_read)) - Number(Boolean(b.item.is_read)) || stamp(b.item.created_at) - stamp(a.item.created_at)
      return stamp(b.item.created_at) - stamp(a.item.created_at)
    })
  const shown = filter === 'unread' ? notices : [...signals, ...notices]
  const selected = shown.find((card) => card.key === selectedKey) ?? shown[0]

  const choose = (key) => {
    setSelectedKey(key)
    if (typeof window !== 'undefined' && window.innerWidth < 1180) inspectorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }
  const refresh = () => {
    markOne.reset()
    markAll.reset()
    feed.refetch()
    if (watch.isError || watch.isSuccess) watch.refetch()
  }
  const exportCsv = () => {
    const lines = [['Kind', 'Course', 'Title', 'Detail', 'When'].map(csvCell).join(',')]
    shown.forEach((card) => lines.push([card.kind === 'alert' ? 'Alert' : card.badge, card.code, card.title, card.text, card.kind === 'alert' ? when(card.item.created_at) : card.when].map(csvCell).join(',')))
    downloadText('alerts.csv', lines.join('\r\n'), 'text/csv;charset=utf-8')
  }

  const error = markOne.error || markAll.error
  const loading = feed.isPending || coursesQuery.isPending || (watch.isPending && watch.fetchStatus !== 'idle')
  const nothing = !loading && !feedFailed && shown.length === 0
  const nextClosing = closing[0]

  return (
    <div className="slpc" aria-label="Notifications and dispatch alerts">
      <style>{COURSE_STYLES}</style>
      <style>{ALERT_STYLES}</style>

      <div className="slpc-stack slpc-gap-lg">
        <div className="slpc-stack" style={{ gap: '0.25rem' }}>
          <nav className="slpc-trail" aria-label="Breadcrumb" style={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 11, fontWeight: 600 }}>
            <Link to="/lecturer" className="slpc-trail-link">
              Lecturer Dashboard
            </Link>
            <span className="slpc-trail-sep">/</span>
            <span className="slpc-trail-item">Communications</span>
            <span className="slpc-trail-sep">/</span>
            <span className="slpc-trail-current">Notifications &amp; Alerts</span>
          </nav>
          <div className="slpo-head" style={{ paddingTop: '0.25rem' }}>
            <div className="slpc-stack" style={{ gap: '0.25rem', maxWidth: 720 }}>
              <h1 className="slpo-title">Notifications &amp; Dispatch Alerts</h1>
              <p className="slpc-lead">Institutional alerts, coursework to grade and deadline countdowns for the courses you teach.</p>
            </div>
            <div className="slpo-actions">
              <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => markAll.mutate()} disabled={!ready || unreadCount === 0 || markAll.isPending}>
                {renderIcon(ready && unreadCount === 0 ? 'done' : 'done_all', 18)}
                {markAll.isPending ? 'Marking…' : 'Mark All as Read'}
              </button>
              <Link to="/lecturer/settings" className="slpc-btn slpc-btn-soft">
                {renderIcon('tune', 18)}
                Preferences
              </Link>
              <button type="button" className="slpc-btn slpc-btn-primary" onClick={exportCsv} disabled={shown.length === 0}>
                {renderIcon('download', 18)}
                Export Alerts (CSV)
              </button>
              <button type="button" className={`slpo-icon-btn ${feed.isFetching || watch.isFetching ? 'slpo-spin' : ''}`} onClick={refresh} title="Refresh alerts" aria-label="Refresh alerts" disabled={feed.isFetching}>
                {renderIcon('refresh', 18)}
              </button>
            </div>
          </div>
        </div>

        <div className="slpc-stats slpo-stats" aria-label="Alert summary">
          <div className="slpc-card slpo-stat">
            <div className="slpo-stat-top">
              <span className="slpo-stat-label">
                Unread dispatches
                {ready && unreadCount > 0 && <span className="slpo-live">NEW</span>}
              </span>
              <span className="slpo-stat-icon">{renderIcon('mark_email_unread', 18)}</span>
            </div>
            <div>
              <div className="slpo-stat-line">
                <span className="slpo-stat-num">{ready ? unreadCount : '—'}</span>
                <span className="slpo-stat-word">Unread</span>
              </div>
              <p className="slpo-stat-sub">{ready ? (coursesQuery.isSuccess ? `Active across ${plural(courses.length, 'assigned course')}` : 'Alerts you have not opened') : 'Waiting for notifications'}</p>
            </div>
          </div>

          <div className="slpc-card slpo-stat">
            <div className="slpo-stat-top">
              <span className="slpo-stat-label">Review pipeline</span>
              <span className="slpo-stat-icon">{renderIcon('pending_actions', 18)}</span>
            </div>
            <div>
              <div className="slpo-stat-line">
                <span className="slpo-stat-num">{countsKnown ? pendingTotal : '—'}</span>
                <span className="slpo-stat-word">Pending</span>
              </div>
              <p className="slpo-stat-sub">{countsKnown ? (pendingTotal > 0 ? `Awaiting grading in ${pendingCodes.join(', ')}` : 'Nothing is waiting to be graded') : watchFailed || failedCourses.length > 0 ? 'Some courses could not be counted' : 'Counting submissions'}</p>
            </div>
          </div>

          <div className="slpc-card slpo-stat">
            <div className="slpo-stat-top">
              <span className="slpo-stat-label">
                Urgent countdown
                <span className="slpo-live is-danger">&lt; 24h</span>
              </span>
              <span className="slpo-stat-icon">{renderIcon('timer', 18)}</span>
            </div>
            <div>
              <div className="slpo-stat-line">
                <span className={`slpo-stat-num ${closing.length > 0 ? 'is-danger' : ''}`}>{watchReady ? closing.length : '—'}</span>
                <span className={`slpo-stat-word ${closing.length > 0 ? 'is-danger' : ''}`}>{closing.length === 1 ? 'Cutoff' : 'Cutoffs'}</span>
              </div>
              <p className="slpo-stat-sub">{watchReady ? (nextClosing ? `${nextClosing.code} ${nextClosing.title} closes in ${countdown(stamp(nextClosing.due_at) - now)}` : 'No deadlines in the next 24 hours') : watchFailed ? 'Deadlines could not be loaded' : 'Checking deadlines'}</p>
            </div>
          </div>
        </div>

        <div className="slpo-split">
          <div className="slpo-main">
            <section className="slpc-card slpo-filters" aria-label="Filter alerts">
              <div className="slpo-filter-row">
                <label className="slpc-search">
                  {renderIcon('search', 18)}
                  <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search alerts by keyword, assignment title or course" aria-label="Search alerts" />
                </label>
                <select className="slpc-select" value={course} onChange={(event) => setCourse(event.target.value)} aria-label="Filter by course">
                  <option value="all">All Assigned Courses ({courses.length})</option>
                  {courses.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.course_code}
                    </option>
                  ))}
                </select>
                <select className="slpc-select" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort alerts">
                  {SORTS.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="slpo-pills" role="group" aria-label="Alert type">
                {PILLS.map((entry) => (
                  <button key={entry.id} type="button" className={`slpo-pill ${filter === entry.id ? 'is-active' : ''}`} onClick={() => setFilter(entry.id)} aria-pressed={filter === entry.id}>
                    {entry.label} ({counts[entry.id]})
                  </button>
                ))}
              </div>
            </section>

            {error && (
              <div className="slpo-warn" role="alert">
                <span>{errorText(error, 'That change could not be saved. Please try again.')}</span>
                <button type="button" className="slpc-btn slpc-btn-soft" onClick={refresh}>
                  Refresh
                </button>
              </div>
            )}
            {(failedCourses.length > 0 || watchFailed) && (
              <div className="slpo-warn" role="status">
                <span>{watchFailed ? 'Assignment data could not be loaded, so deadline and grading signals are missing.' : `Some assignment data for ${failedCourses.join(', ')} could not be loaded, so its signals may be incomplete.`}</span>
                <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => watch.refetch()}>
                  Try again
                </button>
              </div>
            )}

            {loading && <Skeleton height={260} label="Loading alerts" />}
            {feedFailed && <ErrorCard message={errorText(feed.error, 'Your notifications could not be loaded.')} onRetry={() => feed.refetch()} />}
            {notReady && filter !== 'review' && filter !== 'deadline' && (
              <PhasePanel icon="notifications" title="Notifications are not switched on yet" phase="Phase 7">
                The notification service is not available on the server yet. Deadline and grading signals below already work; alerts will appear here once it is enabled.
              </PhasePanel>
            )}
            {nothing && !notReady && <p className="slpc-card slpc-empty">{counts.all === 0 ? 'No alerts yet. Notifications, deadlines and coursework waiting for grading will appear here.' : 'No alerts match these filters.'}</p>}
            {nothing && notReady && counts.all > 0 && <p className="slpc-card slpc-empty">No alerts match these filters.</p>}

            {shown.length > 0 && (
              <ul className="slpo-feed" aria-label="Alerts">
                {shown.map((card) => (
                  <Card key={card.key} card={card} selected={selected?.key === card.key} busy={markOne.isPending && markOne.variables === card.item?.id} onSelect={() => choose(card.key)} onRead={() => markOne.mutate(card.item.id)} />
                ))}
              </ul>
            )}
            {shown.length > 0 && <div className="slpc-card slpo-end">Showing {plural(shown.length, 'alert')}{filter === 'unread' ? '' : ' including live signals'}.</div>}
          </div>

          <aside className="slpo-side" ref={inspectorRef} aria-label="Alert details">
            <Inspector card={selected} busy={selected?.kind === 'alert' && markOne.isPending && markOne.variables === selected.item.id} onRead={() => selected?.kind === 'alert' && markOne.mutate(selected.item.id)} />
            <section className="slpc-card slpo-note" aria-label="About live signals">
              <h2>
                {renderIcon('security', 20)}
                Scoped to your courses
              </h2>
              <p>Alerts are private to you. Deadline and grading signals are counted live from the assignments in courses you teach, and they clear by themselves when the work is graded or the deadline passes.</p>
            </section>
          </aside>
        </div>
      </div>
    </div>
  )
}
