import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/apiClient.js'
import {
  COURSES_KEY,
  COURSE_STYLES,
  ErrorCard,
  PhasePanel,
  Skeleton,
  fetchCourses,
  renderIcon,
  useCourseFonts,
} from '../../components/courseKit.jsx'
import { formatDate, toList } from '../../utils/format.js'

/*
 * Smart Lecture Portal: lecturer Announcements
 * Place at: src/pages/lecturer/LecturerAnnouncements.jsx
 *
 * Routes (see routes.jsx):
 *   /lecturer/announcements                    announcements for every course you teach
 *   /lecturer/courses/:courseId/announcements  the same page with that course preselected
 *
 * - Renders inside AppShell, which already draws the sidebar and top bar.
 * - Built on the contract in docs/API.md (Announcements). Endpoints used:
 *     GET   /courses                                 assigned courses
 *     GET   /courses/{id}                            enrolled_count (who is notified on publish)
 *     GET   /courses/{id}/announcements              announcements, drafts included for lecturers
 *     POST  /courses/{id}/announcements              { title, body, published }
 *     PATCH /announcements/{id}                      edit, publish, unpublish
 * - The announcements backend arrives in Phase 7. Until the server answers these routes the page
 *   says so plainly (it never invents announcements, counts or read receipts). The API has no
 *   delivery log, read counts, priorities, attachments or archive, so the page shows none of them.
 */

const PAGE_SIZE = 6
const TITLE_MAX = 200
const BODY_MAX = 5000
const NOT_READY = [404, 405, 501]
const TABS = [
  { id: 'all', label: 'All' },
  { id: 'published', label: 'Published' },
  { id: 'draft', label: 'Drafts' },
]
const listKey = (courseId) => ['course-announcements', courseId]
const listPath = (courseId) => `/courses/${courseId}/announcements?page_size=100`

const ANNOUNCEMENT_STYLES = `
.slpa-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.slpa-bar .slpc-btn { height: 36px; padding: 0 14px; }
.slpa-topbar { display: flex; flex-direction: column; gap: 0.75rem; }
.slpa-hero { display: flex; flex-direction: column; gap: 1rem; padding: 1.25rem; background: linear-gradient(135deg, var(--surface-lowest) 55%, var(--surface-low)); }
.slpa-tag { display: inline-flex; align-self: flex-start; padding: 2px 10px; border-radius: 999px; background: var(--primary-fixed); color: var(--on-primary-fixed); font-size: 11px; line-height: 16px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
.slpa-title { font-size: 26px; line-height: 34px; font-weight: 700; letter-spacing: -0.02em; overflow-wrap: anywhere; }
.slpa-scope { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.slpa-scope-label { font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); margin-right: 4px; }
.slpa-scope-btn { display: inline-flex; align-items: center; gap: 0.375rem; padding: 6px 14px; border: 0; border-radius: 999px; background: var(--surface-low); color: var(--on-surface-variant); font-size: 11px; line-height: 16px; font-weight: 700; cursor: pointer; transition: background 0.2s; }
.slpa-scope-btn:hover { background: var(--surface-mid); }
.slpa-scope-btn.is-active { background: var(--primary); color: var(--on-primary); box-shadow: 0 1px 2px rgba(30, 26, 35, 0.2); }
.slpa-scope-count { padding: 0 6px; border-radius: 999px; background: var(--surface-high); color: var(--on-surface-variant); font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 16px; }
.slpa-scope-btn.is-active .slpa-scope-count { background: var(--primary-container); color: var(--on-primary-container); }
.slpa-toolbar { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.75rem; }
.slpa-tabs { display: flex; align-items: center; gap: 4px; overflow-x: auto; padding: 2px; }
.slpa-tab { display: inline-flex; align-items: center; gap: 0.375rem; flex: 0 0 auto; padding: 6px 14px; border: 0; border-radius: 10px; background: transparent; color: var(--on-surface-variant); font-size: 12px; line-height: 16px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.slpa-tab:hover { background: var(--surface-high); }
.slpa-tab.is-active { background: var(--primary-container); color: var(--on-primary-container); font-weight: 700; }
.slpa-tab-count { min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; background: var(--surface-high); color: var(--on-surface-variant); font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
.slpa-tab.is-active .slpa-tab-count { background: rgba(255, 255, 255, 0.28); color: inherit; }
.slpa-tools { display: flex; align-items: center; gap: 0.5rem; }
.slpa-tools .slpc-search { flex: 1 1 auto; }
.slpa-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.slpa-feed { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.slpa-card { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 0.75rem; min-width: 0; }
.slpa-card.is-draft { background: var(--surface-low); }
.slpa-card.is-live::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 4px; background: var(--primary); }
.slpa-card-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; }
.slpa-card-title { font-size: 18px; line-height: 26px; font-weight: 600; letter-spacing: -0.005em; overflow-wrap: anywhere; }
.slpa-card-body { font-size: 14px; line-height: 22px; color: var(--on-surface-variant); white-space: pre-wrap; overflow-wrap: anywhere; }
.slpa-card-body.is-clamped { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.slpa-more { align-self: flex-start; border: 0; background: none; padding: 0; color: var(--primary); font-size: 12px; line-height: 16px; font-weight: 700; cursor: pointer; }
.slpa-more:hover { text-decoration: underline; }
.slpa-card-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem; padding-top: 0.75rem; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpa-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; min-width: 0; }
.slpa-meta span { display: inline-flex; align-items: center; gap: 0.25rem; }
.slpa-card-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.slpa-card-actions .slpc-btn { height: 32px; padding: 0 12px; font-size: 12px; }
.slpa-editor { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.875rem; border-radius: 12px; background: var(--surface-low); }
.slpa-card.is-draft .slpa-editor { background: var(--surface-lowest); }
.slpa-button-row { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.slpa-pager { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; font-size: 12px; color: var(--on-surface-variant); }
.slpa-composer { display: flex; flex-direction: column; gap: 0.875rem; }
.slpa-composer-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; }
.slpa-composer-id { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
.slpa-badge-icon { width: 36px; height: 36px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; background: var(--primary-container); color: var(--on-primary-container); }
.slpa-field { display: flex; flex-direction: column; gap: 0.375rem; min-width: 0; }
.slpa-field label { font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpa-field input[type='text'], .slpa-field textarea, .slpa-field select {
  width: 100%; min-width: 0; border: 0; border-radius: 10px; background: var(--surface-low); color: var(--on-surface);
  padding: 10px 14px; font-size: 13px; line-height: 18px;
}
.slpa-field select { height: 44px; padding: 0 14px; }
.slpa-field input[type='text'] { height: 44px; }
.slpa-field textarea { resize: vertical; min-height: 120px; font-family: inherit; }
.slpa-field input:focus, .slpa-field textarea:focus, .slpa-field select:focus { outline: 0; box-shadow: 0 0 0 2px var(--primary-container); }
.slpa-field-error { font-size: 12px; line-height: 16px; font-weight: 600; color: var(--error); }
.slpa-hint { font-size: 11px; line-height: 16px; color: var(--on-surface-variant); }
.slpa-note { display: flex; align-items: flex-start; gap: 0.625rem; padding: 0.625rem 0.75rem; border-radius: 12px; background: var(--surface-low); font-size: 12px; line-height: 18px; color: var(--on-surface-variant); }
.slpa-note .material-symbols-outlined { color: var(--primary); margin-top: 1px; }
.slpa-ok { padding: 0.5rem 0.75rem; border-radius: 12px; background: var(--ok-bg); color: var(--ok); font-size: 13px; line-height: 18px; font-weight: 600; }
.slpa-composer-actions { display: flex; flex-direction: column; gap: 0.5rem; }
.slpa-composer-actions .slpc-btn { height: 44px; justify-content: center; width: 100%; }
@media (min-width: 640px) {
  .slpa-card.is-draft .slpa-card-actions .slpc-btn { height: 32px; }
  .slpa-composer-actions { flex-direction: row; align-items: center; }
  .slpa-composer-actions .slpc-btn { width: auto; }
  .slpa-composer-actions .slpa-grow { flex: 1 1 auto; }
}
@media (min-width: 768px) {
  .slpa-topbar { flex-direction: row; align-items: center; justify-content: space-between; }
  .slpa-toolbar { flex-direction: row; align-items: center; justify-content: space-between; }
  .slpa-tools { width: 400px; flex: 0 0 auto; }
}
@media (min-width: 1024px) {
  .slpa-split { grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); }
  .slpa-hero { padding: 2rem; }
  .slpa-title { font-size: 32px; line-height: 40px; }
}
`

const isNotReady = (error) => NOT_READY.includes(error?.status)
const errorText = (error, fallback) => error?.message || fallback
const stamp = (item) => item.published_at || item.created_at || ''

function AnnouncementCard({ item, courseLabel, enrolled, busy, onToggle, onSave }) {
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [title, setTitle] = useState(item.title ?? '')
  const [body, setBody] = useState(item.body ?? '')
  const [formError, setFormError] = useState('')
  const live = Boolean(item.published)
  const long = String(item.body ?? '').length > 280

  const openEditor = () => {
    setTitle(item.title ?? '')
    setBody(item.body ?? '')
    setFormError('')
    setEditing(true)
  }

  const save = async (event) => {
    event.preventDefault()
    const cleanTitle = title.trim()
    const cleanBody = body.trim()
    if (cleanTitle.length < 2 || cleanTitle.length > TITLE_MAX) {
      setFormError(`The title must be between 2 and ${TITLE_MAX} characters.`)
      return
    }
    if (!cleanBody || cleanBody.length > BODY_MAX) {
      setFormError(`The message must be between 1 and ${BODY_MAX} characters.`)
      return
    }
    const ok = await onSave(item, { title: cleanTitle, body: cleanBody })
    if (ok) setEditing(false)
  }

  return (
    <article className={`slpc-card slpa-card ${live ? 'is-live' : 'is-draft'}`}>
      <div className="slpa-card-head">
        <div className="slpc-chips">
          <span className="slpc-chip is-info">{courseLabel}</span>
          <span className={`slpc-chip ${live ? 'is-ok' : 'is-warn'}`}>
            {renderIcon(live ? 'check_circle' : 'lock', 14)}
            {live ? 'Published' : 'Draft, hidden from students'}
          </span>
        </div>
        {live && typeof enrolled === 'number' && <span className="slpc-muted">{enrolled} enrolled notified</span>}
      </div>

      {!editing && (
        <>
          <h3 className="slpa-card-title">{item.title}</h3>
          <p className={`slpa-card-body ${long && !expanded ? 'is-clamped' : ''}`}>{item.body}</p>
          {long && (
            <button type="button" className="slpa-more" onClick={() => setExpanded((open) => !open)} aria-expanded={expanded}>
              {expanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </>
      )}

      {editing && (
        <form className="slpa-editor" onSubmit={save} aria-label={`Edit ${item.title}`}>
          <div className="slpa-field">
            <label htmlFor={`slpa-edit-title-${item.id}`}>Title</label>
            <input id={`slpa-edit-title-${item.id}`} type="text" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={TITLE_MAX} />
          </div>
          <div className="slpa-field">
            <label htmlFor={`slpa-edit-body-${item.id}`}>Message</label>
            <textarea id={`slpa-edit-body-${item.id}`} value={body} onChange={(event) => setBody(event.target.value)} maxLength={BODY_MAX} />
          </div>
          {formError && (
            <p className="slpa-field-error" role="alert">
              {formError}
            </p>
          )}
          <div className="slpa-button-row">
            <button type="submit" className="slpc-btn slpc-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="slpa-card-foot">
        <div className="slpa-meta">
          {item.author_name && <span className="slpc-strong">{item.author_name}</span>}
          {formatDate(stamp(item)) && (
            <span>
              {renderIcon(live ? 'schedule' : 'edit_note', 16)}
              {live ? 'Published' : 'Saved'} {formatDate(stamp(item))}
            </span>
          )}
        </div>
        {!editing && (
          <div className="slpa-card-actions" role="group" aria-label={`Actions for ${item.title}`}>
            <button type="button" className="slpc-btn slpc-btn-soft" onClick={openEditor} disabled={busy}>
              {renderIcon('edit', 16)}
              {live ? 'Edit' : 'Edit draft'}
            </button>
            <button type="button" className={`slpc-btn ${live ? 'slpc-btn-soft' : 'slpc-btn-primary'}`} onClick={() => onToggle(item)} disabled={busy}>
              {renderIcon(live ? 'visibility_off' : 'send', 16)}
              {busy ? 'Working…' : live ? 'Withhold' : 'Publish to cohort'}
            </button>
          </div>
        )}
      </div>
    </article>
  )
}

function Composer({ courses, defaultCourseId, formRef, enrolledOf, onCreated }) {
  const [courseId, setCourseId] = useState(defaultCourseId || '')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [errors, setErrors] = useState({})
  const [success, setSuccess] = useState('')
  const effectiveCourse = courseId || (courses.length === 1 ? courses[0].id : '')
  const selected = courses.find((course) => course.id === effectiveCourse)
  const enrolled = enrolledOf(effectiveCourse)

  const create = useMutation({
    mutationFn: ({ targetId, payload }) => api(`/courses/${targetId}/announcements`, { method: 'POST', body: payload }),
  })

  const submit = async (published) => {
    const next = {}
    const cleanTitle = title.trim()
    const cleanBody = body.trim()
    if (!effectiveCourse) next.course = 'Choose a course.'
    if (cleanTitle.length < 2 || cleanTitle.length > TITLE_MAX) next.title = `The title must be between 2 and ${TITLE_MAX} characters.`
    if (!cleanBody) next.body = 'Write the message students should see.'
    else if (cleanBody.length > BODY_MAX) next.body = `The message can be at most ${BODY_MAX} characters.`
    setErrors(next)
    setSuccess('')
    if (Object.keys(next).length) return
    try {
      await create.mutateAsync({ targetId: effectiveCourse, payload: { title: cleanTitle, body: cleanBody, published } })
    } catch (caught) {
      setErrors({
        form: isNotReady(caught) ? 'Announcements are not switched on in the backend yet (Phase 7), so nothing was saved.' : errorText(caught, 'The announcement could not be saved. Please try again.'),
      })
      return
    }
    setTitle('')
    setBody('')
    setSuccess(published ? 'Published. Enrolled students will be notified.' : 'Saved as a draft. Students cannot see it yet.')
    onCreated(effectiveCourse)
  }

  const onSubmit = (event) => {
    event.preventDefault()
    submit(true)
  }

  const clear = () => {
    setTitle('')
    setBody('')
    setErrors({})
    setSuccess('')
  }

  return (
    <section className="slpc-card" ref={formRef} aria-labelledby="slpa-composer-title" tabIndex={-1}>
      <form className="slpa-composer" onSubmit={onSubmit} noValidate>
        <div className="slpa-composer-head">
          <div className="slpa-composer-id">
            <span className="slpa-badge-icon">{renderIcon('edit_note', 20)}</span>
            <h2 id="slpa-composer-title" className="slpc-h3">
              Broadcast composer
            </h2>
          </div>
          {selected && <span className="slpc-pill is-primary">{selected.course_code} scoped</span>}
        </div>

        <div className="slpa-field">
          <label htmlFor="slpa-course">Target course</label>
          <select id="slpa-course" value={effectiveCourse} onChange={(event) => setCourseId(event.target.value)} aria-invalid={Boolean(errors.course)}>
            <option value="">Select a course</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.course_code}: {course.course_name}
              </option>
            ))}
          </select>
          {errors.course && <span className="slpa-field-error">{errors.course}</span>}
        </div>

        <div className="slpa-field">
          <label htmlFor="slpa-title">Announcement title</label>
          <input id="slpa-title" type="text" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Lab 02 moved to Hall 4B" maxLength={TITLE_MAX} aria-invalid={Boolean(errors.title)} />
          {errors.title && <span className="slpa-field-error">{errors.title}</span>}
        </div>

        <div className="slpa-field">
          <label htmlFor="slpa-body">Announcement content</label>
          <textarea id="slpa-body" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Room changes, syllabus updates, deadlines…" maxLength={BODY_MAX} rows={6} aria-invalid={Boolean(errors.body)} />
          <span className="slpa-hint">
            {body.length} / {BODY_MAX} characters · plain text
          </span>
          {errors.body && <span className="slpa-field-error">{errors.body}</span>}
        </div>

        <p className="slpa-note">
          {renderIcon('notifications_active', 18)}
          <span>
            Publishing notifies {typeof enrolled === 'number' ? `the ${enrolled} enrolled ${enrolled === 1 ? 'student' : 'students'}` : 'the enrolled students'}. A draft stays visible to lecturers only.
          </span>
        </p>

        {errors.form && (
          <p className="slpc-alert" role="alert">
            {errors.form}
          </p>
        )}
        {success && (
          <p className="slpa-ok" role="status">
            {success}
          </p>
        )}

        <div className="slpa-composer-actions">
          <button type="submit" className="slpc-btn slpc-btn-primary slpa-grow" disabled={create.isPending}>
            {renderIcon('campaign', 18)}
            {create.isPending ? 'Sending…' : 'Publish & notify students'}
          </button>
          <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => submit(false)} disabled={create.isPending}>
            Save draft
          </button>
          <button type="button" className="slpc-btn slpc-btn-soft" onClick={clear} disabled={create.isPending}>
            Clear
          </button>
        </div>
      </form>
    </section>
  )
}

export default function LecturerAnnouncements() {
  useCourseFonts()
  const { courseId: routeCourseId } = useParams()
  const queryClient = useQueryClient()
  const composerRef = useRef(null)

  const [scope, setScope] = useState(routeCourseId || 'all')
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const [newestFirst, setNewestFirst] = useState(true)
  const [page, setPage] = useState(1)
  const [busyId, setBusyId] = useState('')
  const [actionError, setActionError] = useState('')

  const coursesQuery = useQuery({ queryKey: COURSES_KEY, queryFn: fetchCourses })
  const courses = toList(coursesQuery.data)

  const lists = useQueries({
    queries: courses.map((course) => ({
      queryKey: listKey(course.id),
      queryFn: () => api(listPath(course.id)),
      retry: false,
    })),
  })
  const details = useQueries({
    queries: courses.map((course) => ({
      queryKey: ['course', course.id],
      queryFn: () => api(`/courses/${course.id}`),
    })),
  })

  const enrolledOf = (courseId) => {
    if (!courseId) return undefined
    const index = courses.findIndex((course) => course.id === courseId)
    const value = details[index]?.data?.enrolled_count
    return typeof value === 'number' ? value : undefined
  }

  const items = []
  courses.forEach((course, index) => {
    toList(lists[index]?.data).forEach((item) => items.push({ ...item, courseId: course.id, courseCode: course.course_code }))
  })

  const anyPending = lists.some((query) => query.isPending)
  const failed = courses.filter((_, index) => lists[index]?.isError)
  const notReady = courses.length > 0 && failed.length === courses.length && lists.every((query) => isNotReady(query.error))
  const partial = !notReady && failed.length > 0
  const allLoaded = coursesQuery.isSuccess && courses.length > 0 && !anyPending && failed.length === 0

  const scoped = items.filter((item) => scope === 'all' || item.courseId === scope)
  const publishedCount = scoped.filter((item) => item.published).length
  const draftCount = scoped.length - publishedCount

  const scopedCourses = courses.filter((course) => scope === 'all' || course.id === scope)
  const enrolledKnown = scopedCourses.every((course) => typeof enrolledOf(course.id) === 'number')
  const enrolledTotal = scopedCourses.reduce((sum, course) => sum + (enrolledOf(course.id) || 0), 0)

  const needle = search.trim().toLowerCase()
  const visible = scoped
    .filter((item) => (tab === 'published' ? item.published : tab === 'draft' ? !item.published : true))
    .filter((item) => !needle || `${item.title} ${item.body}`.toLowerCase().includes(needle))
    .sort((a, b) => (newestFirst ? 1 : -1) * (new Date(stamp(b)) - new Date(stamp(a))))

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageItems = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const refresh = (courseId) => queryClient.invalidateQueries({ queryKey: listKey(courseId) })
  const patch = useMutation({ mutationFn: ({ id, body }) => api(`/announcements/${id}`, { method: 'PATCH', body }) })

  const runPatch = async (item, body, failure) => {
    setBusyId(item.id)
    setActionError('')
    try {
      await patch.mutateAsync({ id: item.id, body })
      await refresh(item.courseId)
      return true
    } catch (caught) {
      setActionError(errorText(caught, failure))
      return false
    } finally {
      setBusyId('')
    }
  }
  const toggle = (item) => runPatch(item, { published: !item.published }, 'The announcement could not be updated. Please try again.')
  const save = (item, body) => runPatch(item, body, 'The changes could not be saved. Please try again.')

  const pickScope = (id) => {
    setScope(id)
    setPage(1)
  }
  const pickTab = (id) => {
    setTab(id)
    setPage(1)
  }
  const goToComposer = () => {
    composerRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    composerRef.current?.focus?.()
  }

  const scopeCourse = scope === 'all' ? null : courses.find((course) => course.id === scope)
  const tabCount = { all: scoped.length, published: publishedCount, draft: draftCount }
  const courseLabelOf = (item) => item.courseCode

  return (
    <div className="slpc" aria-label="Announcements">
      <style>{COURSE_STYLES}</style>
      <style>{ANNOUNCEMENT_STYLES}</style>

      <div className="slpc-stack slpc-gap-lg">
        <div className="slpa-topbar">
          <nav className="slpc-trail" aria-label="Breadcrumb">
            <Link to="/lecturer" className="slpc-trail-link">
              {renderIcon('home', 16)}
              Dashboard
            </Link>
            <span className="slpc-trail-sep">{renderIcon('chevron_right', 16)}</span>
            <span className="slpc-trail-current">Announcements</span>
            {scopeCourse && (
              <>
                <span className="slpc-trail-sep">{renderIcon('chevron_right', 16)}</span>
                <span className="slpc-pill">Course: {scopeCourse.course_code}</span>
              </>
            )}
          </nav>
          <div className="slpa-bar">
            <button type="button" className="slpc-btn slpc-btn-primary" onClick={goToComposer}>
              {renderIcon('campaign', 18)}
              Post announcement
            </button>
            <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => pickTab('draft')}>
              {renderIcon('drafts', 18)}
              Drafts queue
              {allLoaded && <span className="slpc-count">{draftCount}</span>}
            </button>
          </div>
        </div>

        <section className="slpc-card slpa-hero" aria-labelledby="slpa-heading">
          <span className="slpa-tag">Course announcements</span>
          <h1 id="slpa-heading" className="slpa-title">
            Announcements &amp; Communications
          </h1>
          <p className="slpc-lead">Post syllabus updates, room changes and assessment alerts to the students of a course. Drafts stay hidden until you publish them, and publishing notifies everyone enrolled.</p>

          <div className="slpa-scope" role="group" aria-label="Course scope">
            <span className="slpa-scope-label">Target scope</span>
            <button type="button" className={`slpa-scope-btn ${scope === 'all' ? 'is-active' : ''}`} onClick={() => pickScope('all')} aria-pressed={scope === 'all'}>
              {scope === 'all' && renderIcon('check_circle', 14)}
              All assigned courses{coursesQuery.isSuccess ? ` (${courses.length})` : ''}
            </button>
            {courses.map((course) => {
              const active = scope === course.id
              const enrolled = enrolledOf(course.id)
              return (
                <button key={course.id} type="button" className={`slpa-scope-btn ${active ? 'is-active' : ''}`} onClick={() => pickScope(course.id)} aria-pressed={active}>
                  {active && renderIcon('check_circle', 14)}
                  {course.course_code}: {course.course_name}
                  {typeof enrolled === 'number' && <span className="slpa-scope-count">{enrolled}</span>}
                </button>
              )
            })}
          </div>
        </section>

        <div className="slpc-stats" aria-label="Announcement summary">
          <div className="slpc-card slpc-stat">
            <div className="slpc-stat-top">
              <span className="slpc-stat-label">Total announcements</span>
              <span className="slpc-stat-icon is-mid">{renderIcon('podcasts', 18)}</span>
            </div>
            <div className="slpc-stat-body">
              <span className="slpc-stat-value">{allLoaded ? scoped.length : '—'}</span>
            </div>
            <div className="slpc-stat-foot">Across {scopedCourses.length} {scopedCourses.length === 1 ? 'course' : 'courses'}</div>
          </div>
          <div className="slpc-card slpc-stat">
            <div className="slpc-stat-top">
              <span className="slpc-stat-label">Published</span>
              <span className="slpc-stat-icon is-ok">{renderIcon('visibility', 18)}</span>
            </div>
            <div className="slpc-stat-body">
              <span className="slpc-stat-value">{allLoaded ? publishedCount : '—'}</span>
            </div>
            <div className="slpc-stat-foot">Visible to students</div>
          </div>
          <div className="slpc-card slpc-stat">
            <div className="slpc-stat-top">
              <span className="slpc-stat-label">Drafts</span>
              <span className="slpc-stat-icon is-warm">{renderIcon('drafts', 18)}</span>
            </div>
            <div className="slpc-stat-body">
              <span className="slpc-stat-value">{allLoaded ? draftCount : '—'}</span>
            </div>
            <div className="slpc-stat-foot">Hidden from students</div>
          </div>
          <div className="slpc-card slpc-stat">
            <div className="slpc-stat-top">
              <span className="slpc-stat-label">Students notified</span>
              <span className="slpc-stat-icon is-fixed">{renderIcon('notifications_active', 18)}</span>
            </div>
            <div className="slpc-stat-body">
              <span className="slpc-stat-value">{enrolledKnown && scopedCourses.length > 0 ? enrolledTotal : '—'}</span>
              <span className="slpc-stat-unit">enrolled</span>
            </div>
            <div className="slpc-stat-foot">On each published post</div>
          </div>
        </div>

        <section className="slpc-card slpa-toolbar" aria-label="Filter announcements">
          <div className="slpa-tabs" role="tablist" aria-label="Announcement status">
            {TABS.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={`slpa-tab ${tab === item.id ? 'is-active' : ''}`} onClick={() => pickTab(item.id)}>
                {item.label}
                {allLoaded && <span className="slpa-tab-count">{tabCount[item.id]}</span>}
              </button>
            ))}
          </div>
          <div className="slpa-tools">
            <label className="slpc-search">
              {renderIcon('filter_list', 18)}
              <input
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(1)
                }}
                placeholder="Search announcements"
                aria-label="Search announcements"
              />
            </label>
            <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => setNewestFirst((value) => !value)} aria-label={newestFirst ? 'Sorted newest first' : 'Sorted oldest first'}>
              {renderIcon('swap_vert', 18)}
              <span>{newestFirst ? 'Newest first' : 'Oldest first'}</span>
            </button>
          </div>
        </section>

        <div className="slpa-split">
          <div className="slpa-feed" aria-label="Announcements feed">
            {actionError && (
              <p className="slpc-alert" role="alert">
                {actionError}
              </p>
            )}
            {partial && (
              <p className="slpc-alert" role="alert">
                Announcements could not be loaded for {failed.map((course) => course.course_code).join(', ')}. The figures above are hidden until every course loads.
              </p>
            )}

            {coursesQuery.isPending && <Skeleton height={160} label="Loading announcements" />}
            {coursesQuery.isError && <ErrorCard message="Your courses could not be loaded." onRetry={() => coursesQuery.refetch()} />}
            {coursesQuery.isSuccess && courses.length === 0 && <p className="slpc-empty">You are not assigned to any courses yet, so there is nobody to announce to.</p>}
            {coursesQuery.isSuccess && courses.length > 0 && anyPending && <Skeleton height={160} label="Loading announcements" />}

            {notReady && (
              <PhasePanel icon="campaign" title="Announcements are not switched on yet" phase="Phase 7">
                The announcements service is not available on the server yet. Your page is ready: once it is enabled, drafts and published posts will appear here.
              </PhasePanel>
            )}

            {allLoaded && scoped.length === 0 && <p className="slpc-empty">No announcements yet. Use the composer to post the first one.</p>}
            {allLoaded && scoped.length > 0 && visible.length === 0 && <p className="slpc-empty">No announcements match these filters.</p>}

            {pageItems.map((item) => (
              <AnnouncementCard key={item.id} item={item} courseLabel={courseLabelOf(item)} enrolled={enrolledOf(item.courseId)} busy={busyId === item.id} onToggle={toggle} onSave={save} />
            ))}

            {visible.length > PAGE_SIZE && (
              <div className="slpa-pager">
                <span>
                  Page {safePage} of {pageCount}
                </span>
                <div className="slpa-button-row">
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

          <Composer key={routeCourseId || 'all'} courses={courses} defaultCourseId={routeCourseId} formRef={composerRef} enrolledOf={enrolledOf} onCreated={refresh} />
        </div>
      </div>
    </div>
  )
}
