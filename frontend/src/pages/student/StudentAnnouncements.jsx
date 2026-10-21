import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueries, useQuery } from '@tanstack/react-query'
import { api } from '../../services/apiClient.js'
import { COURSES_KEY, COURSE_STYLES, ErrorCard, PhasePanel, Skeleton, fetchCourses, initials, renderIcon, useClock, useCourseFonts } from '../../components/courseKit.jsx'
import { formatSemester, timeAgo, toList } from '../../utils/format.js'

/*
 * Smart Lecture Portal: student Course Announcements
 * Place at: src/pages/student/StudentAnnouncements.jsx
 *
 * Route (see routes.jsx):
 *   /student/announcements   published announcements from every course you are enrolled in
 *
 * - Renders inside AppShell, which already draws the sidebar and top bar.
 * - Built on the contract in docs/API.md (Announcements). Endpoints used:
 *     GET /courses                          the courses you are enrolled in
 *     GET /courses/{id}                     lecturer name, credit hours and semester
 *     GET /courses/{id}/announcements       published announcements only (students never see drafts)
 * - An announcement is { id, course_id, title, body, published, published_at, created_by, created_at }
 *   (author_name is used when the server sends it).
 * - Announcements arrive in Phase 7. Until the server answers GET /courses/{id}/announcements the page
 *   says so plainly and shows no figures. It never invents notices, urgency levels, categories, action
 *   lists, student counts or security tokens: the API has none of them, so every figure below is counted
 *   from the announcements received. "New" means published within the last 48 hours.
 * - Print / PDF uses the browser print dialog.
 */

const PAGE_SIZE = 5
const NEW_HOURS = 48
const NOT_READY = [404, 405, 501]
const DATE_RANGES = [
  { id: 'all', label: 'All dates' },
  { id: '7d', label: 'Last 7 days' },
  { id: '24h', label: 'Past 24 hours' },
]
const SORTS = [
  { id: 'newest', label: 'Sort: Published (Newest first)' },
  { id: 'oldest', label: 'Sort: Published (Oldest first)' },
  { id: 'course', label: 'Sort: Course code (A - Z)' },
]

const isNotReady = (error) => NOT_READY.includes(error?.status)
const errorText = (error, fallback) => error?.message || fallback
const stampOf = (item) => item.published_at || item.created_at || ''
const timeOf = (item) => {
  const time = new Date(stampOf(item)).getTime()
  return Number.isNaN(time) ? 0 : time
}
const pad = (value) => String(value).padStart(2, '0')
// "Feb 19, 2026, 14:20" in the viewer's own time zone.
function stampText(value) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return ''
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

const ANNOUNCEMENT_STYLES = `
.slpv-head { display: flex; flex-direction: column; gap: 1rem; }
.slpv-eyebrow { display: inline-flex; align-items: center; gap: 0.5rem; font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--primary); }
.slpv-pulse { width: 10px; height: 10px; border-radius: 999px; background: var(--primary-container); animation: slpv-pulse 2s ease-in-out infinite; }
@keyframes slpv-pulse { 50% { opacity: 0.4; } }
@media (prefers-reduced-motion: reduce) { .slpv-pulse { animation: none; } }
.slpv-title { margin: 0; font-size: 26px; line-height: 34px; font-weight: 700; letter-spacing: -0.02em; overflow-wrap: anywhere; }
.slpv-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.slpv-actions .slpc-btn, .slpv-scope { height: 40px; padding: 0 16px; }
.slpv-scope { display: inline-flex; align-items: center; gap: 0.5rem; border-radius: 999px; background: var(--surface-lowest); color: var(--on-surface); font-size: 13px; line-height: 18px; font-weight: 600; box-shadow: 0 1px 3px rgba(30, 26, 35, 0.12); }
.slpv-scope .material-symbols-outlined { color: var(--primary); font-variation-settings: 'FILL' 1; }
.slpv-stat { display: flex; flex-direction: column; justify-content: space-between; gap: 0.75rem; padding: 1rem; }
.slpv-stat-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; }
.slpv-stat-label { display: block; font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpv-stat-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.5rem; margin-top: 0.25rem; }
.slpv-stat-num { font-size: 24px; line-height: 32px; font-weight: 700; letter-spacing: -0.015em; }
.slpv-stat-unit { font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpv-stat-icon { flex: 0 0 auto; width: 40px; height: 40px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; background: var(--surface-mid); color: var(--primary); }
.slpv-stat-icon.is-rose { background: var(--primary-fixed); color: var(--on-primary-fixed); }
.slpv-stat-icon.is-warm { background: var(--tertiary-fixed, #ffdbd2); color: var(--on-tertiary-fixed, #3c0800); }
.slpv-stat-foot { display: flex; align-items: center; gap: 0.5rem; font-size: 11px; line-height: 14px; font-weight: 600; color: var(--on-surface-variant); overflow-wrap: anywhere; }
.slpv-stat-foot .slpv-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--primary); flex: 0 0 auto; }
.slpv-mono { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 16px; font-weight: 600; color: var(--primary); }
.slpv-filters { display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem; }
.slpv-filter-row { display: flex; flex-direction: column; gap: 0.5rem; }
.slpv-filters .slpc-search { height: 44px; border-radius: 12px; }
.slpv-selects { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.slpv-select { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0 12px; height: 44px; border-radius: 12px; background: var(--surface-low); color: var(--on-surface); flex: 1 1 200px; min-width: 0; }
.slpv-select .material-symbols-outlined { flex: 0 0 auto; color: var(--on-surface-variant); }
.slpv-select select { flex: 1 1 auto; min-width: 0; height: 100%; border: 0; outline: 0; background: transparent; color: var(--on-surface); font-family: inherit; font-size: 13px; font-weight: 500; cursor: pointer; }
.slpv-chips { display: flex; align-items: center; gap: 0.25rem; overflow-x: auto; padding: 4px 0; scrollbar-width: none; }
.slpv-chips::-webkit-scrollbar { display: none; }
.slpv-chips-label { flex: 0 0 auto; margin-right: 0.5rem; font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpv-chip { flex: 0 0 auto; padding: 6px 12px; border: 0; border-radius: 999px; background: var(--surface-low); color: var(--on-surface-variant); font-size: 12px; line-height: 16px; font-weight: 500; white-space: nowrap; cursor: pointer; font-family: inherit; transition: background 0.2s; }
.slpv-chip:hover { background: var(--surface-mid); }
.slpv-chip.is-active { background: var(--primary-container); color: var(--on-primary-container); font-weight: 600; box-shadow: 0 1px 2px rgba(30, 26, 35, 0.2); }
.slpv-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.slpv-main { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.slpv-meta-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.25rem 1rem; padding: 0 0.25rem; font-size: 11px; line-height: 14px; font-weight: 600; color: var(--on-surface-variant); text-transform: uppercase; letter-spacing: 0.02em; }
.slpv-meta-row span:last-child { display: inline-flex; align-items: center; gap: 0.375rem; text-transform: none; letter-spacing: 0; }
.slpv-meta-row .slpv-dot { width: 8px; height: 8px; border-radius: 999px; background: var(--primary); }
.slpv-feed { display: flex; flex-direction: column; gap: 1rem; margin: 0; padding: 0; list-style: none; }
.slpv-card { position: relative; overflow: hidden; width: 100%; display: flex; flex-direction: column; gap: 0.5rem; padding: 1.25rem 1.25rem 1.25rem 1.5rem; border: 0; border-radius: 12px; background: var(--surface-lowest); color: var(--on-surface); text-align: left; cursor: pointer; font-family: inherit; box-shadow: 0 1px 3px rgba(30, 26, 35, 0.08); transition: box-shadow 0.2s, background 0.2s; }
.slpv-card:hover { box-shadow: 0 4px 12px rgba(30, 26, 35, 0.12); }
.slpv-card.is-selected { background: var(--surface-low); box-shadow: 0 4px 12px rgba(30, 26, 35, 0.12); }
.slpv-card.is-selected::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: var(--primary-container); }
.slpv-card-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.25rem 0.75rem; }
.slpv-card-course { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.5rem; min-width: 0; font-size: 13px; line-height: 18px; font-weight: 600; }
.slpv-code { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 13px; line-height: 20px; font-weight: 700; color: var(--primary); }
.slpv-sep { color: var(--outline-variant); }
.slpv-pill { padding: 2px 10px; border-radius: 999px; background: var(--primary-fixed); color: var(--on-primary-fixed-variant, #872013); font-size: 11px; line-height: 16px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; }
.slpv-pill.is-quiet { background: var(--surface-high); color: var(--on-surface-variant); }
.slpv-card h2 { margin: 0; font-size: 20px; line-height: 28px; font-weight: 700; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.slpv-card:hover h2 { color: var(--primary); }
.slpv-snippet { margin: 0; font-size: 14px; line-height: 22px; color: var(--on-surface-variant); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
.slpv-card-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 1rem; padding-top: 0.25rem; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpv-author { display: inline-flex; align-items: center; gap: 0.5rem; min-width: 0; }
.slpv-avatar { width: 24px; height: 24px; border-radius: 999px; background: var(--surface-mid); color: var(--on-surface); display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; font-size: 10px; line-height: 12px; font-weight: 700; }
.slpv-card.is-selected .slpv-avatar { background: var(--primary-container); color: var(--on-primary-container); }
.slpv-stamp { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.75rem; font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 12px; line-height: 16px; }
.slpv-stamp b { font-weight: 500; color: var(--primary); }
.slpv-pager { display: flex; flex-direction: column; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 1rem; }
.slpv-pager-text { font-size: 13px; line-height: 18px; color: var(--on-surface-variant); text-align: center; }
.slpv-pager-text strong { color: var(--on-surface); font-weight: 600; }
.slpv-pager-btns { display: flex; align-items: center; gap: 0.25rem; }
.slpv-page-btn { min-width: 32px; height: 32px; padding: 0 12px; border: 0; border-radius: 8px; background: var(--surface-mid); color: var(--on-surface); display: inline-flex; align-items: center; justify-content: center; gap: 0.25rem; font-size: 12px; line-height: 16px; font-weight: 500; cursor: pointer; font-family: inherit; }
.slpv-page-btn:hover:not(:disabled) { background: var(--surface-high); }
.slpv-page-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.slpv-page-btn.is-num { padding: 0; background: var(--surface-low); }
.slpv-page-btn.is-current { background: var(--primary-container); color: var(--on-primary-container); font-weight: 700; box-shadow: 0 1px 2px rgba(30, 26, 35, 0.2); }
.slpv-side { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.slpv-inspector { display: flex; flex-direction: column; gap: 1rem; padding: 1.25rem; scroll-margin-top: 5rem; }
.slpv-inspector-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; }
.slpv-verified { display: inline-flex; align-items: center; gap: 0.375rem; font-size: 11px; line-height: 14px; font-weight: 600; color: var(--on-surface-variant); }
.slpv-verified .material-symbols-outlined { color: var(--primary); }
.slpv-inspector-course { display: block; font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 12px; line-height: 16px; font-weight: 700; color: var(--primary); overflow-wrap: anywhere; }
.slpv-inspector h3 { margin: 0.25rem 0 0; font-size: 18px; line-height: 26px; font-weight: 700; overflow-wrap: anywhere; }
.slpv-byline { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.5rem; font-size: 12px; line-height: 16px; color: var(--on-surface-variant); }
.slpv-body { margin: 0; font-size: 14px; line-height: 23px; font-weight: 500; white-space: pre-wrap; overflow-wrap: anywhere; }
.slpv-linked { display: flex; flex-direction: column; gap: 0.5rem; padding: 1rem; border-radius: 12px; background: var(--surface-mid); }
.slpv-linked-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.25rem 0.5rem; }
.slpv-linked p { margin: 0; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpv-link { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 8px; border-radius: 8px; background: var(--surface-lowest); color: var(--on-surface); font-size: 13px; line-height: 18px; font-weight: 600; transition: color 0.2s; }
.slpv-link:hover { color: var(--primary); }
.slpv-link > span { display: inline-flex; align-items: center; gap: 0.5rem; min-width: 0; }
.slpv-link .material-symbols-outlined:first-child { color: var(--primary); }
.slpv-link > .material-symbols-outlined { color: var(--on-surface-variant); }
.slpv-lock { display: flex; flex-direction: column; gap: 0.25rem; padding: 0.75rem; border-radius: 8px; background: var(--surface-low); font-size: 11px; line-height: 16px; color: var(--on-surface-variant); }
.slpv-lock strong { display: inline-flex; align-items: center; gap: 0.375rem; font-size: 11px; font-weight: 700; color: var(--on-surface); }
.slpv-lock .material-symbols-outlined { color: var(--primary); }
.slpv-lock p { margin: 0; }
.slpv-help { display: flex; align-items: center; gap: 1rem; padding: 1rem; }
.slpv-help-icon { width: 40px; height: 40px; border-radius: 999px; background: var(--primary-container); color: var(--on-primary-container); display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.slpv-help-text { flex: 1 1 auto; min-width: 0; }
.slpv-help-text strong { display: block; font-size: 14px; line-height: 22px; font-weight: 700; }
.slpv-help-text p { margin: 0; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpv-help a { flex: 0 0 auto; font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--primary); }
.slpv-help a:hover { text-decoration: underline; }
.slpv-warn { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.75rem 1rem; border-radius: 12px; background: var(--error-container); color: var(--on-error-container); font-size: 13px; line-height: 18px; }
@media (min-width: 640px) {
  .slpv-filter-row { flex-direction: row; align-items: center; justify-content: space-between; }
  .slpv-filter-row .slpc-search { flex: 1 1 auto; max-width: 640px; }
  .slpv-selects { flex-wrap: nowrap; }
  .slpv-select { flex: 0 0 auto; }
  .slpv-pager { flex-direction: row; }
}
@media (min-width: 768px) {
  .slpv-head { flex-direction: row; align-items: flex-end; justify-content: space-between; }
}
@media (min-width: 1024px) {
  .slpv-title { font-size: 32px; line-height: 40px; }
  .slpv-filter-row { flex-wrap: wrap; }
}
@media (min-width: 1180px) {
  .slpv-split { grid-template-columns: minmax(0, 2fr) minmax(300px, 1fr); }
  .slpv-inspector-sticky { position: sticky; top: 5rem; }
}
@media (max-width: 479px) {
  .slpv-card { padding: 1rem 1rem 1rem 1.25rem; }
  .slpv-card h2 { font-size: 18px; line-height: 26px; }
}
@media print {
  .slpv-actions, .slpv-filters, .slpv-side, .slpv-pager, .slpv-trail { display: none; }
  .slpv-split { grid-template-columns: minmax(0, 1fr); }
  .slpv-snippet { display: block; -webkit-line-clamp: unset; }
}
`

/* ---------- pieces ---------- */

function Inspector({ item, lecturer, now }) {
  if (!item) {
    return (
      <section className="slpc-card slpv-inspector slpv-inspector-sticky" aria-label="Announcement details">
        <span className="slpc-eyebrow">Announcement details</span>
        <p className="slpc-empty">Select an announcement to read it in full here.</p>
      </section>
    )
  }
  const fresh = now - item.time <= NEW_HOURS * 3600000
  return (
    <section className="slpc-card slpv-inspector slpv-inspector-sticky" aria-label="Announcement details">
      <div className="slpv-inspector-top">
        <span className={`slpv-pill ${fresh ? '' : 'is-quiet'}`}>{fresh ? 'New notice' : 'Published notice'}</span>
        <span className="slpv-verified">
          {renderIcon('verified', 16)}
          Published
        </span>
      </div>
      <div>
        <span className="slpv-inspector-course">
          {item.code} • {item.courseName}
        </span>
        <h3>{item.title}</h3>
      </div>
      <div className="slpv-byline">
        {item.author && (
          <span className="slpv-author">
            <span className="slpv-avatar" aria-hidden="true">
              {initials(item.author)}
            </span>
            {item.author}
          </span>
        )}
        {item.stamp && <span>{item.author ? '• ' : ''}Published {item.stamp}</span>}
      </div>
      <p className="slpv-body">{item.body}</p>
      <div className="slpv-linked">
        <div className="slpv-linked-top">
          <span className="slpc-eyebrow" style={{ color: 'var(--on-surface)' }}>
            Linked course module
          </span>
          <span className="slpv-mono">
            {item.code}
            {item.credits ? ` (${item.credits} Credit Hours)` : ''}
          </span>
        </div>
        {(item.term || lecturer) && <p>{[item.term, lecturer].filter(Boolean).join(' • ')}</p>}
        <div className="slpc-stack" style={{ gap: '0.5rem' }}>
          <Link to={`/student/courses/${item.courseId}/materials`} className="slpv-link">
            <span>
              {renderIcon('folder_open', 18)}
              Open {item.code} course materials
            </span>
            {renderIcon('arrow_forward', 16)}
          </Link>
          <Link to="/student/timetable" className="slpv-link">
            <span>
              {renderIcon('schedule', 18)}
              View my timetable
            </span>
            {renderIcon('arrow_forward', 16)}
          </Link>
        </div>
      </div>
      <div className="slpv-lock">
        <strong>
          {renderIcon('lock', 16)}
          Read-only
        </strong>
        <p>You can read this because you are enrolled in {item.code}. Announcements can only be written by your lecturers.</p>
      </div>
    </section>
  )
}

/* ---------- page ---------- */

export default function StudentAnnouncements() {
  useCourseFonts()
  const now = useClock()

  const [course, setCourse] = useState('all')
  const [range, setRange] = useState('all')
  const [sort, setSort] = useState('newest')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState('')
  const inspectorRef = useRef(null)

  const coursesQuery = useQuery({ queryKey: COURSES_KEY, queryFn: fetchCourses })
  const courses = toList(coursesQuery.data)

  const lists = useQueries({
    queries: courses.map((item) => ({
      queryKey: ['course-announcements', item.id],
      queryFn: () => api(`/courses/${item.id}/announcements?page_size=100`),
      retry: false,
    })),
  })
  const details = useQueries({
    queries: courses.map((item) => ({
      queryKey: ['course', item.id],
      queryFn: () => api(`/courses/${item.id}`),
    })),
  })

  const waiting = coursesQuery.isPending || (courses.length > 0 && lists.some((query) => query.isPending))
  const settled = coursesQuery.isSuccess && !waiting
  const notReady = settled && courses.length > 0 && lists.every((query) => query.isError && isNotReady(query.error))
  const failed = settled ? courses.filter((_, index) => lists[index]?.isError && !isNotReady(lists[index].error)) : []
  const ready = settled && !notReady

  const all = ready
    ? courses
        .flatMap((entry, index) => {
          const lecturer = details[index]?.data?.lecturers?.[0]
          const lecturerName = [lecturer?.title, lecturer?.full_name].filter(Boolean).join(' ')
          return toList(lists[index]?.data)
            .filter((item) => item.published !== false)
            .map((item) => ({
              id: String(item.id),
              courseId: entry.id,
              code: entry.course_code,
              courseName: entry.course_name,
              credits: Number(entry.credit_hours) || 0,
              term: [formatSemester(details[index]?.data?.semester ?? entry.semester), details[index]?.data?.academic_year ?? entry.academic_year].filter(Boolean).join(' • '),
              title: String(item.title ?? ''),
              body: String(item.body ?? ''),
              author: String(item.author_name || lecturerName || ''),
              raw: stampOf(item),
              time: timeOf(item),
              stamp: stampText(stampOf(item)),
            }))
        })
        .sort((a, b) => b.time - a.time)
    : []

  const countOf = (id) => all.filter((item) => item.courseId === id).length
  const within = (hours) => all.filter((item) => item.time > 0 && now - item.time <= hours * 3600000)
  const recent = within(48)
  const lastWeek = within(24 * 7)
  const newest = all[0]
  const activeCourses = courses.filter((entry) => countOf(entry.id) > 0)

  const needle = search.trim().toLowerCase()
  const filtered = all
    .filter((item) => course === 'all' || item.courseId === course)
    .filter((item) => range === 'all' || (item.time > 0 && now - item.time <= (range === '24h' ? 24 : 24 * 7) * 3600000))
    .filter((item) => !needle || `${item.title} ${item.body} ${item.code} ${item.courseName} ${item.author}`.toLowerCase().includes(needle))
    .sort((a, b) => {
      if (sort === 'oldest') return a.time - b.time
      if (sort === 'course') return a.code.localeCompare(b.code) || b.time - a.time
      return b.time - a.time
    })

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const shown = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const selected = filtered.find((item) => item.id === selectedId) ?? shown[0]
  const selectedLecturer = (() => {
    const index = selected ? courses.findIndex((entry) => entry.id === selected.courseId) : -1
    const lecturer = details[index]?.data?.lecturers?.[0]
    return lecturer?.department ?? ''
  })()

  const change = (setter) => (value) => {
    setter(value)
    setPage(1)
  }
  const choose = (id) => {
    setSelectedId(id)
    if (typeof window !== 'undefined' && window.innerWidth < 1180) inspectorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }
  const retryFailed = () => lists.forEach((query) => query.isError && !isNotReady(query.error) && query.refetch())

  return (
    <div className="slpc" aria-label="Course announcements">
      <style>{COURSE_STYLES}</style>
      <style>{ANNOUNCEMENT_STYLES}</style>

      <div className="slpc-stack slpc-gap-lg">
        <section className="slpc-stack" style={{ gap: '0.5rem' }}>
          <nav className="slpc-trail slpv-trail" aria-label="Breadcrumb" style={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 11, fontWeight: 600 }}>
            <Link to="/student" className="slpc-trail-link">
              Student Dashboard
            </Link>
            <span className="slpc-trail-sep">/</span>
            <span className="slpc-trail-item">Course Communication</span>
            <span className="slpc-trail-sep">/</span>
            <span className="slpc-trail-current">Announcements</span>
          </nav>
          <div className="slpv-head">
            <div className="slpc-stack" style={{ gap: '0.25rem', maxWidth: 760 }}>
              <span className="slpv-eyebrow">
                <span className="slpv-pulse" />
                Academic transmission feed
              </span>
              <h1 className="slpv-title">Course Announcements</h1>
              <p className="slpc-lead">Official notices, scheduling updates and coursework advisories published by your lecturers for the courses you are enrolled in.</p>
            </div>
            <div className="slpv-actions">
              <span className="slpv-scope">
                {renderIcon('check_circle', 18)}
                Enrolled courses only
              </span>
              <button type="button" className="slpc-btn slpc-btn-primary" onClick={() => window.print()} disabled={!ready || all.length === 0}>
                {renderIcon('picture_as_pdf', 18)}
                Print digest (PDF)
              </button>
            </div>
          </div>
        </section>

        {coursesQuery.isError && <ErrorCard message={errorText(coursesQuery.error, 'Your courses could not be loaded.')} onRetry={() => coursesQuery.refetch()} />}

        <section className="slpc-stats" aria-label="Announcement summary">
          <div className="slpc-card slpv-stat">
            <div className="slpv-stat-top">
              <div>
                <span className="slpv-stat-label">Active broadcasts</span>
                <div className="slpv-stat-line">
                  <span className="slpv-stat-num">{ready ? all.length : '—'}</span>
                  <span className="slpv-stat-unit">{all.length === 1 ? 'notice published' : 'notices published'}</span>
                </div>
              </div>
              <span className="slpv-stat-icon">{renderIcon('campaign', 22)}</span>
            </div>
            <div className="slpv-stat-foot">
              <span className="slpv-dot" />
              <span>{ready ? `Across ${plural(activeCourses.length, 'course')} with notices` : 'Waiting for announcements'}</span>
            </div>
          </div>

          <div className="slpc-card slpv-stat">
            <div className="slpv-stat-top">
              <div>
                <span className="slpv-stat-label">This week</span>
                <div className="slpv-stat-line">
                  <span className="slpv-stat-num">{ready ? lastWeek.length : '—'}</span>
                  <span className="slpv-stat-unit">in last 7 days</span>
                </div>
              </div>
              <span className="slpv-stat-icon is-rose">{renderIcon('date_range', 22)}</span>
            </div>
            <div className="slpv-stat-foot">
              <span className="slpv-dot" />
              <span>{ready ? (lastWeek.length > 0 ? 'Published in the past 7 days' : 'Nothing new this week') : 'Waiting for announcements'}</span>
            </div>
          </div>

          <div className="slpc-card slpv-stat">
            <div className="slpv-stat-top">
              <div>
                <span className="slpv-stat-label">Recent transmissions</span>
                <div className="slpv-stat-line">
                  <span className="slpv-stat-num">{ready ? recent.length : '—'}</span>
                  <span className="slpv-stat-unit">in last 48 hours</span>
                </div>
              </div>
              <span className="slpv-stat-icon is-warm">{renderIcon('update', 22)}</span>
            </div>
            <div className="slpv-stat-foot">
              <span className="slpv-dot" />
              <span>{ready ? (newest ? `Latest: ${newest.author || newest.code} ${timeAgo(newest.raw, now).toLowerCase()}` : 'No announcements yet') : 'Waiting for announcements'}</span>
            </div>
          </div>

          <div className="slpc-card slpv-stat">
            <div className="slpv-stat-top">
              <div>
                <span className="slpv-stat-label">Course scope</span>
                <div className="slpv-stat-line">
                  <span className="slpv-stat-num">{coursesQuery.isSuccess ? courses.length : '—'}</span>
                  <span className="slpv-stat-unit">{courses.length === 1 ? 'module enrolled' : 'modules enrolled'}</span>
                </div>
              </div>
              <span className="slpv-stat-icon">{renderIcon('verified_user', 22)}</span>
            </div>
            <div className="slpv-stat-foot">
              <span className="slpv-mono">{coursesQuery.isSuccess && courses.length > 0 ? courses.map((entry) => entry.course_code).join(', ') : 'No courses yet'}</span>
            </div>
          </div>
        </section>

        <section className="slpc-card slpv-filters" aria-label="Filter announcements">
          <div className="slpv-filter-row">
            <label className="slpc-search">
              {renderIcon('search', 20)}
              <input type="search" value={search} onChange={(event) => change(setSearch)(event.target.value)} placeholder="Search announcements by keyword, topic or lecturer" aria-label="Search announcements" />
            </label>
            <div className="slpv-selects">
              <label className="slpv-select">
                {renderIcon('calendar_today', 18)}
                <select value={range} onChange={(event) => change(setRange)(event.target.value)} aria-label="Date range">
                  {DATE_RANGES.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="slpv-select">
                {renderIcon('sort', 18)}
                <select value={sort} onChange={(event) => change(setSort)(event.target.value)} aria-label="Sort announcements">
                  {SORTS.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="slpv-chips" role="group" aria-label="Filter by course">
            <span className="slpv-chips-label">Filter module:</span>
            <button type="button" className={`slpv-chip ${course === 'all' ? 'is-active' : ''}`} onClick={() => change(setCourse)('all')} aria-pressed={course === 'all'}>
              All enrolled{ready ? ` (${all.length})` : ''}
            </button>
            {courses.map((entry) => (
              <button key={entry.id} type="button" className={`slpv-chip ${course === entry.id ? 'is-active' : ''}`} onClick={() => change(setCourse)(entry.id)} aria-pressed={course === entry.id}>
                {entry.course_code}: {entry.course_name}
                {ready ? ` (${countOf(entry.id)})` : ''}
              </button>
            ))}
          </div>
        </section>

        {failed.length > 0 && (
          <div className="slpv-warn" role="alert">
            <span>Announcements for {failed.map((entry) => entry.course_code).join(', ')} could not be loaded.</span>
            <button type="button" className="slpc-btn slpc-btn-soft" onClick={retryFailed}>
              Try again
            </button>
          </div>
        )}

        <div className="slpv-split">
          <div className="slpv-main">
            {waiting && <Skeleton height={260} label="Loading announcements" />}
            {coursesQuery.isSuccess && courses.length === 0 && <p className="slpc-card slpc-empty">You are not enrolled in any courses yet, so there are no announcements to show.</p>}
            {notReady && (
              <PhasePanel icon="campaign" title="Announcements are not switched on yet" phase="Phase 7">
                The announcements service is not available on the server yet. This page is ready: once it is enabled, notices from your lecturers will appear here.
              </PhasePanel>
            )}
            {ready && courses.length > 0 && all.length === 0 && <p className="slpc-card slpc-empty">Your lecturers have not published any announcements yet. New notices will appear here as soon as they do.</p>}
            {ready && all.length > 0 && filtered.length === 0 && <p className="slpc-card slpc-empty">No announcements match these filters.</p>}

            {ready && filtered.length > 0 && (
              <>
                <div className="slpv-meta-row">
                  <span>Showing published announcements for your enrolled courses</span>
                  <span>
                    <span className="slpv-dot" />
                    {plural(filtered.length, 'notice')}
                  </span>
                </div>
                <ul className="slpv-feed" aria-label="Announcements">
                  {shown.map((item) => {
                    const fresh = item.time > 0 && now - item.time <= NEW_HOURS * 3600000
                    return (
                      <li key={item.id}>
                        <button type="button" className={`slpv-card ${selected?.id === item.id ? 'is-selected' : ''}`} onClick={() => choose(item.id)} aria-pressed={selected?.id === item.id} aria-label={`${item.code} ${item.title}`}>
                          <span className="slpv-card-top">
                            <span className="slpv-card-course">
                              <span className="slpv-code">{item.code}</span>
                              <span className="slpv-sep">•</span>
                              <span>{item.courseName}</span>
                            </span>
                            {fresh && <span className="slpv-pill">New</span>}
                          </span>
                          <h2>{item.title}</h2>
                          <p className="slpv-snippet">{item.body}</p>
                          <span className="slpv-card-foot">
                            {item.author ? (
                              <span className="slpv-author">
                                <span className="slpv-avatar" aria-hidden="true">
                                  {initials(item.author)}
                                </span>
                                <span>{item.author}</span>
                              </span>
                            ) : (
                              <span />
                            )}
                            <span className="slpv-stamp">
                              {item.stamp && <span>Published: {item.stamp}</span>}
                              <span className="slpv-sep">•</span>
                              <b>Course: {item.code}</b>
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                <nav className="slpc-card slpv-pager" aria-label="Pagination">
                  <span className="slpv-pager-text">
                    Showing <strong>{shown.length}</strong> of <strong>{filtered.length}</strong> published {filtered.length === 1 ? 'announcement' : 'announcements'} • Page {current} of {pages}
                  </span>
                  <span className="slpv-pager-btns">
                    <button type="button" className="slpv-page-btn" onClick={() => setPage(current - 1)} disabled={current <= 1}>
                      {renderIcon('chevron_left', 16)}
                      Previous
                    </button>
                    {Array.from({ length: pages }, (_, index) => index + 1).map((number) => (
                      <button key={number} type="button" className={`slpv-page-btn is-num ${number === current ? 'is-current' : ''}`} onClick={() => setPage(number)} aria-label={`Page ${number}`} aria-current={number === current ? 'page' : undefined}>
                        {number}
                      </button>
                    ))}
                    <button type="button" className="slpv-page-btn" onClick={() => setPage(current + 1)} disabled={current >= pages}>
                      Next
                      {renderIcon('chevron_right', 16)}
                    </button>
                  </span>
                </nav>
              </>
            )}
          </div>

          <aside className="slpv-side" ref={inspectorRef} aria-label="Announcement reader">
            <Inspector item={ready ? selected : undefined} lecturer={selectedLecturer} now={now} />
            <section className="slpc-card slpv-help" aria-label="Missing a notice">
              <span className="slpv-help-icon" aria-hidden="true">
                {renderIcon('help_center', 20)}
              </span>
              <div className="slpv-help-text">
                <strong>Missing a notice?</strong>
                <p>Only courses you are enrolled in appear in this feed.</p>
              </div>
              <Link to="/student/courses">My courses</Link>
            </section>
          </aside>
        </div>
      </div>
    </div>
  )
}
