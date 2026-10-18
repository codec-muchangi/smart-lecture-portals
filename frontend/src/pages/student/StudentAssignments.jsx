import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/apiClient.js'
import {
  COURSES_KEY,
  COURSE_STYLES,
  ErrorCard,
  Skeleton,
  fetchCourses,
  renderIcon,
  trimNumber,
  useClock,
  useCourseFonts,
  useDownloads,
} from '../../components/courseKit.jsx'
import { ALLOWED_EXTENSIONS, MAX_UPLOAD_MB, validateFile } from '../../components/SubmitModal.jsx'
import { dueInfo, formatDue, formatSize, sentenceCase, timeAgo, toList } from '../../utils/format.js'

/*
 * Smart Lecture Portal: student Assignments & Submissions
 * Place at: src/pages/student/StudentAssignments.jsx
 *
 * Routes (see routes.jsx):
 *   /student/assignments                      assignments from every course you are enrolled in
 *   /student/courses/:courseId/assignments    the same page with that course preselected
 *   /student/assignments/:assignmentId        the same page with that assignment open in the workspace
 *
 * - Renders inside AppShell, which already draws the sidebar and top bar.
 * - Built on the implemented Phase 4 contract in docs/API.md (Assignments & submissions):
 *     GET  /courses                                    enrolled courses
 *     GET  /courses/{id}/assignments                   published assignments with my_submission
 *     GET  /assignments/{id}/attachment                signed link to the brief
 *     GET  /submissions/{id}/download                  signed link to my own file
 *     POST /assignments/{id}/submissions               multipart "file" (201 first upload, 200 replacement)
 * - Marks and feedback are shown only once the lecturer has released them (grade_released).
 * - The API has no module weights, letter grades, late-penalty rules, student notes, file hashes,
 *   storage paths or bulk brief download, so none are shown. Every figure is worked out from the
 *   assignments the server returned; if any course fails to load the figures show "—" instead.
 */

const PAGE_SIZE = 5
const STATUS_LABELS = { submitted: 'Submitted', late: 'Submitted late', graded: 'Graded', returned: 'Returned for revision' }
const TABS = [
  { id: 'all', label: 'All assignments' },
  { id: 'todo', label: 'To do / pending' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'graded', label: 'Graded & feedback' },
]
const SORTS = [
  { id: 'soonest', label: 'Sort: Deadline (soonest)' },
  { id: 'latest', label: 'Sort: Deadline (latest)' },
  { id: 'course', label: 'Sort: Course' },
  { id: 'title', label: 'Sort: Title' },
]
const listKey = (courseId) => ['course-assignments', courseId]
const listPath = (courseId) => `/courses/${courseId}/assignments?page_size=100`

const ASSIGNMENT_STYLES = `
.slps-topbar { display: flex; flex-direction: column; gap: 0.75rem; }
.slps-head { display: flex; flex-direction: column; gap: 1rem; }
.slps-title { font-size: 26px; line-height: 34px; font-weight: 800; letter-spacing: -0.02em; overflow-wrap: anywhere; }
.slps-head-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.slps-head-actions .slpc-btn { height: 40px; padding: 0 18px; }
.slps-scope { display: flex; gap: 0.5rem; overflow-x: auto; padding-bottom: 4px; }
.slps-scope-btn { display: inline-flex; align-items: center; gap: 0.375rem; flex: 0 0 auto; padding: 7px 16px; border: 0; border-radius: 999px; background: var(--surface-low); color: var(--on-surface); font-size: 12px; line-height: 16px; font-weight: 700; cursor: pointer; transition: background 0.2s; white-space: nowrap; }
.slps-scope-btn:hover { background: var(--surface-mid); }
.slps-scope-btn.is-active { background: var(--primary); color: var(--on-primary); box-shadow: 0 1px 2px rgba(30, 26, 35, 0.2); }
.slps-scope-count { padding: 0 7px; border-radius: 999px; background: var(--surface-high); color: var(--on-surface-variant); font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 18px; }
.slps-scope-btn.is-active .slps-scope-count { background: rgba(255, 255, 255, 0.22); color: var(--on-primary); }
.slps-big { font-size: 28px; line-height: 36px; font-weight: 800; letter-spacing: -0.02em; }
.slps-bar { height: 6px; border-radius: 999px; background: var(--surface-mid); overflow: hidden; }
.slps-bar > span { display: block; height: 100%; border-radius: 999px; background: var(--primary); transition: width 0.4s; }
.slps-bar.is-warm > span { background: var(--tertiary); }
.slps-bar.is-cool > span { background: var(--secondary); }
.slps-stat-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.5rem; }
.slps-aside { font-size: 11px; line-height: 14px; font-weight: 700; color: var(--primary); }
.slps-aside.is-quiet { color: var(--on-surface-variant); }
.slps-toolbar { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.75rem; background: var(--surface-low); }
.slps-tabs { display: flex; align-items: center; gap: 4px; overflow-x: auto; padding: 2px; }
.slps-tab { display: inline-flex; align-items: center; gap: 0.375rem; flex: 0 0 auto; padding: 8px 14px; border: 0; border-radius: 12px; background: transparent; color: var(--on-surface-variant); font-size: 13px; line-height: 18px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.slps-tab:hover { background: var(--surface-high); color: var(--on-surface); }
.slps-tab.is-active { background: var(--surface-lowest); color: var(--on-surface); box-shadow: 0 1px 2px rgba(30, 26, 35, 0.12); font-weight: 700; }
.slps-tools { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.5rem; align-items: center; }
.slps-tools .slpc-search { grid-column: 1 / -1; height: 40px; border-radius: 12px; background: var(--surface-lowest); }
.slps-tools .slpc-select { height: 40px; border-radius: 12px; background: var(--surface-lowest); width: 100%; min-width: 0; }
.slps-views { display: inline-flex; align-items: center; padding: 2px; border-radius: 12px; background: var(--surface-lowest); }
.slps-view { width: 36px; height: 36px; border: 0; border-radius: 10px; background: transparent; color: var(--on-surface-variant); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.slps-view:hover { color: var(--on-surface); }
.slps-view.is-active { background: var(--primary-container); color: var(--on-primary-container); }
.slps-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.slps-feed { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; min-width: 0; align-content: start; }
.slps-feed.is-grid { grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); }
.slps-feed > .slpc-empty, .slps-feed > .slpc-alert, .slps-feed > .slps-pager, .slps-feed > .slpc-skeleton, .slps-feed > .slpc-state { grid-column: 1 / -1; }
.slps-card { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 0.875rem; min-width: 0; padding: 1.25rem; cursor: default; }
.slps-card.is-urgent::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: var(--primary); }
.slps-card.is-selected { box-shadow: 0 0 0 2px var(--primary-container), 0 4px 12px rgba(30, 26, 35, 0.1); }
.slps-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 0.75rem; }
.slps-row-group { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; min-width: 0; }
.slps-code { padding: 4px 10px; border-radius: 999px; background: var(--surface-mid); font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 14px; font-weight: 700; overflow-wrap: anywhere; }
.slps-due { display: inline-flex; align-items: center; gap: 0.25rem; padding: 4px 10px; border-radius: 999px; background: var(--surface-high); font-size: 11px; line-height: 14px; font-weight: 700; }
.slps-due.is-urgent { background: var(--primary-fixed); color: var(--on-primary-fixed); }
.slps-due.is-soon { background: var(--tertiary-fixed); color: var(--on-tertiary-fixed); }
.slps-pts { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 12px; line-height: 16px; font-weight: 700; color: var(--on-surface-variant); }
.slps-card-title { font-size: 18px; line-height: 26px; font-weight: 700; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.slps-card-text { margin-top: 0.375rem; font-size: 14px; line-height: 22px; color: var(--on-surface-variant); overflow-wrap: anywhere; }
.slps-clamp { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.slps-instructions { white-space: pre-wrap; padding: 0.75rem; border-radius: 12px; background: var(--surface-low); }
.slps-facts { display: flex; flex-wrap: wrap; gap: 0.375rem; }
.slps-fact { display: inline-flex; align-items: center; gap: 0.25rem; padding: 4px 10px; border-radius: 8px; background: var(--surface-mid); font-size: 11px; line-height: 14px; font-weight: 600; color: var(--on-surface-variant); }
.slps-fact.is-mono { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-weight: 500; }
.slps-fact.is-warn { color: var(--primary); }
.slps-file { display: flex; align-items: center; gap: 0.625rem; padding: 0.625rem 0.75rem; border-radius: 12px; background: var(--surface-low); min-width: 0; }
.slps-file .material-symbols-outlined { color: var(--primary); }
.slps-file-main { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
.slps-file-name { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 12px; line-height: 18px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slps-score { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: 0.375rem; padding: 0.625rem 0.875rem; border-radius: 16px; background: var(--surface-mid); align-self: flex-start; }
.slps-score strong { font-size: 28px; line-height: 34px; font-weight: 800; color: var(--primary); }
.slps-feedback { display: flex; align-items: flex-start; gap: 0.625rem; padding: 0.75rem; border-radius: 12px; background: var(--surface-low); }
.slps-feedback .material-symbols-outlined { color: var(--primary); margin-top: 1px; }
.slps-feedback p { font-size: 13px; line-height: 20px; color: var(--on-surface-variant); font-style: italic; overflow-wrap: anywhere; white-space: pre-wrap; }
.slps-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; }
.slps-actions-group { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.slps-actions .slpc-btn { height: 36px; padding: 0 14px; font-size: 12px; }
.slps-link { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0 10px; height: 36px; border: 0; border-radius: 10px; background: transparent; color: var(--on-surface-variant); font-size: 12px; font-weight: 700; cursor: pointer; }
.slps-link:hover { background: var(--surface-mid); color: var(--on-surface); }
.slps-link:disabled { opacity: 0.6; cursor: progress; }
.slps-pager { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; font-size: 12px; color: var(--on-surface-variant); }
.slps-side { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.slps-desk { display: flex; flex-direction: column; gap: 1rem; }
.slps-desk-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; }
.slps-desk-title { font-size: 16px; line-height: 24px; font-weight: 700; overflow-wrap: anywhere; }
.slps-target { display: flex; flex-direction: column; gap: 4px; padding: 0.75rem; border-radius: 12px; background: var(--surface-low); }
.slps-target strong { font-size: 14px; line-height: 20px; font-weight: 600; overflow-wrap: anywhere; }
.slps-drop { display: flex; flex-direction: column; align-items: center; gap: 0.375rem; padding: 1.25rem 1rem; border-radius: 16px; background: var(--surface-low); text-align: center; border: 2px dashed transparent; transition: background 0.2s, border-color 0.2s; }
.slps-drop.is-drag { background: var(--surface-mid); border-color: var(--primary-container); }
.slps-drop-icon { width: 48px; height: 48px; border-radius: 999px; background: var(--primary-fixed); color: var(--on-primary-fixed); display: inline-flex; align-items: center; justify-content: center; margin-bottom: 0.25rem; }
.slps-drop strong { font-size: 15px; line-height: 22px; font-weight: 700; overflow-wrap: anywhere; }
.slps-browse { border: 0; background: none; padding: 0; color: var(--primary); font-size: 13px; font-weight: 700; text-decoration: underline; cursor: pointer; }
.slps-file-input { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); opacity: 0; }
.slps-pledge { display: flex; align-items: flex-start; gap: 0.625rem; padding: 0.75rem; border-radius: 12px; background: var(--surface-low); font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slps-pledge input { margin-top: 2px; width: 16px; height: 16px; accent-color: var(--primary); flex: 0 0 auto; cursor: pointer; }
.slps-pledge label { cursor: pointer; }
.slps-submit { width: 100%; height: 48px; justify-content: center; font-size: 14px; }
.slps-ok { padding: 0.5rem 0.75rem; border-radius: 12px; background: var(--ok-bg); color: var(--ok); font-size: 13px; line-height: 18px; font-weight: 600; }
.slps-banner { display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.625rem 0.75rem; border-radius: 12px; background: var(--warn-bg); color: var(--warn); font-size: 13px; line-height: 18px; font-weight: 600; }
.slps-rules { display: flex; flex-direction: column; gap: 0.5rem; margin: 0; padding: 0; list-style: none; font-size: 13px; line-height: 20px; color: var(--on-surface-variant); }
.slps-rules li { display: flex; align-items: flex-start; gap: 0.5rem; }
.slps-rules .material-symbols-outlined { color: var(--primary); margin-top: 1px; }
@media (min-width: 640px) {
  .slps-tools { grid-template-columns: minmax(0, 1fr) auto auto; }
  .slps-tools .slpc-search { grid-column: auto; }
}
@media (min-width: 768px) {
  .slps-head { flex-direction: row; align-items: flex-end; justify-content: space-between; }
  .slps-tools { width: 100%; }
}
@media (min-width: 1500px) {
  .slps-toolbar { flex-direction: row; align-items: center; justify-content: space-between; }
  .slps-tools { width: min(100%, 520px); }
}
@media (min-width: 1024px) {
  .slps-title { font-size: 32px; line-height: 40px; }
  .slps-split { grid-template-columns: minmax(0, 2fr) minmax(300px, 1fr); }
  .slps-desk-card { position: sticky; top: 5rem; }
}
`

const errorText = (error, fallback) => error?.message || fallback
const stateOf = (item) => item.my_submission?.status
const percentOf = (mark, max) => (max > 0 ? Math.round((mark / max) * 1000) / 10 : 0)
const isTodo = (item) => item.state === 'open' && (!item.my_submission || stateOf(item) === 'returned')
const isReleased = (item) => Boolean(item.my_submission?.grade_released) && typeof item.my_submission?.mark === 'number'
const byDue = (a, b) => new Date(a.due_at) - new Date(b.due_at)

function sortItems(list, sort) {
  const items = [...list]
  if (sort === 'latest') return items.sort((a, b) => byDue(b, a))
  if (sort === 'course') return items.sort((a, b) => a.courseCode.localeCompare(b.courseCode) || byDue(a, b))
  if (sort === 'title') return items.sort((a, b) => a.title.localeCompare(b.title))
  return items.sort((a, b) => {
    const aOpen = a.state === 'open'
    const bOpen = b.state === 'open'
    if (aOpen !== bOpen) return aOpen ? -1 : 1
    return aOpen ? byDue(a, b) : byDue(b, a)
  })
}

function fullDue(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' })
}

/* ---------- pieces ---------- */

function AssignmentCard({ item, selected, now, downloads, onOpenDesk }) {
  const [showInstructions, setShowInstructions] = useState(false)
  const submission = item.my_submission
  const info = dueInfo(item.due_at, now)
  const closed = item.state !== 'open'
  const todo = isTodo(item)
  const tone = closed || !todo ? 'later' : info.tone
  const released = isReleased(item)
  const graded = stateOf(item) === 'graded'
  const canWork = item.submissions_open && !graded

  let statusChip = { tone: 'is-quiet', icon: 'pending', text: 'Not submitted' }
  if (submission) {
    const text = STATUS_LABELS[submission.status] ?? sentenceCase(submission.status)
    if (submission.status === 'graded') statusChip = { tone: 'is-ok', icon: 'grade', text: released ? 'Graded & released' : 'Graded' }
    else if (submission.status === 'late' || submission.status === 'returned') statusChip = { tone: 'is-warn', icon: submission.status === 'late' ? 'schedule' : 'undo', text }
    else statusChip = { tone: 'is-info', icon: 'task_alt', text }
  } else if (closed) {
    statusChip = { tone: 'is-warn', icon: 'block', text: 'Closed, not submitted' }
  }

  return (
    <article className={`slpc-card slps-card ${todo && tone === 'urgent' ? 'is-urgent' : ''} ${selected ? 'is-selected' : ''}`} aria-label={item.title}>
      <div className="slps-row">
        <div className="slps-row-group">
          <span className="slps-code">
            {item.courseCode} • {item.courseName}
          </span>
          <span className={`slps-due ${todo ? `is-${tone}` : ''}`}>
            {todo && renderIcon(tone === 'urgent' ? 'timer' : 'calendar_today', 14)}
            {closed ? 'Closed' : todo ? info.label : `Due ${formatDue(item.due_at, now)}`}
          </span>
        </div>
        <div className="slps-row-group">
          <span className="slps-pts">{trimNumber(item.max_marks)} pts</span>
          <span className={`slpc-chip ${statusChip.tone}`}>
            {renderIcon(statusChip.icon, 14)}
            {statusChip.text}
          </span>
        </div>
      </div>

      <div>
        <h2 className="slps-card-title">{item.title}</h2>
        {item.description && <p className={`slps-card-text ${showInstructions ? '' : 'slps-clamp'}`}>{item.description}</p>}
        {showInstructions && <p className="slps-card-text slps-instructions">{item.instructions || 'No extra instructions were added.'}</p>}
      </div>

      <div className="slps-facts">
        <span className={`slps-fact ${item.allow_late ? '' : 'is-warn'}`}>
          {renderIcon(item.allow_late ? 'check_circle' : 'block', 15)}
          {item.allow_late ? 'Late submissions allowed' : 'No late submissions'}
        </span>
        <span className="slps-fact is-mono">
          {renderIcon('event', 14)}
          Deadline: {fullDue(item.due_at)}
        </span>
      </div>

      {submission && (
        <div className="slps-file">
          {renderIcon('draft', 20)}
          <span className="slps-file-main">
            <span className="slps-file-name">{submission.file_name}</span>
            <span className="slpc-muted">
              {formatSize(submission.file_size)} • {timeAgo(submission.submitted_at, now)}
            </span>
          </span>
        </div>
      )}

      {released && (
        <>
          <div className="slps-score">
            <strong>{trimNumber(submission.mark)}</strong>
            <span className="slpc-muted">/ {trimNumber(item.max_marks)}</span>
            <span className="slpc-chip is-ok">{percentOf(submission.mark, item.max_marks)}%</span>
          </div>
          {submission.feedback && (
            <div className="slps-feedback">
              {renderIcon('format_quote', 20)}
              <div className="slpc-stack" style={{ gap: '0.25rem' }}>
                <span className="slpc-strong">Instructor review notes</span>
                <p>{submission.feedback}</p>
              </div>
            </div>
          )}
        </>
      )}
      {graded && !released && <p className="slpc-muted">Your lecturer has marked this work but has not released the result yet.</p>}
      {stateOf(item) === 'returned' && <p className="slpc-muted">Your lecturer returned this for revision. Upload a corrected file before the deadline.</p>}

      <div className="slps-actions">
        <div className="slps-actions-group">
          {item.has_attachment && (
            <button type="button" className="slpc-btn slpc-btn-soft" disabled={downloads.busy === `brief-${item.id}`} onClick={() => downloads.start(`brief-${item.id}`, `/assignments/${item.id}/attachment`)}>
              {renderIcon('description', 18)}
              {downloads.busy === `brief-${item.id}` ? 'Preparing…' : `Download brief${item.attachment_name ? ` (${item.attachment_name})` : ''}`}
            </button>
          )}
          {(item.instructions || item.description) && (
            <button type="button" className="slps-link" onClick={() => setShowInstructions((value) => !value)} aria-expanded={showInstructions}>
              {showInstructions ? 'Hide instructions' : 'Instructions & specs'}
            </button>
          )}
          {submission && (
            <button type="button" className="slps-link" disabled={downloads.busy === `mine-${submission.id}`} onClick={() => downloads.start(`mine-${submission.id}`, `/submissions/${submission.id}/download`)}>
              {renderIcon('download', 16)}
              {downloads.busy === `mine-${submission.id}` ? 'Preparing…' : 'Download my file'}
            </button>
          )}
        </div>
        {canWork ? (
          <button type="button" className={`slpc-btn ${todo ? 'slpc-btn-primary' : 'slpc-btn-soft'}`} onClick={() => onOpenDesk(item.id)}>
            {renderIcon(submission ? 'edit_document' : 'cloud_upload', 18)}
            {submission ? 'Replace submission' : 'Open submission desk'}
          </button>
        ) : (
          <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => onOpenDesk(item.id)}>
            {renderIcon('visibility', 18)}
            View in workspace
          </button>
        )}
      </div>
    </article>
  )
}

function Workspace({ item, now, onSubmitted, deskRef }) {
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [pledge, setPledge] = useState(false)
  const [fileError, setFileError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [success, setSuccess] = useState('')

  const submission = item.my_submission
  const graded = stateOf(item) === 'graded'
  const pastDue = new Date(item.due_at).getTime() < now
  const canSubmit = item.submissions_open && !graded

  const upload = useMutation({
    mutationFn: (chosen) => {
      const form = new FormData()
      form.append('file', chosen)
      return api(`/assignments/${item.id}/submissions`, { method: 'POST', form })
    },
  })

  const choose = (chosen) => {
    if (!chosen) return
    const problem = validateFile(chosen)
    setFileError(problem)
    setFile(problem ? null : chosen)
    setSuccess('')
  }

  const submit = async () => {
    if (!file || !pledge) return
    setSuccess('')
    try {
      const saved = await upload.mutateAsync(file)
      setFile(null)
      setPledge(false)
      setSuccess(saved?.status === 'late' ? 'Submitted. Your work was recorded as late.' : 'Submitted. Your work was recorded on time.')
      await onSubmitted(item)
    } catch {
      // The error is shown from the mutation state below.
    }
  }

  const submitError = upload.isError ? errorText(upload.error, 'The upload failed. Please try again.') : ''
  const ready = Boolean(file) && pledge && !upload.isPending

  return (
    <section className="slpc-card slps-desk slps-desk-card" aria-label="Submission workspace" ref={deskRef} tabIndex={-1}>
      <div className="slps-desk-head">
        <div className="slpc-stack" style={{ gap: '0.125rem', minWidth: 0 }}>
          <span className="slpc-eyebrow" style={{ color: 'var(--primary)' }}>
            Submission workspace
          </span>
          <span className="slps-desk-title">
            {item.courseCode} • {trimNumber(item.max_marks)} pts
          </span>
        </div>
        <span className={`slpc-chip ${canSubmit ? 'is-ok' : 'is-quiet'}`}>{canSubmit ? 'Open' : graded ? 'Graded' : 'Closed'}</span>
      </div>

      <div className="slps-target">
        <strong>{item.title}</strong>
        <span className="slpc-mono slpc-muted">
          Allowed formats: {ALLOWED_EXTENSIONS.map((ext) => `.${ext.toUpperCase()}`).join(', ')} (max {MAX_UPLOAD_MB} MB)
        </span>
      </div>

      {submission && (
        <div className="slps-file">
          {renderIcon('draft', 20)}
          <span className="slps-file-main">
            <span className="slps-file-name">{submission.file_name}</span>
            <span className="slpc-muted">
              Current submission • {formatSize(submission.file_size)} • {STATUS_LABELS[submission.status] ?? sentenceCase(submission.status)}
            </span>
          </span>
        </div>
      )}

      {!canSubmit && (
        <p className="slpc-empty">{graded ? 'This work has been graded, so it can no longer be replaced.' : 'Submissions are closed for this assignment.'}</p>
      )}

      {canSubmit && (
        <>
          {pastDue && (
            <p className="slps-banner" role="status">
              {renderIcon('schedule', 18)}
              <span>The deadline has passed. Your work will be recorded as late.</span>
            </p>
          )}
          <div
            className={`slps-drop ${dragging ? 'is-drag' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              choose(event.dataTransfer?.files?.[0])
            }}
          >
            <span className="slps-drop-icon">{renderIcon('cloud_upload', 24)}</span>
            {file ? (
              <strong data-testid="chosen-file">
                {file.name} <span className="slpc-muted">({formatSize(file.size)})</span>
              </strong>
            ) : (
              <strong>{submission ? 'Drop a new file to replace it' : 'Drop your file here'}</strong>
            )}
            <span className="slpc-muted">
              or{' '}
              <button type="button" className="slps-browse" onClick={() => inputRef.current?.click()}>
                browse local files
              </button>
            </span>
            <input
              ref={inputRef}
              type="file"
              className="slps-file-input"
              aria-label="Choose a file to submit"
              accept={ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(',')}
              onChange={(event) => {
                choose(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </div>
          {fileError && (
            <p className="slpc-alert" role="alert">
              {fileError}
            </p>
          )}

          <div className="slps-pledge">
            <input id="slps-pledge" type="checkbox" checked={pledge} onChange={(event) => setPledge(event.target.checked)} />
            <label htmlFor="slps-pledge">I confirm that this submission is my own original work and follows the university academic integrity rules.</label>
          </div>

          {submitError && (
            <p className="slpc-alert" role="alert">
              {submitError}
            </p>
          )}
          {success && (
            <p className="slps-ok" role="status">
              {success}
            </p>
          )}

          <button type="button" className="slpc-btn slpc-btn-primary slps-submit" disabled={!ready} onClick={submit}>
            {renderIcon('upload_file', 20)}
            {upload.isPending ? 'Submitting…' : submission ? 'Confirm & replace submission' : 'Confirm & submit'}
          </button>
          <p className="slpc-muted" style={{ textAlign: 'center' }}>
            The server records the time of your upload.
          </p>
        </>
      )}
    </section>
  )
}

/* ---------- page ---------- */

export default function StudentAssignments() {
  useCourseFonts()
  const { courseId: routeCourseId, assignmentId: routeAssignmentId } = useParams()
  const queryClient = useQueryClient()
  const now = useClock()
  const downloads = useDownloads()
  const deskRef = useRef(null)

  const [scope, setScope] = useState(routeCourseId || 'all')
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('soonest')
  const [grid, setGrid] = useState(false)
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState(routeAssignmentId || '')
  const [refreshing, setRefreshing] = useState(false)

  const coursesQuery = useQuery({ queryKey: COURSES_KEY, queryFn: fetchCourses })
  const courses = toList(coursesQuery.data)

  const lists = useQueries({
    queries: courses.map((course) => ({
      queryKey: listKey(course.id),
      queryFn: () => api(listPath(course.id)),
    })),
  })

  const items = []
  courses.forEach((course, index) => {
    toList(lists[index]?.data).forEach((item) => items.push({ ...item, courseCode: course.course_code, courseName: course.course_name }))
  })

  const anyPending = lists.some((query) => query.isPending)
  const failed = courses.filter((_, index) => lists[index]?.isError)
  const allLoaded = coursesQuery.isSuccess && courses.length > 0 && !anyPending && failed.length === 0

  const scoped = items.filter((item) => scope === 'all' || item.course_id === scope)
  const countFor = (courseId) => items.filter((item) => item.course_id === courseId).length

  // Figures
  const pending = scoped.filter(isTodo)
  const nearest = sortItems(pending.filter((item) => item.submissions_open), 'soonest')[0]
  const openTotal = scoped.filter((item) => item.state === 'open').length
  const inReview = scoped.filter((item) => ['submitted', 'late'].includes(stateOf(item)))
  const lateCount = inReview.filter((item) => stateOf(item) === 'late').length
  const released = scoped.filter(isReleased)
  const average = released.length ? Math.round((released.reduce((sum, item) => sum + percentOf(item.my_submission.mark, item.max_marks), 0) / released.length) * 10) / 10 : null
  const returned = scoped.filter((item) => stateOf(item) === 'returned').length
  const missed = scoped.filter((item) => item.state !== 'open' && !item.my_submission).length

  const tabCount = {
    all: scoped.length,
    todo: pending.length,
    submitted: inReview.length,
    graded: scoped.filter((item) => stateOf(item) === 'graded').length,
  }
  const needle = search.trim().toLowerCase()
  const visible = sortItems(
    scoped
      .filter((item) => (tab === 'todo' ? isTodo(item) : tab === 'submitted' ? ['submitted', 'late'].includes(stateOf(item)) : tab === 'graded' ? stateOf(item) === 'graded' : true))
      .filter((item) => !needle || `${item.title} ${item.description ?? ''} ${item.courseCode} ${item.courseName}`.toLowerCase().includes(needle)),
    sort,
  )
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageItems = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const selected = items.find((item) => item.id === selectedId) ?? visible[0]

  const pickScope = (id) => {
    setScope(id)
    setPage(1)
  }
  const pickTab = (id) => {
    setTab(id)
    setPage(1)
  }
  const openDesk = (id) => {
    setSelectedId(id)
    deskRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    deskRef.current?.focus?.({ preventScroll: true })
  }
  const refresh = async () => {
    setRefreshing(true)
    try {
      await Promise.all([coursesQuery.refetch(), ...lists.map((query) => query.refetch())])
    } finally {
      setRefreshing(false)
    }
  }
  const afterSubmit = async (item) => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: listKey(item.course_id) }), queryClient.invalidateQueries({ queryKey: ['student-dashboard'] })])
  }

  const scopeCourse = scope === 'all' ? null : courses.find((course) => course.id === scope)
  const nearestInfo = nearest ? dueInfo(nearest.due_at, now) : null
  const completedShare = openTotal > 0 ? Math.round(((openTotal - pending.length) / openTotal) * 100) : 0

  return (
    <div className="slpc" aria-label="Assignments and submissions">
      <style>{COURSE_STYLES}</style>
      <style>{ASSIGNMENT_STYLES}</style>

      <div className="slpc-stack slpc-gap-lg">
        <div className="slps-topbar">
          <nav className="slpc-trail" aria-label="Breadcrumb">
            <Link to="/student" className="slpc-trail-link">
              {renderIcon('home', 16)}
              Dashboard
            </Link>
            <span className="slpc-trail-sep">{renderIcon('chevron_right', 16)}</span>
            <span className="slpc-trail-current">Assignments &amp; Submissions</span>
            {scopeCourse && (
              <>
                <span className="slpc-trail-sep">{renderIcon('chevron_right', 16)}</span>
                <span className="slpc-pill">Course: {scopeCourse.course_code}</span>
              </>
            )}
          </nav>
        </div>

        <header className="slps-head">
          <div className="slpc-stack" style={{ gap: '0.25rem' }}>
            <h1 className="slps-title">Assignments &amp; Course Submissions</h1>
            <p className="slpc-lead">Review assignment briefs, submit coursework files, track evaluation statuses, and see released grades and faculty feedback across your enrolled modules.</p>
          </div>
          <div className="slps-head-actions">
            <button type="button" className="slpc-btn slpc-btn-soft" onClick={refresh} disabled={refreshing}>
              {renderIcon('sync', 18)}
              {refreshing ? 'Refreshing…' : 'Refresh status'}
            </button>
          </div>
        </header>

        <div className="slps-scope" role="group" aria-label="Course scope">
          <button type="button" className={`slps-scope-btn ${scope === 'all' ? 'is-active' : ''}`} onClick={() => pickScope('all')} aria-pressed={scope === 'all'}>
            All enrolled courses
            {coursesQuery.isSuccess && <span className="slps-scope-count">{courses.length}</span>}
          </button>
          {courses.map((course) => (
            <button key={course.id} type="button" className={`slps-scope-btn ${scope === course.id ? 'is-active' : ''}`} onClick={() => pickScope(course.id)} aria-pressed={scope === course.id}>
              {course.course_code}: {course.course_name}
              {allLoaded && <span className="slps-scope-count">{countFor(course.id)}</span>}
            </button>
          ))}
        </div>

        <div className="slpc-stats" aria-label="Assignment summary">
          <div className="slpc-card slpc-stat">
            <div className="slpc-stat-top">
              <span className="slpc-stat-label">Pending submissions</span>
              <span className="slpc-stat-icon is-fixed">{renderIcon('notification_important', 18)}</span>
            </div>
            <div className="slpc-stat-body">
              <div className="slps-stat-line">
                <span className="slps-big">{allLoaded ? pending.length : '—'}</span>
                <span className="slps-aside">to submit</span>
              </div>
            </div>
            <div className="slpc-stat-foot">
              <span>{allLoaded ? (nearest ? `Nearest cutoff ${nearestInfo.label.toLowerCase().replace(/^due /, '')} (${nearest.courseCode}: ${nearest.title})` : 'Nothing is waiting for you') : 'Waiting for every course to load'}</span>
              <span className="slps-bar" aria-hidden="true" style={{ marginTop: 8 }}>
                <span style={{ width: `${allLoaded ? completedShare : 0}%` }} />
              </span>
            </div>
          </div>
          <div className="slpc-card slpc-stat">
            <div className="slpc-stat-top">
              <span className="slpc-stat-label">Submitted &amp; under review</span>
              <span className="slpc-stat-icon is-mid">{renderIcon('verified', 18)}</span>
            </div>
            <div className="slpc-stat-body">
              <div className="slps-stat-line">
                <span className="slps-big">{allLoaded ? inReview.length : '—'}</span>
                <span className="slps-aside is-quiet">{allLoaded && inReview.length > 0 ? `${Math.round(((inReview.length - lateCount) / inReview.length) * 100)}% on time` : ''}</span>
              </div>
            </div>
            <div className="slpc-stat-foot">
              <span>Waiting for your lecturer to mark</span>
              <span className="slps-bar is-warm" aria-hidden="true" style={{ marginTop: 8 }}>
                <span style={{ width: `${allLoaded && inReview.length > 0 ? Math.round(((inReview.length - lateCount) / inReview.length) * 100) : 0}%` }} />
              </span>
            </div>
          </div>
          <div className="slpc-card slpc-stat">
            <div className="slpc-stat-top">
              <span className="slpc-stat-label">Released grades</span>
              <span className="slpc-stat-icon is-warm">{renderIcon('military_tech', 18)}</span>
            </div>
            <div className="slpc-stat-body">
              <div className="slps-stat-line">
                <span className="slps-big">{allLoaded ? released.length : '—'}</span>
                <span className="slps-aside is-quiet">{allLoaded && average !== null ? `${average}% avg` : ''}</span>
              </div>
            </div>
            <div className="slpc-stat-foot">
              <span>Only marks your lecturer has released</span>
              <span className="slps-bar is-cool" aria-hidden="true" style={{ marginTop: 8 }}>
                <span style={{ width: `${allLoaded && average !== null ? Math.min(100, average) : 0}%` }} />
              </span>
            </div>
          </div>
          <div className="slpc-card slpc-stat">
            <div className="slpc-stat-top">
              <span className="slpc-stat-label">Needs attention</span>
              <span className="slpc-stat-icon is-ok">{renderIcon('flag', 18)}</span>
            </div>
            <div className="slpc-stat-body">
              <div className="slps-stat-line">
                <span className="slps-big">{allLoaded ? returned + missed : '—'}</span>
                <span className="slps-aside is-quiet">{allLoaded ? (returned + missed === 0 ? 'all clear' : 'to review') : ''}</span>
              </div>
            </div>
            <div className="slpc-stat-foot">{allLoaded ? `${returned} returned for revision • ${missed} closed without a submission` : 'Waiting for every course to load'}</div>
          </div>
        </div>

        <section className="slpc-card slps-toolbar" aria-label="Filter assignments">
          <div className="slps-tabs" role="tablist" aria-label="Assignment status">
            {TABS.map((entry) => (
              <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} className={`slps-tab ${tab === entry.id ? 'is-active' : ''}`} onClick={() => pickTab(entry.id)}>
                {entry.label}
                {allLoaded && <span className="slpc-count">{tabCount[entry.id]}</span>}
              </button>
            ))}
          </div>
          <div className="slps-tools">
            <label className="slpc-search">
              {renderIcon('search', 18)}
              <input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(1)
                }}
                placeholder="Search assignment title, course..."
                aria-label="Search assignments"
              />
            </label>
            <select className="slpc-select" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort assignments">
              {SORTS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
            <div className="slps-views" role="group" aria-label="Layout">
              <button type="button" className={`slps-view ${grid ? '' : 'is-active'}`} onClick={() => setGrid(false)} aria-label="List view" aria-pressed={!grid}>
                {renderIcon('view_agenda', 18)}
              </button>
              <button type="button" className={`slps-view ${grid ? 'is-active' : ''}`} onClick={() => setGrid(true)} aria-label="Grid view" aria-pressed={grid}>
                {renderIcon('grid_view', 18)}
              </button>
            </div>
          </div>
        </section>

        <div className="slps-split">
          <div className={`slps-feed ${grid ? 'is-grid' : ''}`} aria-label="Assignments">
            {downloads.error && (
              <p className="slpc-alert" role="alert">
                {downloads.error}
              </p>
            )}
            {failed.length > 0 && (
              <p className="slpc-alert" role="alert">
                Assignments could not be loaded for {failed.map((course) => course.course_code).join(', ')}. The figures above are hidden until every course loads.
              </p>
            )}

            {coursesQuery.isPending && <Skeleton height={160} label="Loading assignments" />}
            {coursesQuery.isError && <ErrorCard message="Your courses could not be loaded." onRetry={() => coursesQuery.refetch()} />}
            {coursesQuery.isSuccess && courses.length === 0 && <p className="slpc-empty">You are not enrolled in any courses yet, so there are no assignments to show.</p>}
            {coursesQuery.isSuccess && courses.length > 0 && anyPending && <Skeleton height={160} label="Loading assignments" />}

            {coursesQuery.isSuccess && courses.length > 0 && !anyPending && scoped.length === 0 && failed.length === 0 && <p className="slpc-empty">No assignments have been published for {scopeCourse ? scopeCourse.course_code : 'your courses'} yet.</p>}
            {scoped.length > 0 && visible.length === 0 && <p className="slpc-empty">No assignments match these filters.</p>}

            {pageItems.map((item) => (
              <AssignmentCard key={item.id} item={item} selected={selected?.id === item.id} now={now} downloads={downloads} onOpenDesk={openDesk} />
            ))}

            {visible.length > PAGE_SIZE && (
              <div className="slps-pager">
                <span>
                  Page {safePage} of {pageCount}
                </span>
                <div className="slps-actions-group">
                  <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => setPage(safePage - 1)} disabled={safePage <= 1}>
                    Previous
                  </button>
                  <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => setPage(safePage + 1)} disabled={safePage >= pageCount}>
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="slps-side">
            {selected ? (
              <Workspace key={selected.id} item={selected} now={now} onSubmitted={afterSubmit} deskRef={deskRef} />
            ) : (
              <section className="slpc-card slps-desk" aria-label="Submission workspace" ref={deskRef} tabIndex={-1}>
                <span className="slpc-eyebrow" style={{ color: 'var(--primary)' }}>
                  Submission workspace
                </span>
                <p className="slpc-empty">Choose an assignment to open its submission desk here.</p>
              </section>
            )}
            <section className="slpc-card" aria-label="Submission rules">
              <div className="slpc-stack" style={{ gap: '0.75rem' }}>
                <span className="slpc-inline slpc-strong">
                  <span className="slpc-accent">{renderIcon('verified_user', 18)}</span>
                  How submissions work
                </span>
                <ul className="slps-rules">
                  <li>
                    {renderIcon('check_circle', 16)}
                    <span>
                      Accepted files: {ALLOWED_EXTENSIONS.map((ext) => ext.toUpperCase()).join(', ')}, up to {MAX_UPLOAD_MB} MB.
                    </span>
                  </li>
                  <li>
                    {renderIcon('check_circle', 16)}
                    <span>Uploading again replaces your previous file until your lecturer has graded it.</span>
                  </li>
                  <li>
                    {renderIcon('check_circle', 16)}
                    <span>After the deadline, work is accepted only when the lecturer allows late submissions, and it is marked late.</span>
                  </li>
                  <li>
                    {renderIcon('check_circle', 16)}
                    <span>Marks and feedback appear here only after your lecturer releases them.</span>
                  </li>
                </ul>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
