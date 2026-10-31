import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../app/AuthContext.jsx'
import { api } from '../../services/apiClient.js'

/*
 * Smart Lecture Portal: Student dashboard (page content)
 * Place at: src/pages/student/StudentDashboard.jsx
 *
 * - Renders inside AppShell, which already draws the sidebar and top bar.
 * - Self-contained: styles are scoped under `.slpt` and injected by this
 *   component, so no Tailwind or extra CSS file is needed.
 * - Real data only (SRS: no hard-coded dashboard figures). It composes the
 *   endpoints that exist today; when GET /dashboard ships in Phase 8, swap the
 *   queries below for that single call.
 *     GET  /courses                          enrolled courses
 *     GET  /courses/{id}/assignments         published assignments + my_submission
 *     GET  /courses/{id}/marks/me            released marks and weighted percentage
 *     POST /assignments/{id}/submissions     upload a submission (multipart)
 *     GET  /notifications                    activity stream (Phase 7)
 * - Attendance (Phase 6), the timetable (Phase 8) and announcements (Phase 7)
 *   have no API yet, so those panels say so instead of inventing numbers.
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

const TASK_LIMIT = 5
const FEED_LIMIT = 5
const TASK_ICONS = ['terminal', 'schema', 'shield_lock', 'science', 'functions', 'article']
const FEED_DOTS = ['primary', 'tertiary', 'secondary']

// Matches the backend upload rules (PDF, DOCX, PPTX, XLSX, CSV, PNG, JPG/JPEG, ZIP; 25 MB).
const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'pptx', 'xlsx', 'csv', 'png', 'jpg', 'jpeg', 'zip']
const MAX_UPLOAD_MB = 25

// Same query keys as AppShell, so courses and notifications are fetched once and shared.
const COURSES_KEY = ['courses', 'assigned']
const SUMMARY_KEY = 'student-dashboard'
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

// The database already stores "Semester 1"; only add the word when it is missing.
function formatSemester(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  return /^semester/i.test(text) ? text : `Semester ${text}`
}

function sentenceCase(value) {
  const text = String(value ?? '')
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : ''
}

// "14 mins ago", "1 hour ago", "Yesterday", then a plain date.
function timeAgo(value, now) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return ''
  const minutes = Math.floor((now - date.getTime()) / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'min' : 'mins'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  if (hours < 48) return 'Yesterday'
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

function clock(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// "Tomorrow, 23:59", "Today, 09:00" or "Feb 27, 23:59".
function formatDue(value, now) {
  const due = new Date(value)
  if (!value || Number.isNaN(due.getTime())) return ''
  const today = new Date(now)
  const tomorrow = new Date(now)
  tomorrow.setDate(today.getDate() + 1)
  let day = due.toLocaleDateString([], { month: 'short', day: 'numeric' })
  if (sameDay(due, today)) day = 'Today'
  else if (sameDay(due, tomorrow)) day = 'Tomorrow'
  return `${day}, ${clock(due)}`
}

// Urgency drives the label, the pill colour and the card's accent bar.
function dueInfo(value, now) {
  const due = new Date(value)
  if (!value || Number.isNaN(due.getTime())) return { label: '', tone: 'later' }
  const diff = due.getTime() - now
  if (diff < 0) return { label: 'Overdue', tone: 'urgent' }
  const minutes = Math.max(1, Math.ceil(diff / 60000))
  if (minutes < 60) return { label: `Due in ${minutes} ${minutes === 1 ? 'min' : 'mins'}`, tone: 'urgent' }
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return { label: `Due in ${hours} ${hours === 1 ? 'hour' : 'hours'}`, tone: 'urgent' }
  const days = Math.floor(diff / 86400000)
  if (days < 7) return { label: `Due in ${days} days`, tone: 'soon' }
  if (days < 14) return { label: 'Due Next Week', tone: 'later' }
  return { label: `Due ${due.toLocaleDateString([], { month: 'short', day: 'numeric' })}`, tone: 'later' }
}

function remaining(value, now) {
  const diff = new Date(value).getTime() - now
  if (!Number.isFinite(diff)) return ''
  if (diff <= 0) return 'Deadline passed'
  const totalMinutes = Math.floor(diff / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h Remaining`
  return `${hours}h ${minutes}m Remaining`
}

function extensionOf(name) {
  const index = String(name ?? '').lastIndexOf('.')
  return index < 0 ? '' : String(name).slice(index + 1).toLowerCase()
}

function validateFile(file) {
  if (!ALLOWED_EXTENSIONS.includes(extensionOf(file.name))) {
    return `Unsupported file type. Use ${ALLOWED_EXTENSIONS.map((ext) => ext.toUpperCase()).join(', ')}.`
  }
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return `File is larger than ${MAX_UPLOAD_MB} MB.`
  if (file.size === 0) return 'That file is empty.'
  return ''
}

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/*
 * One summary per course: its assignments (with my_submission) and my weighted mark.
 * Each request may fail on its own. A failed piece becomes `null` ("unknown") so
 * the rest of the dashboard still renders and never shows a wrong number.
 */
async function loadSummaries(courses) {
  const entries = await Promise.all(
    courses.map(async (course) => {
      const [assignments, marks] = await Promise.allSettled([
        api(`/courses/${course.id}/assignments?page_size=100`),
        api(`/courses/${course.id}/marks/me`),
      ])
      return [
        course.id,
        {
          assignments: assignments.status === 'fulfilled' ? toList(assignments.value) : null,
          marks: marks.status === 'fulfilled' ? { percent: marks.value?.totals?.weighted_percent ?? null } : null,
        },
      ]
    }),
  )
  return Object.fromEntries(entries)
}

function Kpi({ icon, tone, pill, pillTone, children }) {
  return (
    <div className="slpt-kpi">
      <div className="slpt-kpi-top">
        <span className={`slpt-kpi-icon is-${tone}`}>{renderIcon(icon, 22)}</span>
        {pill && <span className={`slpt-pill ${pillTone ?? ''}`}>{pill}</span>}
      </div>
      <div className="slpt-kpi-body">{children}</div>
    </div>
  )
}

function SubmitModal({ task, now, onClose }) {
  const queryClient = useQueryClient()
  const dialogRef = useRef(null)
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [pledge, setPledge] = useState(false)
  const [fileError, setFileError] = useState('')
  const [dragging, setDragging] = useState(false)

  const mutation = useMutation({
    mutationFn: (chosen) => {
      const form = new FormData()
      form.append('file', chosen)
      return api(`/assignments/${task.id}/submissions`, { method: 'POST', form })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [SUMMARY_KEY] })
      onClose(true)
    },
  })

  useEffect(() => {
    const dialog = dialogRef.current
    const previous = document.activeElement
    dialog?.querySelector('button')?.focus()

    const onKey = (event) => {
      if (event.key === 'Escape') {
        onClose(false)
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = Array.from(dialog.querySelectorAll('button:not([disabled]), input, [href]')).filter(
        (el) => el.type !== 'file',
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (previous && typeof previous.focus === 'function') previous.focus()
    }
  }, [onClose])

  const choose = (chosen) => {
    if (!chosen) return
    const problem = validateFile(chosen)
    setFileError(problem)
    setFile(problem ? null : chosen)
  }

  const onDrop = (event) => {
    event.preventDefault()
    setDragging(false)
    choose(event.dataTransfer?.files?.[0])
  }

  const canSubmit = Boolean(file) && pledge && !mutation.isPending
  const submitError = mutation.error?.message || (mutation.isError ? 'The upload failed. Please try again.' : '')

  return (
    <div className="slpt-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose(false)}>
      <div
        ref={dialogRef}
        className="slpt-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="slpt-modal-title"
      >
        <div className="slpt-modal-head">
          <div>
            <p className="slpt-code">SUBMISSION PORTAL · {task.course_code}</p>
            <h2 id="slpt-modal-title" className="slpt-modal-title">
              {task.title}
            </h2>
          </div>
          <button type="button" className="slpt-icon-btn" aria-label="Close" onClick={() => onClose(false)}>
            {renderIcon('close', 20)}
          </button>
        </div>

        <div className="slpt-modal-due">
          <span className="slpt-inline">
            {renderIcon('schedule', 16)}
            Due: {formatDue(task.due_at, now)}
          </span>
          <span className="slpt-code slpt-error-text">{remaining(task.due_at, now)}</span>
        </div>

        <div
          className={`slpt-drop ${dragging ? 'is-drag' : ''}`}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <span className="slpt-drop-icon">{renderIcon('upload_file', 32)}</span>
          {file ? (
            <p className="slpt-drop-title" data-testid="chosen-file">
              {file.name} <span className="slpt-muted">({formatSize(file.size)})</span>
            </p>
          ) : (
            <p className="slpt-drop-title">Drag and drop your file here</p>
          )}
          <p className="slpt-muted">
            Supported formats: {ALLOWED_EXTENSIONS.map((ext) => ext.toUpperCase()).join(', ')} (Maximum {MAX_UPLOAD_MB}MB)
          </p>
          <button type="button" className="slpt-btn slpt-btn-soft" onClick={() => inputRef.current?.click()}>
            Select File from Device
          </button>
          <input
            ref={inputRef}
            type="file"
            className="slpt-file"
            aria-label="Choose a file to submit"
            accept={ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(',')}
            onChange={(event) => {
              choose(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </div>
        {fileError && (
          <p className="slpt-alert" role="alert">
            {fileError}
          </p>
        )}

        <div className="slpt-pledge">
          <input
            id="slpt-pledge"
            type="checkbox"
            checked={pledge}
            onChange={(event) => setPledge(event.target.checked)}
          />
          <label htmlFor="slpt-pledge">
            I confirm that this submission is my own original work and complies with university academic
            integrity and plagiarism regulations.
          </label>
        </div>

        {submitError && (
          <p className="slpt-alert" role="alert">
            {submitError}
          </p>
        )}

        <div className="slpt-modal-actions">
          <button type="button" className="slpt-btn slpt-btn-plain" onClick={() => onClose(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="slpt-btn slpt-btn-primary"
            disabled={!canSubmit}
            onClick={() => mutation.mutate(file)}
          >
            {mutation.isPending ? 'Submitting...' : 'Confirm & Submit'}
          </button>
        </div>
      </div>
    </div>
  )
}

function StudentDashboard() {
  const { user } = useAuth()
  const [now, setNow] = useState(() => Date.now())
  const [activeTask, setActiveTask] = useState(null)
  const [notice, setNotice] = useState('')

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

  // Keep "Due in 18 hours" and "35 mins ago" fresh without refetching.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [])

  const coursesQuery = useQuery({ queryKey: COURSES_KEY, queryFn: fetchCourses })
  const courses = useMemo(() => toList(coursesQuery.data), [coursesQuery.data])
  const courseIds = courses.map((course) => course.id).join(',')

  const summaryQuery = useQuery({
    queryKey: [SUMMARY_KEY, courseIds],
    queryFn: () => loadSummaries(courses),
    enabled: coursesQuery.isSuccess && courses.length > 0,
  })

    const timetableQuery = useQuery({
    queryKey: ['timetable', 'week'],
    queryFn: () => api('/timetable'),
  })
  const localToday = new Date()
  const todayIso = `${localToday.getFullYear()}-${String(localToday.getMonth() + 1).padStart(2, '0')}-${String(localToday.getDate()).padStart(2, '0')}`
  const todayClasses = (timetableQuery.data?.items ?? []).filter((entry) => entry.date === todayIso)

    const dashboardQuery = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api('/dashboard'),
  })
  const attendanceRows = dashboardQuery.data?.attendance_summary ?? []
  const attendanceByCourse = Object.fromEntries(attendanceRows.map((row) => [row.course_id, row]))
  const totalCounted = attendanceRows.reduce((sum, row) => sum + row.counted_sessions, 0)
  const totalAttended = attendanceRows.reduce((sum, row) => sum + row.attended, 0)
  const overallPct = totalCounted > 0 ? Math.round((totalAttended / totalCounted) * 1000) / 10 : null
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

  const summaries = useMemo(() => summaryQuery.data ?? {}, [summaryQuery.data])
  const summariesPending = courses.length > 0 && summaryQuery.isPending
  const ready = coursesQuery.isSuccess && !summariesPending

  const firstName = String(user?.full_name ?? '').trim().split(/\s+/)[0] || 'there'

  const credits = courses.reduce((sum, course) => sum + (Number(course.credit_hours) || 0), 0)
  const term = courses[0] ? formatSemester(courses[0].semester) : ''

  const assignmentsKnown = courses.every((course) => Array.isArray(summaries[course.id]?.assignments))

  const tasks = useMemo(() => {
    const list = []
    courses.forEach((course, index) => {
      toList(summaries[course.id]?.assignments).forEach((assignment) => {
        if (assignment.state !== 'open') return
        list.push({ ...assignment, course_code: course.course_code, icon: TASK_ICONS[index % TASK_ICONS.length] })
      })
    })
    return list.sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
  }, [courses, summaries])

  const pending = tasks.filter((task) => !task.my_submission)
  const nextDue = pending[0] ?? null
  const weekAhead = now + 7 * 86400000
  const laterThisWeek = pending.slice(1).filter((task) => new Date(task.due_at).getTime() <= weekAhead).length
  const visibleTasks = tasks.slice(0, TASK_LIMIT)

  const percents = courses
    .map((course) => summaries[course.id]?.marks?.percent)
    .filter((value) => typeof value === 'number')
  const average = percents.length ? percents.reduce((sum, value) => sum + value, 0) / percents.length : null
  const marksUnknown = courses.some((course) => !summaries[course.id]?.marks)

  const notifications = notificationsQuery.isSuccess ? toList(notificationsQuery.data) : null
  const feedMissing = notificationsQuery.error?.status === 404
  const weekday = new Date(now).toLocaleDateString([], { weekday: 'short' })

  let subtitle = 'Loading your workspace…'
  if (ready && assignmentsKnown) {
    subtitle =
      pending.length > 0
        ? `You have ${pending.length} pending ${pending.length === 1 ? 'submission' : 'submissions'}.`
        : 'Your scholarly workspace is up to date.'
  } else if (ready) {
    subtitle = 'Some of your assignments could not be loaded.'
  }

  const closeModal = (submitted) => {
    setActiveTask(null)
    if (submitted === true) setNotice('Submission received. Your file was uploaded successfully.')
  }

  return (
    <div className="slpt">
      <style>{STYLES}</style>

      <section className="slpt-greeting" aria-labelledby="slpt-welcome">
        <h1 id="slpt-welcome" className="slpt-h1">
          Welcome back, {firstName}!
        </h1>
        <p className="slpt-sub">{subtitle}</p>
      </section>

      {notice && (
        <p className="slpt-notice" role="status">
          {renderIcon('check_circle', 18)}
          <span>{notice}</span>
          <button type="button" className="slpt-icon-btn" aria-label="Dismiss message" onClick={() => setNotice('')}>
            {renderIcon('close', 16)}
          </button>
        </p>
      )}

      <div className="slpt-kpis">
        <Kpi icon="auto_stories" tone="mid" pill={coursesQuery.isSuccess ? `${credits} Credits` : null}>
          <div className="slpt-kpi-value">{coursesQuery.isSuccess ? `${courses.length} Active` : '—'}</div>
          <div className="slpt-kpi-foot">
            <span>Enrolled Modules</span>
            <span className="slpt-mono slpt-accent-secondary">{term}</span>
          </div>
        </Kpi>

        <Kpi
          icon="hourglass_top"
          tone="fixed"
          pill={ready && assignmentsKnown && nextDue ? dueInfo(nextDue.due_at, now).label : null}
          pillTone="is-error"
        >
          <div className={`slpt-kpi-value ${ready && pending.length > 0 ? 'is-danger' : ''}`}>
            {ready && assignmentsKnown ? `${pending.length} Due Soon` : '—'}
          </div>
          <div className="slpt-kpi-foot">
            <span>Pending Submissions</span>
            <span className="slpt-mono">
              {!ready && 'Loading…'}
              {ready && !assignmentsKnown && 'Could not load'}
              {ready && assignmentsKnown && pending.length === 0 && 'All caught up'}
              {ready && assignmentsKnown && pending.length > 0 && `${laterThisWeek} Later This Week`}
            </span>
          </div>
        </Kpi>

        <Kpi icon="how_to_reg" tone="low">
          <div className="slpt-kpi-value">—</div>
          <div className="slpt-kpi-foot">
            <span>Overall Attendance</span>
            <span className="slpt-mono slpt-muted">Phase 6</span>
          </div>
        </Kpi>

        <Kpi icon="military_tech" tone="highest">
          <div className="slpt-kpi-value">
            {ready && average !== null ? (
              <>
                {average.toFixed(1)}
                <span className="slpt-kpi-unit">%</span>
              </>
            ) : (
              '—'
            )}
          </div>
          <div className="slpt-kpi-foot">
            <span>Average Mark</span>
            <span className="slpt-mono slpt-accent-primary">
              {!ready && 'Loading…'}
              {ready && average !== null && `${percents.length} ${percents.length === 1 ? 'Course' : 'Courses'}`}
              {ready && average === null && (marksUnknown ? 'Could not load' : 'None released')}
            </span>
          </div>
        </Kpi>
      </div>

      <div className="slpt-grid">
        <div className="slpt-col">
          <section aria-labelledby="slpt-tasks-title">
            <div className="slpt-section-head">
              <div className="slpt-inline">
                <h2 id="slpt-tasks-title" className="slpt-h2">
                  Upcoming Assignments &amp; Tasks
                </h2>
                {ready && assignmentsKnown && pending.length > 0 && (
                  <span className="slpt-pill is-error">{pending.length} Pending</span>
                )}
              </div>
              <Link to="/student/courses" className="slpt-link">
                Portal Submission Box →
              </Link>
            </div>

            {coursesQuery.isError && (
              <div className="slpt-card slpt-state" role="alert">
                <p>We could not load your courses.</p>
                <button type="button" className="slpt-btn slpt-btn-soft" onClick={retry}>
                  Try again
                </button>
              </div>
            )}

            {(coursesQuery.isPending || summariesPending) && (
              <div className="slpt-list" aria-busy="true" aria-label="Loading assignments">
                {[0, 1, 2].map((key) => (
                  <div key={key} className="slpt-card slpt-skeleton" />
                ))}
              </div>
            )}

            {coursesQuery.isSuccess && courses.length === 0 && (
              <div className="slpt-card slpt-state">
                <p>You are not enrolled in any courses yet.</p>
              </div>
            )}

            {ready && courses.length > 0 && !assignmentsKnown && summaryQuery.isError && (
              <div className="slpt-card slpt-state" role="alert">
                <p>We could not load your assignments.</p>
                <button type="button" className="slpt-btn slpt-btn-soft" onClick={retry}>
                  Try again
                </button>
              </div>
            )}

            {ready && assignmentsKnown && courses.length > 0 && visibleTasks.length === 0 && (
              <div className="slpt-card slpt-state">
                <p>No open assignments right now. Enjoy the breathing room.</p>
              </div>
            )}

            {ready && visibleTasks.length > 0 && (
              <ul className="slpt-list">
                {visibleTasks.map((task) => {
                  const info = dueInfo(task.due_at, now)
                  const submitted = Boolean(task.my_submission)
                  const tone = submitted ? 'later' : info.tone
                  const canSubmit = task.submissions_open !== false
                  return (
                    <li key={task.id} className={`slpt-card slpt-task is-${tone}`}>
                      <span className={`slpt-task-icon is-${tone}`}>{renderIcon(task.icon, 22)}</span>
                      <div className="slpt-task-main">
                        <div className="slpt-task-meta">
                          <span className="slpt-mono slpt-task-code">{task.course_code}</span>
                          <span className={`slpt-pill is-${tone}`}>{info.label}</span>
                          <span className="slpt-muted">Due {formatDue(task.due_at, now)}</span>
                        </div>
                        <h3 className="slpt-task-title">
                          <Link to={`/student/assignments/${task.id}`}>{task.title}</Link>
                        </h3>
                        <div className="slpt-task-facts slpt-mono">
                          <span className="slpt-inline">
                            {renderIcon('scale', 15)}
                            {Number(task.max_marks)} pts
                          </span>
                          {task.has_attachment && (
                            <span className="slpt-inline">
                              {renderIcon('attach_file', 15)}
                              {task.attachment_name || 'Attachment'}
                            </span>
                          )}
                          {submitted && (
                            <span className="slpt-chip">
                              {renderIcon('task_alt', 14)}
                              {sentenceCase(task.my_submission.status)}
                            </span>
                          )}
                          {!submitted && (
                            <span className="slpt-chip is-quiet">
                              {renderIcon('pending', 14)}
                              Not Submitted
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="slpt-task-action">
                        {canSubmit ? (
                          <button
                            type="button"
                            className={`slpt-btn ${!submitted && tone === 'urgent' ? 'slpt-btn-primary' : 'slpt-btn-soft'}`}
                            onClick={() => setActiveTask(task)}
                          >
                            {renderIcon(submitted ? 'edit' : 'file_upload', 18)}
                            {submitted ? 'Replace Submission' : 'Upload Submission'}
                          </button>
                        ) : (
                          <Link to={`/student/assignments/${task.id}`} className="slpt-btn slpt-btn-soft">
                            {renderIcon('visibility', 18)}
                            View Brief
                          </Link>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>

        <aside className="slpt-col" aria-label="Today at a glance">
          <section className="slpt-card slpt-panel" aria-labelledby="slpt-schedule-title">
            <div className="slpt-panel-head">
              <div>
                <p className="slpt-eyebrow">Live Timetable</p>
                <h2 id="slpt-schedule-title" className="slpt-h3">
                  Today&apos;s Schedule · {weekday}
                </h2>
              </div>
              <span className="slpt-round">{renderIcon('calendar_today', 18)}</span>
            </div>
          {timetableQuery.isLoading && <p className="slpt-empty">Loading classes for today…</p>}
{timetableQuery.isError && <p className="slpt-empty">We could not load classes for today right now.</p>}
{timetableQuery.isSuccess && todayClasses.length === 0 && (
  <p className="slpt-empty">No classes are scheduled for today.</p>
)}
{todayClasses.length > 0 && (
  <ul>
    {todayClasses.map((entry) => (
      <li key={`${entry.entry_id}-${entry.date}`}>
        <strong>{String(entry.start_time).slice(0, 5)} – {String(entry.end_time).slice(0, 5)}</strong>{' '}
        {entry.course_code}{entry.room ? ` · ${entry.room}` : ''}
      </li>
    ))}
  </ul>
)}  
          </section>

          <section className="slpt-card slpt-panel" aria-labelledby="slpt-attendance-title">
            <div className="slpt-panel-head">
              <div>
                <p className="slpt-eyebrow is-secondary">Statutory Check</p>
                <h2 id="slpt-attendance-title" className="slpt-h3">
                  Attendance Gauge
                </h2>
              </div>
              <span className="slpt-pill slpt-mono">&gt; 75% Req.</span>
            </div>
            <div className="slpt-gauge">
  <div className="slpt-ring" aria-hidden="true">
    <svg viewBox="0 0 36 36">
      <circle cx="18" cy="18" r="15.9155" fill="none" strokeWidth="3.5" className="slpt-ring-track" />
      {overallPct != null && (
        <circle
          cx="18"
          cy="18"
          r="15.9155"
          fill="none"
          strokeWidth="3.5"
          strokeLinecap="round"
          className={`slpt-ring-fill ${overallPct < 75 ? 'is-low' : ''}`}
          strokeDasharray={`${Math.min(overallPct, 100)} 100`}
        />
      )}
    </svg>
    <span className="slpt-mono">{overallPct == null ? '—' : `${overallPct}%`}</span>
  </div>
  <div>
    {dashboardQuery.isLoading && <p className="slpt-gauge-title">Loading attendance…</p>}
    {dashboardQuery.isError && <p className="slpt-gauge-title">Attendance unavailable</p>}
    {dashboardQuery.isSuccess && overallPct == null && (
      <>
        <p className="slpt-gauge-title">No sessions recorded yet</p>
        <p className="slpt-muted">Your attendance appears once a lecturer marks a session.</p>
      </>
    )}
    {overallPct != null && (
      <>
        <p className="slpt-gauge-title">
          {overallPct >= 75 ? 'Good standing' : 'Below the 75% minimum'}
        </p>
        <p className="slpt-muted">
          {totalAttended} of {totalCounted} counted sessions attended
        </p>
      </>
    )}
  </div>
</div>
{courses.length > 0 && (
  <ul className="slpt-bars">
    {courses.map((course) => {
      const row = attendanceByCourse[course.id]
      const pct = row?.attendance_pct ?? null
      return (
        <li key={course.id}>
          <div className="slpt-bar-row">
            <span>
              {course.course_code} {course.course_name}
            </span>
            <span className="slpt-mono slpt-muted">{pct == null ? '—' : `${pct}%`}</span>
          </div>
          <div className="slpt-bar-track">
            {pct != null && (
              <div
                className={`slpt-bar-fill ${pct < 75 ? 'is-low' : ''}`}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            )}
          </div>
        </li>
      )
    })}
  </ul>
)}
          </section>

          <section className="slpt-card slpt-panel" aria-labelledby="slpt-notices-title">
            <div className="slpt-panel-head">
              <div className="slpt-inline">
                <span className="slpt-accent-primary">{renderIcon('campaign', 20)}</span>
                <h2 id="slpt-notices-title" className="slpt-h3">
                  Department Notices
                </h2>
              </div>
              <Link to="/student/announcements" className="slpt-link-sm">
                All
              </Link>
            </div>
            <p className="slpt-empty">Announcements from your lecturers will appear here once they go live (Phase 7).</p>
          </section>

          <section className="slpt-card slpt-panel" aria-labelledby="slpt-feed-title">
            <div className="slpt-panel-head">
              <h2 id="slpt-feed-title" className="slpt-h3">
                Activity Stream
              </h2>
              <span className="slpt-outline">{renderIcon('history', 18)}</span>
            </div>
            {notificationsQuery.isPending && <div className="slpt-skeleton slpt-skeleton-sm" aria-busy="true" />}
            {feedMissing && (
              <p className="slpt-empty">Activity updates will appear here once notifications go live (Phase 7).</p>
            )}
            {notificationsQuery.isError && !feedMissing && (
              <p className="slpt-empty">The activity feed is unavailable right now.</p>
            )}
            {notifications && notifications.length === 0 && <p className="slpt-empty">You&apos;re all caught up.</p>}
            {notifications && notifications.length > 0 && (
              <ul className="slpt-feed">
                {notifications.slice(0, FEED_LIMIT).map((item, index) => (
                  <li key={item.id ?? index}>
                    <span className={`slpt-dot is-${FEED_DOTS[index % FEED_DOTS.length]}`} aria-hidden="true" />
                    <div>
                      <p className="slpt-feed-title">{item.title || item.message}</p>
                      <p className="slpt-feed-time">{timeAgo(item.created_at, now)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {activeTask && <SubmitModal task={activeTask} now={now} onClose={closeModal} />}
    </div>
  )
}

export default StudentDashboard

const STYLES = `
.slpt {
  --primary: #a03223;
  --on-primary: #ffffff;
  --primary-container: #c14a38;
  --on-primary-container: #fff5f3;
  --primary-fixed: #ffdad4;
  --secondary: #9e3e49;
  --secondary-container: #fd8892;
  --tertiary: #933f28;
  --error: #ba1a1a;
  --error-container: #ffdad6;
  --on-error-container: #93000a;
  --surface: #fef7ff;
  --surface-low: #faf0fe;
  --surface-mid: #f4ebf8;
  --surface-high: #eee5f2;
  --surface-highest: #e8dfec;
  --surface-lowest: #ffffff;
  --on-surface: #1e1a23;
  --on-surface-variant: #58413e;
  --outline: #8b716d;
  --outline-variant: #dfbfba;
  font-family: 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: var(--on-surface);
  line-height: 1.5;
  text-align: left;
  -webkit-font-smoothing: antialiased;
  width: 100%;
}
.slpt *, .slpt *::before, .slpt *::after { box-sizing: border-box; }
/* :where() keeps the reset at low specificity so the class rules below can override it */
.slpt :where(h1, h2, h3, p, ul, ol) { margin: 0; padding: 0; }
.slpt :where(ul, ol) { list-style: none; }
.slpt a { color: inherit; text-decoration: none; }
.slpt button, .slpt input { font-family: inherit; }
.slpt .material-symbols-outlined {
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
.slpt a:focus-visible, .slpt button:focus-visible, .slpt input:focus-visible {
  outline: 3px solid var(--primary-container);
  outline-offset: 3px;
  border-radius: 8px;
}
.slpt-mono { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; }
.slpt-muted { color: var(--on-surface-variant); font-size: 13px; line-height: 18px; }
.slpt-outline { color: var(--outline); display: inline-flex; }
.slpt-inline { display: inline-flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.slpt-accent-primary { color: var(--primary); }
.slpt-accent-secondary { color: var(--secondary); }
.slpt-error-text { color: var(--error); }

/* Greeting */
.slpt-greeting { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.75rem; }
.slpt-h1 { font-size: 32px; line-height: 40px; font-weight: 700; letter-spacing: -0.02em; }
.slpt-sub { font-size: 14px; line-height: 22px; color: var(--on-surface-variant); }

.slpt-notice {
  margin-top: 1rem; display: flex; align-items: center; gap: 0.5rem; padding: 0.625rem 0.875rem;
  border-radius: 12px; background: var(--surface-low); color: var(--on-surface);
  font-size: 13px; line-height: 18px; font-weight: 600;
}
.slpt-notice .material-symbols-outlined:first-child { color: var(--primary); }
.slpt-notice span { flex: 1 1 auto; }

/* KPI cards */
.slpt-kpis { margin-top: 1.5rem; display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; }
.slpt-kpi {
  border-radius: 16px; background: var(--surface-lowest); padding: 1rem;
  box-shadow: 0 1px 3px rgba(30, 26, 35, 0.08);
  display: flex; flex-direction: column; justify-content: space-between; gap: 1rem;
  transition: transform 0.3s, box-shadow 0.3s;
}
.slpt-kpi:hover { transform: translateY(-4px); box-shadow: 0 10px 24px rgba(30, 26, 35, 0.12); }
.slpt-kpi-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; min-height: 40px; }
.slpt-kpi-icon {
  width: 40px; height: 40px; border-radius: 12px; color: var(--primary);
  display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
}
.slpt-kpi-icon.is-mid { background: var(--surface-mid); }
.slpt-kpi-icon.is-fixed { background: var(--primary-fixed); }
.slpt-kpi-icon.is-low { background: var(--surface-low); color: var(--tertiary); }
.slpt-kpi-icon.is-highest { background: var(--surface-highest); color: var(--secondary); }
.slpt-kpi-body { display: flex; flex-direction: column; gap: 0.25rem; }
.slpt-kpi-value { font-size: 32px; line-height: 40px; font-weight: 700; letter-spacing: -0.02em; }
.slpt-kpi-value.is-danger { color: var(--primary); }
.slpt-kpi-unit { margin-left: 0.25rem; font-size: 14px; font-weight: 600; color: var(--outline); letter-spacing: 0; }
.slpt-kpi-foot {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; min-height: 36px;
  font-size: 13px; line-height: 18px; color: var(--on-surface-variant);
}
.slpt-kpi-foot > :first-child { min-width: 0; }
.slpt-kpi-foot .slpt-mono { font-size: 11px; line-height: 14px; font-weight: 600; text-align: right; max-width: 55%; padding-top: 2px; }

.slpt-pill {
  display: inline-flex; align-items: center; padding: 2px 10px; border-radius: 999px;
  background: var(--surface-high); color: var(--on-surface-variant);
  font-size: 11px; line-height: 16px; font-weight: 600; letter-spacing: 0.02em; white-space: nowrap;
}
.slpt-pill.is-error { background: var(--error-container); color: var(--on-error-container); }
.slpt-pill.is-urgent { background: var(--primary); color: var(--on-primary); font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.slpt-pill.is-soon { background: var(--surface-high); color: var(--on-surface); font-weight: 700; text-transform: uppercase; }
.slpt-pill.is-later { background: var(--surface-mid); color: var(--on-surface-variant); }

/* Two-column layout */
.slpt-grid { margin-top: 2rem; display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.slpt-col { display: flex; flex-direction: column; gap: 1.5rem; min-width: 0; }
.slpt-section-head { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 1rem; }
.slpt-h2 { font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em; }
.slpt-h3 { font-size: 18px; line-height: 26px; font-weight: 600; letter-spacing: -0.005em; }
.slpt-link { font-size: 12px; line-height: 16px; font-weight: 600; color: var(--primary); letter-spacing: 0.02em; }
.slpt-link:hover, .slpt-link-sm:hover { text-decoration: underline; }
.slpt-link-sm { font-size: 11px; line-height: 14px; font-weight: 600; color: var(--primary); }

.slpt-card {
  border-radius: 16px; background: var(--surface-lowest); padding: 1rem;
  box-shadow: 0 1px 3px rgba(30, 26, 35, 0.08);
}
.slpt-list { display: flex; flex-direction: column; gap: 0.5rem; }
.slpt-skeleton { min-height: 92px; background: linear-gradient(90deg, var(--surface-mid), var(--surface-low), var(--surface-mid)); background-size: 200% 100%; animation: slpt-shimmer 1.4s linear infinite; }
.slpt-skeleton-sm { min-height: 56px; border-radius: 12px; }
@keyframes slpt-shimmer { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .slpt-skeleton { animation: none; } .slpt-kpi { transition: none; } .slpt-kpi:hover { transform: none; } }
.slpt-state { display: flex; flex-direction: column; align-items: flex-start; gap: 0.75rem; font-size: 14px; color: var(--on-surface-variant); }

/* Assignment cards */
.slpt-task {
  position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 1rem; padding: 1rem 1rem 1rem 1.5rem;
}
.slpt-task::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: var(--outline-variant); }
.slpt-task.is-urgent::before { background: var(--primary); }
.slpt-task.is-soon::before { background: var(--secondary-container); }
.slpt-task-icon {
  width: 40px; height: 40px; border-radius: 12px; display: none; align-items: center; justify-content: center;
  background: var(--surface-mid); color: var(--tertiary); flex: 0 0 auto;
}
.slpt-task-icon.is-urgent { background: var(--primary-fixed); color: var(--primary); }
.slpt-task-icon.is-soon { background: var(--surface-high); color: var(--secondary); }
.slpt-task-main { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; flex: 1 1 auto; }
.slpt-task-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 0.25rem 0.5rem; font-size: 13px; line-height: 18px; }
.slpt-task-meta .slpt-muted { font-size: 13px; }
.slpt-task-code { font-size: 11px; font-weight: 700; color: var(--primary); }
.slpt-task-title { font-size: 16px; line-height: 24px; font-weight: 600; }
.slpt-task-title a:hover { text-decoration: underline; }
.slpt-task-facts { display: flex; align-items: center; flex-wrap: wrap; gap: 0.25rem 1rem; font-size: 11px; line-height: 16px; color: var(--on-surface-variant); }
.slpt-task-facts .slpt-inline { gap: 0.25rem; flex-wrap: nowrap; }
.slpt-task-facts .material-symbols-outlined { color: var(--tertiary); }
.slpt-chip {
  display: inline-flex; align-items: center; gap: 0.25rem; padding: 2px 8px; border-radius: 6px;
  background: var(--surface-mid); color: var(--on-surface-variant);
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif; font-size: 11px; line-height: 14px; font-weight: 600;
}
.slpt-chip.is-quiet { background: var(--surface-low); color: var(--outline); }
.slpt-chip .material-symbols-outlined { color: inherit; }
.slpt-task-action { display: flex; flex: 0 0 auto; }

.slpt-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.375rem; border: 0; cursor: pointer;
  padding: 10px 16px; border-radius: 999px; font-size: 12px; line-height: 16px; font-weight: 600; letter-spacing: 0.02em;
  transition: background 0.2s, box-shadow 0.2s; white-space: nowrap;
}
.slpt-btn-primary { background: var(--primary-container); color: var(--on-primary-container); box-shadow: 0 1px 3px rgba(30, 26, 35, 0.2); }
.slpt-btn-primary:hover:not(:disabled) { background: var(--primary); }
.slpt-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.slpt-btn-soft { background: var(--surface-low); color: var(--on-surface); }
.slpt-btn-soft:hover { background: var(--surface-high); }
.slpt-btn-plain { background: var(--surface-mid); color: var(--on-surface); }
.slpt-btn-plain:hover { background: var(--surface-high); }
.slpt-icon-btn {
  width: 32px; height: 32px; border: 0; border-radius: 999px; background: var(--surface-mid); color: var(--outline);
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex: 0 0 auto;
}
.slpt-icon-btn:hover { color: var(--on-surface); }

/* Side panels */
.slpt-panel { display: flex; flex-direction: column; gap: 1rem; }
.slpt-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
.slpt-eyebrow { font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--primary); }
.slpt-eyebrow.is-secondary { color: var(--secondary); }
.slpt-round {
  width: 32px; height: 32px; border-radius: 999px; background: var(--surface-mid); color: var(--on-surface-variant);
  display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
}
.slpt-empty { padding: 0.75rem; border-radius: 12px; background: var(--surface-low); font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpt-gauge { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; border-radius: 12px; background: var(--surface-low); }
.slpt-gauge-title { font-size: 12px; line-height: 16px; font-weight: 700; }
.slpt-ring { position: relative; width: 56px; height: 56px; display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.slpt-ring svg { width: 56px; height: 56px; transform: rotate(-90deg); }
.slpt-ring-track { stroke: var(--surface-high); }
.slpt-ring .slpt-mono { position: absolute; font-size: 11px; font-weight: 700; }
.slpt-bars { display: flex; flex-direction: column; gap: 0.5rem; }
.slpt-bar-row { display: flex; justify-content: space-between; gap: 0.5rem; font-size: 11px; line-height: 14px; font-weight: 500; }
.slpt-bar-row .slpt-muted { font-size: 11px; line-height: 14px; }
.slpt-bar-track { margin-top: 4px; height: 6px; border-radius: 999px; background: var(--surface-mid); }
.slpt-ring-fill { stroke: var(--primary); }
.slpt-ring-fill.is-low { stroke: var(--error, #b3261e); }
.slpt-bar-track { overflow: hidden; }
.slpt-bar-fill { height: 100%; border-radius: 999px; background: var(--primary); }
.slpt-bar-fill.is-low { background: var(--error, #b3261e); }
.slpt-feed { display: flex; flex-direction: column; gap: 0.25rem; }
.slpt-feed li { display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.5rem 0; }
.slpt-dot { width: 8px; height: 8px; margin-top: 7px; border-radius: 999px; background: var(--primary); flex: 0 0 auto; }
.slpt-dot.is-tertiary { background: var(--tertiary); }
.slpt-dot.is-secondary { background: var(--secondary); }
.slpt-feed-title { font-size: 13px; line-height: 18px; font-weight: 500; }
.slpt-feed-time { font-size: 11px; line-height: 14px; color: var(--outline); }

/* Submission modal */
.slpt-overlay {
  position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center;
  padding: 1rem; background: rgba(51, 47, 56, 0.4); backdrop-filter: blur(4px);
}
.slpt-modal {
  width: 100%; max-width: 576px; max-height: calc(100vh - 2rem); overflow-y: auto; border-radius: 16px;
  background: var(--surface-lowest); padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem;
  box-shadow: 0 24px 48px rgba(30, 26, 35, 0.25);
}
.slpt-modal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; }
.slpt-code { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 14px; font-weight: 700; color: var(--primary); }
.slpt-modal-title { margin-top: 2px; font-size: 20px; line-height: 28px; font-weight: 700; letter-spacing: -0.01em; }
.slpt-modal-due {
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;
  padding: 0.5rem 0.75rem; border-radius: 12px; background: var(--surface-low); font-size: 13px; color: var(--on-surface-variant);
}
.slpt-modal-due .material-symbols-outlined { color: var(--primary); }
.slpt-drop {
  display: flex; flex-direction: column; align-items: center; text-align: center; gap: 0.5rem; padding: 2rem 1rem;
  border-radius: 16px; background: var(--surface-lowest); box-shadow: inset 0 0 0 2px var(--surface-high);
  transition: background 0.2s;
}
.slpt-drop.is-drag { background: var(--surface-low); box-shadow: inset 0 0 0 2px var(--primary-container); }
.slpt-drop-icon {
  width: 56px; height: 56px; border-radius: 16px; background: var(--primary-fixed); color: var(--primary);
  display: inline-flex; align-items: center; justify-content: center;
}
.slpt-drop-title { font-size: 16px; line-height: 24px; font-weight: 600; overflow-wrap: anywhere; }
.slpt-file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.slpt-alert { padding: 0.5rem 0.75rem; border-radius: 12px; background: var(--error-container); color: var(--on-error-container); font-size: 13px; line-height: 18px; font-weight: 600; }
.slpt-pledge { display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.75rem; border-radius: 12px; background: var(--surface-low); }
.slpt-pledge input { margin-top: 3px; width: 16px; height: 16px; accent-color: var(--primary); flex: 0 0 auto; }
.slpt-pledge label { font-size: 13px; line-height: 18px; color: var(--on-surface-variant); cursor: pointer; }
.slpt-modal-actions { display: flex; align-items: center; justify-content: flex-end; gap: 0.5rem; padding-top: 0.5rem; }

@media (min-width: 640px) {
  .slpt-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 768px) {
  .slpt-task { flex-direction: row; align-items: center; justify-content: space-between; }
  .slpt-task-icon { display: inline-flex; align-self: flex-start; margin-top: 2px; }
}
@media (min-width: 1024px) {
  .slpt-grid { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
}
@media (min-width: 1280px) {
  .slpt-kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
`
