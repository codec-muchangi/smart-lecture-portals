import { useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/apiClient.js'
import {
  CATEGORY_LABELS,
  COURSES_KEY,
  COURSE_STYLES,
  ErrorCard,
  Skeleton,
  fetchCourses,
  renderIcon,
  useCourseFonts,
  useDownloads,
} from '../../components/courseKit.jsx'
import { formatDate, formatSize, toList } from '../../utils/format.js'

/*
 * Smart Lecture Portal: lecturer Materials Management
 * Place at: src/pages/lecturer/LecturerMaterials.jsx
 *
 * Routes (see routes.jsx):
 *   /lecturer/materials                    every material across the courses you teach
 *   /lecturer/courses/:courseId/materials  the same page with that course preselected
 *
 * - Renders inside AppShell, which already draws the sidebar and top bar.
 * - Real data only (SRS: no hard-coded figures). Endpoints used:
 *     GET    /courses                          assigned courses
 *     GET    /courses/{id}/materials           materials, drafts included for lecturers
 *     POST   /courses/{id}/materials           upload (multipart: file, title, description, category, published)
 *     PATCH  /materials/{id}                   publish / unpublish, edit details
 *     DELETE /materials/{id}                   delete
 *     GET    /materials/{id}/download          signed download link (short-lived)
 * - The API keeps no download counts, storage quota or scheduling, so the page shows none of them.
 */

const CATEGORY_IDS = Object.keys(CATEGORY_LABELS)
const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'pptx', 'xlsx', 'csv', 'png', 'jpg', 'jpeg', 'zip']
const MAX_UPLOAD_MB = 25
const PAGE_SIZE = 8
const FORMAT_OPTIONS = [
  { id: 'pdf', label: 'PDF documents' },
  { id: 'docx', label: 'Word documents' },
  { id: 'pptx', label: 'PowerPoint slides' },
  { id: 'xlsx', label: 'Excel sheets' },
  { id: 'csv', label: 'CSV files' },
  { id: 'image', label: 'Images' },
  { id: 'zip', label: 'ZIP archives' },
]
const SORTS = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'title', label: 'Title A to Z' },
  { id: 'size', label: 'Largest first' },
]
const FILE_ICONS = {
  pdf: 'picture_as_pdf',
  docx: 'description',
  pptx: 'slideshow',
  xlsx: 'table_chart',
  csv: 'table_chart',
  image: 'image',
  zip: 'folder_zip',
}

const formatOf = (fileName) => {
  const ext = String(fileName ?? '').split('.').pop().toLowerCase()
  return ext === 'png' || ext === 'jpg' || ext === 'jpeg' ? 'image' : ext
}
const extensionOf = (fileName) => String(fileName ?? '').split('.').pop().toLowerCase()
const listKey = (courseId) => ['course-materials', courseId]
const listPath = (courseId) => `/courses/${courseId}/materials?page_size=100`

const MATERIALS_STYLES = `
.slpm-hero { display: flex; flex-direction: column; gap: 1.25rem; padding: 1.25rem; background: linear-gradient(135deg, var(--surface-lowest) 55%, var(--surface-low)); }
.slpm-hero-main { display: flex; flex-direction: column; gap: 0.75rem; min-width: 0; }
.slpm-hero-actions { display: flex; flex-direction: column; gap: 0.75rem; align-items: stretch; }
.slpm-hero-actions .slpc-btn { justify-content: center; }
.slpm-title { font-size: 26px; line-height: 34px; font-weight: 700; letter-spacing: -0.02em; overflow-wrap: anywhere; }
.slpm-tag { display: inline-flex; align-self: flex-start; padding: 2px 10px; border-radius: 999px; background: var(--primary-fixed); color: var(--on-primary-fixed); font-size: 11px; line-height: 16px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
.slpm-ribbon { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.5rem; padding: 0.75rem; border-radius: 12px; background: var(--surface-low); }
.slpm-ribbon-item { display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem; min-width: 0; }
.slpm-ribbon-icon { width: 40px; height: 40px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; background: var(--surface-lowest); box-shadow: 0 1px 2px rgba(30, 26, 35, 0.08); color: var(--primary); }
.slpm-ribbon-icon.is-ok { color: var(--ok); }
.slpm-ribbon-icon.is-warm { color: var(--warn); }
.slpm-ribbon-text { display: flex; flex-direction: column; min-width: 0; }
.slpm-ribbon-label { font-size: 10px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpm-ribbon-value { font-size: 16px; line-height: 24px; font-weight: 700; overflow-wrap: anywhere; }
.slpm-policy { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.875rem 1rem; border-radius: 12px; background: var(--surface-low); font-size: 13px; line-height: 20px; color: var(--on-surface-variant); }
.slpm-policy ul { display: flex; flex-direction: column; gap: 0.375rem; }
.slpm-policy li { display: flex; align-items: flex-start; gap: 0.5rem; }
.slpm-policy li .material-symbols-outlined { color: var(--primary); margin-top: 1px; }
.slpm-filters { display: flex; flex-direction: column; gap: 0.75rem; }
.slpm-filter-row { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.5rem; }
.slpm-filters .slpc-select { width: 100%; min-width: 0; text-overflow: ellipsis; }
.slpm-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.slpm-list-head { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.5rem; }
.slpm-list-title { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; }
.slpm-list-note { display: inline-flex; align-items: center; gap: 0.375rem; font-size: 12px; line-height: 16px; color: var(--on-surface-variant); }
.slpm-rows { display: flex; flex-direction: column; }
.slpm-row { display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem 0; border-top: 1px solid var(--surface-mid); min-width: 0; }
.slpm-row:first-child { border-top: 0; }
.slpm-row-main { display: flex; align-items: flex-start; gap: 0.75rem; min-width: 0; }
.slpm-file-icon { width: 44px; height: 44px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; background: var(--primary-fixed); color: var(--primary); }
.slpm-row-body { display: flex; flex-direction: column; gap: 0.375rem; min-width: 0; flex: 1 1 auto; }
.slpm-row-title { font-size: 15px; line-height: 22px; font-weight: 700; overflow-wrap: anywhere; }
.slpm-row-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; font-size: 12px; line-height: 16px; color: var(--on-surface-variant); }
.slpm-row-meta span { display: inline-flex; align-items: center; gap: 0.25rem; }
.slpm-row-desc { font-size: 13px; line-height: 18px; color: var(--on-surface-variant); overflow-wrap: anywhere; }
.slpm-code { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; padding: 2px 6px; border-radius: 6px; background: var(--surface-mid); font-size: 11px; line-height: 14px; font-weight: 600; color: var(--on-surface); }
.slpm-actions { display: flex; align-items: center; gap: 0.5rem; padding-left: 56px; flex-wrap: wrap; }
.slpm-icon-btn { width: 36px; height: 36px; border: 0; border-radius: 10px; background: var(--surface-low); color: var(--on-surface-variant); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex: 0 0 auto; transition: background 0.2s, color 0.2s; }
.slpm-icon-btn:hover:not(:disabled) { background: var(--surface-high); color: var(--primary); }
.slpm-icon-btn:disabled { opacity: 0.55; cursor: progress; }
.slpm-icon-btn.is-live { color: var(--ok); background: var(--ok-bg); }
.slpm-icon-btn.is-danger:hover:not(:disabled) { background: var(--error-container); color: var(--error); }
.slpm-editor, .slpm-confirm { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.875rem; border-radius: 12px; background: var(--surface-low); margin-left: 0; }
.slpm-confirm { background: var(--error-container); color: var(--on-error-container); font-size: 13px; line-height: 18px; font-weight: 600; }
.slpm-button-row { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.slpm-btn-danger { background: var(--error); color: #fff; }
.slpm-btn-danger:hover:not(:disabled) { background: var(--on-error-container); }
.slpm-pager { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding-top: 0.75rem; border-top: 1px solid var(--surface-mid); font-size: 12px; color: var(--on-surface-variant); flex-wrap: wrap; }
.slpm-form { display: flex; flex-direction: column; gap: 0.875rem; }
.slpm-form-head { display: flex; align-items: center; gap: 0.75rem; }
.slpm-form-head .slpm-file-icon { width: 36px; height: 36px; }
.slpm-field { display: flex; flex-direction: column; gap: 0.375rem; min-width: 0; }
.slpm-field label, .slpm-label { font-size: 12px; line-height: 16px; font-weight: 700; color: var(--on-surface); }
.slpm-field input[type='text'], .slpm-field textarea, .slpm-field select {
  width: 100%; min-width: 0; border: 0; border-radius: 8px; background: var(--surface-low); color: var(--on-surface);
  padding: 10px 12px; font-size: 13px; line-height: 18px;
}
.slpm-field select { height: 40px; padding: 0 12px; }
.slpm-field textarea { resize: vertical; min-height: 72px; }
.slpm-field input:focus, .slpm-field textarea:focus, .slpm-field select:focus { outline: 0; box-shadow: 0 0 0 2px var(--primary-container); }
.slpm-field-error { font-size: 12px; line-height: 16px; color: var(--error); font-weight: 600; }
.slpm-hint { font-size: 11px; line-height: 16px; color: var(--on-surface-variant); }
.slpm-drop { display: flex; flex-direction: column; align-items: center; gap: 0.375rem; padding: 1rem; border-radius: 12px; border: 2px dashed var(--outline-variant); background: var(--surface-low); text-align: center; cursor: pointer; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpm-drop:hover { border-color: var(--primary-container); }
.slpm-drop strong { color: var(--on-surface); overflow-wrap: anywhere; }
.slpm-drop .material-symbols-outlined { color: var(--primary); }
.slpm-check { display: flex; align-items: flex-start; gap: 0.625rem; font-size: 13px; line-height: 18px; }
.slpm-check input { width: 18px; height: 18px; margin: 0; accent-color: var(--primary); flex: 0 0 auto; }
.slpm-ok { padding: 0.5rem 0.75rem; border-radius: 12px; background: var(--ok-bg); color: var(--ok); font-size: 13px; line-height: 18px; font-weight: 600; }
@media (min-width: 640px) {
  .slpm-ribbon { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .slpm-filter-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .slpm-hero-actions { flex-direction: row; flex-wrap: wrap; align-items: center; }
  .slpm-row { flex-direction: row; align-items: flex-start; justify-content: space-between; }
  .slpm-row-editing, .slpm-row-confirming { flex-direction: column; }
  .slpm-actions { padding-left: 0; flex-wrap: nowrap; }
  .slpm-list-head { flex-direction: row; align-items: center; justify-content: space-between; }
}
@media (min-width: 1024px) {
  .slpm-filter-row { grid-template-columns: minmax(0, 2fr) repeat(3, minmax(0, 1fr)); }
  .slpm-ribbon { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .slpm-split { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
  .slpm-hero { flex-direction: row; align-items: flex-start; justify-content: space-between; padding: 2rem; }
  .slpm-hero-main { flex: 1 1 auto; }
  .slpm-hero-actions { flex: 0 0 auto; flex-direction: column; align-items: stretch; width: 220px; }
  .slpm-title { font-size: 32px; line-height: 40px; }
}
`

function errorText(error, fallback) {
  return error?.message || fallback
}

function Ribbon({ icon, tone, label, children }) {
  return (
    <div className="slpm-ribbon-item">
      <span className={`slpm-ribbon-icon ${tone ? `is-${tone}` : ''}`}>{renderIcon(icon, 22)}</span>
      <span className="slpm-ribbon-text">
        <span className="slpm-ribbon-label">{label}</span>
        <span className="slpm-ribbon-value">{children}</span>
      </span>
    </div>
  )
}

function MaterialRow({ item, courseLabel, busyId, downloads, onTogglePublish, onSave, onDelete, pending }) {
  const [mode, setMode] = useState('') // '', 'edit', 'delete'
  const [title, setTitle] = useState(item.title)
  const [description, setDescription] = useState(item.description ?? '')
  const [category, setCategory] = useState(item.category)
  const [formError, setFormError] = useState('')
  const format = formatOf(item.file_name)
  const busy = busyId === item.id || pending

  const openEditor = () => {
    setTitle(item.title)
    setDescription(item.description ?? '')
    setCategory(item.category)
    setFormError('')
    setMode('edit')
  }

  const save = async (event) => {
    event.preventDefault()
    const cleanTitle = title.trim()
    if (cleanTitle.length < 2 || cleanTitle.length > 200) {
      setFormError('The title must be between 2 and 200 characters.')
      return
    }
    if (description.length > 2000) {
      setFormError('The description can be at most 2000 characters.')
      return
    }
    const ok = await onSave(item, { title: cleanTitle, description: description.trim(), category })
    if (ok) setMode('')
  }

  const remove = async () => {
    const ok = await onDelete(item)
    if (ok) setMode('')
  }

  return (
    <li className={`slpm-row ${mode === 'edit' ? 'slpm-row-editing' : ''} ${mode === 'delete' ? 'slpm-row-confirming' : ''}`}>
      <div className="slpm-row-main">
        <span className="slpm-file-icon">{renderIcon(FILE_ICONS[format] ?? 'draft', 24)}</span>
        <div className="slpm-row-body">
          <h3 className="slpm-row-title">{item.title}</h3>
          <div className="slpc-chips">
            <span className={`slpc-chip ${item.published ? 'is-ok' : 'is-warn'}`}>
              {renderIcon(item.published ? 'visibility' : 'visibility_off', 14)}
              {item.published ? 'Published' : 'Draft, hidden from students'}
            </span>
            <span className="slpm-code">{courseLabel}</span>
          </div>
          <div className="slpm-row-meta">
            <span>{CATEGORY_LABELS[item.category] ?? item.category}</span>
            {formatSize(item.file_size) && <span>{formatSize(item.file_size)}</span>}
            {formatDate(item.created_at) && (
              <span>
                {formatDate(item.created_at)}
                {item.uploader_name ? ` (${item.uploader_name})` : ''}
              </span>
            )}
          </div>
          <div className="slpm-row-meta">
            <span className="slpm-code">{item.file_name}</span>
            {item.mime_type && <span>MIME: {item.mime_type}</span>}
          </div>
          {item.description && <p className="slpm-row-desc">{item.description}</p>}
        </div>
      </div>

      {mode === '' && (
        <div className="slpm-actions" role="group" aria-label={`Actions for ${item.title}`}>
          <button
            type="button"
            className={`slpm-icon-btn ${item.published ? 'is-live' : ''}`}
            onClick={() => onTogglePublish(item)}
            disabled={busy}
            aria-pressed={item.published}
            aria-label={item.published ? `Unpublish ${item.title}` : `Publish ${item.title}`}
            title={item.published ? 'Published: click to hide from students' : 'Draft: click to publish'}
          >
            {renderIcon(item.published ? 'visibility' : 'visibility_off', 20)}
          </button>
          <button
            type="button"
            className="slpm-icon-btn"
            onClick={() => downloads.start(item.id, `/materials/${item.id}/download`)}
            disabled={downloads.busy === item.id}
            aria-label={`Download ${item.title}`}
            title="Download"
          >
            {renderIcon('download', 20)}
          </button>
          <button type="button" className="slpm-icon-btn" onClick={openEditor} disabled={busy} aria-label={`Edit ${item.title}`} title="Edit details">
            {renderIcon('edit', 20)}
          </button>
          <button
            type="button"
            className="slpm-icon-btn is-danger"
            onClick={() => setMode('delete')}
            disabled={busy}
            aria-label={`Delete ${item.title}`}
            title="Delete"
          >
            {renderIcon('delete', 20)}
          </button>
        </div>
      )}

      {mode === 'edit' && (
        <form className="slpm-editor" onSubmit={save} aria-label={`Edit ${item.title}`}>
          <div className="slpm-field">
            <label htmlFor={`edit-title-${item.id}`}>Title</label>
            <input id={`edit-title-${item.id}`} type="text" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} />
          </div>
          <div className="slpm-field">
            <label htmlFor={`edit-category-${item.id}`}>Category</label>
            <select id={`edit-category-${item.id}`} value={category} onChange={(event) => setCategory(event.target.value)}>
              {CATEGORY_IDS.map((id) => (
                <option key={id} value={id}>
                  {CATEGORY_LABELS[id]}
                </option>
              ))}
            </select>
          </div>
          <div className="slpm-field">
            <label htmlFor={`edit-description-${item.id}`}>Description</label>
            <textarea id={`edit-description-${item.id}`} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} />
          </div>
          {formError && (
            <p className="slpm-field-error" role="alert">
              {formError}
            </p>
          )}
          <div className="slpm-button-row">
            <button type="submit" className="slpc-btn slpc-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => setMode('')} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {mode === 'delete' && (
        <div className="slpm-confirm" role="alertdialog" aria-label={`Delete ${item.title}`}>
          <p>Delete “{item.title}”? Students will no longer be able to download it. This cannot be undone.</p>
          <div className="slpm-button-row">
            <button type="button" className="slpc-btn slpm-btn-danger" onClick={remove} disabled={busy}>
              {busy ? 'Deleting…' : 'Yes, delete'}
            </button>
            <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => setMode('')} disabled={busy}>
              Keep it
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

function UploadForm({ courses, defaultCourseId, formRef, onUploaded }) {
  const fileInput = useRef(null)
  const [courseId, setCourseId] = useState(defaultCourseId || '')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('lecture_notes')
  const [description, setDescription] = useState('')
  const [published, setPublished] = useState(true)
  const [file, setFile] = useState(null)
  const [errors, setErrors] = useState({})
  const [success, setSuccess] = useState('')

  const effectiveCourse = courseId || (courses.length === 1 ? courses[0].id : '')

  const upload = useMutation({
    mutationFn: ({ targetId, form }) => api(`/courses/${targetId}/materials`, { method: 'POST', form }),
  })

  const submit = async (event) => {
    event.preventDefault()
    const next = {}
    const cleanTitle = title.trim()
    if (!effectiveCourse) next.course = 'Choose a course.'
    if (cleanTitle.length < 2 || cleanTitle.length > 200) next.title = 'The title must be between 2 and 200 characters.'
    if (description.length > 2000) next.description = 'The description can be at most 2000 characters.'
    if (!file) next.file = 'Choose a file to upload.'
    else if (!ALLOWED_EXTENSIONS.includes(extensionOf(file.name))) next.file = `This file type is not allowed. Use ${ALLOWED_EXTENSIONS.join(', ').toUpperCase()}.`
    else if (file.size > MAX_UPLOAD_MB * 1024 * 1024) next.file = `The file is larger than ${MAX_UPLOAD_MB} MB.`
    setErrors(next)
    setSuccess('')
    if (Object.keys(next).length) return

    const form = new FormData()
    form.append('file', file)
    form.append('title', cleanTitle)
    form.append('description', description.trim())
    form.append('category', category)
    form.append('published', String(published))
    try {
      await upload.mutateAsync({ targetId: effectiveCourse, form })
    } catch (caught) {
      setErrors({ form: errorText(caught, 'The upload failed. Please try again.') })
      return
    }
    setTitle('')
    setDescription('')
    setFile(null)
    if (fileInput.current) fileInput.current.value = ''
    setSuccess(published ? 'Uploaded and published to students.' : 'Uploaded as a draft. Students cannot see it yet.')
    onUploaded(effectiveCourse)
  }

  return (
    <section className="slpc-card" ref={formRef} aria-labelledby="slpm-upload-title" tabIndex={-1}>
      <form className="slpm-form" onSubmit={submit} noValidate>
        <div className="slpm-form-head">
          <span className="slpm-file-icon">{renderIcon('upload_file', 20)}</span>
          <h2 id="slpm-upload-title" className="slpc-h3">
            Upload material
          </h2>
        </div>

        <div className="slpm-field">
          <label htmlFor="slpm-course">Target course *</label>
          <select id="slpm-course" value={effectiveCourse} onChange={(event) => setCourseId(event.target.value)} aria-invalid={Boolean(errors.course)}>
            <option value="">Select a course</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.course_code}: {course.course_name}
              </option>
            ))}
          </select>
          {errors.course && <span className="slpm-field-error">{errors.course}</span>}
        </div>

        <div className="slpm-field">
          <label htmlFor="slpm-title">Material title *</label>
          <input id="slpm-title" type="text" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Week 09 distributed tracing slides" maxLength={200} aria-invalid={Boolean(errors.title)} />
          {errors.title && <span className="slpm-field-error">{errors.title}</span>}
        </div>

        <div className="slpm-field">
          <label htmlFor="slpm-category">Category *</label>
          <select id="slpm-category" value={category} onChange={(event) => setCategory(event.target.value)}>
            {CATEGORY_IDS.map((id) => (
              <option key={id} value={id}>
                {CATEGORY_LABELS[id]}
              </option>
            ))}
          </select>
        </div>

        <div className="slpm-field">
          <label htmlFor="slpm-description">Description (optional)</label>
          <textarea id="slpm-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} />
          {errors.description && <span className="slpm-field-error">{errors.description}</span>}
        </div>

        <div className="slpm-field">
          <span className="slpm-label">File *</span>
          <label className="slpm-drop" htmlFor="slpm-file">
            {renderIcon('cloud_upload', 28)}
            {file ? <strong>{file.name}</strong> : <strong>Choose a file</strong>}
            <span className="slpm-hint">
              {ALLOWED_EXTENSIONS.join(', ').toUpperCase()} · up to {MAX_UPLOAD_MB} MB
            </span>
          </label>
          <input
            id="slpm-file"
            ref={fileInput}
            className="slpc-visually-hidden"
            type="file"
            accept={ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(',')}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            aria-label="File"
          />
          {errors.file && <span className="slpm-field-error">{errors.file}</span>}
        </div>

        <label className="slpm-check" htmlFor="slpm-published">
          <input id="slpm-published" type="checkbox" checked={published} onChange={(event) => setPublished(event.target.checked)} />
          <span>Publish now so enrolled students can see it</span>
        </label>

        {errors.form && (
          <p className="slpc-alert" role="alert">
            {errors.form}
          </p>
        )}
        {success && (
          <p className="slpm-ok" role="status">
            {success}
          </p>
        )}

        <button type="submit" className="slpc-btn slpc-btn-primary" disabled={upload.isPending}>
          {renderIcon('upload', 18)}
          {upload.isPending ? 'Uploading…' : 'Upload material'}
        </button>
      </form>
    </section>
  )
}

export default function LecturerMaterials() {
  useCourseFonts()
  const { courseId: routeCourseId } = useParams()
  const queryClient = useQueryClient()
  const downloads = useDownloads()
  const formRef = useRef(null)

  const [search, setSearch] = useState('')
  const [courseFilter, setCourseFilter] = useState(routeCourseId || 'all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [formatFilter, setFormatFilter] = useState('all')
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(1)
  const [showPolicy, setShowPolicy] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [actionError, setActionError] = useState('')

  const coursesQuery = useQuery({ queryKey: COURSES_KEY, queryFn: fetchCourses })
  const courses = useMemo(() => toList(coursesQuery.data), [coursesQuery.data])

  const materialQueries = useQueries({
    queries: courses.map((course) => ({
      queryKey: listKey(course.id),
      queryFn: () => api(listPath(course.id)),
    })),
  })

  const items = []
  courses.forEach((course, index) => {
    toList(materialQueries[index]?.data).forEach((item) => items.push({ ...item, courseId: course.id, courseCode: course.course_code }))
  })

  const anyPending = materialQueries.some((query) => query.isPending)
  const failedCourses = courses.filter((_, index) => materialQueries[index]?.isError)
  const allLoaded = coursesQuery.isSuccess && !anyPending && failedCourses.length === 0
  const truncated = courses.filter((course, index) => {
    const data = materialQueries[index]?.data
    return typeof data?.total === 'number' && data.total > toList(data).length
  })

  const published = items.filter((item) => item.published).length
  const drafts = items.length - published
  const totalBytes = items.reduce((sum, item) => sum + (Number(item.file_size) || 0), 0)

  const visible = (() => {
    const needle = search.trim().toLowerCase()
    const filtered = items.filter((item) => {
      if (courseFilter !== 'all' && item.courseId !== courseFilter) return false
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false
      if (statusFilter === 'published' && !item.published) return false
      if (statusFilter === 'draft' && item.published) return false
      if (formatFilter !== 'all' && formatOf(item.file_name) !== formatFilter) return false
      if (needle && !`${item.title} ${item.file_name} ${item.description ?? ''}`.toLowerCase().includes(needle)) return false
      return true
    })
    const by = {
      newest: (a, b) => new Date(b.created_at) - new Date(a.created_at),
      oldest: (a, b) => new Date(a.created_at) - new Date(b.created_at),
      title: (a, b) => String(a.title).localeCompare(String(b.title)),
      size: (a, b) => (Number(b.file_size) || 0) - (Number(a.file_size) || 0),
    }
    return filtered.sort(by[sort])
  })()

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageItems = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const refresh = (courseId) => queryClient.invalidateQueries({ queryKey: listKey(courseId) })

  const patch = useMutation({
    mutationFn: ({ id, body }) => api(`/materials/${id}`, { method: 'PATCH', body }),
  })
  const remove = useMutation({
    mutationFn: (id) => api(`/materials/${id}`, { method: 'DELETE' }),
  })

  const runAction = async (item, work, failure) => {
    setBusyId(item.id)
    setActionError('')
    try {
      await work()
      await refresh(item.courseId)
      return true
    } catch (caught) {
      setActionError(errorText(caught, failure))
      return false
    } finally {
      setBusyId('')
    }
  }

  const togglePublish = (item) =>
    runAction(item, () => patch.mutateAsync({ id: item.id, body: { published: !item.published } }), 'The visibility could not be changed. Please try again.')
  const saveDetails = (item, body) => runAction(item, () => patch.mutateAsync({ id: item.id, body }), 'The changes could not be saved. Please try again.')
  const deleteItem = (item) => runAction(item, () => remove.mutateAsync(item.id), 'The material could not be deleted. Please try again.')

  const resetPage = (setter) => (event) => {
    setter(event.target.value)
    setPage(1)
  }

  const goToForm = () => {
    formRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    formRef.current?.focus?.()
  }

  const courseLabelOf = (item) => item.courseCode

  const scopeCourse = routeCourseId ? courses.find((course) => course.id === routeCourseId) : null

  return (
    <div className="slpc" aria-label="Materials management">
      <style>{COURSE_STYLES}</style>
      <style>{MATERIALS_STYLES}</style>

      <div className="slpc-stack slpc-gap-lg">
        <nav className="slpc-trail" aria-label="Breadcrumb">
          <Link to="/lecturer" className="slpc-trail-link">
            {renderIcon('home', 16)}
            Dashboard
          </Link>
          <span className="slpc-trail-sep">{renderIcon('chevron_right', 16)}</span>
          <span className="slpc-trail-current">Materials Management</span>
          {scopeCourse && <span className="slpm-code">{scopeCourse.course_code}</span>}
        </nav>

        <section className="slpc-card slpm-hero" aria-labelledby="slpm-heading">
          <div className="slpm-hero-main">
            <span className="slpm-tag">Course materials</span>
            <h1 id="slpm-heading" className="slpm-title">
              Materials Management
            </h1>
            <p className="slpc-lead">Upload, organise and publish lecture slides, notes, labs and readings for the courses you teach. Files stay hidden from students until you publish them.</p>

            <div className="slpm-ribbon" aria-label="Materials summary">
              <Ribbon icon="folder_copy" label="Total materials">
                {allLoaded ? `${items.length} ${items.length === 1 ? 'file' : 'files'}` : '—'}
              </Ribbon>
              <Ribbon icon="hard_drive" label="Storage used">
                {allLoaded ? formatSize(totalBytes) || '0 KB' : '—'}
              </Ribbon>
              <Ribbon icon="visibility" tone="ok" label="Visible to students">
                {allLoaded ? `${published} published` : '—'}
              </Ribbon>
              <Ribbon icon="pending_actions" tone="warm" label="Drafts">
                {allLoaded ? `${drafts} hidden` : '—'}
              </Ribbon>
            </div>
          </div>

          <div className="slpm-hero-actions">
            <button type="button" className="slpc-btn slpc-btn-primary" onClick={goToForm}>
              {renderIcon('cloud_upload', 18)}
              Upload new material
            </button>
            <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => setShowPolicy((open) => !open)} aria-expanded={showPolicy} aria-controls="slpm-policy">
              {renderIcon('shield', 18)}
              Storage policy
            </button>
          </div>
        </section>

        {showPolicy && (
          <section id="slpm-policy" className="slpm-policy" aria-label="Storage policy">
            <ul>
              <li>
                {renderIcon('draft', 18)}
                <span>Allowed files: {ALLOWED_EXTENSIONS.join(', ').toUpperCase()}.</span>
              </li>
              <li>
                {renderIcon('data_usage', 18)}
                <span>Each file can be up to {MAX_UPLOAD_MB} MB.</span>
              </li>
              <li>
                {renderIcon('lock_clock', 18)}
                <span>Downloads use a private link that expires after about 2 minutes, so links cannot be shared.</span>
              </li>
              <li>
                {renderIcon('visibility_off', 18)}
                <span>Drafts are visible to lecturers only. Students see a file once you publish it.</span>
              </li>
              <li>
                {renderIcon('delete', 18)}
                <span>Deleting a material removes the file; only a record of it is kept.</span>
              </li>
            </ul>
          </section>
        )}

        <section className="slpc-card slpm-filters" aria-label="Filter materials">
          <div className="slpm-filter-row">
            <label className="slpc-search">
              {renderIcon('search', 18)}
              <input type="search" value={search} onChange={resetPage(setSearch)} placeholder="Search materials" aria-label="Search materials" />
            </label>
            <select className="slpc-select" value={courseFilter} onChange={resetPage(setCourseFilter)} aria-label="Filter by course">
              <option value="all">All courses</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.course_code}: {course.course_name}
                </option>
              ))}
            </select>
            <select className="slpc-select" value={categoryFilter} onChange={resetPage(setCategoryFilter)} aria-label="Filter by category">
              <option value="all">All categories</option>
              {CATEGORY_IDS.map((id) => (
                <option key={id} value={id}>
                  {CATEGORY_LABELS[id]}
                </option>
              ))}
            </select>
            <select className="slpc-select" value={statusFilter} onChange={resetPage(setStatusFilter)} aria-label="Filter by status">
              <option value="all">All statuses</option>
              <option value="published">Published</option>
              <option value="draft">Draft (hidden)</option>
            </select>
          </div>
          <div className="slpm-filter-row">
            <select className="slpc-select" value={formatFilter} onChange={resetPage(setFormatFilter)} aria-label="Filter by format">
              <option value="all">All formats</option>
              {FORMAT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <select className="slpc-select" value={sort} onChange={resetPage(setSort)} aria-label="Sort materials">
              {SORTS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </section>

        <div className="slpm-split">
          <section className="slpc-card" aria-labelledby="slpm-inventory">
            <div className="slpm-list-head">
              <div className="slpm-list-title">
                <h2 id="slpm-inventory" className="slpc-h3">
                  Course document inventory
                </h2>
                {allLoaded && (
                  <span className="slpc-pill is-primary">
                    {visible.length} {visible.length === 1 ? 'item' : 'items'}
                  </span>
                )}
              </div>
              <span className="slpm-list-note">
                {renderIcon('lock_clock', 16)}
                Downloads use short-lived private links
              </span>
            </div>

            {actionError && (
              <p className="slpc-alert" role="alert">
                {actionError}
              </p>
            )}
            {downloads.error && (
              <p className="slpc-alert" role="alert">
                {downloads.error}
              </p>
            )}
            {failedCourses.length > 0 && (
              <p className="slpc-alert" role="alert">
                Materials could not be loaded for {failedCourses.map((course) => course.course_code).join(', ')}. The figures above are hidden until every course loads.
              </p>
            )}
            {truncated.length > 0 && (
              <p className="slpc-notice" role="status">
                {renderIcon('info', 18)}
                <span>Showing the first 100 files for {truncated.map((course) => course.course_code).join(', ')}.</span>
              </p>
            )}

            {coursesQuery.isPending && <Skeleton height={160} label="Loading materials" />}
            {coursesQuery.isError && <ErrorCard message="Your courses could not be loaded." onRetry={() => coursesQuery.refetch()} />}
            {coursesQuery.isSuccess && courses.length === 0 && <p className="slpc-empty">You are not assigned to any courses yet, so there is nowhere to upload materials.</p>}
            {coursesQuery.isSuccess && courses.length > 0 && anyPending && <Skeleton height={160} label="Loading materials" />}
            {coursesQuery.isSuccess && courses.length > 0 && !anyPending && items.length === 0 && failedCourses.length === 0 && (
              <p className="slpc-empty">No materials have been uploaded yet. Use the form to add your first file.</p>
            )}
            {allLoaded && items.length > 0 && visible.length === 0 && <p className="slpc-empty">No materials match these filters.</p>}

            {pageItems.length > 0 && (
              <ul className="slpm-rows">
                {pageItems.map((item) => (
                  <MaterialRow
                    key={item.id}
                    item={item}
                    courseLabel={courseLabelOf(item)}
                    busyId={busyId}
                    pending={false}
                    downloads={downloads}
                    onTogglePublish={togglePublish}
                    onSave={saveDetails}
                    onDelete={deleteItem}
                  />
                ))}
              </ul>
            )}

            {visible.length > PAGE_SIZE && (
              <div className="slpm-pager">
                <span>
                  Page {safePage} of {pageCount}
                </span>
                <div className="slpm-button-row">
                  <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => setPage(safePage - 1)} disabled={safePage <= 1}>
                    Previous
                  </button>
                  <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => setPage(safePage + 1)} disabled={safePage >= pageCount}>
                    Next
                  </button>
                </div>
              </div>
            )}
          </section>

          <UploadForm key={routeCourseId || 'all'} courses={courses} defaultCourseId={routeCourseId} formRef={formRef} onUploaded={refresh} />
        </div>
      </div>
    </div>
  )
}
