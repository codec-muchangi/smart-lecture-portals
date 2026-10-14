import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '../services/apiClient.js'
import { formatDue, formatSize } from '../utils/format.js'

/*
 * Smart Lecture Portal: assignment submission dialog (shared by the student pages)
 * Place at: src/components/SubmitModal.jsx
 *
 * - POST /assignments/{id}/submissions (multipart "file"). A second upload replaces the first.
 * - Mirrors the backend rules: PDF, DOCX, PPTX, XLSX, CSV, PNG, JPG/JPEG or ZIP, at most 25 MB.
 * - Styles are scoped under `.slsm` and injected here, so no extra CSS file is needed.
 * - `task` needs { id, title, course_code, due_at }. `onClose(true)` means "uploaded".
 *   `onSubmitted` (optional, may be async) runs after a successful upload and before the
 *   dialog closes, so the parent can refresh its data.
 */

export const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'pptx', 'xlsx', 'csv', 'png', 'jpg', 'jpeg', 'zip']
export const MAX_UPLOAD_MB = 25

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

export function validateFile(file) {
  if (!ALLOWED_EXTENSIONS.includes(extensionOf(file.name))) {
    return `Unsupported file type. Use ${ALLOWED_EXTENSIONS.map((ext) => ext.toUpperCase()).join(', ')}.`
  }
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return `File is larger than ${MAX_UPLOAD_MB} MB.`
  if (file.size === 0) return 'That file is empty.'
  return ''
}

function SubmitModal({ task, now, onClose, onSubmitted }) {
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
      if (onSubmitted) await onSubmitted()
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
    <div className="slsm" onMouseDown={(event) => event.target === event.currentTarget && onClose(false)}>
      <style>{STYLES}</style>
      <div ref={dialogRef} className="slsm-modal" role="dialog" aria-modal="true" aria-labelledby="slsm-title">
        <div className="slsm-head">
          <div>
            <p className="slsm-code">SUBMISSION PORTAL · {task.course_code}</p>
            <h2 id="slsm-title" className="slsm-title">
              {task.title}
            </h2>
          </div>
          <button type="button" className="slsm-icon-btn" aria-label="Close" onClick={() => onClose(false)}>
            {renderIcon('close', 20)}
          </button>
        </div>

        <div className="slsm-due">
          <span className="slsm-inline">
            {renderIcon('schedule', 16)}
            Due: {formatDue(task.due_at, now)}
          </span>
          <span className="slsm-code slsm-error-text">{remaining(task.due_at, now)}</span>
        </div>

        <div
          className={`slsm-drop ${dragging ? 'is-drag' : ''}`}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <span className="slsm-drop-icon">{renderIcon('upload_file', 32)}</span>
          {file ? (
            <p className="slsm-drop-title" data-testid="chosen-file">
              {file.name} <span className="slsm-muted">({formatSize(file.size)})</span>
            </p>
          ) : (
            <p className="slsm-drop-title">Drag and drop your file here</p>
          )}
          <p className="slsm-muted">
            Supported formats: {ALLOWED_EXTENSIONS.map((ext) => ext.toUpperCase()).join(', ')} (Maximum {MAX_UPLOAD_MB}MB)
          </p>
          <button type="button" className="slsm-btn slsm-btn-soft" onClick={() => inputRef.current?.click()}>
            Select File from Device
          </button>
          <input
            ref={inputRef}
            type="file"
            className="slsm-file"
            aria-label="Choose a file to submit"
            accept={ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(',')}
            onChange={(event) => {
              choose(event.target.files?.[0])
              event.target.value = ''
            }}
          />
        </div>
        {fileError && (
          <p className="slsm-alert" role="alert">
            {fileError}
          </p>
        )}

        <div className="slsm-pledge">
          <input
            id="slsm-pledge"
            type="checkbox"
            checked={pledge}
            onChange={(event) => setPledge(event.target.checked)}
          />
          <label htmlFor="slsm-pledge">
            I confirm that this submission is my own original work and complies with university academic
            integrity and plagiarism regulations.
          </label>
        </div>

        {submitError && (
          <p className="slsm-alert" role="alert">
            {submitError}
          </p>
        )}

        <div className="slsm-actions">
          <button type="button" className="slsm-btn slsm-btn-plain" onClick={() => onClose(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="slsm-btn slsm-btn-primary"
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

export default SubmitModal

const STYLES = `
.slsm {
  --primary: #a03223;
  --on-primary: #ffffff;
  --primary-container: #c14a38;
  --on-primary-container: #fff5f3;
  --primary-fixed: #ffdad4;
  --error: #ba1a1a;
  --error-container: #ffdad6;
  --on-error-container: #93000a;
  --surface-low: #faf0fe;
  --surface-mid: #f4ebf8;
  --surface-high: #eee5f2;
  --surface-lowest: #ffffff;
  --on-surface: #1e1a23;
  --on-surface-variant: #58413e;
  --outline: #8b716d;
  position: fixed; inset: 0; z-index: 100; display: flex; align-items: center; justify-content: center;
  padding: 1rem; background: rgba(51, 47, 56, 0.4); backdrop-filter: blur(4px);
  font-family: 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: var(--on-surface); line-height: 1.5; text-align: left; -webkit-font-smoothing: antialiased;
}
.slsm *, .slsm *::before, .slsm *::after { box-sizing: border-box; }
/* :where() keeps the reset at low specificity so the class rules below can override it */
.slsm :where(h2, p) { margin: 0; padding: 0; }
.slsm button, .slsm input { font-family: inherit; }
.slsm .material-symbols-outlined {
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
.slsm button:focus-visible, .slsm input:focus-visible {
  outline: 3px solid var(--primary-container);
  outline-offset: 3px;
  border-radius: 8px;
}
.slsm-modal {
  width: 100%; max-width: 576px; max-height: calc(100vh - 2rem); overflow-y: auto; border-radius: 16px;
  background: var(--surface-lowest); padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem;
  box-shadow: 0 24px 48px rgba(30, 26, 35, 0.25);
}
.slsm-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; }
.slsm-code { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 14px; font-weight: 700; color: var(--primary); }
.slsm-title { margin-top: 2px; font-size: 20px; line-height: 28px; font-weight: 700; letter-spacing: -0.01em; }
.slsm-muted { color: var(--on-surface-variant); font-size: 13px; line-height: 18px; }
.slsm-inline { display: inline-flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.slsm-error-text { color: var(--error); }
.slsm-due {
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;
  padding: 0.5rem 0.75rem; border-radius: 12px; background: var(--surface-low); font-size: 13px; color: var(--on-surface-variant);
}
.slsm-due .material-symbols-outlined { color: var(--primary); }
.slsm-drop {
  display: flex; flex-direction: column; align-items: center; text-align: center; gap: 0.5rem; padding: 2rem 1rem;
  border-radius: 16px; background: var(--surface-lowest); box-shadow: inset 0 0 0 2px var(--surface-high);
  transition: background 0.2s;
}
.slsm-drop.is-drag { background: var(--surface-low); box-shadow: inset 0 0 0 2px var(--primary-container); }
.slsm-drop-icon {
  width: 56px; height: 56px; border-radius: 16px; background: var(--primary-fixed); color: var(--primary);
  display: inline-flex; align-items: center; justify-content: center;
}
.slsm-drop-title { font-size: 16px; line-height: 24px; font-weight: 600; overflow-wrap: anywhere; }
.slsm-file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.slsm-alert { padding: 0.5rem 0.75rem; border-radius: 12px; background: var(--error-container); color: var(--on-error-container); font-size: 13px; line-height: 18px; font-weight: 600; }
.slsm-pledge { display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.75rem; border-radius: 12px; background: var(--surface-low); }
.slsm-pledge input { margin-top: 3px; width: 16px; height: 16px; accent-color: var(--primary); flex: 0 0 auto; }
.slsm-pledge label { font-size: 13px; line-height: 18px; color: var(--on-surface-variant); cursor: pointer; }
.slsm-actions { display: flex; align-items: center; justify-content: flex-end; gap: 0.5rem; padding-top: 0.5rem; }
.slsm-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.375rem; border: 0; cursor: pointer;
  padding: 10px 16px; border-radius: 999px; font-size: 12px; line-height: 16px; font-weight: 600; letter-spacing: 0.02em;
  transition: background 0.2s; white-space: nowrap;
}
.slsm-btn-primary { background: var(--primary-container); color: var(--on-primary-container); box-shadow: 0 1px 3px rgba(30, 26, 35, 0.2); }
.slsm-btn-primary:hover:not(:disabled) { background: var(--primary); }
.slsm-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.slsm-btn-soft { background: var(--surface-low); color: var(--on-surface); box-shadow: inset 0 0 0 1px var(--surface-high); }
.slsm-btn-soft:hover { background: var(--surface-high); }
.slsm-btn-plain { background: var(--surface-mid); color: var(--on-surface); }
.slsm-btn-plain:hover { background: var(--surface-high); }
.slsm-icon-btn {
  width: 32px; height: 32px; border: 0; border-radius: 999px; background: var(--surface-mid); color: var(--outline);
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex: 0 0 auto;
}
.slsm-icon-btn:hover { color: var(--on-surface); }
`
