import { useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
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
import { formatDate, formatSemester, formatSize, sentenceCase, timeAgo, toList } from '../../utils/format.js'

/*
 * Smart Lecture Portal: lecturer courses (catalogue + course detail)
 * Place at: src/pages/lecturer/LecturerCourses.jsx
 *
 * One page, two views, like the design:
 *   /lecturer/courses            the courses you teach
 *   /lecturer/courses/:courseId  course workspace with tabs (?tab=students, materials ...)
 *
 * - Renders inside AppShell, which already draws the sidebar and top bar.
 * - Styles come from components/courseKit.jsx (scoped under `.slpc`) plus a few extra rules below.
 * - Real data only (SRS: no hard-coded figures). Endpoints used:
 *     GET   /courses                                  assigned courses
 *     GET   /courses/{id}                             course, lecturers, enrolled_count
 *     GET   /courses/{id}/students                    roster
 *     GET   /courses/{id}/materials                   materials (drafts included for lecturers)
 *     GET   /materials/{id}/download                  signed download link
 *     GET   /courses/{id}/assignments                 assignments
 *     GET   /assignments/{id}                         submission_counts (grading backlog)
 *     GET   /assignments/{id}/submissions             grading queue
 *     GET   /submissions/{id}/download                signed download link
 *     GET   /courses/{id}/assessments                 grade pipeline
 *     PATCH /assessments/{id}                         publish marks to the cohort
 * - Attendance (Phase 6), announcements (Phase 7), analytics and the timetable (Phase 8) have no
 *   API yet, so those tabs say so instead of inventing data. If one data source fails, its figure
 *   shows "—" rather than a wrong number.
 */

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'students', label: 'Students' },
  { id: 'materials', label: 'Materials' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'submissions', label: 'Submissions' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'marks', label: 'Marks & Assessments' },
  { id: 'announcements', label: 'Announcements' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'timetable', label: 'Timetable' },
]

const PHASE_TABS = {
  attendance: { icon: 'how_to_reg', title: 'Attendance', phase: 'Phase 6', text: 'Class attendance logging and the compliance ledger will appear here once attendance goes live.' },
  announcements: { icon: 'campaign', title: 'Announcements', phase: 'Phase 7', text: 'Broadcasting notices to your cohort will be available here once announcements go live.' },
  analytics: { icon: 'insights', title: 'Analytics', phase: 'Phase 8', text: 'Course performance analytics will appear here once reporting goes live.' },
  timetable: { icon: 'event_note', title: 'Timetable', phase: 'Phase 8', text: "This course's weekly schedule will appear here once the timetable goes live." },
}

const QUEUE_PREVIEW = 3
const SHORT_LABELS = {
  lecture_notes: ['Note', 'Notes'],
  slides: ['Slide', 'Slides'],
  reading: ['Reading', 'Readings'],
  lab: ['Lab', 'Labs'],
  past_paper: ['Past Paper', 'Past Papers'],
  other: ['Other', 'Other'],
}
const STATE_LABELS = { draft: 'Draft', open: 'Open', closed: 'Closed' }
const SUBMISSION_LABELS = { submitted: 'On Time', late: 'Late', graded: 'Graded', returned: 'Returned' }

const detailKey = (id) => ['course', id]
const base = '/lecturer'

function courseBadge(course) {
  const digits = String(course.course_code ?? '').match(/\d+/)
  return digits ? digits[0].slice(-3) : String(course.course_code ?? '').slice(0, 3)
}

function pendingOf(detail) {
  const counts = detail?.submission_counts
  return counts ? (counts.submitted ?? 0) + (counts.late ?? 0) : 0
}

function fileTone(item) {
  const name = String(item.file_name ?? '').toLowerCase()
  if (name.endsWith('.pdf')) return { icon: 'picture_as_pdf', tone: 'pdf' }
  if (name.endsWith('.zip')) return { icon: 'folder_zip', tone: 'zip' }
  if (name.endsWith('.pptx')) return { icon: 'slideshow', tone: 'ppt' }
  return { icon: 'description', tone: 'doc' }
}

function Trail({ items }) {
  return (
    <nav className="slpc-trail slpc-trail-gap" aria-label="Course breadcrumb">
      <Link to={base} className="slpc-trail-link">
        Dashboard
      </Link>
      {items.map((item) => (
        <span key={item.label} className="slpc-trail-item">
          {renderIcon('chevron_right', 14)}
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
  )
}

/* ------------------------------------------------------------------ catalogue */

function Catalog() {
  const [search, setSearch] = useState('')
  const coursesQuery = useQuery({ queryKey: COURSES_KEY, queryFn: fetchCourses })
  const courses = useMemo(() => toList(coursesQuery.data), [coursesQuery.data])

  const detailQueries = useQueries({
    queries: courses.map((course) => ({
      queryKey: detailKey(course.id),
      queryFn: () => api(`/courses/${course.id}`),
      staleTime: 60_000,
    })),
  })

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return courses
      .filter((course) => !needle || String(course.course_code).toLowerCase().includes(needle) || String(course.course_name).toLowerCase().includes(needle))
      .sort((a, b) => String(a.course_code).localeCompare(String(b.course_code)))
  }, [courses, search])

  return (
    <>
      <div className="slpc-topbar">
        <Trail items={[{ label: 'My Courses', strong: true }]} />
      </div>
      <section className="slpc-stack" aria-labelledby="slpc-catalog-title">
        <div className="slpc-card slpc-filter">
          <div>
            <h1 id="slpc-catalog-title" className="slpc-h2">
              My Courses
            </h1>
            <p className="slpc-muted">
              {coursesQuery.isSuccess
                ? `Showing ${visible.length} of ${courses.length} assigned ${courses.length === 1 ? 'course' : 'courses'}`
                : 'The courses you teach this session'}
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
          </div>
        </div>

        {coursesQuery.isPending && (
          <div className="slpc-grid-cards" aria-busy="true" aria-label="Loading courses">
            {[0, 1, 2, 3].map((key) => (
              <Skeleton key={key} height={170} />
            ))}
          </div>
        )}
        {coursesQuery.isError && <ErrorCard message="We could not load your courses." onRetry={() => coursesQuery.refetch()} />}
        {coursesQuery.isSuccess && courses.length === 0 && (
          <div className="slpc-card slpc-state">
            <p>You are not assigned to any courses yet.</p>
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
              const detail = detailQueries[courses.indexOf(course)]?.data
              const enrolled = detail?.enrolled_count
              return (
                <li key={course.id}>
                  <Link to={`${base}/courses/${course.id}`} className={`slpc-card slpc-course ${index === 0 ? 'is-first' : ''}`}>
                    <div>
                      <div className="slpc-course-top">
                        <span className={`slpc-pill ${index === 0 ? 'is-primary' : ''}`}>{Number(course.credit_hours) || 0} Credits</span>
                        <span className="slpc-mono slpc-muted">{typeof enrolled === 'number' ? `${enrolled} enrolled` : ''}</span>
                      </div>
                      <h2 className="slpc-course-title">{courseTitle(course)}</h2>
                      <p className="slpc-clamp">{course.description || 'No description has been published yet.'}</p>
                    </div>
                    <div className="slpc-course-foot">
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

function FileBadge({ item }) {
  const { icon, tone } = fileTone(item)
  return <span className={`slpc-file is-${tone}`}>{renderIcon(icon, 20)}</span>
}

function OverviewPanel({ ctx }) {
  const { courseId, now, enrolled, materials, materialsQuery, assignments, assignmentsQuery, pendingTotal, queue, queueQuery, assessments, assessmentsQuery, downloads, selectTab } = ctx
  const released = assessments.filter((item) => item.published).length
  const breakdown = useMemo(() => {
    const counts = {}
    materials.forEach((item) => {
      counts[item.category] = (counts[item.category] ?? 0) + 1
    })
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([key, count]) => `${count} ${(SHORT_LABELS[key] ?? [sentenceCase(key), sentenceCase(key)])[count === 1 ? 0 : 1]}`)
      .join(' • ')
  }, [materials])
  const published = assignments.filter((item) => item.state !== 'draft').length
  const queueRows = toList(queueQuery.data).filter((item) => ['submitted', 'late'].includes(item.status))
  const recentMaterials = [...materials].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 3)
  const draftAssessment = assessments.find((item) => !item.published)

  return (
    <div className="slpc-stack slpc-gap-lg">
      <div className="slpc-stats is-five">
        <StatCard
          label="Enrolled Cohort"
          icon="groups"
          tone="mid"
          foot={
            <button type="button" className="slpc-link-btn slpc-inline-tight" onClick={() => selectTab('students')}>
              Full Roster {renderIcon('arrow_forward', 14)}
            </button>
          }
        >
          <span className="slpc-stat-value">{typeof enrolled === 'number' ? enrolled : '—'}</span>
          <span className="slpc-stat-unit">Students</span>
        </StatCard>

        <StatCard
          label="Course Materials"
          icon="folder_copy"
          tone="mid"
          foot={
            <button type="button" className="slpc-link-btn slpc-inline-tight" onClick={() => selectTab('materials')}>
              Manage Files {renderIcon('arrow_forward', 14)}
            </button>
          }
        >
          <span className="slpc-stat-value">{materialsQuery.isSuccess ? countOf(materialsQuery.data) : '—'}</span>
          <span className="slpc-stat-unit">Resources</span>
          {breakdown && <span className="slpc-stat-note">{breakdown}</span>}
        </StatCard>

        <StatCard
          label="Active Assignments"
          icon="assignment_late"
          tone="alert"
          foot={
            <button type="button" className="slpc-link-btn slpc-inline-tight" onClick={() => selectTab('submissions')}>
              Review Queue {renderIcon('arrow_forward', 14)}
            </button>
          }
        >
          <span className="slpc-stat-value is-accent">{pendingTotal === null ? '—' : pendingTotal}</span>
          <span className="slpc-stat-unit is-alert">Pending Graded</span>
          <span className="slpc-stat-note">{assignmentsQuery.isSuccess ? `${published} ${published === 1 ? 'Assignment' : 'Assignments'} Published` : 'Could not load'}</span>
        </StatCard>

        <StatCard
          label="Term Attendance"
          icon="donut_large"
          tone="mid"
          foot={<span>Available when attendance (Phase 6) goes live</span>}
        >
          <span className="slpc-stat-value">—</span>
        </StatCard>

        <StatCard
          label="Assessment Standing"
          icon="monitoring"
          tone="mid"
          foot={
            <button type="button" className="slpc-link-btn slpc-inline-tight" onClick={() => selectTab('marks')}>
              Grade Ledger {renderIcon('arrow_forward', 14)}
            </button>
          }
        >
          <span className="slpc-stat-value">{assessmentsQuery.isSuccess ? `${released}/${assessments.length}` : '—'}</span>
          <span className="slpc-stat-unit">Released</span>
        </StatCard>
      </div>

      <div className="slpc-split is-seven">
        <div className="slpc-stack slpc-gap-lg">
          <section className="slpc-card slpc-panel" aria-labelledby="slpc-queue-title">
            <div className="slpc-panel-head">
              <div className="slpc-inline slpc-wrap">
                <span className="slpc-accent">{renderIcon('pending_actions', 20)}</span>
                <h2 id="slpc-queue-title" className="slpc-h3">
                  Grading Queue: Pending Submissions
                </h2>
                {pendingTotal > 0 && <span className="slpc-chip is-alert">{pendingTotal} Action Required</span>}
              </div>
              {queue && (
                <Link to={`${base}/assignments/${queue.id}/submissions`} className="slpc-link-btn slpc-inline-tight">
                  Review All {renderIcon('tune', 14)}
                </Link>
              )}
            </div>

            {assignmentsQuery.isPending && <div className="slpc-skeleton slpc-skeleton-sm" aria-busy="true" />}
            {assignmentsQuery.isError && <p className="slpc-empty">The grading queue could not be loaded.</p>}
            {assignmentsQuery.isSuccess && !queue && <p className="slpc-empty">Nothing is waiting to be graded. You are all caught up.</p>}

            {queue && (
              <>
                <p className="slpc-muted">
                  <strong className="slpc-strong">{queue.title}</strong> (Max Marks: {trimNumber(queue.max_marks)})
                </p>
                {queueQuery.isPending && <div className="slpc-skeleton slpc-skeleton-sm" aria-busy="true" />}
                {queueQuery.isError && <ErrorCard message="We could not load these submissions." onRetry={() => queueQuery.refetch()} />}
                {queueRows.length > 0 && (
                  <ul className="slpc-stack slpc-gap-sm">
                    {queueRows.slice(0, QUEUE_PREVIEW).map((row, index) => (
                      <SubmissionRow key={row.id} row={row} assignment={queue} index={index} now={now} downloads={downloads} />
                    ))}
                  </ul>
                )}
                <div className="slpc-callout">
                  <span className="slpc-inline">
                    <span className="slpc-muted-icon">{renderIcon('verified_user', 16)}</span>
                    <span className="slpc-muted">Grades stay draft until you release them to students.</span>
                  </span>
                  {pendingTotal > queueRows.slice(0, QUEUE_PREVIEW).length && (
                    <span className="slpc-mono slpc-more">{pendingTotal - queueRows.slice(0, QUEUE_PREVIEW).length} MORE QUEUED</span>
                  )}
                </div>
              </>
            )}
          </section>

          <section className="slpc-card slpc-panel" aria-labelledby="slpc-repo-title">
            <div className="slpc-panel-head">
              <div className="slpc-inline slpc-wrap">
                <span className="slpc-accent">{renderIcon('auto_stories', 20)}</span>
                <h2 id="slpc-repo-title" className="slpc-h3">
                  Course Materials &amp; Repositories
                </h2>
                {materialsQuery.isSuccess && <span className="slpc-pill">{countOf(materialsQuery.data)} Files</span>}
              </div>
              <Link to={`${base}/courses/${courseId}/materials`} className="slpc-btn slpc-btn-soft">
                <span className="slpc-accent">{renderIcon('upload_file', 16)}</span>
                Upload Resource
              </Link>
            </div>
            {materialsQuery.isPending && <div className="slpc-skeleton slpc-skeleton-sm" aria-busy="true" />}
            {materialsQuery.isError && <p className="slpc-empty">The materials could not be loaded.</p>}
            {materialsQuery.isSuccess && recentMaterials.length === 0 && <p className="slpc-empty">No materials have been uploaded for this course yet.</p>}
            {recentMaterials.length > 0 && (
              <ul className="slpc-stack slpc-gap-sm">
                {recentMaterials.map((item) => (
                  <li key={item.id} className="slpc-row-item">
                    <div className="slpc-row-main">
                      <FileBadge item={item} />
                      <div className="slpc-row-text">
                        <div className="slpc-row-title">
                          <span className="slpc-cell-title slpc-truncate">{item.file_name}</span>
                          <span className={`slpc-chip ${item.published ? 'is-ok' : 'is-quiet'}`}>{item.published ? 'Published' : 'Draft'}</span>
                        </div>
                        <div className="slpc-row-meta">
                          <span>
                            {CATEGORY_LABELS[item.category] ?? sentenceCase(item.category)} • {formatSize(item.file_size)}
                          </span>
                          <span>• Added {formatDate(item.created_at)}</span>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="slpc-tool"
                      title="Download Resource"
                      aria-label={`Download ${item.title}`}
                      disabled={downloads.busy === item.id}
                      onClick={() => downloads.start(item.id, `/materials/${item.id}/download`)}
                    >
                      {renderIcon('download', 18)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="slpc-stack slpc-gap-lg">
          <section className="slpc-card slpc-panel" aria-labelledby="slpc-ops-title">
            <div className="slpc-inline">
              <span className="slpc-accent">{renderIcon('bolt', 20)}</span>
              <h2 id="slpc-ops-title" className="slpc-h3">
                Quick Operations Hub
              </h2>
            </div>
            <p className="slpc-muted">Shortcuts for this course.</p>
            <div className="slpc-tiles">
              <Link to={`${base}/courses/${courseId}/assignments`} className="slpc-tile">
                <span className="slpc-accent">{renderIcon('add_task', 20)}</span>
                <span className="slpc-tile-text">
                  <span className="slpc-tile-title">Create Assignment</span>
                  <span className="slpc-tile-sub">Set rubrics &amp; limits</span>
                </span>
              </Link>
              <Link to={`${base}/courses/${courseId}/materials`} className="slpc-tile">
                <span className="slpc-accent">{renderIcon('file_upload', 20)}</span>
                <span className="slpc-tile-text">
                  <span className="slpc-tile-title">Upload Material</span>
                  <span className="slpc-tile-sub">PDF, DOCX, ZIP up to 25 MB</span>
                </span>
              </Link>
              <Link to={`${base}/courses/${courseId}/attendance`} className="slpc-tile">
                <span className="slpc-accent">{renderIcon('checklist_rtl', 20)}</span>
                <span className="slpc-tile-text">
                  <span className="slpc-tile-title">Log Attendance</span>
                  <span className="slpc-tile-sub">{typeof enrolled === 'number' ? `Mark ${enrolled} students` : 'Mark your class'}</span>
                </span>
              </Link>
              <Link to={`${base}/courses/${courseId}/marks`} className="slpc-tile">
                <span className="slpc-accent">{renderIcon('calculate', 20)}</span>
                <span className="slpc-tile-text">
                  <span className="slpc-tile-title">Enter Marks</span>
                  <span className="slpc-tile-sub">Spreadsheet upsert</span>
                </span>
              </Link>
              <Link to={`${base}/courses/${courseId}/announcements`} className="slpc-tile is-wide">
                <span className="slpc-inline slpc-tile-lead">
                  <span className="slpc-accent">{renderIcon('campaign', 20)}</span>
                  <span className="slpc-tile-text">
                    <span className="slpc-tile-title">Broadcast Cohort Announcement</span>
                    <span className="slpc-tile-sub">{typeof enrolled === 'number' ? `Reach all ${enrolled} students` : 'Reach your whole cohort'}</span>
                  </span>
                </span>
                {renderIcon('chevron_right', 16)}
              </Link>
            </div>
          </section>

          <section className="slpc-card slpc-panel" aria-labelledby="slpc-att-title">
            <div className="slpc-panel-head">
              <div className="slpc-inline">
                <span className="slpc-accent">{renderIcon('fact_check', 20)}</span>
                <h2 id="slpc-att-title" className="slpc-h3">
                  Attendance &amp; Compliance
                </h2>
              </div>
              <span className="slpc-pill">Phase 6</span>
            </div>
            <p className="slpc-empty">Session logs and the 80% threshold monitor will appear here once attendance (Phase 6) goes live.</p>
          </section>

          <section className="slpc-card slpc-panel" aria-labelledby="slpc-grade-title">
            <div className="slpc-inline">
              <span className="slpc-accent">{renderIcon('analytics', 20)}</span>
              <h2 id="slpc-grade-title" className="slpc-h3">
                Grade Release Pipeline
              </h2>
            </div>
            {assessmentsQuery.isPending && <div className="slpc-skeleton slpc-skeleton-sm" aria-busy="true" />}
            {assessmentsQuery.isError && <p className="slpc-empty">The grade pipeline could not be loaded.</p>}
            {assessmentsQuery.isSuccess && assessments.length === 0 && <p className="slpc-empty">No assessments have been set up for this course yet.</p>}
            {assessments.length > 0 && (
              <ul className="slpc-stack slpc-gap-sm">
                {assessments.slice(0, 4).map((item) => (
                  <li key={item.id} className={`slpc-row-item is-compact ${item.published ? '' : 'is-draft'}`}>
                    <div>
                      <div className="slpc-row-title">
                        <span className="slpc-cell-title">{item.name}</span>
                        {typeof item.weight === 'number' && <span className="slpc-muted">({trimNumber(item.weight)}% Weight)</span>}
                      </div>
                      <span className="slpc-muted">
                        {typeof item.marks_entered === 'number' && typeof enrolled === 'number'
                          ? `${item.marks_entered} of ${enrolled} marked`
                          : `Max ${trimNumber(item.max_marks)}`}
                      </span>
                    </div>
                    <span className={`slpc-chip ${item.published ? 'is-ok' : 'is-quiet'}`}>{item.published ? 'RELEASED' : 'DRAFT LOCK'}</span>
                  </li>
                ))}
              </ul>
            )}
            {draftAssessment && (
              <button type="button" className="slpc-link-btn slpc-inline-tight" onClick={() => selectTab('marks')}>
                Publish marks from the Marks &amp; Assessments tab {renderIcon('arrow_forward', 14)}
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function SubmissionRow({ row, assignment, index, now, downloads }) {
  const late = row.status === 'late'
  return (
    <li className="slpc-row-item">
      <div className="slpc-row-main is-top">
        <span className={`slpc-avatar-md is-${AVATAR_TONES[index % AVATAR_TONES.length]}`}>{initials(row.student_name)}</span>
        <div className="slpc-row-text">
          <div className="slpc-row-title slpc-wrap">
            <span className="slpc-cell-title">{row.student_name}</span>
            <span className="slpc-mono slpc-reg">{row.registration_number}</span>
            <span className={`slpc-chip ${late ? 'is-warn' : 'is-ok'}`}>{SUBMISSION_LABELS[row.status] ?? sentenceCase(row.status)}</span>
          </div>
          <div className="slpc-row-meta">
            <span className="slpc-inline-tight slpc-muted-icon">{renderIcon('attach_file', 14)}</span>
            <span className="slpc-truncate">
              {row.file_name} ({formatSize(row.file_size)})
            </span>
            <span>• Submitted {timeAgo(row.submitted_at, now)}</span>
          </div>
        </div>
      </div>
      <div className="slpc-row-actions">
        <button
          type="button"
          className="slpc-tool"
          title="Download Archive"
          aria-label={`Download submission from ${row.student_name}`}
          disabled={downloads.busy === row.id}
          onClick={() => downloads.start(row.id, `/submissions/${row.id}/download`)}
        >
          {renderIcon('download', 16)}
        </button>
        <Link to={`${base}/assignments/${assignment.id}/submissions`} className="slpc-btn slpc-btn-primary slpc-btn-sm">
          {renderIcon('rate_review', 16)}
          Grade (0-{trimNumber(assignment.max_marks)})
        </Link>
      </div>
    </li>
  )
}

function StudentsPanel({ courseId }) {
  const [search, setSearch] = useState('')
  const query = useQuery({
    queryKey: ['course-students', courseId],
    queryFn: () => api(`/courses/${courseId}/students?page_size=100`),
  })
  const students = useMemo(() => toList(query.data), [query.data])
  const visible = students.filter((item) => {
    const needle = search.trim().toLowerCase()
    return !needle || String(item.full_name).toLowerCase().includes(needle) || String(item.registration_number).toLowerCase().includes(needle)
  })
  return (
    <div className="slpc-stack">
      <div className="slpc-card slpc-filter">
        <p className="slpc-muted">{query.isSuccess ? `Showing ${visible.length} of ${countOf(query.data)} enrolled students` : 'Your enrolled cohort'}</p>
        <label className="slpc-search">
          {renderIcon('search', 18)}
          <input
            type="search"
            value={search}
            maxLength={100}
            placeholder="Search by name or registration number..."
            aria-label="Search students"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      {query.isPending && <Skeleton height={160} label="Loading students" />}
      {query.isError && <ErrorCard message="We could not load the student roster." onRetry={() => query.refetch()} />}
      {query.isSuccess && students.length === 0 && (
        <div className="slpc-card slpc-state">
          <p>No students are enrolled in this course yet.</p>
        </div>
      )}
      {query.isSuccess && students.length > 0 && visible.length === 0 && (
        <div className="slpc-card slpc-state">
          <p>No students match your search.</p>
        </div>
      )}
      {visible.length > 0 && (
        <div className="slpc-card slpc-table-card">
          <div className="slpc-table-scroll">
            <table className="slpc-table">
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">Registration No.</th>
                  <th scope="col">Programme</th>
                  <th scope="col">Year</th>
                  <th scope="col">Status</th>
                  <th scope="col">Enrolled</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.student_id}>
                    <td>
                      <span className="slpc-cell-title">{item.full_name}</span>
                      <span className="slpc-cell-sub">{item.email}</span>
                    </td>
                    <td className="slpc-mono slpc-nowrap">{item.registration_number}</td>
                    <td>{item.program || <span className="slpc-muted">—</span>}</td>
                    <td className="slpc-nowrap">{item.year_of_study ?? '—'}</td>
                    <td>
                      <span className={`slpc-chip ${item.enrollment_status === 'active' ? 'is-ok' : 'is-quiet'}`}>{sentenceCase(item.enrollment_status)}</span>
                    </td>
                    <td className="slpc-nowrap">{formatDate(item.enrolled_at)}</td>
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

function MaterialsPanel({ materials, query, downloads }) {
  const [search, setSearch] = useState('')
  const visible = materials.filter((item) => !search.trim() || String(item.title).toLowerCase().includes(search.trim().toLowerCase()))
  return (
    <div className="slpc-stack">
      <div className="slpc-card slpc-filter">
        <p className="slpc-muted">{query.isSuccess ? `Showing ${visible.length} of ${materials.length} files` : 'Files for this course'}</p>
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
          <p>No materials have been uploaded for this course yet.</p>
        </div>
      )}
      {query.isSuccess && materials.length > 0 && visible.length === 0 && (
        <div className="slpc-card slpc-state">
          <p>No materials match your search.</p>
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
                  <th scope="col">Status</th>
                  <th scope="col">Added</th>
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
                    <td>
                      <span className={`slpc-chip ${item.published ? 'is-ok' : 'is-quiet'}`}>{item.published ? 'Published' : 'Draft'}</span>
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

function AssignmentsPanel({ assignments, query, details, now }) {
  return (
    <div className="slpc-stack">
      {query.isPending && <Skeleton height={140} label="Loading assignments" />}
      {query.isError && <ErrorCard message="We could not load the assignments." onRetry={() => query.refetch()} />}
      {query.isSuccess && assignments.length === 0 && (
        <div className="slpc-card slpc-state">
          <p>No assignments have been created for this course yet.</p>
        </div>
      )}
      {assignments.length > 0 && (
        <ul className="slpc-stack">
          {assignments.map((item, index) => {
            const counts = details[index]?.data?.submission_counts
            const pending = pendingOf(details[index]?.data)
            return (
              <li key={item.id} className={`slpc-card slpc-assignment is-${item.state === 'open' ? 'soon' : 'later'}`}>
                <div className="slpc-assignment-main">
                  <div className="slpc-task-meta">
                    <span className={`slpc-due is-${item.state === 'open' ? 'soon' : 'later'}`}>{STATE_LABELS[item.state] ?? sentenceCase(item.state)}</span>
                    <span className="slpc-muted">Due {formatDate(item.due_at)}</span>
                  </div>
                  <h3 className="slpc-assignment-title">{item.title}</h3>
                  {item.description && <p className="slpc-clamp">{item.description}</p>}
                  <div className="slpc-facts slpc-mono">
                    <span className="slpc-inline-tight">
                      {renderIcon('scale', 15)}
                      {trimNumber(item.max_marks)} pts
                    </span>
                    {counts ? (
                      <>
                        <span>{counts.total} submitted</span>
                        <span>{counts.graded + (counts.returned ?? 0)} graded</span>
                        <span className={pending > 0 ? 'slpc-need' : ''}>{pending} to grade</span>
                      </>
                    ) : (
                      <span>{details[index]?.isError ? 'Counts unavailable' : 'Loading…'}</span>
                    )}
                    <span>{timeAgo(item.created_at, now)}</span>
                  </div>
                </div>
                <div className="slpc-assignment-action">
                  <Link to={`${base}/assignments/${item.id}/submissions`} className={`slpc-btn ${pending > 0 ? 'slpc-btn-primary' : 'slpc-btn-soft'}`}>
                    {renderIcon('rate_review', 18)}
                    Review Submissions
                  </Link>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function SubmissionsPanel({ assignments, queue, now, downloads }) {
  const [picked, setPicked] = useState('')
  const [status, setStatus] = useState('pending')
  const selected = assignments.find((item) => item.id === picked) ?? queue ?? assignments[0]
  const query = useQuery({
    queryKey: ['assignment-submissions', selected?.id],
    queryFn: () => api(`/assignments/${selected.id}/submissions?page_size=100`),
    enabled: Boolean(selected),
  })
  const rows = toList(query.data).filter((row) =>
    status === 'all' ? true : status === 'pending' ? ['submitted', 'late'].includes(row.status) : ['graded', 'returned'].includes(row.status),
  )

  if (assignments.length === 0) {
    return (
      <div className="slpc-card slpc-state">
        <p>No assignments have been created for this course yet.</p>
      </div>
    )
  }
  return (
    <div className="slpc-stack">
      <div className="slpc-card slpc-filter">
        <label className="slpc-field">
          <span className="slpc-eyebrow">Assignment</span>
          <select className="slpc-select" value={selected?.id ?? ''} aria-label="Choose assignment" onChange={(event) => setPicked(event.target.value)}>
            {assignments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <label className="slpc-field">
          <span className="slpc-eyebrow">Show</span>
          <select className="slpc-select" value={status} aria-label="Filter submissions" onChange={(event) => setStatus(event.target.value)}>
            <option value="pending">Waiting to be graded</option>
            <option value="graded">Graded</option>
            <option value="all">All submissions</option>
          </select>
        </label>
      </div>
      {downloads.error && (
        <p className="slpc-alert" role="alert">
          {downloads.error}
        </p>
      )}
      {query.isPending && <Skeleton height={140} label="Loading submissions" />}
      {query.isError && <ErrorCard message="We could not load these submissions." onRetry={() => query.refetch()} />}
      {query.isSuccess && rows.length === 0 && (
        <div className="slpc-card slpc-state">
          <p>{status === 'pending' ? 'Nothing is waiting to be graded for this assignment.' : 'No submissions match this filter.'}</p>
        </div>
      )}
      {rows.length > 0 && (
        <ul className="slpc-card slpc-panel slpc-stack slpc-gap-sm">
          {rows.map((row, index) => (
            <SubmissionRow key={row.id} row={row} assignment={selected} index={index} now={now} downloads={downloads} />
          ))}
        </ul>
      )}
    </div>
  )
}

function MarksPanel({ courseId, assessments, query, enrolled }) {
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState('')
  const [error, setError] = useState('')
  const publish = useMutation({
    mutationFn: (id) => api(`/assessments/${id}`, { method: 'PATCH', body: { published: true } }),
    onSuccess: async () => {
      setConfirming('')
      setError('')
      await queryClient.invalidateQueries({ queryKey: ['course-assessments', courseId] })
    },
    onError: (caught) => setError(caught?.message || 'The marks could not be published. Please try again.'),
  })
  return (
    <div className="slpc-stack">
      {error && (
        <p className="slpc-alert" role="alert">
          {error}
        </p>
      )}
      {query.isPending && <Skeleton height={160} label="Loading assessments" />}
      {query.isError && <ErrorCard message="We could not load the assessments." onRetry={() => query.refetch()} />}
      {query.isSuccess && assessments.length === 0 && (
        <div className="slpc-card slpc-state">
          <p>No assessments have been set up for this course yet.</p>
        </div>
      )}
      {assessments.length > 0 && (
        <div className="slpc-card slpc-table-card">
          <div className="slpc-table-scroll">
            <table className="slpc-table">
              <thead>
                <tr>
                  <th scope="col">Assessment</th>
                  <th scope="col">Weight</th>
                  <th scope="col">Max</th>
                  <th scope="col">Marked</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="slpc-visually-hidden">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {assessments.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <span className="slpc-cell-title">{item.name}</span>
                      <span className="slpc-cell-sub">{sentenceCase(item.type)}</span>
                    </td>
                    <td className="slpc-nowrap">{typeof item.weight === 'number' ? `${trimNumber(item.weight)}%` : '—'}</td>
                    <td className="slpc-nowrap">{trimNumber(item.max_marks)}</td>
                    <td className="slpc-nowrap">
                      {typeof item.marks_entered === 'number' ? `${item.marks_entered}${typeof enrolled === 'number' ? ` of ${enrolled}` : ''}` : '—'}
                    </td>
                    <td>
                      <span className={`slpc-chip ${item.published ? 'is-ok' : 'is-quiet'}`}>{item.published ? 'RELEASED' : 'DRAFT LOCK'}</span>
                    </td>
                    <td className="slpc-right">
                      {!item.published &&
                        (confirming === item.id ? (
                          <span className="slpc-confirm" role="group" aria-label={`Confirm publishing ${item.name}`}>
                            <span className="slpc-muted">Students will see these marks.</span>
                            <button type="button" className="slpc-btn slpc-btn-primary slpc-btn-sm" disabled={publish.isPending} onClick={() => publish.mutate(item.id)}>
                              {publish.isPending ? 'Publishing…' : 'Yes, publish'}
                            </button>
                            <button type="button" className="slpc-btn slpc-btn-soft slpc-btn-sm" onClick={() => setConfirming('')}>
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button type="button" className="slpc-btn slpc-btn-primary slpc-btn-sm" onClick={() => setConfirming(item.id)}>
                            {renderIcon('lock_open', 14)}
                            Publish to Cohort
                          </button>
                        ))}
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

/* -------------------------------------------------------------- detail view */

function CourseDetail({ courseId }) {
  const [params, setParams] = useSearchParams()
  const now = useClock()
  const downloads = useDownloads()
  const tabRefs = useRef({})

  const requested = params.get('tab')
  const tab = TABS.some((item) => item.id === requested) ? requested : 'overview'
  const activeTab = TABS.find((item) => item.id === tab)

  const courseQuery = useQuery({
    queryKey: detailKey(courseId),
    queryFn: () => api(`/courses/${courseId}`),
    // A missing or forbidden course will not appear by retrying; only server errors are retried.
    retry: (failures, error) => error?.status >= 500 && failures < 2,
  })
  const coursesQuery = useQuery({ queryKey: COURSES_KEY, queryFn: fetchCourses })
  const studentsQuery = useQuery({
    queryKey: ['course-students', courseId],
    queryFn: () => api(`/courses/${courseId}/students?page_size=100`),
  })
  const materialsQuery = useQuery({
    queryKey: ['course-materials', courseId],
    queryFn: () => api(`/courses/${courseId}/materials?page_size=100`),
  })
  const assignmentsQuery = useQuery({
    queryKey: ['course-assignments', courseId],
    queryFn: () => api(`/courses/${courseId}/assignments?page_size=100`),
  })
  const assessmentsQuery = useQuery({
    queryKey: ['course-assessments', courseId],
    queryFn: () => api(`/courses/${courseId}/assessments?page_size=100`),
  })

  const course = courseQuery.data
  const courses = useMemo(() => toList(coursesQuery.data), [coursesQuery.data])
  const materials = useMemo(() => toList(materialsQuery.data), [materialsQuery.data])
  const assignments = useMemo(() => toList(assignmentsQuery.data), [assignmentsQuery.data])
  const assessments = useMemo(() => toList(assessmentsQuery.data), [assessmentsQuery.data])

  // submission_counts only come from the single-assignment endpoint, so ask for each one.
  const detailQueries = useQueries({
    queries: assignments.map((item) => ({
      queryKey: ['assignment', item.id],
      queryFn: () => api(`/assignments/${item.id}`),
    })),
  })
  // The same ['course', id] key as the page header, so switching courses reuses what is cached.
  const switcherQueries = useQueries({
    queries: courses.map((item) => ({
      queryKey: detailKey(item.id),
      queryFn: () => api(`/courses/${item.id}`),
      staleTime: 60_000,
    })),
  })

  const detailsSettled = assignmentsQuery.isSuccess && detailQueries.every((query) => query.isSuccess)
  const detailsFailed = assignmentsQuery.isError || detailQueries.some((query) => query.isError)
  const pendingTotal = detailsSettled ? detailQueries.reduce((sum, query) => sum + pendingOf(query.data), 0) : null
  const queue = useMemo(() => {
    let best = null
    let bestCount = 0
    assignments.forEach((item, index) => {
      const count = pendingOf(detailQueries[index]?.data)
      if (count > bestCount) {
        best = item
        bestCount = count
      }
    })
    return best
  }, [assignments, detailQueries])
  const queueQuery = useQuery({
    queryKey: ['assignment-submissions', queue?.id],
    queryFn: () => api(`/assignments/${queue.id}/submissions?page_size=100`),
    enabled: Boolean(queue),
  })

  const enrolled = typeof course?.enrolled_count === 'number' ? course.enrolled_count : studentsQuery.isSuccess ? countOf(studentsQuery.data) : undefined
  const lecturer = course?.lecturers?.[0]

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

  const badges = {
    students: typeof enrolled === 'number' ? { text: String(enrolled), tone: 'mid' } : null,
    materials: materialsQuery.isSuccess ? { text: String(countOf(materialsQuery.data)), tone: 'mid' } : null,
    assignments: assignmentsQuery.isSuccess ? { text: String(countOf(assignmentsQuery.data)), tone: 'mid' } : null,
    submissions: pendingTotal ? { text: `${pendingTotal} Pending`, tone: 'alert' } : null,
  }

  if (courseQuery.isError) {
    const gone = courseQuery.error?.status === 404 || courseQuery.error?.status === 403
    return (
      <>
        <div className="slpc-topbar">
          <Trail items={[{ label: 'My Courses', to: `${base}/courses` }, { label: 'Course', strong: true }]} />
        </div>
        <ErrorCard
          message={gone ? 'We could not find this course among the courses you teach.' : 'We could not load this course.'}
          onRetry={gone ? undefined : () => courseQuery.refetch()}
        >
          <Link to={`${base}/courses`} className="slpc-btn slpc-btn-soft">
            Back to My Courses
          </Link>
        </ErrorCard>
      </>
    )
  }

  const queueCount = pendingTotal ?? 0
  return (
    <>
      <div className="slpc-topbar">
        <Trail
          items={[
            { label: 'My Courses', to: `${base}/courses` },
            { label: course ? courseTitle(course) : 'Course' },
            { label: activeTab.label, strong: true },
          ]}
        />
      </div>

      <div className="slpc-stack slpc-gap-lg">
        {courses.length > 1 && (
          <nav className="slpc-switcher-bar" aria-label="Switch course">
            {courses.map((item, index) => {
              const active = item.id === courseId
              const count = switcherQueries[index]?.data?.enrolled_count
              const body = (
                <>
                  <span className="slpc-switch-badge">{courseBadge(item)}</span>
                  <span className="slpc-switch-text">
                    <span className="slpc-switch-title">
                      {courseTitle(item)}
                      {active && <span className="slpc-current">Current</span>}
                    </span>
                    <span className="slpc-switch-sub">
                      {typeof count === 'number' ? `${count} Enrolled` : 'Course'}
                      {active && pendingTotal !== null ? ` • ${pendingTotal} Pending Submissions` : ''}
                    </span>
                  </span>
                </>
              )
              return active ? (
                <span key={item.id} className="slpc-switch-card is-active" aria-current="page">
                  {body}
                </span>
              ) : (
                <Link key={item.id} to={`${base}/courses/${item.id}`} className="slpc-switch-card">
                  {body}
                </Link>
              )
            })}
          </nav>
        )}

        {courseQuery.isPending ? (
          <Skeleton height={200} label="Loading course" />
        ) : (
          <section className="slpc-card slpc-hero" aria-labelledby="slpc-course-title">
            <div className="slpc-hero-glow" aria-hidden="true" />
            <div className="slpc-hero-main">
              <div className="slpc-hero-meta">
                <span className="slpc-mono slpc-code-pill">{course.course_code}</span>
                <span className="slpc-pill">{Number(course.credit_hours) || 0} Credit Hours</span>
                <span className="slpc-pill">
                  {formatSemester(course.semester)} • {course.academic_year}
                </span>
              </div>
              <h1 id="slpc-course-title" className="slpc-h1">
                {courseTitle(course)}
              </h1>
              <p className="slpc-lead">{course.description || 'No course description has been published yet.'}</p>
              <div className="slpc-banner">
                <span className="slpc-accent">{renderIcon('notifications_active', 18)}</span>
                <span>
                  {pendingTotal === null && (detailsFailed ? 'We could not check for submissions waiting to be graded.' : 'Checking for submissions waiting to be graded…')}
                  {pendingTotal === 0 && 'No submissions are waiting to be graded.'}
                  {pendingTotal > 0 && (
                    <>
                      <strong className="slpc-strong">
                        {queueCount} {queueCount === 1 ? 'submission is' : 'submissions are'}
                      </strong>{' '}
                      waiting to be graded.
                    </>
                  )}
                  {lecturer && course.lecturers.length > 1 && ` Co-taught with ${course.lecturers.length - 1} other ${course.lecturers.length === 2 ? 'lecturer' : 'lecturers'}.`}
                </span>
              </div>
            </div>
            <div className="slpc-cta">
              <Link to={`${base}/courses/${courseId}/assignments`} className="slpc-btn slpc-btn-primary slpc-btn-lg">
                {renderIcon('post_add', 18)}
                New Assignment
              </Link>
              <Link to={`${base}/courses/${courseId}/attendance`} className="slpc-btn slpc-btn-soft slpc-btn-lg">
                {renderIcon('how_to_reg', 18)}
                Log Class Attendance
              </Link>
            </div>
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
              ctx={{
                courseId,
                now,
                enrolled,
                materials,
                materialsQuery,
                assignments,
                assignmentsQuery,
                pendingTotal,
                queue,
                queueQuery,
                assessments,
                assessmentsQuery,
                downloads,
                selectTab,
              }}
            />
          )}
          {tab === 'students' && <StudentsPanel courseId={courseId} />}
          {tab === 'materials' && <MaterialsPanel materials={materials} query={materialsQuery} downloads={downloads} />}
          {tab === 'assignments' && <AssignmentsPanel assignments={assignments} query={assignmentsQuery} details={detailQueries} now={now} />}
          {tab === 'submissions' && <SubmissionsPanel assignments={assignments} queue={queue} now={now} downloads={downloads} />}
          {tab === 'marks' && <MarksPanel courseId={courseId} assessments={assessments} query={assessmentsQuery} enrolled={enrolled} />}
          {PHASE_TABS[tab] && (
            <PhasePanel icon={PHASE_TABS[tab].icon} title={PHASE_TABS[tab].title} phase={PHASE_TABS[tab].phase}>
              {PHASE_TABS[tab].text}
            </PhasePanel>
          )}
        </div>

        <footer className="slpc-card slpc-footbar">
          <span className="slpc-inline slpc-wrap">
            <span className="slpc-accent">{renderIcon('security', 18)}</span>
            {lecturer && (
              <span>
                Course Lead: <strong className="slpc-strong">{[lecturer.title, lecturer.full_name].filter(Boolean).join(' ')}</strong>
              </span>
            )}
            <span>•</span>
            <span>
              Role: <strong className="slpc-strong">Lecturer</strong>
            </span>
            <span>•</span>
            <span className="slpc-mono slpc-scope-pill">Enrolled Course Scoped</span>
          </span>
        </footer>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------- export */

function LecturerCourses() {
  const { courseId } = useParams()
  useCourseFonts()

  return (
    <div className="slpc">
      <style>{COURSE_STYLES}</style>
      <style>{LECTURER_STYLES}</style>
      {courseId ? <CourseDetail key={courseId} courseId={courseId} /> : <Catalog />}
    </div>
  )
}

export default LecturerCourses

const LECTURER_STYLES = `
.slpc .slpc-trail-gap { gap: 0.5rem; }
.slpc .slpc-gap-sm { gap: 0.5rem; }
.slpc .slpc-wrap { flex-wrap: wrap; }
.slpc .slpc-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.slpc .slpc-muted-icon { color: var(--outline); display: inline-flex; }
.slpc .slpc-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1 1 220px; }
.slpc .slpc-field .slpc-select { width: 100%; }
.slpc .slpc-chip.is-alert { background: var(--error-container); color: var(--on-error-container); }
.slpc .slpc-stat-value.is-accent { color: var(--primary); }
.slpc .slpc-stat-unit.is-alert { color: var(--error); font-weight: 600; }
.slpc .slpc-stat-note { flex: 1 0 100%; margin-top: 2px; font-size: 13px; line-height: 18px; color: var(--outline); }
.slpc .slpc-stat-icon.is-alert { background: var(--error-container); color: var(--on-error-container); }
.slpc .slpc-stat-foot .slpc-link-btn { font-size: 12px; line-height: 16px; }
.slpc .slpc-badge.is-alert { background: var(--error-container); color: var(--on-error-container); font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; }
.slpc .slpc-switcher-bar { display: flex; align-items: stretch; gap: 0.5rem; overflow-x: auto; padding-bottom: 4px; }
.slpc .slpc-switch-card {
  display: inline-flex; align-items: center; gap: 12px; padding: 10px 16px; border-radius: 16px; flex: 0 0 auto;
  background: var(--surface-lowest); color: var(--on-surface); text-align: left; white-space: nowrap;
  box-shadow: 0 1px 3px rgba(30, 26, 35, 0.08); transition: background 0.2s;
}
.slpc a.slpc-switch-card:hover { background: var(--surface-mid); }
.slpc .slpc-switch-card.is-active { background: var(--primary); color: var(--on-primary); }
.slpc .slpc-switch-badge {
  width: 32px; height: 32px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
  background: var(--surface-high); color: var(--on-surface-variant); font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 12px; font-weight: 700;
}
.slpc .slpc-switch-card.is-active .slpc-switch-badge { background: rgba(255, 255, 255, 0.2); color: #fff; }
.slpc .slpc-switch-text { display: flex; flex-direction: column; gap: 2px; }
.slpc .slpc-switch-title { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; line-height: 16px; font-weight: 600; }
.slpc .slpc-switch-sub { font-size: 11px; line-height: 14px; font-weight: 600; opacity: 0.8; }
.slpc .slpc-current { padding: 2px 6px; border-radius: 999px; background: rgba(255, 255, 255, 0.2); font-size: 10px; line-height: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
.slpc .slpc-code-pill { padding: 2px 8px; border-radius: 6px; background: var(--primary-fixed); color: var(--primary); font-size: 12px; font-weight: 700; }
.slpc .slpc-banner { display: flex; align-items: center; gap: 12px; padding: 8px 14px; border-radius: 12px; background: var(--surface-low); color: var(--on-surface-variant); font-size: 13px; line-height: 18px; }
.slpc .slpc-banner > span:last-child { min-width: 0; }
.slpc .slpc-cta { position: relative; display: flex; flex-wrap: wrap; gap: 8px; flex: 0 0 auto; }
.slpc .slpc-btn-lg { height: 40px; padding: 0 16px; }
.slpc .slpc-btn-sm { padding: 6px 14px; }
.slpc .slpc-stats.is-five { grid-template-columns: minmax(0, 1fr); }
.slpc .slpc-stats.is-five .slpc-stat { justify-content: flex-start; }
.slpc .slpc-stats.is-five .slpc-stat-body { min-height: 76px; align-content: flex-start; align-items: baseline; }
.slpc .slpc-stats.is-five .slpc-stat-foot { margin-top: auto; }
.slpc .slpc-row-item {
  display: flex; flex-direction: column; align-items: stretch; justify-content: space-between; gap: 12px; padding: 14px;
  border-radius: 12px; background: var(--surface-low); transition: background 0.2s;
}
.slpc .slpc-row-item:hover { background: var(--surface-mid); }
.slpc .slpc-row-item.is-compact { flex-direction: row; align-items: center; padding: 10px; }
.slpc .slpc-row-item.is-draft { border: 2px solid rgba(160, 50, 35, 0.2); background: var(--surface-mid); }
.slpc .slpc-row-main { display: flex; align-items: center; gap: 12px; min-width: 0; }
.slpc .slpc-row-main.is-top { align-items: flex-start; }
.slpc .slpc-row-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.slpc .slpc-row-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
.slpc .slpc-row-title.slpc-wrap { flex-wrap: wrap; }
.slpc .slpc-row-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px; font-size: 13px; line-height: 18px; color: var(--outline); }
.slpc .slpc-row-actions { display: flex; align-items: center; gap: 8px; align-self: flex-end; flex: 0 0 auto; }
.slpc .slpc-reg { font-size: 11px; color: var(--outline); }
.slpc .slpc-avatar-md { width: 36px; height: 36px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; background: var(--primary-fixed); color: var(--on-primary-fixed); font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 13px; font-weight: 700; }
.slpc .slpc-avatar-md.is-tertiary { background: var(--tertiary-fixed); color: var(--on-tertiary-fixed); }
.slpc .slpc-avatar-md.is-secondary { background: #ffdadb; color: #40000d; }
.slpc .slpc-file { width: 40px; height: 40px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.slpc .slpc-file.is-pdf { background: #fee2e2; color: #b91c1c; }
.slpc .slpc-file.is-zip { background: #fef3c7; color: #92400e; }
.slpc .slpc-file.is-ppt { background: #f3e8ff; color: #6b21a8; }
.slpc .slpc-file.is-doc { background: var(--surface-high); color: var(--on-surface-variant); }
.slpc .slpc-tool {
  width: 34px; height: 34px; border: 0; border-radius: 8px; cursor: pointer; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
  background: var(--surface-lowest); color: var(--on-surface-variant); transition: background 0.2s, color 0.2s;
}
.slpc .slpc-tool:hover:not(:disabled) { background: var(--surface-highest); color: var(--on-surface); }
.slpc .slpc-tool:disabled { opacity: 0.6; cursor: progress; }
.slpc .slpc-callout { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 12px; border-radius: 12px; background: var(--surface-mid); }
.slpc .slpc-more { font-size: 11px; font-weight: 700; color: var(--primary); }
.slpc .slpc-tiles { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
.slpc .slpc-tile {
  display: flex; align-items: flex-start; gap: 10px; padding: 12px; border-radius: 12px; background: var(--surface-low); color: var(--on-surface);
  transition: background 0.2s, color 0.2s;
}
.slpc .slpc-tile:hover { background: var(--primary-container); color: var(--on-primary-container); }
.slpc .slpc-tile:hover .slpc-accent, .slpc .slpc-tile:hover .slpc-tile-sub { color: var(--on-primary-container); }
.slpc .slpc-tile.is-wide { align-items: center; justify-content: space-between; }
.slpc .slpc-tile-lead { align-items: flex-start; }
.slpc .slpc-tile-text { display: flex; flex-direction: column; min-width: 0; }
.slpc .slpc-tile-title { font-size: 16px; line-height: 20px; font-weight: 600; }
.slpc .slpc-tile-sub { margin-top: 2px; font-size: 11px; line-height: 14px; font-weight: 600; color: var(--outline); }
.slpc .slpc-need { color: var(--primary); font-weight: 700; }
.slpc .slpc-confirm { display: inline-flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
.slpc .slpc-footbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; font-size: 13px; line-height: 18px; color: var(--outline); }
.slpc .slpc-scope-pill { padding: 2px 8px; border-radius: 6px; background: var(--surface-low); color: var(--primary); font-size: 12px; font-weight: 600; }
@media (min-width: 640px) {
  .slpc .slpc-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .slpc .slpc-tile.is-wide { grid-column: span 2; }
  .slpc .slpc-stats.is-five { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 768px) {
  .slpc .slpc-row-item:not(.is-compact) { flex-direction: row; align-items: center; }
  .slpc .slpc-row-item:not(.is-compact) .slpc-row-actions { align-self: center; }
}
@media (min-width: 1024px) {
  .slpc .slpc-stats.is-five { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .slpc .slpc-split.is-seven { grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); }
  .slpc .slpc-hero { flex-direction: row; align-items: flex-start; justify-content: space-between; gap: 1.5rem; }
  .slpc .slpc-cta { flex-direction: column; }
}
`
