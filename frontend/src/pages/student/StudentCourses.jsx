import { useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/apiClient.js'
import {
  AVATAR_TONES,
  CATEGORY_LABELS,
  COURSES_KEY,
  COURSE_STYLES,
  ErrorCard,
  PhasePanel,
  Skeleton,
  StatCard,
  countOf,
  courseTitle,
  fetchCourses,
  initials,
  renderIcon,
  trimNumber,
  useClock,
  useCourseFonts,
  useDownloads,
} from '../../components/courseKit.jsx'
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
 * - Self-contained: styles are scoped under `.slpc` and injected from components/courseKit.jsx.
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

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'dashboard' },
  { id: 'materials', label: 'Materials', icon: 'folder_open' },
  { id: 'assignments', label: 'Assignments', icon: 'assignment' },
  { id: 'attendance', label: 'Attendance', icon: 'how_to_reg' },
  { id: 'marks', label: 'Marks & Results', icon: 'analytics' },
  { id: 'announcements', label: 'Announcements', icon: 'campaign' },
  { id: 'timetable', label: 'Timetable', icon: 'event_note' },
]

const SUBMISSION_LABELS = { submitted: 'Submitted', late: 'Submitted late', graded: 'Graded', returned: 'Returned' }
const STREAM_LIMIT = 5


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
  useCourseFonts()

  return (
    <div className="slpc">
      <style>{COURSE_STYLES}</style>
      {courseId ? <CourseDetail key={courseId} courseId={courseId} /> : <Catalog />}
    </div>
  )
}

export default StudentCourses
