import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/apiClient.js'
import SubmitModal from '../../components/SubmitModal.jsx'
import {
  dueInfo,
  formatDate,
  formatDue,
  formatSemester,
  formatSize,
  sentenceCase,
  timeAgo,
  toList,
} from '../../utils/format.js'

/*
 * Smart Lecture Portal: student courses (catalogue + course detail)
 * Place at: src/pages/student/StudentCourses.jsx
 *
 * One page, two views, like the design:
 *   /student/courses            catalogue of enrolled courses
 *   /student/courses/:courseId  course detail with tabs (?tab=materials, assignments, marks ...)
 *
 * - Renders inside AppShell, which already draws the sidebar and top bar.
 * - Self-contained: styles are scoped under `.slpc` and injected by this component.
 * - Real data only (SRS: no hard-coded figures). Endpoints used:
 *     GET  /courses                              enrolled courses
 *     GET  /courses/{id}                         course + lecturers
 *     GET  /courses/{id}/materials               published materials
 *     GET  /materials/{id}/download              signed download link
 *     GET  /courses/{id}/assignments             published assignments + my_submission
 *     GET  /assignments/{id}/attachment          signed download link
 *     POST /assignments/{id}/submissions         upload (shared SubmitModal)
 *     GET  /courses/{id}/marks/me                released marks and weighted percentage
 * - Attendance (Phase 6), announcements (Phase 7) and the timetable (Phase 8) have no
 *   API yet, so those tabs say so instead of inventing data.
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

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'dashboard' },
  { id: 'materials', label: 'Materials', icon: 'folder_open' },
  { id: 'assignments', label: 'Assignments', icon: 'assignment' },
  { id: 'attendance', label: 'Attendance', icon: 'how_to_reg' },
  { id: 'marks', label: 'Marks & Results', icon: 'analytics' },
  { id: 'announcements', label: 'Announcements', icon: 'campaign' },
  { id: 'timetable', label: 'Timetable', icon: 'event_note' },
]

const CATEGORY_LABELS = {
  lecture_notes: 'Lecture Notes',
  slides: 'Lecture Slides',
  reading: 'Reading',
  lab: 'Lab Worksheets',
  past_paper: 'Past Papers',
  other: 'Other',
}

const SUBMISSION_LABELS = { submitted: 'Submitted', late: 'Submitted late', graded: 'Graded', returned: 'Returned' }
const AVATAR_TONES = ['primary', 'tertiary', 'secondary']
const STREAM_LIMIT = 5

// Same query key as AppShell and the dashboard, so the course list is fetched once and shared.
const COURSES_KEY = ['courses', 'assigned']
const fetchCourses = () => api('/courses?page_size=100')

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

function countOf(data) {
  return typeof data?.total === 'number' ? data.total : toList(data).length
}

function initials(name) {
  const letters = String(name ?? '')
    .split(/\s+/)
    .filter((word) => /^[A-Za-z]/.test(word) && !/^(dr|prof|mr|mrs|ms)\.?$/i.test(word))
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('')
  return letters || '•'
}

function trimNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? String(+number.toFixed(1)) : ''
}

function courseTitle(course) {
  return `${course.course_code}: ${course.course_name}`
}

// A signed link comes back from the API; open it in a new tab.
async function openSignedLink(path) {
  const data = await api(path)
  const link = document.createElement('a')
  link.href = data.url
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  if (data.file_name) link.download = data.file_name
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function useDownloads() {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const start = async (key, path) => {
    setBusy(key)
    setError('')
    try {
      await openSignedLink(path)
    } catch (caught) {
      setError(caught?.message || 'The download could not be started. Please try again.')
    } finally {
      setBusy('')
    }
  }
  return { busy, error, start }
}

function useClock() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [])
  return now
}

function Skeleton({ height = 92, label }) {
  return <div className="slpc-card slpc-skeleton" style={{ minHeight: height }} aria-busy="true" aria-label={label} />
}

function ErrorCard({ message, onRetry, children }) {
  return (
    <div className="slpc-card slpc-state" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="slpc-btn slpc-btn-soft" onClick={onRetry}>
          Try again
        </button>
      )}
      {children}
    </div>
  )
}

function TopBar({ trail, courseCount, activeCode }) {
  return (
    <div className="slpc-topbar">
      <nav className="slpc-trail" aria-label="Course breadcrumb">
        <Link to="/student" className="slpc-trail-link">
          {renderIcon('school', 16)}
          <span>Dashboard</span>
        </Link>
        {trail.map((item) => (
          <span key={item.label} className="slpc-trail-item">
            <span className="slpc-trail-sep" aria-hidden="true">
              /
            </span>
            {item.to ? (
              <Link to={item.to} className="slpc-trail-link">
                {item.label}
              </Link>
            ) : (
              <span className={item.strong ? 'slpc-trail-current' : 'slpc-trail-title'}>{item.label}</span>
            )}
          </span>
        ))}
      </nav>
      <div className="slpc-switch" role="group" aria-label="View">
        <Link to="/student/courses" className={`slpc-switch-btn ${activeCode ? '' : 'is-active'}`}>
          {renderIcon('grid_view', 18)}
          <span>All Enrolled Courses</span>
          {typeof courseCount === 'number' && <span className="slpc-count">{courseCount}</span>}
        </Link>
        {activeCode && (
          <span className="slpc-switch-btn is-active" aria-current="page">
            {renderIcon('auto_stories', 18)}
            <span>Course Detail View: {activeCode}</span>
          </span>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ catalogue */

function Catalog() {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('code')

  const coursesQuery = useQuery({ queryKey: COURSES_KEY, queryFn: fetchCourses })
  const courses = useMemo(() => toList(coursesQuery.data), [coursesQuery.data])

  // Lecturer name and department come from the course detail; a failure only blanks that line.
  const detailQueries = useQueries({
    queries: courses.map((course) => ({
      queryKey: ['course', course.id],
      queryFn: () => api(`/courses/${course.id}`),
      staleTime: 60_000,
    })),
  })
  const details = {}
  courses.forEach((course, index) => {
    details[course.id] = detailQueries[index]?.data ?? null
  })

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const list = courses.filter(
      (course) =>
        !needle ||
        String(course.course_code).toLowerCase().includes(needle) ||
        String(course.course_name).toLowerCase().includes(needle),
    )
    return list.sort((a, b) =>
      sort === 'credits'
        ? (Number(b.credit_hours) || 0) - (Number(a.credit_hours) || 0)
        : String(a.course_code).localeCompare(String(b.course_code)),
    )
  }, [courses, search, sort])

  return (
    <>
      <TopBar
        trail={[{ label: 'My Courses', strong: true }]}
        courseCount={coursesQuery.isSuccess ? courses.length : undefined}
      />

      <section className="slpc-stack" aria-labelledby="slpc-catalog-title">
        <div className="slpc-card slpc-filter">
          <div>
            <h1 id="slpc-catalog-title" className="slpc-h2">
              My Enrolled Courses
            </h1>
            <p className="slpc-muted">
              {coursesQuery.isSuccess
                ? `Showing ${visible.length} of ${courses.length} active ${courses.length === 1 ? 'course' : 'courses'}`
                : 'Your active modules for this session'}
            </p>
          </div>
          <div className="slpc-filter-controls">
            <label className="slpc-search">
              {renderIcon('search', 18)}
              <input
                type="search"
                value={search}
                maxLength={100}
                placeholder="Filter courses by code or title..."
                aria-label="Filter courses by code or title"
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <select
              className="slpc-select"
              value={sort}
              aria-label="Sort courses"
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="code">Course Code (A-Z)</option>
              <option value="credits">Credit Hours (High to Low)</option>
            </select>
          </div>
        </div>

        {coursesQuery.isPending && (
          <div className="slpc-grid-cards" aria-busy="true" aria-label="Loading courses">
            {[0, 1, 2, 3].map((key) => (
              <Skeleton key={key} height={190} />
            ))}
          </div>
        )}

        {coursesQuery.isError && (
          <ErrorCard message="We could not load your courses." onRetry={() => coursesQuery.refetch()} />
        )}

        {coursesQuery.isSuccess && courses.length === 0 && (
          <div className="slpc-card slpc-state">
            <p>You are not enrolled in any courses yet.</p>
          </div>
        )}

        {coursesQuery.isSuccess && courses.length > 0 && visible.length === 0 && (
          <div className="slpc-card slpc-state">
            <p>No courses match your search.</p>
          </div>
        )}

        {visible.length > 0 && (
          <ul className="slpc-grid-cards">
            {visible.map((course, index) => {
              const lecturer = details[course.id]?.lecturers?.[0]
              return (
                <li key={course.id}>
                  <Link to={`/student/courses/${course.id}`} className={`slpc-card slpc-course ${index === 0 ? 'is-first' : ''}`}>
                    <div>
                      <div className="slpc-course-top">
                        <span className={`slpc-pill ${index === 0 ? 'is-primary' : ''}`}>
                          {Number(course.credit_hours) || 0} Credits
                        </span>
                        <span className="slpc-mono slpc-muted">{lecturer?.department ?? ''}</span>
                      </div>
                      <h2 className="slpc-course-title">{courseTitle(course)}</h2>
                      <p className="slpc-clamp">{course.description || 'No description has been published yet.'}</p>
                    </div>
                    <div className="slpc-course-foot">
                      {lecturer && (
                        <span className="slpc-person">
                          <span className={`slpc-avatar-sm is-${AVATAR_TONES[index % AVATAR_TONES.length]}`}>
                            {initials(lecturer.full_name)}
                          </span>
                          <span>{[lecturer.title, lecturer.full_name].filter(Boolean).join(' ')}</span>
                        </span>
                      )}
                      <span className="slpc-course-meta">
                        <span>
                          {formatSemester(course.semester)} • {course.academic_year}
                        </span>
                        <span className="slpc-open">
                          Open Course
                          {renderIcon('arrow_forward', 14)}
                        </span>
                      </span>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}

/* ------------------------------------------------------------ detail: panels */

function PhasePanel({ icon, title, phase, children }) {
  return (
    <section className="slpc-card slpc-phase" aria-label={title}>
      <span className="slpc-phase-icon">{renderIcon(icon, 28)}</span>
      <h2 className="slpc-h2">{title}</h2>
      <p className="slpc-muted">{children}</p>
      <span className="slpc-pill">Coming in {phase}</span>
    </section>
  )
}

function StatCard({ label, icon, tone, children, foot }) {
  return (
    <div className="slpc-card slpc-stat">
      <div className="slpc-stat-top">
        <span className="slpc-stat-label">{label}</span>
        <span className={`slpc-stat-icon is-${tone}`}>{renderIcon(icon, 18)}</span>
      </div>
      <div className="slpc-stat-body">{children}</div>
      <div className="slpc-stat-foot">{foot}</div>
    </div>
  )
}

function OverviewPanel({ data, now, selectTab }) {
  const { materials, assignments, marks, materialsQuery, assignmentsQuery, marksQuery } = data
  const open = assignments.filter((item) => item.state === 'open')
  const pending = open.filter((item) => !item.my_submission)
  const graded = assignments.filter((item) => ['graded', 'returned'].includes(item.my_submission?.status)).length
  const submitted = assignments.filter((item) => ['submitted', 'late'].includes(item.my_submission?.status)).length
  const unsubmitted = assignments.filter((item) => item.state === 'open' && !item.my_submission).length
  const newest = [...materials].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
  const percent = marks?.totals?.weighted_percent
  const hasPercent = typeof percent === 'number'

  const stream = []
  pending
    .sort((a, b) => new Date(a.due_at) - new Date(b.due_at))
    .slice(0, 2)
    .forEach((item) => {
      const info = dueInfo(item.due_at, now)
      stream.push({
        key: `due-${item.id}`,
        icon: 'alarm',
        tone: 'tertiary',
        title: `Approaching Deadline: ${item.title}`,
        when: info.label,
        urgent: info.tone === 'urgent',
        text: `Due ${formatDue(item.due_at, now)}. ${item.submissions_open === false ? '' : 'Submission is open.'}`.trim(),
        action: 'Jump to Upload Panel',
        tab: 'assignments',
      })
    })
  materials
    .filter((item) => item !== undefined)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 2)
    .forEach((item) => {
      stream.push({
        key: `mat-${item.id}`,
        icon: 'upload_file',
        tone: 'primary',
        title: `New Material: ${item.title}`,
        when: timeAgo(item.created_at, now),
        text: item.description || `${item.uploader_name || 'Your lecturer'} shared ${item.file_name}.`,
        action: 'View & Download',
        tab: 'materials',
      })
    })
  toList(marks?.items)
    .filter((item) => typeof item.mark === 'number')
    .slice(0, 2)
    .forEach((item) => {
      stream.push({
        key: `mark-${item.assessment_id}`,
        icon: 'verified',
        tone: 'ok',
        title: `Marks Released: ${item.name}`,
        when: '',
        text: `Score: ${trimNumber(item.mark)} / ${trimNumber(item.max_marks)}.${item.feedback ? ` Faculty remarks: "${item.feedback}"` : ''}`,
        action: 'Review Detailed Marks',
        tab: 'marks',
      })
    })
  const visibleStream = stream.slice(0, STREAM_LIMIT)
  const streamLoading = [materialsQuery, assignmentsQuery, marksQuery].some((query) => query.isPending)
  const streamFailed = [materialsQuery, assignmentsQuery, marksQuery].every((query) => query.isError)

  return (
    <div className="slpc-stack">
      <div className="slpc-stats">
        <StatCard
          label="Published Materials"
          icon="folder"
          tone="mid"
          foot={
            <>
              <span>{newest ? `Last added ${timeAgo(newest.created_at, now)}` : 'Nothing published yet'}</span>
              <button type="button" className="slpc-link-btn" onClick={() => selectTab('materials')}>
                Explore
              </button>
            </>
          }
        >
          <span className="slpc-stat-value">{materialsQuery.isSuccess ? countOf(materialsQuery.data) : '—'}</span>
          <span className="slpc-stat-unit">Curated Files</span>
        </StatCard>

        <StatCard
          label="Assignments"
          icon="assignment"
          tone="warm"
          foot={
            assignmentsQuery.isSuccess ? (
              <span className="slpc-chips">
                <span className="slpc-chip is-ok">{graded} Graded</span>
                <span className="slpc-chip is-info">{submitted} Submitted</span>
                <span className="slpc-chip is-warn">{unsubmitted} Pending</span>
              </span>
            ) : (
              <span>{assignmentsQuery.isError ? 'Could not load' : 'Loading…'}</span>
            )
          }
        >
          <span className="slpc-stat-value">{assignmentsQuery.isSuccess ? open.length : '—'}</span>
          <span className="slpc-stat-unit">Items Active</span>
        </StatCard>

        <StatCard
          label="Verified Attendance"
          icon="done_all"
          tone="ok"
          foot={<span>Available when attendance (Phase 6) goes live</span>}
        >
          <span className="slpc-stat-value">—</span>
        </StatCard>

        <StatCard
          label="Released Mark Summary"
          icon="grade"
          tone="fixed"
          foot={
            <>
              <span>
                {marksQuery.isError && 'Could not load'}
                {marksQuery.isPending && 'Loading…'}
                {marksQuery.isSuccess &&
                  `Weight marked: ${trimNumber(marks?.totals?.weight_graded ?? 0)}% of ${trimNumber(marks?.totals?.weight_published ?? 0)}%`}
              </span>
              <button type="button" className="slpc-link-btn" onClick={() => selectTab('marks')}>
                Full Transcript
              </button>
            </>
          }
        >
          <span className="slpc-stat-value">{hasPercent ? `${trimNumber(percent)}%` : '—'}</span>
          {marksQuery.isSuccess && !hasPercent && <span className="slpc-stat-unit">None released</span>}
        </StatCard>
      </div>

      <div className="slpc-split">
        <section className="slpc-card slpc-panel" aria-labelledby="slpc-stream-title">
          <div className="slpc-panel-head">
            <div className="slpc-inline">
              <span className="slpc-accent">{renderIcon('notifications_active', 20)}</span>
              <h2 id="slpc-stream-title" className="slpc-h3">
                Recent Course Stream
              </h2>
            </div>
            <span className="slpc-muted">Updates from this course</span>
          </div>

          {streamLoading && visibleStream.length === 0 && <div className="slpc-skeleton slpc-skeleton-sm" aria-busy="true" />}
          {streamFailed && <p className="slpc-empty">The course stream could not be loaded.</p>}
          {!streamLoading && !streamFailed && visibleStream.length === 0 && (
            <p className="slpc-empty">Nothing new in this course yet.</p>
          )}
          {visibleStream.length > 0 && (
            <ul className="slpc-stream">
              {visibleStream.map((item) => (
                <li key={item.key} className="slpc-event">
                  <span className={`slpc-event-icon is-${item.tone}`}>{renderIcon(item.icon, 16)}</span>
                  <div className="slpc-event-main">
                    <div className="slpc-event-head">
                      <span className="slpc-event-title">{item.title}</span>
                      {item.when && <span className={`slpc-event-when ${item.urgent ? 'is-urgent' : ''}`}>{item.when}</span>}
                    </div>
                    <p className="slpc-event-text">{item.text}</p>
                    <button type="button" className="slpc-event-action" onClick={() => selectTab(item.tab)}>
                      <span>{item.action}</span>
                      {renderIcon('arrow_forward', 14)}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="slpc-card slpc-panel" aria-labelledby="slpc-actions-title">
          <div className="slpc-inline">
            <span className="slpc-accent">{renderIcon('bolt', 20)}</span>
            <h2 id="slpc-actions-title" className="slpc-h3">
              Fast Actions
            </h2>
          </div>
          <div className="slpc-actions">
            <button type="button" className="slpc-action" onClick={() => selectTab('materials')}>
              <span className="slpc-inline">
                <span className="slpc-accent">{renderIcon('download', 18)}</span>
                Browse Course Materials
              </span>
              {renderIcon('chevron_right', 16)}
            </button>
            <button type="button" className="slpc-action" onClick={() => selectTab('assignments')}>
              <span className="slpc-inline">
                <span className="slpc-accent-warm">{renderIcon('cloud_upload', 18)}</span>
                <span className="slpc-action-text">{pending[0] ? `Submit ${pending[0].title}` : 'View Assignments'}</span>
              </span>
              {renderIcon('chevron_right', 16)}
            </button>
            <button type="button" className="slpc-action" onClick={() => selectTab('attendance')}>
              <span className="slpc-inline">
                <span className="slpc-accent-ok">{renderIcon('fact_check', 18)}</span>
                Check Attendance Record
              </span>
              {renderIcon('chevron_right', 16)}
            </button>
            <button type="button" className="slpc-action" onClick={() => selectTab('timetable')}>
              <span className="slpc-inline">
                <span className="slpc-accent">{renderIcon('schedule', 18)}</span>
                View Weekly Timetable
              </span>
              {renderIcon('chevron_right', 16)}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

function MaterialsPanel({ materials, query }) {
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const downloads = useDownloads()

  const categories = useMemo(() => {
    const counts = {}
    materials.forEach((item) => {
      counts[item.category] = (counts[item.category] ?? 0) + 1
    })
    return Object.entries(counts)
  }, [materials])

  const visible = materials.filter((item) => {
    const needle = search.trim().toLowerCase()
    return (
      (category === 'all' || item.category === category) &&
      (!needle || String(item.title).toLowerCase().includes(needle))
    )
  })

  return (
    <div className="slpc-stack">
      <div className="slpc-card slpc-filter">
        <div className="slpc-pills" role="group" aria-label="Filter by category">
          <button
            type="button"
            className={`slpc-filter-pill ${category === 'all' ? 'is-active' : ''}`}
            aria-pressed={category === 'all'}
            onClick={() => setCategory('all')}
          >
            All ({materials.length})
          </button>
          {categories.map(([key, count]) => (
            <button
              key={key}
              type="button"
              className={`slpc-filter-pill ${category === key ? 'is-active' : ''}`}
              aria-pressed={category === key}
              onClick={() => setCategory(key)}
            >
              {CATEGORY_LABELS[key] ?? sentenceCase(key)} ({count})
            </button>
          ))}
        </div>
        <label className="slpc-search">
          {renderIcon('search', 18)}
          <input
            type="search"
            value={search}
            maxLength={100}
            placeholder="Search materials by title..."
            aria-label="Search materials by title"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      {downloads.error && (
        <p className="slpc-alert" role="alert">
          {downloads.error}
        </p>
      )}

      {query.isPending && <Skeleton height={160} label="Loading materials" />}
      {query.isError && <ErrorCard message="We could not load the course materials." onRetry={() => query.refetch()} />}
      {query.isSuccess && materials.length === 0 && (
        <div className="slpc-card slpc-state">
          <p>No materials have been published for this course yet.</p>
        </div>
      )}
      {query.isSuccess && materials.length > 0 && visible.length === 0 && (
        <div className="slpc-card slpc-state">
          <p>No materials match your filter.</p>
        </div>
      )}

      {visible.length > 0 && (
        <div className="slpc-card slpc-table-card">
          <div className="slpc-table-scroll">
            <table className="slpc-table">
              <thead>
                <tr>
                  <th scope="col">Material</th>
                  <th scope="col">Category</th>
                  <th scope="col">File</th>
                  <th scope="col">Published</th>
                  <th scope="col">
                    <span className="slpc-visually-hidden">Download</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <span className="slpc-cell-title">{item.title}</span>
                      {item.description && <span className="slpc-cell-sub">{item.description}</span>}
                    </td>
                    <td>
                      <span className="slpc-pill">{CATEGORY_LABELS[item.category] ?? sentenceCase(item.category)}</span>
                    </td>
                    <td>
                      <span className="slpc-mono slpc-cell-file">{item.file_name}</span>
                      <span className="slpc-cell-sub">{formatSize(item.file_size)}</span>
                    </td>
                    <td className="slpc-nowrap">{formatDate(item.created_at)}</td>
                    <td className="slpc-right">
                      <button
                        type="button"
                        className="slpc-btn slpc-btn-soft"
                        disabled={downloads.busy === item.id}
                        aria-label={`Download ${item.title}`}
                        onClick={() => downloads.start(item.id, `/materials/${item.id}/download`)}
                      >
                        {renderIcon('download', 18)}
                        {downloads.busy === item.id ? 'Preparing…' : 'Download'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function AssignmentsPanel({ assignments, query, course, now, onUpload }) {
  const downloads = useDownloads()

  const ordered = useMemo(() => {
    const isOpen = (item) => item.state === 'open'
    return [...assignments].sort((a, b) => {
      if (isOpen(a) !== isOpen(b)) return isOpen(a) ? -1 : 1
      const diff = new Date(a.due_at) - new Date(b.due_at)
      return isOpen(a) ? diff : -diff
    })
  }, [assignments])

  return (
    <div className="slpc-stack">
      {downloads.error && (
        <p className="slpc-alert" role="alert">
          {downloads.error}
        </p>
      )}
      {query.isPending && <Skeleton height={140} label="Loading assignments" />}
      {query.isError && <ErrorCard message="We could not load the assignments." onRetry={() => query.refetch()} />}
      {query.isSuccess && assignments.length === 0 && (
        <div className="slpc-card slpc-state">
          <p>No assignments have been published for this course yet.</p>
        </div>
      )}

      {ordered.length > 0 && (
        <ul className="slpc-stack">
          {ordered.map((item) => {
            const submission = item.my_submission
            const info = dueInfo(item.due_at, now)
            const closed = item.state !== 'open'
            const tone = closed || submission ? 'later' : info.tone
            const released = submission?.grade_released && typeof submission.mark === 'number'
            return (
              <li key={item.id} className={`slpc-card slpc-assignment is-${tone}`}>
                <div className="slpc-assignment-main">
                  <div className="slpc-task-meta">
                    <span className="slpc-mono slpc-code">{course.course_code}</span>
                    <span className={`slpc-due is-${tone}`}>{closed ? 'Closed' : info.label}</span>
                    <span className="slpc-muted">Due {formatDue(item.due_at, now)}</span>
                  </div>
                  <h3 className="slpc-assignment-title">{item.title}</h3>
                  {item.description && <p className="slpc-clamp">{item.description}</p>}
                  <div className="slpc-facts slpc-mono">
                    <span className="slpc-inline-tight">
                      {renderIcon('scale', 15)}
                      {trimNumber(item.max_marks)} pts
                    </span>
                    {item.has_attachment && (
                      <button
                        type="button"
                        className="slpc-attach"
                        disabled={downloads.busy === item.id}
                        onClick={() => downloads.start(item.id, `/assignments/${item.id}/attachment`)}
                      >
                        {renderIcon('attach_file', 15)}
                        {item.attachment_name || 'Download brief'}
                      </button>
                    )}
                    <span className={`slpc-chip ${submission ? 'is-info' : 'is-quiet'}`}>
                      {renderIcon(submission ? 'task_alt' : 'pending', 14)}
                      {submission ? (SUBMISSION_LABELS[submission.status] ?? sentenceCase(submission.status)) : 'Not Submitted'}
                    </span>
                  </div>
                  {submission && (
                    <p className="slpc-muted">
                      {submission.file_name} · {formatSize(submission.file_size)} · {timeAgo(submission.submitted_at, now)}
                    </p>
                  )}
                  {released && (
                    <p className="slpc-score">
                      Score: <strong>{trimNumber(submission.mark)}</strong> / {trimNumber(item.max_marks)}
                      {submission.feedback ? ` · Faculty remarks: "${submission.feedback}"` : ''}
                    </p>
                  )}
                </div>
                <div className="slpc-assignment-action">
                  {item.submissions_open ? (
                    <button
                      type="button"
                      className={`slpc-btn ${!submission && tone === 'urgent' ? 'slpc-btn-primary' : 'slpc-btn-soft'}`}
                      onClick={() => onUpload({ ...item, course_code: course.course_code })}
                    >
                      {renderIcon(submission ? 'edit' : 'file_upload', 18)}
                      {submission ? 'Replace Submission' : 'Upload Submission'}
                    </button>
                  ) : (
                    !submission && <span className="slpc-muted">Submissions are closed</span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function MarksPanel({ marks, query }) {
  const items = toList(marks?.items)
  const totals = marks?.totals
  const percent = totals?.weighted_percent
  return (
    <div className="slpc-stack">
      {query.isPending && <Skeleton height={160} label="Loading marks" />}
      {query.isError && <ErrorCard message="We could not load your marks." onRetry={() => query.refetch()} />}
      {query.isSuccess && items.length === 0 && (
        <div className="slpc-card slpc-state">
          <p>No assessments have been released for this course yet.</p>
        </div>
      )}
      {query.isSuccess && items.length > 0 && (
        <>
          <div className="slpc-card slpc-marks-summary">
            <div>
              <p className="slpc-eyebrow">Weighted result</p>
              <p className="slpc-stat-value">{typeof percent === 'number' ? `${trimNumber(percent)}%` : '—'}</p>
            </div>
            <div className="slpc-marks-facts">
              <span>
                Raw marks: <strong>{trimNumber(totals?.marks_total)}</strong> / {trimNumber(totals?.max_total)}
              </span>
              <span>
                Weight marked: <strong>{trimNumber(totals?.weight_graded)}%</strong> of {trimNumber(totals?.weight_published)}%
              </span>
            </div>
          </div>
          <div className="slpc-card slpc-table-card">
            <div className="slpc-table-scroll">
              <table className="slpc-table">
                <thead>
                  <tr>
                    <th scope="col">Assessment</th>
                    <th scope="col">Weight</th>
                    <th scope="col">Max</th>
                    <th scope="col">Score</th>
                    <th scope="col">Percent</th>
                    <th scope="col">Feedback</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.assessment_id}>
                      <td>
                        <span className="slpc-cell-title">{item.name}</span>
                        <span className="slpc-cell-sub">{sentenceCase(item.type)}</span>
                      </td>
                      <td className="slpc-nowrap">{typeof item.weight === 'number' ? `${trimNumber(item.weight)}%` : '—'}</td>
                      <td className="slpc-nowrap">{trimNumber(item.max_marks)}</td>
                      <td className="slpc-nowrap">
                        {typeof item.mark === 'number' ? <strong>{trimNumber(item.mark)}</strong> : <span className="slpc-muted">Not marked yet</span>}
                      </td>
                      <td className="slpc-nowrap">{typeof item.percentage === 'number' ? `${trimNumber(item.percentage)}%` : '—'}</td>
                      <td>{item.feedback || <span className="slpc-muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* -------------------------------------------------------------- detail view */

function CourseDetail({ courseId }) {
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const now = useClock()
  const [activeTask, setActiveTask] = useState(null)
  const [notice, setNotice] = useState('')
  const tabRefs = useRef({})

  const requested = params.get('tab')
  const tab = TABS.some((item) => item.id === requested) ? requested : 'overview'
  const activeTab = TABS.find((item) => item.id === tab)

  const courseQuery = useQuery({
    queryKey: ['course', courseId],
    queryFn: () => api(`/courses/${courseId}`),
    // A missing or forbidden course will not appear by retrying; only server errors are retried.
    retry: (failures, error) => error?.status >= 500 && failures < 2,
  })
  const coursesQuery = useQuery({ queryKey: COURSES_KEY, queryFn: fetchCourses })
  const materialsQuery = useQuery({
    queryKey: ['course-materials', courseId],
    queryFn: () => api(`/courses/${courseId}/materials?page_size=100`),
  })
  const assignmentsQuery = useQuery({
    queryKey: ['course-assignments', courseId],
    queryFn: () => api(`/courses/${courseId}/assignments?page_size=100`),
  })
  const marksQuery = useQuery({
    queryKey: ['course-marks', courseId],
    queryFn: () => api(`/courses/${courseId}/marks/me`),
  })

  const course = courseQuery.data
  const courses = useMemo(() => toList(coursesQuery.data), [coursesQuery.data])
  const materials = useMemo(() => toList(materialsQuery.data), [materialsQuery.data])
  const assignments = useMemo(
    () => toList(assignmentsQuery.data).filter((item) => item.state !== 'draft'),
    [assignmentsQuery.data],
  )
  const marks = marksQuery.data ?? null

  const pendingCount = assignments.filter((item) => item.state === 'open' && !item.my_submission).length
  const percent = marks?.totals?.weighted_percent
  const lecturers = course?.lecturers ?? []
  const lecturer = lecturers[0]

  const selectTab = (id) => setParams(id === 'overview' ? {} : { tab: id })

  const onTabKeyDown = (event, index) => {
    const last = TABS.length - 1
    let next = null
    if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1
    else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    if (next === null) return
    event.preventDefault()
    const id = TABS[next].id
    selectTab(id)
    tabRefs.current[id]?.focus()
  }

  const closeModal = (submitted) => {
    setActiveTask(null)
    if (submitted === true) setNotice('Submission received. Your file was uploaded successfully.')
  }

  const badges = {
    materials: materialsQuery.isSuccess ? { text: String(countOf(materialsQuery.data)), tone: 'mid' } : null,
    assignments: assignmentsQuery.isSuccess ? { text: String(pendingCount), tone: 'warm' } : null,
    marks: typeof percent === 'number' ? { text: `${trimNumber(percent)}%`, tone: 'fixed' } : null,
  }

  const trail = [
    { label: 'My Courses', to: '/student/courses' },
    { label: course ? courseTitle(course) : 'Course', strong: false },
    { label: activeTab.label, strong: true },
  ]

  if (courseQuery.isError) {
    return (
      <>
        <TopBar trail={[{ label: 'My Courses', to: '/student/courses' }, { label: 'Course', strong: true }]} courseCount={courses.length || undefined} />
        <ErrorCard
          message={
            courseQuery.error?.status === 404 || courseQuery.error?.status === 403
              ? 'We could not find this course among your enrolled courses.'
              : 'We could not load this course.'
          }
          onRetry={courseQuery.error?.status >= 500 || !courseQuery.error?.status ? () => courseQuery.refetch() : undefined}
        >
          <Link to="/student/courses" className="slpc-btn slpc-btn-soft">
            Back to My Courses
          </Link>
        </ErrorCard>
      </>
    )
  }

  return (
    <>
      <TopBar trail={trail} courseCount={coursesQuery.isSuccess ? courses.length : undefined} activeCode={course?.course_code ?? '…'} />

      <div className="slpc-stack slpc-gap-lg">
        {notice && (
          <p className="slpc-notice" role="status">
            {renderIcon('check_circle', 18)}
            <span>{notice}</span>
            <button type="button" className="slpc-icon-btn" aria-label="Dismiss message" onClick={() => setNotice('')}>
              {renderIcon('close', 16)}
            </button>
          </p>
        )}

        {courses.length > 0 && (
          <nav className="slpc-card slpc-switcher" aria-label="Switch course">
            <div className="slpc-switcher-list">
              <span className="slpc-eyebrow slpc-inline-tight">
                {renderIcon('swap_horiz', 14)}
                Switch Course:
              </span>
              {courses.map((item) =>
                item.id === courseId ? (
                  <span key={item.id} className="slpc-chip-course is-active" aria-current="page">
                    <span className="slpc-live-dot" aria-hidden="true" />
                    {courseTitle(item)}
                  </span>
                ) : (
                  <Link key={item.id} to={`/student/courses/${item.id}`} className="slpc-chip-course">
                    {courseTitle(item)}
                  </Link>
                ),
              )}
            </div>
            {course && (
              <span className="slpc-confirmed">
                {renderIcon('verified_user', 16)}
                Enrollment Confirmed • Academic Year {course.academic_year}
              </span>
            )}
          </nav>
        )}

        {courseQuery.isPending ? (
          <Skeleton height={230} label="Loading course" />
        ) : (
          <section className="slpc-card slpc-hero" aria-labelledby="slpc-course-title">
            <div className="slpc-hero-glow" aria-hidden="true" />
            <div className="slpc-hero-main">
              <h1 id="slpc-course-title" className="slpc-h1">
                {courseTitle(course)}
              </h1>
              <p className="slpc-lead">{course.description || 'No course description has been published yet.'}</p>
              <div className="slpc-hero-meta">
                <span className="slpc-pill is-primary">{Number(course.credit_hours) || 0} Credits</span>
                <span className="slpc-pill">
                  {formatSemester(course.semester)} • {course.academic_year}
                </span>
              </div>
            </div>
            {lecturer && (
              <aside className="slpc-lecturer" aria-label="Lecturer">
                <div className="slpc-lecturer-head">
                  <span className="slpc-avatar">{initials(lecturer.full_name)}</span>
                  <div className="slpc-lecturer-name">
                    <span className="slpc-lecturer-title">{[lecturer.title, lecturer.full_name].filter(Boolean).join(' ')}</span>
                    {lecturer.department && <span className="slpc-muted">Dept of {lecturer.department}</span>}
                  </div>
                </div>
                <div className="slpc-lecturer-rows">
                  {lecturer.department && (
                    <div className="slpc-row">
                      <span className="slpc-inline-tight">{renderIcon('domain', 16)} Department:</span>
                      <span className="slpc-strong">{lecturer.department}</span>
                    </div>
                  )}
                  <div className="slpc-row">
                    <span className="slpc-inline-tight">{renderIcon('mail', 16)} Contact:</span>
                    <a className="slpc-mono slpc-email" href={`mailto:${lecturer.email}`}>
                      {lecturer.email}
                    </a>
                  </div>
                  {lecturers.length > 1 && (
                    <p className="slpc-muted">
                      +{lecturers.length - 1} more {lecturers.length === 2 ? 'lecturer' : 'lecturers'}:{' '}
                      {lecturers
                        .slice(1)
                        .map((item) => item.full_name)
                        .join(', ')}
                    </p>
                  )}
                </div>
              </aside>
            )}
          </section>
        )}

        <div className="slpc-card slpc-tabs-card">
          <div className="slpc-tabs" role="tablist" aria-label="Course sections">
            {TABS.map((item, index) => {
              const badge = badges[item.id]
              return (
                <button
                  key={item.id}
                  ref={(node) => {
                    tabRefs.current[item.id] = node
                  }}
                  type="button"
                  role="tab"
                  id={`slpc-tab-${item.id}`}
                  aria-selected={tab === item.id}
                  aria-controls={`slpc-panel-${item.id}`}
                  tabIndex={tab === item.id ? 0 : -1}
                  className={`slpc-tab ${tab === item.id ? 'is-active' : ''}`}
                  onClick={() => selectTab(item.id)}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                >
                  {renderIcon(item.icon, 18)}
                  <span>{item.label}</span>
                  {badge && <span className={`slpc-badge is-${badge.tone}`}>{badge.text}</span>}
                </button>
              )
            })}
          </div>
        </div>

        <div role="tabpanel" id={`slpc-panel-${tab}`} aria-labelledby={`slpc-tab-${tab}`} tabIndex={0} className="slpc-panel-wrap">
          {tab === 'overview' && (
            <OverviewPanel
              data={{ materials, assignments, marks, materialsQuery, assignmentsQuery, marksQuery }}
              now={now}
              selectTab={selectTab}
            />
          )}
          {tab === 'materials' && <MaterialsPanel materials={materials} query={materialsQuery} />}
          {tab === 'assignments' && course && (
            <AssignmentsPanel
              assignments={assignments}
              query={assignmentsQuery}
              course={course}
              now={now}
              onUpload={setActiveTask}
            />
          )}
          {tab === 'attendance' && (
            <PhasePanel icon="how_to_reg" title="Attendance" phase="Phase 6">
              Your verified attendance for this course will appear here once attendance tracking goes live.
            </PhasePanel>
          )}
          {tab === 'marks' && <MarksPanel marks={marks} query={marksQuery} />}
          {tab === 'announcements' && (
            <PhasePanel icon="campaign" title="Announcements" phase="Phase 7">
              Course bulletins and notices from your lecturers will appear here once announcements go live.
            </PhasePanel>
          )}
          {tab === 'timetable' && (
            <PhasePanel icon="event_note" title="Timetable" phase="Phase 8">
              This course&apos;s weekly schedule and lecture rooms will appear here once the timetable goes live.
            </PhasePanel>
          )}
        </div>
      </div>

      {activeTask && (
        <SubmitModal
          task={activeTask}
          now={now}
          onClose={closeModal}
          onSubmitted={async () => {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['course-assignments', courseId] }),
              queryClient.invalidateQueries({ queryKey: ['student-dashboard'] }),
            ])
          }}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------------- export */

function StudentCourses() {
  const { courseId } = useParams()

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

  return (
    <div className="slpc">
      <style>{STYLES}</style>
      {courseId ? <CourseDetail key={courseId} courseId={courseId} /> : <Catalog />}
    </div>
  )
}

export default StudentCourses

const STYLES = `
.slpc {
  --primary: #a03223;
  --on-primary: #ffffff;
  --primary-container: #c14a38;
  --on-primary-container: #fff5f3;
  --primary-fixed: #ffdad4;
  --on-primary-fixed: #400200;
  --secondary: #9e3e49;
  --secondary-container: #fd8892;
  --on-secondary-container: #76202c;
  --tertiary: #933f28;
  --tertiary-fixed: #ffdbd2;
  --on-tertiary-fixed: #3c0800;
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
  --ok: #047857;
  --ok-bg: rgba(16, 185, 129, 0.1);
  --info: #0369a1;
  --info-bg: rgba(14, 165, 233, 0.1);
  --warn: #b45309;
  --warn-bg: rgba(245, 158, 11, 0.12);
  font-family: 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: var(--on-surface);
  line-height: 1.5;
  text-align: left;
  -webkit-font-smoothing: antialiased;
  width: 100%;
}
.slpc *, .slpc *::before, .slpc *::after { box-sizing: border-box; }
/* :where() keeps the reset at low specificity so the class rules below can override it */
.slpc :where(h1, h2, h3, p, ul, ol) { margin: 0; padding: 0; }
.slpc :where(ul, ol) { list-style: none; }
.slpc a { color: inherit; text-decoration: none; }
.slpc button, .slpc input, .slpc select { font-family: inherit; }
.slpc .material-symbols-outlined {
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
.slpc a:focus-visible, .slpc button:focus-visible, .slpc input:focus-visible, .slpc select:focus-visible,
.slpc [tabindex]:focus-visible {
  outline: 3px solid var(--primary-container);
  outline-offset: 3px;
  border-radius: 8px;
}
.slpc-mono { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; }
.slpc-muted { color: var(--on-surface-variant); font-size: 13px; line-height: 18px; }
.slpc-strong { font-weight: 600; color: var(--on-surface); }
.slpc-nowrap { white-space: nowrap; }
.slpc-right { text-align: right; }
.slpc-inline { display: inline-flex; align-items: center; gap: 0.5rem; }
.slpc-inline-tight { display: inline-flex; align-items: center; gap: 0.25rem; }
.slpc-accent { color: var(--primary); display: inline-flex; }
.slpc-accent-warm { color: var(--tertiary); display: inline-flex; }
.slpc-accent-ok { color: var(--ok); display: inline-flex; }
.slpc-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.slpc-stack { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.slpc-gap-lg { gap: 1.5rem; }
.slpc-h1 { font-size: 32px; line-height: 40px; font-weight: 700; letter-spacing: -0.02em; }
.slpc-h2 { font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em; }
.slpc-h3 { font-size: 18px; line-height: 26px; font-weight: 700; letter-spacing: -0.005em; }
.slpc-lead { font-size: 16px; line-height: 26px; color: var(--on-surface-variant); max-width: 48rem; }
.slpc-eyebrow { font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpc-card { border-radius: 12px; background: var(--surface-lowest); padding: 1rem; box-shadow: 0 1px 3px rgba(30, 26, 35, 0.08); }
.slpc-state { display: flex; flex-direction: column; align-items: flex-start; gap: 0.75rem; font-size: 14px; color: var(--on-surface-variant); }
.slpc-empty { padding: 0.75rem; border-radius: 12px; background: var(--surface-low); font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpc-alert { padding: 0.5rem 0.75rem; border-radius: 12px; background: var(--error-container); color: var(--on-error-container); font-size: 13px; line-height: 18px; font-weight: 600; }
.slpc-notice {
  display: flex; align-items: center; gap: 0.5rem; padding: 0.625rem 0.875rem; border-radius: 12px;
  background: var(--surface-low); font-size: 13px; line-height: 18px; font-weight: 600;
}
.slpc-notice .material-symbols-outlined:first-child { color: var(--primary); }
.slpc-notice span { flex: 1 1 auto; }
.slpc-skeleton { background: linear-gradient(90deg, var(--surface-mid), var(--surface-low), var(--surface-mid)); background-size: 200% 100%; animation: slpc-shimmer 1.4s linear infinite; }
.slpc-skeleton-sm { min-height: 64px; border-radius: 12px; }
@keyframes slpc-shimmer { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .slpc-skeleton { animation: none; } .slpc-card, .slpc-action, .slpc-tab { transition: none !important; } }

.slpc-pill {
  display: inline-flex; align-items: center; padding: 2px 10px; border-radius: 999px;
  background: var(--surface-high); color: var(--on-surface-variant);
  font-size: 11px; line-height: 16px; font-weight: 700; letter-spacing: 0.02em; white-space: nowrap;
}
.slpc-pill.is-primary { background: var(--primary-fixed); color: var(--on-primary-fixed); }
.slpc-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.375rem; border: 0; cursor: pointer;
  padding: 10px 16px; border-radius: 999px; font-size: 12px; line-height: 16px; font-weight: 600; letter-spacing: 0.02em;
  transition: background 0.2s; white-space: nowrap;
}
.slpc-btn:disabled { opacity: 0.6; cursor: progress; }
.slpc-btn-primary { background: var(--primary-container); color: var(--on-primary-container); box-shadow: 0 1px 3px rgba(30, 26, 35, 0.2); }
.slpc-btn-primary:hover:not(:disabled) { background: var(--primary); }
.slpc-btn-soft { background: var(--surface-low); color: var(--on-surface); box-shadow: inset 0 0 0 1px var(--surface-high); }
.slpc-btn-soft:hover:not(:disabled) { background: var(--surface-high); }
.slpc-link-btn { border: 0; background: none; padding: 0; cursor: pointer; font-size: 11px; line-height: 14px; font-weight: 700; color: var(--primary); }
.slpc-link-btn:hover { text-decoration: underline; }
.slpc-icon-btn {
  width: 32px; height: 32px; border: 0; border-radius: 999px; background: var(--surface-mid); color: var(--outline);
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex: 0 0 auto;
}

/* Top bar: breadcrumb + view switch */
.slpc-topbar { display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1.5rem; }
.slpc-trail { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); min-width: 0; }
.slpc-trail-item { display: inline-flex; align-items: center; gap: 0.25rem; min-width: 0; }
.slpc-trail-link { display: inline-flex; align-items: center; gap: 0.25rem; font-weight: 500; }
.slpc-trail-link:hover { color: var(--primary); }
.slpc-trail-sep { color: var(--outline-variant); }
.slpc-trail-title { color: var(--on-surface); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
.slpc-trail-current { color: var(--primary); font-weight: 600; white-space: nowrap; }
.slpc-switch { display: inline-flex; align-self: flex-start; padding: 4px; border-radius: 999px; background: var(--surface-high); box-shadow: 0 1px 2px rgba(30, 26, 35, 0.06); flex-wrap: wrap; }
.slpc-switch-btn {
  display: inline-flex; align-items: center; gap: 0.375rem; padding: 6px 16px; border-radius: 999px;
  font-size: 12px; line-height: 16px; font-weight: 600; color: var(--on-surface-variant); transition: color 0.2s;
}
.slpc-switch-btn:hover { color: var(--on-surface); }
.slpc-switch-btn.is-active { background: var(--primary); color: var(--on-primary); box-shadow: 0 1px 2px rgba(30, 26, 35, 0.2); }
.slpc-count { min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; background: var(--surface-highest); color: var(--on-surface); font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }

/* Catalogue */
.slpc-filter { display: flex; flex-direction: column; gap: 1rem; }
.slpc-filter-controls { display: flex; flex-direction: column; gap: 0.5rem; width: 100%; }
.slpc-search {
  position: relative; display: flex; align-items: center; flex: 1 1 auto; min-width: 0; height: 36px; padding: 0 12px;
  border-radius: 8px; background: var(--surface-low); color: var(--on-surface-variant); gap: 0.5rem;
}
.slpc-search:focus-within { box-shadow: 0 0 0 2px var(--primary-container); }
.slpc-search input { flex: 1 1 auto; min-width: 0; border: 0; outline: 0; background: transparent; font-size: 13px; color: var(--on-surface); }
.slpc-search input::placeholder { color: var(--on-surface-variant); }
.slpc-select { height: 36px; padding: 0 12px; border: 0; border-radius: 8px; background: var(--surface-low); color: var(--on-surface); font-size: 12px; font-weight: 600; }
.slpc-grid-cards { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; }
.slpc-course {
  height: 100%; display: flex; flex-direction: column; justify-content: space-between; gap: 1rem; padding: 1.5rem;
  transition: box-shadow 0.2s, transform 0.2s;
}
.slpc-course:hover { box-shadow: 0 10px 24px rgba(30, 26, 35, 0.12); transform: translateY(-2px); }
.slpc-course.is-first { border-left: 4px solid var(--primary); }
.slpc-course-top { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.5rem; }
.slpc-course-top .slpc-muted { font-size: 12px; }
.slpc-course-title { font-size: 16px; line-height: 24px; font-weight: 600; margin-bottom: 4px; }
.slpc-course:hover .slpc-course-title { color: var(--primary); }
.slpc-clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpc-course-foot { display: flex; flex-direction: column; gap: 0.5rem; }
.slpc-person { display: inline-flex; align-items: center; gap: 0.5rem; font-size: 13px; line-height: 18px; font-weight: 500; }
.slpc-avatar-sm {
  width: 28px; height: 28px; border-radius: 999px; background: var(--surface-high); font-size: 11px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
}
.slpc-avatar-sm.is-primary { color: var(--primary); }
.slpc-avatar-sm.is-tertiary { color: var(--tertiary); }
.slpc-avatar-sm.is-secondary { color: var(--secondary); }
.slpc-course-meta { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding-top: 4px; font-size: 11px; line-height: 14px; font-weight: 600; color: var(--on-surface-variant); }
.slpc-open { display: inline-flex; align-items: center; gap: 2px; color: var(--primary); }

/* Detail: switcher, hero */
.slpc-switcher { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.5rem; overflow-x: auto; }
.slpc-switcher-list { display: flex; align-items: center; gap: 0.25rem; min-width: max-content; }
.slpc-switcher .slpc-eyebrow { padding: 0 0.25rem; }
.slpc-chip-course {
  display: inline-flex; align-items: center; gap: 0.375rem; padding: 6px 12px; border-radius: 8px;
  background: var(--surface-low); color: var(--on-surface); font-size: 12px; line-height: 16px; font-weight: 600; white-space: nowrap;
  transition: background 0.2s;
}
.slpc-chip-course:hover { background: var(--surface-high); }
.slpc-chip-course.is-active { background: var(--primary); color: var(--on-primary); box-shadow: 0 1px 2px rgba(30, 26, 35, 0.2); }
.slpc-live-dot { width: 8px; height: 8px; border-radius: 999px; background: #fff; }
.slpc-confirmed { display: none; align-items: center; gap: 0.25rem; padding-left: 1rem; font-size: 11px; line-height: 14px; font-weight: 600; color: var(--on-surface-variant); white-space: nowrap; }
.slpc-confirmed .material-symbols-outlined { color: var(--tertiary); }
.slpc-hero { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 1.5rem; padding: 1.5rem; border-radius: 16px; }
.slpc-hero-glow { position: absolute; right: -32px; top: -32px; width: 256px; height: 256px; border-radius: 999px; background: radial-gradient(circle at 30% 30%, rgba(255, 218, 212, 0.45), rgba(255, 219, 210, 0.15) 55%, transparent 75%); pointer-events: none; }
.slpc-hero-main { position: relative; flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 0.75rem; }
.slpc-hero-meta { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.slpc-lecturer { position: relative; width: 100%; border-radius: 12px; background: var(--surface-low); padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; align-self: flex-start; }
.slpc-lecturer-head { display: flex; align-items: center; gap: 0.5rem; }
.slpc-avatar { width: 48px; height: 48px; border-radius: 12px; background: var(--primary); color: var(--on-primary); font-size: 18px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; box-shadow: 0 1px 2px rgba(30, 26, 35, 0.2); }
.slpc-lecturer-name { display: flex; flex-direction: column; min-width: 0; }
.slpc-lecturer-title { font-size: 16px; line-height: 22px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slpc-lecturer-name .slpc-muted { font-size: 11px; line-height: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slpc-lecturer-rows { display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 1px solid var(--surface-highest); font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpc-row { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; min-width: 0; }
.slpc-row .slpc-inline-tight { white-space: nowrap; }
.slpc-row .material-symbols-outlined { font-size: 16px; }
.slpc-email { font-size: 12px; color: var(--primary); overflow-wrap: anywhere; text-align: right; }
.slpc-email:hover { text-decoration: underline; }

/* Tabs */
.slpc-tabs-card { padding: 6px; overflow-x: auto; }
.slpc-tabs { display: flex; align-items: center; gap: 4px; min-width: max-content; }
.slpc-tab {
  display: inline-flex; align-items: center; gap: 0.5rem; padding: 8px 16px; border: 0; border-radius: 8px; cursor: pointer;
  background: transparent; color: var(--on-surface-variant); font-size: 12px; line-height: 16px; font-weight: 600; transition: background 0.2s, color 0.2s;
}
.slpc-tab:hover { background: var(--surface-high); color: var(--on-surface); }
.slpc-tab.is-active { background: var(--primary); color: var(--on-primary); font-weight: 700; box-shadow: 0 1px 2px rgba(30, 26, 35, 0.2); }
.slpc-badge { padding: 1px 6px; border-radius: 999px; font-size: 11px; line-height: 16px; font-weight: 700; }
.slpc-badge.is-mid { background: var(--surface-highest); color: var(--on-surface); }
.slpc-badge.is-warm { background: var(--tertiary-fixed); color: var(--on-tertiary-fixed); }
.slpc-badge.is-fixed { background: var(--primary-fixed); color: var(--on-primary-fixed); }
.slpc-panel-wrap { outline: none; min-width: 0; }

/* Overview */
.slpc-stats { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; }
.slpc-stat { display: flex; flex-direction: column; justify-content: space-between; gap: 0.5rem; transition: box-shadow 0.2s; }
.slpc-stat:hover { box-shadow: 0 8px 20px rgba(30, 26, 35, 0.1); }
.slpc-stat-top { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.5rem; min-height: 32px; }
.slpc-stat-label { font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpc-stat-icon { width: 32px; height: 32px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.slpc-stat-icon.is-mid { background: var(--surface-mid); color: var(--primary); }
.slpc-stat-icon.is-warm { background: rgba(255, 219, 210, 0.6); color: var(--tertiary); }
.slpc-stat-icon.is-ok { background: var(--ok-bg); color: var(--ok); }
.slpc-stat-icon.is-fixed { background: var(--primary-fixed); color: var(--on-primary-fixed); }
.slpc-stat-body { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0.25rem 0.5rem; min-height: 40px; }
.slpc-stat-value { font-size: 32px; line-height: 40px; font-weight: 700; letter-spacing: -0.02em; }
.slpc-stat-unit { font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpc-stat-foot { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-top: 0.5rem; padding-top: 0.5rem; font-size: 11px; line-height: 14px; font-weight: 600; color: var(--on-surface-variant); min-height: 36px; }
.slpc-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.slpc-chip { display: inline-flex; align-items: center; gap: 0.25rem; padding: 2px 6px; border-radius: 6px; font-size: 11px; line-height: 14px; font-weight: 700; background: var(--surface-mid); color: var(--on-surface-variant); }
.slpc-chip.is-ok { background: var(--ok-bg); color: var(--ok); }
.slpc-chip.is-info { background: var(--info-bg); color: var(--info); }
.slpc-chip.is-warn { background: var(--warn-bg); color: var(--warn); }
.slpc-chip.is-quiet { background: var(--surface-low); color: var(--outline); }
.slpc-chip .material-symbols-outlined { color: inherit; }
.slpc-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.slpc-panel { display: flex; flex-direction: column; gap: 1rem; padding: 1.5rem; }
.slpc-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; }
.slpc-stream { display: flex; flex-direction: column; gap: 1rem; }
.slpc-event { display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.5rem; border-radius: 8px; background: var(--surface-low); transition: background 0.2s; }
.slpc-event:hover { background: var(--surface-mid); }
.slpc-event-icon { width: 32px; height: 32px; margin-top: 2px; border-radius: 8px; color: #fff; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.slpc-event-icon.is-primary { background: var(--primary); }
.slpc-event-icon.is-tertiary { background: var(--tertiary); }
.slpc-event-icon.is-ok { background: #059669; }
.slpc-event-main { flex: 1 1 auto; min-width: 0; }
.slpc-event-head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
.slpc-event-title { font-size: 15px; line-height: 22px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slpc-event-when { font-size: 11px; line-height: 14px; font-weight: 600; color: var(--on-surface-variant); flex: 0 0 auto; }
.slpc-event-when.is-urgent { color: var(--error); }
.slpc-event-text { margin-top: 2px; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpc-event-action { margin-top: 8px; display: inline-flex; align-items: center; gap: 0.25rem; border: 0; background: none; padding: 0; cursor: pointer; font-size: 11px; line-height: 14px; font-weight: 600; color: var(--primary); }
.slpc-event-action:hover { text-decoration: underline; }
.slpc-actions { display: flex; flex-direction: column; gap: 0.25rem; }
.slpc-action {
  width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 8px; border: 0; border-radius: 8px;
  background: var(--surface-low); cursor: pointer; text-align: left; font-size: 13px; line-height: 18px; font-weight: 600; color: var(--on-surface);
  transition: background 0.2s;
}
.slpc-action:hover { background: var(--surface-high); }
.slpc-action > .material-symbols-outlined { color: var(--on-surface-variant); }
.slpc-action .slpc-inline { min-width: 0; }
.slpc-action-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Materials, marks tables */
.slpc-pills { display: flex; flex-wrap: wrap; gap: 0.25rem; }
.slpc-filter-pill { padding: 4px 12px; border: 0; border-radius: 999px; cursor: pointer; background: var(--surface-high); color: var(--on-surface-variant); font-size: 11px; line-height: 16px; font-weight: 600; }
.slpc-filter-pill:hover { color: var(--on-surface); }
.slpc-filter-pill.is-active { background: var(--primary); color: var(--on-primary); }
.slpc-table-card { padding: 0; overflow: hidden; }
.slpc-table-scroll { overflow-x: auto; }
.slpc-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; line-height: 18px; }
.slpc-table th { padding: 12px 16px; background: var(--surface-mid); font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); white-space: nowrap; }
.slpc-table td { padding: 12px 16px; border-top: 1px solid var(--surface-mid); vertical-align: middle; }
.slpc-cell-title { display: block; font-weight: 600; color: var(--on-surface); }
.slpc-cell-sub { display: block; margin-top: 2px; font-size: 12px; line-height: 16px; color: var(--on-surface-variant); }
.slpc-cell-file { display: block; font-size: 12px; overflow-wrap: anywhere; }
.slpc-marks-summary { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; }
.slpc-marks-facts { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--on-surface-variant); }
.slpc-marks-facts strong { color: var(--on-surface); }

/* Assignments */
.slpc-assignment { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 1rem; padding: 1rem 1rem 1rem 1.5rem; }
.slpc-assignment::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: var(--outline-variant); }
.slpc-assignment.is-urgent::before { background: var(--primary); }
.slpc-assignment.is-soon::before { background: var(--secondary-container); }
.slpc-assignment-main { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1 1 auto; }
.slpc-task-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; font-size: 13px; line-height: 18px; }
.slpc-code { font-size: 11px; font-weight: 700; color: var(--primary); }
.slpc-due { padding: 2px 8px; border-radius: 999px; font-size: 11px; line-height: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; background: var(--surface-mid); color: var(--on-surface-variant); }
.slpc-due.is-urgent { background: var(--primary); color: var(--on-primary); }
.slpc-due.is-soon { background: var(--surface-high); color: var(--on-surface); }
.slpc-assignment-title { font-size: 16px; line-height: 24px; font-weight: 600; }
.slpc-facts { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 16px; font-size: 11px; line-height: 16px; color: var(--on-surface-variant); }
.slpc-facts .material-symbols-outlined { color: var(--tertiary); }
.slpc-facts .slpc-chip { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; }
.slpc-attach { display: inline-flex; align-items: center; gap: 0.25rem; border: 0; background: none; padding: 0; cursor: pointer; font-family: inherit; font-size: 11px; line-height: 16px; color: var(--primary); font-weight: 600; }
.slpc-attach:hover:not(:disabled) { text-decoration: underline; }
.slpc-score { font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpc-score strong { color: var(--on-surface); }
.slpc-assignment-action { display: flex; flex: 0 0 auto; align-items: center; }

@media (min-width: 640px) {
  .slpc-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .slpc-grid-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .slpc-confirmed { display: inline-flex; }
}
@media (min-width: 768px) {
  .slpc-topbar { flex-direction: row; align-items: center; justify-content: space-between; }
  .slpc-switch { align-self: auto; }
  .slpc-filter { flex-direction: row; align-items: center; justify-content: space-between; }
  .slpc-filter-controls { flex-direction: row; max-width: 36rem; }
  .slpc-select { flex: 0 0 auto; }
  .slpc-assignment { flex-direction: row; align-items: center; justify-content: space-between; }
  .slpc-trail-title { max-width: none; }
}
@media (min-width: 1024px) {
  .slpc-stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .slpc-split { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
}
@media (min-width: 1280px) {
  .slpc-grid-cards { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .slpc-hero { flex-direction: row; align-items: flex-start; justify-content: space-between; padding: 2rem; gap: 2rem; }
  .slpc-lecturer { width: 384px; flex: 0 0 384px; }
}
.slpc-phase { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 0.75rem; padding: 3rem 1.5rem; }
.slpc-phase-icon { width: 56px; height: 56px; border-radius: 16px; background: var(--primary-fixed); color: var(--primary); display: inline-flex; align-items: center; justify-content: center; }
.slpc-phase .slpc-muted { max-width: 32rem; }
`
