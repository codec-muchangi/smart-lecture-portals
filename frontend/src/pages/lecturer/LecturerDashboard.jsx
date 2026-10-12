import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../app/AuthContext.jsx'
import { api } from '../../services/apiClient.js'

/*
 * Smart Lecture Portal: Lecturer dashboard (page content)
 * Place at: src/pages/lecturer/LecturerDashboard.jsx
 *
 * - Renders inside AppShell, which already draws the sidebar and top bar.
 * - Self-contained: styles are scoped under `.slpd` and injected by this
 *   component, so no Tailwind or extra CSS file is needed.
 * - Real data only (SRS: no hard-coded dashboard figures). It composes the
 *   endpoints that exist today; when GET /dashboard ships in Phase 8, swap the
 *   queries below for that single call.
 *     GET /courses                          assigned courses
 *     GET /courses/{id}/students            enrolled-student total per course
 *     GET /courses/{id}/assignments         assignments (open / draft / closed)
 *     GET /assignments/{id}                 submission_counts for grading backlog
 *     GET /notifications                    activity feed (Phase 7)
 * - Cohort attendance needs the attendance API (Phase 6), so that card says so
 *   instead of inventing a number.
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

const FEED_LIMIT = 6
const ACCENTS = ['primary', 'secondary', 'tertiary']

// Same query keys as AppShell, so courses and notifications are fetched once and shared.
const COURSES_KEY = ['courses', 'assigned']
const fetchCourses = () => api('/courses?page_size=100')
const fetchNotifications = () => api('/notifications')

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

// The API may return a bare array or a paginated { items, total } object; accept both.
function toList(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.items)) return data.items
  return []
}

function countOf(data) {
  return typeof data?.total === 'number' ? data.total : toList(data).length
}

function courseBadge(course) {
  const code = String(course.course_code ?? '')
  const digits = code.replace(/\D/g, '')
  return (digits || code).slice(-3).toUpperCase() || '—'
}

// The database already stores "Semester 1"; only add the word when it is missing.
function formatSemester(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  return /^semester/i.test(text) ? text : `Semester ${text}`
}

function formatDate(value) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
}

// "14 mins ago", "1 hour ago", "Yesterday", then a plain date.
function timeAgo(value) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return ''
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'min' : 'mins'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  if (hours < 48) return 'Yesterday'
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

function sentenceCase(value) {
  const text = String(value ?? '')
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : ''
}

function sumCounts(list) {
  const total = { submitted: 0, late: 0, graded: 0, returned: 0 }
  list.forEach((counts) => {
    Object.keys(total).forEach((key) => {
      total[key] += Number(counts?.[key]) || 0
    })
  })
  return total
}

/*
 * One summary per course: enrolled students, grading counts and open assignments.
 * Each request is allowed to fail on its own. A failed piece becomes `null`
 * ("unknown") so the rest of the dashboard still renders and never shows a wrong number.
 */
async function loadSummaries(courses) {
  const entries = await Promise.all(
    courses.map(async (course) => {
      const [roster, assignments] = await Promise.allSettled([
        api(`/courses/${course.id}/students?page_size=1`),
        api(`/courses/${course.id}/assignments?page_size=100`),
      ])
      const enrolled = roster.status === 'fulfilled' ? countOf(roster.value) : null
      if (assignments.status !== 'fulfilled') {
        return [course.id, { enrolled, grading: null, open: [] }]
      }

      const published = toList(assignments.value).filter((item) => item.state !== 'draft')
      const details = await Promise.allSettled(published.map((item) => api(`/assignments/${item.id}`)))
      const complete = details.every((result) => result.status === 'fulfilled')
      const grading = complete ? sumCounts(details.map((result) => result.value.submission_counts)) : null
      const open = published
        .filter((item) => item.state === 'open')
        .map((item) => ({ id: item.id, title: item.title, due_at: item.due_at, course_code: course.course_code }))

      return [course.id, { enrolled, grading, open }]
    }),
  )
  return Object.fromEntries(entries)
}

function Kpi({ label, icon, pill, danger, children }) {
  return (
    <div className="slpd-kpi">
      <div className="slpd-kpi-top">
        <span className="slpd-kpi-label">
          {label}
          {pill && <span className="slpd-kpi-pill">{pill}</span>}
        </span>
        <span className="slpd-kpi-icon">{renderIcon(icon, 18)}</span>
      </div>
      <div className={`slpd-kpi-body ${danger ? 'is-danger' : ''}`}>{children}</div>
    </div>
  )
}

function LecturerDashboard() {
  const { user } = useAuth()

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

  const coursesQuery = useQuery({ queryKey: COURSES_KEY, queryFn: fetchCourses })
  const courses = useMemo(() => toList(coursesQuery.data), [coursesQuery.data])
  const courseIds = courses.map((course) => course.id).join(',')

  const summaryQuery = useQuery({
    queryKey: ['lecturer-dashboard', 'summaries', courseIds],
    queryFn: () => loadSummaries(courses),
    enabled: coursesQuery.isSuccess && courses.length > 0,
  })

  // Not live until Phase 7; a failure here must never break the page.
  const notificationsQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: fetchNotifications,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  })

  const retry = () => {
    coursesQuery.refetch()
    if (summaryQuery.isError) summaryQuery.refetch()
  }

  const summaries = summaryQuery.data ?? {}
  const summariesPending = courses.length > 0 && summaryQuery.isPending
  const ready = coursesQuery.isSuccess && !summariesPending

  const details = user?.details ?? {}
  const name = [details.title, user?.full_name].filter(Boolean).join(' ') || user?.email || 'Lecturer'
  const subtitle = [
    details.department && `Department of ${details.department}`,
    details.staff_number && `Staff ID: #${details.staff_number}`,
  ]
    .filter(Boolean)
    .join(' • ')

  const creditUnits = courses.reduce((sum, course) => sum + (Number(course.credit_hours) || 0), 0)
  const totalStudents = courses.reduce((sum, course) => {
    const enrolled = summaries[course.id]?.enrolled
    return sum + (typeof enrolled === 'number' ? enrolled : 0)
  }, 0)

  const gradingKnown = courses.every((course) => Boolean(summaries[course.id]?.grading))
  const backlog = sumCounts(courses.map((course) => summaries[course.id]?.grading))
  const ungraded = backlog.submitted + backlog.late

  const openAssignments = courses
    .flatMap((course) => summaries[course.id]?.open ?? [])
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
  const nextDue = openAssignments.find((item) => new Date(item.due_at) >= new Date()) ?? null

  const notifications = notificationsQuery.isSuccess ? toList(notificationsQuery.data) : null
  const feedMissing = notificationsQuery.error?.status === 404

  return (
    <div className="slpd">
      <style>{STYLES}</style>

      <section className="slpd-banner" aria-labelledby="slpd-welcome">
        <h1 id="slpd-welcome" className="slpd-h1">
          Welcome back, {name}
        </h1>
        {subtitle && <p className="slpd-sub">{subtitle}</p>}
      </section>

      <div className="slpd-kpis">
        <Kpi label="Active Enrollment" icon="groups">
          <div className="slpd-kpi-row">
            <span className="slpd-kpi-value">{ready ? totalStudents : '—'}</span>
            <span className="slpd-kpi-unit">Students</span>
          </div>
          <div className="slpd-kpi-note">
            <span className="slpd-dot" aria-hidden="true" />
            {ready
              ? `Across ${courses.length} assigned ${courses.length === 1 ? 'course' : 'courses'}`
              : 'Loading…'}
          </div>
        </Kpi>

        <Kpi
          label="Grading Backlog"
          icon="rate_review"
          pill={ready && gradingKnown && ungraded > 0 ? 'Action needed' : null}
          danger={ready && gradingKnown && ungraded > 0}
        >
          <div className="slpd-kpi-row">
            <span className="slpd-kpi-value">{ready && gradingKnown ? ungraded : '—'}</span>
            <span className="slpd-kpi-unit">Scripts Ungraded</span>
          </div>
          <div className="slpd-kpi-note slpd-mono">
            {!ready && 'Loading…'}
            {ready && !gradingKnown && 'Could not load'}
            {ready && gradingKnown && (
              <>
                <span>{backlog.submitted} On time</span>
                <span className="slpd-sep" aria-hidden="true">
                  •
                </span>
                <span className={backlog.late > 0 ? 'slpd-warn' : ''}>{backlog.late} Late</span>
                <span className="slpd-sep" aria-hidden="true">
                  •
                </span>
                <span>{backlog.returned} Revisions</span>
              </>
            )}
          </div>
        </Kpi>

        <Kpi label="Cohort Attendance" icon="person_check">
          <div className="slpd-kpi-row">
            <span className="slpd-kpi-value">—</span>
            <span className="slpd-kpi-unit">Avg Rate</span>
          </div>
          <div className="slpd-kpi-note slpd-muted">Available when attendance (Phase 6) goes live</div>
        </Kpi>

        <Kpi label="Upcoming Deadlines" icon="event_upcoming">
          <div className="slpd-kpi-row">
            <span className="slpd-kpi-value">{ready ? openAssignments.length : '—'}</span>
            <span className="slpd-kpi-unit">Open Assignments</span>
          </div>
          <div className="slpd-kpi-note slpd-mono">
            {!ready && 'Loading…'}
            {ready && nextDue && `Next due ${formatDate(nextDue.due_at)}`}
            {ready && !nextDue && 'No upcoming deadlines'}
          </div>
        </Kpi>
      </div>

      <div className="slpd-grid">
        <section className="slpd-panel" aria-labelledby="slpd-courses-title">
          <div className="slpd-panel-head">
            <div className="slpd-panel-title">
              <span className="slpd-bar" />
              <div>
                <h2 id="slpd-courses-title" className="slpd-h2">
                  Assigned Courses
                </h2>
                <p className="slpd-muted">Semester active modules and registered faculty loads</p>
              </div>
            </div>
            <div className="slpd-panel-side">
              {coursesQuery.isSuccess && (
                <span className="slpd-mono slpd-total">Total: {creditUnits} Credit Units</span>
              )}
              <Link to="/lecturer/courses" className="slpd-link">
                <span>All courses</span>
                {renderIcon('arrow_forward', 16)}
              </Link>
            </div>
          </div>

          {coursesQuery.isPending && (
            <div className="slpd-list" aria-busy="true" aria-live="polite">
              {[0, 1, 2].map((item) => (
                <div key={item} className="slpd-skeleton" />
              ))}
            </div>
          )}

          {coursesQuery.isError && (
            <div className="slpd-empty" role="alert">
              {renderIcon('cloud_off', 32)}
              <p className="slpd-empty-title">We couldn&apos;t load your courses.</p>
              <p className="slpd-muted">Check your connection and try again.</p>
              <button type="button" className="slpd-btn" onClick={retry}>
                {renderIcon('refresh', 18)}
                <span>Try again</span>
              </button>
            </div>
          )}

          {coursesQuery.isSuccess && courses.length === 0 && (
            <div className="slpd-empty">
              {renderIcon('menu_book', 32)}
              <p className="slpd-empty-title">No courses assigned yet.</p>
              <p className="slpd-muted">Courses are assigned to you by your institution.</p>
            </div>
          )}

          {coursesQuery.isSuccess && courses.length > 0 && (
            <ul className="slpd-list">
              {courses.map((course, index) => {
                const accent = ACCENTS[index % ACCENTS.length]
                const summary = summaries[course.id]
                const period = [formatSemester(course.semester), course.academic_year].filter(Boolean).join(' • ')
                const awaiting = summary?.grading ? summary.grading.submitted + summary.grading.late : 0
                let students = 'Students unavailable'
                if (summariesPending) students = 'Counting students…'
                else if (typeof summary?.enrolled === 'number') {
                  students = `${summary.enrolled} ${summary.enrolled === 1 ? 'Student' : 'Students'} Enrolled`
                }
                return (
                  <li key={course.id} className="slpd-course">
                    <div className="slpd-course-main">
                      <span className={`slpd-badge-box slpd-accent-${accent}`}>{courseBadge(course)}</span>
                      <div className="slpd-course-body">
                        <div className="slpd-course-title-row">
                          <span className="slpd-course-title">{course.course_name}</span>
                          <span className="slpd-pill">{course.course_code}</span>
                          {course.credit_hours != null && (
                            <span className="slpd-pill slpd-pill-accent">
                              {course.credit_hours} {Number(course.credit_hours) === 1 ? 'Credit' : 'Credits'}
                            </span>
                          )}
                        </div>
                        <div className="slpd-meta">
                          {period && (
                            <span className="slpd-meta-item">
                              {renderIcon('calendar_today', 16)}
                              {period}
                            </span>
                          )}
                          <span className="slpd-meta-item">
                            {renderIcon('person', 16)}
                            {students}
                          </span>
                          {awaiting > 0 && (
                            <span className="slpd-meta-item">
                              {renderIcon('rate_review', 16)}
                              {awaiting} awaiting grading
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="slpd-course-side">
                      {course.status && <span className="slpd-status">{sentenceCase(course.status)}</span>}
                      <Link to={`/lecturer/courses/${course.id}`} className="slpd-btn">
                        <span>Manage Course</span>
                        {renderIcon('chevron_right', 16)}
                      </Link>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="slpd-panel" aria-labelledby="slpd-feed-title">
          <div className="slpd-feed-head">
            <div className="slpd-panel-title">
              <span className="slpd-feed-icon">{renderIcon('notifications_active', 20)}</span>
              <h2 id="slpd-feed-title" className="slpd-h3">
                Activity Feed
              </h2>
            </div>
            <span className="slpd-mono slpd-tag">Recent</span>
          </div>

          {notificationsQuery.isPending && (
            <div className="slpd-list" aria-busy="true">
              {[0, 1, 2].map((item) => (
                <div key={item} className="slpd-skeleton slpd-skeleton-sm" />
              ))}
            </div>
          )}

          {notificationsQuery.isError && (
            <p className="slpd-muted">
              {feedMissing
                ? 'Activity updates will appear here once notifications go live (Phase 7).'
                : 'The activity feed is unavailable right now.'}
            </p>
          )}

          {notifications && notifications.length === 0 && (
            <p className="slpd-muted">You&apos;re all caught up.</p>
          )}

          {notifications && notifications.length > 0 && (
            <ul className="slpd-feed">
              {notifications.slice(0, FEED_LIMIT).map((item) => (
                <li key={item.id} className="slpd-feed-item">
                  <span className={`slpd-feed-dot ${item.is_read ? 'is-read' : ''}`} />
                  <div className="slpd-feed-body">
                    <p className="slpd-feed-title">{item.title}</p>
                    {item.message && <p className="slpd-feed-text">{item.message}</p>}
                    <span className="slpd-feed-time">{timeAgo(item.created_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

export default LecturerDashboard

const STYLES = `
.slpd {
  --primary: #a03223;
  --on-primary: #ffffff;
  --primary-container: #c14a38;
  --secondary: #9e3e49;
  --on-secondary: #ffffff;
  --tertiary-container: #b2563e;
  --on-tertiary-container: #fff4f2;
  --surface: #fef7ff;
  --surface-low: #faf0fe;
  --surface-mid: #f4ebf8;
  --surface-high: #eee5f2;
  --surface-lowest: #ffffff;
  --on-surface: #1e1a23;
  --on-surface-variant: #58413e;
  --outline: #8b716d;
  font-family: 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: var(--on-surface);
  line-height: 1.5;
  text-align: left;
  -webkit-font-smoothing: antialiased;
  width: 100%;
}
.slpd *, .slpd *::before, .slpd *::after { box-sizing: border-box; }
/* :where() keeps the reset at low specificity so the class rules below can override it */
.slpd :where(h1, h2, h3, p, ul, ol) { margin: 0; padding: 0; }
.slpd :where(ul, ol) { list-style: none; }
.slpd a { color: inherit; text-decoration: none; }
.slpd button { font-family: inherit; }
.slpd .material-symbols-outlined {
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
.slpd a:focus-visible, .slpd button:focus-visible {
  outline: 3px solid var(--primary-container);
  outline-offset: 3px;
  border-radius: 8px;
}
.slpd-mono { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; }

/* Banner */
.slpd-banner {
  border-radius: 16px; background: var(--surface-lowest); padding: 1.25rem 1.5rem;
  box-shadow: 0 1px 3px rgba(30, 26, 35, 0.08);
}
.slpd-h1 { font-size: 26px; line-height: 34px; font-weight: 700; letter-spacing: -0.015em; }
.slpd-sub { margin-top: 0.25rem; font-size: 13px; line-height: 20px; color: var(--on-surface-variant); }

/* KPI cards */
.slpd-kpis { margin-top: 1.5rem; display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; }
.slpd-kpi {
  border-radius: 16px; background: var(--surface-lowest); padding: 1rem;
  box-shadow: 0 1px 3px rgba(30, 26, 35, 0.08);
  display: flex; flex-direction: column; gap: 1rem; transition: transform 0.3s, box-shadow 0.3s;
}
.slpd-kpi:hover { transform: translateY(-4px); box-shadow: 0 10px 24px rgba(30, 26, 35, 0.12); }
.slpd-kpi-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; min-height: 44px; }
.slpd-kpi-label {
  display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem 0.5rem;
  font-size: 11px; line-height: 16px; font-weight: 600; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--on-surface-variant);
}
.slpd-kpi-pill {
  padding: 2px 8px; border-radius: 999px; background: #ffdad6; color: #93000a;
  font-size: 10px; line-height: 14px; font-weight: 700; letter-spacing: 0.04em;
}
.slpd-kpi-icon {
  width: 32px; height: 32px; border-radius: 8px; background: var(--surface-mid); color: var(--primary);
  display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
}
.slpd-kpi-body { display: flex; flex-direction: column; gap: 0.5rem; }
.slpd-kpi-row { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; }
.slpd-kpi-value { font-size: 40px; line-height: 1; font-weight: 800; letter-spacing: -0.025em; }
.slpd-kpi-body.is-danger .slpd-kpi-value { color: var(--primary); }
.slpd-kpi-unit { font-size: 12px; line-height: 16px; font-weight: 600; color: var(--on-surface-variant); }
.slpd-kpi-note {
  display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem;
  font-size: 12px; line-height: 16px; color: var(--on-surface-variant);
}
.slpd-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--primary); flex: 0 0 auto; }
.slpd-sep { color: var(--outline); }
.slpd-warn { color: var(--primary); font-weight: 700; }
.slpd-muted { color: var(--on-surface-variant); font-size: 13px; line-height: 18px; }
.slpd-kpi-note.slpd-muted { font-size: 12px; line-height: 16px; }
.slpd-kpi-note.slpd-mono { font-size: 11px; gap: 0.25rem; }

/* Layout */
.slpd-grid { margin-top: 1.5rem; display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.slpd-panel {
  border-radius: 16px; background: var(--surface-lowest); padding: 1rem;
  box-shadow: 0 1px 3px rgba(30, 26, 35, 0.08);
}
.slpd-panel-head {
  display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1rem;
}
.slpd-panel-title { display: flex; align-items: center; gap: 0.5rem; }
.slpd-panel-side { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 1rem; }
.slpd-bar { width: 10px; height: 36px; border-radius: 999px; background: var(--primary); flex: 0 0 auto; }
.slpd-h2 { font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em; }
.slpd-h3 { font-size: 18px; line-height: 26px; font-weight: 700; letter-spacing: -0.005em; }
.slpd-total { font-size: 12px; line-height: 16px; color: var(--on-surface-variant); }
.slpd-link {
  display: inline-flex; align-items: center; gap: 0.25rem; font-size: 12px; line-height: 16px; font-weight: 600;
  letter-spacing: 0.02em; color: var(--primary);
}
.slpd-link:hover { text-decoration: underline; }

/* Course list */
.slpd-list { display: flex; flex-direction: column; gap: 1rem; }
.slpd-course {
  border-radius: 12px; background: var(--surface); padding: 1rem;
  box-shadow: 0 1px 3px rgba(30, 26, 35, 0.08); transition: box-shadow 0.2s;
  display: flex; flex-direction: column; gap: 1rem;
}
.slpd-course:hover { box-shadow: 0 4px 14px rgba(30, 26, 35, 0.12); }
.slpd-course-main { display: flex; align-items: flex-start; gap: 1rem; min-width: 0; }
.slpd-course-body { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
.slpd-badge-box {
  width: 48px; height: 48px; border-radius: 12px; flex: 0 0 auto;
  display: inline-flex; align-items: center; justify-content: center;
  font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 18px; font-weight: 700;
}
.slpd-accent-primary { background: var(--primary); color: var(--on-primary); }
.slpd-accent-secondary { background: var(--secondary); color: var(--on-secondary); }
.slpd-accent-tertiary { background: var(--tertiary-container); color: var(--on-tertiary-container); }
.slpd-course-title-row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.slpd-course-title { font-size: 18px; line-height: 26px; font-weight: 700; letter-spacing: -0.005em; overflow-wrap: anywhere; }
.slpd-pill {
  padding: 2px 8px; border-radius: 999px; background: var(--surface-high); color: var(--on-surface);
  font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 16px; font-weight: 600;
}
.slpd-pill-accent {
  background: rgba(160, 50, 35, 0.1); color: var(--primary);
  font-family: inherit; letter-spacing: 0.04em;
}
.slpd-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 1rem; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpd-meta-item { display: inline-flex; align-items: center; gap: 0.375rem; }
.slpd-meta-item .material-symbols-outlined { color: var(--primary); }
.slpd-course-side { display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 0.5rem; flex: 0 0 auto; }
.slpd-status {
  padding: 4px 10px; border-radius: 999px; background: var(--surface-high); color: var(--on-surface-variant);
  font-size: 11px; line-height: 14px; font-weight: 600; letter-spacing: 0.04em;
}
.slpd-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.25rem; padding: 6px 14px;
  border: 0; border-radius: 999px; background: var(--primary); color: var(--on-primary); cursor: pointer;
  font-size: 12px; line-height: 16px; font-weight: 600; letter-spacing: 0.02em; transition: background 0.2s;
}
.slpd-btn:hover { background: var(--primary-container); }

/* Empty, error, loading */
.slpd-empty {
  display: flex; flex-direction: column; align-items: center; text-align: center; gap: 0.5rem;
  padding: 2rem 1rem; border-radius: 12px; background: var(--surface); color: var(--outline);
}
.slpd-empty-title { font-size: 16px; line-height: 24px; font-weight: 600; color: var(--on-surface); }
.slpd-empty .slpd-btn { margin-top: 0.5rem; padding: 8px 18px; }
.slpd-skeleton {
  height: 96px; border-radius: 12px;
  background: linear-gradient(90deg, var(--surface-mid) 25%, var(--surface-high) 50%, var(--surface-mid) 75%);
  background-size: 200% 100%; animation: slpd-shimmer 1.4s ease-in-out infinite;
}
.slpd-skeleton-sm { height: 56px; }
@keyframes slpd-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }

/* Activity feed */
.slpd-feed-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 1rem; }
.slpd-feed-icon { color: var(--primary); display: inline-flex; }
.slpd-tag { font-size: 11px; line-height: 16px; color: var(--on-surface-variant); }
.slpd-feed { display: flex; flex-direction: column; gap: 0.5rem; }
.slpd-feed-item {
  display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.5rem; border-radius: 12px; transition: background 0.2s;
}
.slpd-feed-item:hover { background: var(--surface-low); }
.slpd-feed-dot { width: 8px; height: 8px; margin-top: 7px; border-radius: 999px; background: var(--primary); flex: 0 0 auto; }
.slpd-feed-dot.is-read { background: var(--outline); }
.slpd-feed-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.slpd-feed-title { font-size: 13px; line-height: 18px; font-weight: 600; overflow-wrap: anywhere; }
.slpd-feed-text { font-size: 13px; line-height: 18px; color: var(--on-surface-variant); overflow-wrap: anywhere; }
.slpd-feed-time {
  font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 16px; color: var(--on-surface-variant);
}

@media (min-width: 640px) {
  .slpd-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .slpd-h1 { font-size: 32px; line-height: 40px; letter-spacing: -0.02em; }
  .slpd-panel-head { flex-direction: row; align-items: center; justify-content: space-between; }
}
@media (min-width: 768px) {
  .slpd-course { flex-direction: row; align-items: flex-start; justify-content: space-between; }
  .slpd-course-side { flex-direction: column; align-items: flex-end; }
}
@media (min-width: 1024px) {
  .slpd-panel { padding: 1.5rem; }
  .slpd-grid { grid-template-columns: minmax(0, 8fr) minmax(0, 4fr); }
}
@media (min-width: 1280px) {
  .slpd-kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
@media (prefers-reduced-motion: reduce) {
  .slpd-skeleton { animation: none; }
  .slpd *, .slpd *::before, .slpd *::after { transition: none !important; }
}
`
