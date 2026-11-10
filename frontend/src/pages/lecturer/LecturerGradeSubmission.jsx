import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/apiClient.js'
import { COURSES_KEY, COURSE_STYLES, ErrorCard, Skeleton, fetchCourses, renderIcon, useCourseFonts, useDownloads } from '../../components/courseKit.jsx'
import { formatSize, toList } from '../../utils/format.js'

/*
 * Smart Lecture Portal: lecturer Grade Submission (Submission Review)
 * Place at: src/pages/lecturer/LecturerGradeSubmission.jsx
 *
 * Route (see routes.jsx):
 *   /lecturer/assignments/:assignmentId/submissions    optional ?submission=<id> opens one candidate
 *
 * - Renders inside AppShell, which already draws the sidebar and top bar. The sidebar's
 *   "Assignments & Grading" entry points at /lecturer/assignments, which is a prefix of this route,
 *   so it stays lit while you grade.
 * - Built on the contract in docs/API.md (Assignments & submissions, Phase 4; grading, Phase 5):
 *     GET    /assignments/{id}                     title, deadline, max_marks, instructions, counts
 *     GET    /assignments/{id}/submissions         every submission with student name, number, mark, feedback
 *     GET    /submissions/{id}/download            signed link for the student's file
 *     PATCH  /submissions/{id}/grade               grade, regrade, show or hide, return for revision
 *     POST   /assignments/{id}/grades/release      show or hide every graded submission at once
 *     GET    /courses                              the course code beside the title
 * - Candidates are listed oldest submission first so the queue order never jumps while you grade.
 * - Every figure comes from those answers. The API has no rubric, syllabus weight, grade letter scale,
 *   checksum, automated test results or attempt counter, so the page shows none of them. Assignment
 *   grades are separate from the course result (Marks & Assessment); nothing is copied between them.
 * - A grade is only visible to its student once it is released. Returning work for revision needs
 *   written feedback and clears any mark. The server records every change in its audit log.
 */

const FEEDBACK_MAX = 2000
const RING = 97.38
const PENDING = ['submitted', 'late']
const DECIMALS = /^\d+(\.\d{1,2})?$/

const STATUS = {
  submitted: { label: 'Pending Evaluation', queue: 'Ungraded', tone: 'warm' },
  late: { label: 'Late · Pending', queue: 'Ungraded', tone: 'warm' },
  graded: { label: 'Graded', queue: 'Graded', tone: 'ok' },
  returned: { label: 'Returned for Revision', queue: 'Returned', tone: 'plain' },
}

const subsKey = (assignmentId) => ['lecturer-submissions', assignmentId]
const detailKey = (assignmentId) => ['lecturer-assignment', assignmentId]
const errorText = (error, fallback) => error?.message || fallback
const pad = (value) => String(value).padStart(2, '0')
const markText = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? `${Math.round(number * 100) / 100}` : ''
}
const stampOf = (value) => {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return ''
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
const spanText = (ms) => {
  const minutes = Math.max(0, Math.round(ms / 60000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}
const timing = (submittedAt, dueAt) => {
  const sent = new Date(submittedAt).getTime()
  const due = new Date(dueAt).getTime()
  if (Number.isNaN(sent) || Number.isNaN(due)) return ''
  return due >= sent ? `${spanText(due - sent)} before the deadline` : `${spanText(sent - due)} after the deadline`
}
const markError = (raw, max) => {
  const text = String(raw).trim()
  const limit = markText(max)
  if (text === '' || !Number.isFinite(Number(text))) return `Enter a mark between 0 and ${limit}.`
  if (!DECIMALS.test(text)) return 'Use at most 2 decimal places.'
  const value = Number(text)
  if (value < 0 || value > Number(max)) return `A mark must be between 0 and ${limit}.`
  return ''
}

async function fetchSubmissions(assignmentId) {
  const items = []
  for (let page = 1; page <= 20; page += 1) {
    const data = await api(`/assignments/${assignmentId}/submissions?page=${page}&page_size=100`)
    const batch = toList(data)
    items.push(...batch)
    if (batch.length < 100 || (typeof data?.total === 'number' && items.length >= data.total)) break
  }
  return items
}

const GRADE_STYLES = `
.slpy-head { display: flex; flex-direction: column; gap: 1rem; }
.slpy-titlerow { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; }
.slpy-code { display: inline-flex; align-items: center; padding: 2px 10px; border-radius: 999px; background: var(--primary-fixed); color: var(--primary); font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 13px; line-height: 20px; font-weight: 500; }
.slpy-title { margin: 0; min-width: 0; font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.slpy-pager { display: inline-flex; align-items: center; gap: 0.5rem; align-self: flex-start; padding: 6px 12px; border-radius: 12px; background: var(--surface-lowest); box-shadow: 0 1px 3px rgba(30, 26, 35, 0.08); }
.slpy-step { width: 28px; height: 28px; border: 0; border-radius: 8px; background: var(--surface-low); color: var(--on-surface-variant); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.15s; }
.slpy-step:hover:not(:disabled) { background: var(--surface-high); }
.slpy-step:disabled { opacity: 0.4; cursor: not-allowed; }
.slpy-step:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.slpy-count { padding: 0 4px; font-size: 13px; line-height: 18px; font-weight: 600; }
.slpy-count small { font-size: 13px; font-weight: 400; color: var(--on-surface-variant); }
.slpy-tools { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.75rem; }
.slpy-jump { height: 44px; width: 100%; min-width: 0; padding: 0 12px; border: 0; border-radius: 12px; background: var(--surface-low); color: var(--on-surface); font-family: inherit; font-size: 14px; }
.slpy-jump:focus-visible { outline: 2px solid var(--primary-container); }
.slpy-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.slpy-col { display: flex; flex-direction: column; gap: 1.5rem; min-width: 0; }
.slpy-card { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 1rem; padding: 1.25rem; border-radius: 12px; background: var(--surface-lowest); box-shadow: 0 1px 3px rgba(30, 26, 35, 0.08); }
.slpy-card.is-accent { padding-left: 1.5rem; }
.slpy-card.is-accent::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: var(--primary); }
.slpy-row { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 0.5rem 0.75rem; }
.slpy-row.is-center { align-items: center; }
.slpy-row > :first-child { min-width: 0; }
.slpy-eyebrow { display: block; font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--primary); }
.slpy-label { display: block; font-size: 11px; line-height: 14px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--outline); }
.slpy-name { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.125rem 0.5rem; margin-top: 2px; }
.slpy-name strong { font-size: 18px; line-height: 26px; font-weight: 700; overflow-wrap: anywhere; }
.slpy-mono { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; }
.slpy-name .slpy-mono { font-size: 12px; line-height: 20px; color: var(--outline); }
.slpy-sub { display: block; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); overflow-wrap: anywhere; }
.slpy-badge { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 0.25rem; padding: 4px 10px; border-radius: 999px; background: var(--surface-high); color: var(--on-surface-variant); font-size: 11px; line-height: 14px; font-weight: 600; white-space: nowrap; }
.slpy-badge.is-warm { background: rgba(255, 178, 182, 0.5); color: #40000d; }
.slpy-badge.is-warm::before { content: ''; width: 6px; height: 6px; border-radius: 999px; background: var(--secondary); }
.slpy-badge.is-ok { background: var(--ok-bg); color: var(--ok); }
.slpy-badge.is-solid { background: var(--primary); color: var(--on-primary); letter-spacing: 0.06em; text-transform: uppercase; padding: 4px 12px; }
.slpy-specs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem; padding: 1rem; border-radius: 12px; background: var(--surface-low); }
.slpy-spec { display: flex; flex-direction: column; min-width: 0; }
.slpy-spec .slpy-mono { margin-top: 2px; font-size: 12px; line-height: 20px; font-weight: 600; overflow-wrap: anywhere; }
.slpy-spec strong { margin-top: 2px; font-size: 16px; line-height: 24px; font-weight: 700; }
.slpy-spec small { margin-top: 2px; font-size: 11px; line-height: 16px; font-weight: 600; color: var(--primary); overflow-wrap: anywhere; }
.slpy-spec small.is-late { color: var(--error); }
.slpy-spec small.is-plain { color: var(--on-surface-variant); }
.slpy-brief { display: flex; flex-direction: column; gap: 0.25rem; padding: 1rem; border-radius: 12px; background: rgba(238, 229, 242, 0.4); }
.slpy-brief-head { display: flex; align-items: center; gap: 0.375rem; font-size: 12px; line-height: 16px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.slpy-brief-head .material-symbols-outlined { color: var(--tertiary); }
.slpy-brief p { margin: 0; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.slpy-heading { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
.slpy-heading .material-symbols-outlined { color: var(--primary); }
.slpy-heading h2, .slpy-heading strong { margin: 0; font-size: 16px; line-height: 24px; font-weight: 700; }
.slpy-heading small { display: block; font-size: 11px; line-height: 14px; color: var(--outline); }
.slpy-file { display: flex; align-items: center; gap: 1rem; padding: 1rem; border-radius: 12px; background: var(--surface-low); }
.slpy-file-icon { flex: 0 0 auto; width: 48px; height: 48px; border-radius: 12px; background: var(--tertiary-fixed); color: var(--on-tertiary-fixed); display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(30, 26, 35, 0.08); }
.slpy-file-body { min-width: 0; flex: 1 1 auto; }
.slpy-file-body strong { display: block; font-size: 16px; line-height: 24px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slpy-file-body span { display: block; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); overflow-wrap: anywhere; }
.slpy-btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; width: 100%; height: 44px; padding: 0 16px; border: 0; border-radius: 999px; font-family: inherit; font-size: 16px; line-height: 24px; font-weight: 600; cursor: pointer; transition: background 0.15s; }
.slpy-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.slpy-btn:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.slpy-btn.is-soft { background: var(--surface-high); color: var(--on-surface); }
.slpy-btn.is-soft:hover:not(:disabled) { background: var(--surface-highest); }
.slpy-btn.is-soft .material-symbols-outlined { color: var(--primary); }
.slpy-btn.is-solid { background: var(--primary-container); color: var(--on-primary-container); box-shadow: 0 4px 12px rgba(193, 74, 56, 0.25); }
.slpy-btn.is-solid:hover:not(:disabled) { background: var(--primary); }
.slpy-btn.is-ghost { background: var(--surface-low); color: var(--on-surface); }
.slpy-btn.is-ghost:hover:not(:disabled) { background: var(--surface-high); }
.slpy-btn.is-small { height: 36px; font-size: 12px; line-height: 16px; border-radius: 12px; }
.slpy-hero { display: flex; flex-direction: column; gap: 1rem; padding: 1.25rem; border-radius: 12px; background: var(--surface-low); }
.slpy-hero-main { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; }
.slpy-score { width: 112px; height: 64px; box-sizing: border-box; padding: 0 8px; border: 0; border-radius: 12px; background: var(--surface-lowest); color: var(--on-surface); font-family: inherit; font-size: 34px; line-height: 40px; font-weight: 800; text-align: center; box-shadow: 0 1px 3px rgba(30, 26, 35, 0.08); outline: 0; -moz-appearance: textfield; appearance: textfield; }
.slpy-score:focus { box-shadow: 0 0 0 2px var(--primary-container); }
.slpy-score[aria-invalid='true'] { box-shadow: 0 0 0 2px var(--error); }
.slpy-of { display: flex; flex-direction: column; min-width: 0; }
.slpy-of-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem; }
.slpy-of-line span { font-size: 24px; line-height: 32px; color: var(--on-surface-variant); letter-spacing: -0.015em; }
.slpy-of-line strong { font-size: 16px; line-height: 24px; color: var(--primary); font-weight: 700; }
.slpy-of small { font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpy-ring { position: relative; width: 56px; height: 56px; flex: 0 0 auto; display: flex; align-items: center; justify-content: center; align-self: flex-end; }
.slpy-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.slpy-ring circle { fill: none; stroke-width: 3; }
.slpy-ring .track { stroke: var(--surface-highest); }
.slpy-ring .fill { stroke: var(--primary); stroke-linecap: round; transition: stroke-dashoffset 0.3s; }
.slpy-ring span { position: absolute; font-size: 11px; line-height: 16px; font-weight: 700; }
.slpy-error { margin: 0; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--error); }
.slpy-field { display: flex; flex-direction: column; gap: 0.375rem; }
.slpy-field textarea { width: 100%; box-sizing: border-box; min-height: 112px; padding: 14px; border: 0; border-radius: 12px; background: var(--surface-low); color: var(--on-surface); font-family: inherit; font-size: 14px; line-height: 22px; resize: vertical; outline: 0; }
.slpy-field textarea:focus { background: var(--surface-lowest); box-shadow: 0 0 0 2px rgba(160, 50, 35, 0.25); }
.slpy-field textarea::placeholder { color: var(--outline); }
.slpy-hint { font-size: 11px; line-height: 16px; color: var(--on-surface-variant); }
.slpy-modes { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.5rem; }
.slpy-mode { display: flex; flex-direction: column; gap: 0.375rem; padding: 1rem; border-radius: 12px; background: var(--surface-low); cursor: pointer; transition: background 0.15s; }
.slpy-mode:hover { background: var(--surface-high); }
.slpy-mode.is-on { background: var(--primary-fixed); }
.slpy-mode-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; }
.slpy-mode strong { font-size: 14px; line-height: 20px; font-weight: 600; }
.slpy-mode input { width: 16px; height: 16px; margin: 2px 0 0; accent-color: var(--primary); cursor: pointer; flex: 0 0 auto; }
.slpy-mode span { font-size: 12px; line-height: 18px; color: var(--on-surface-variant); }
.slpy-actions { display: flex; flex-direction: column; gap: 0.5rem; padding-top: 0.25rem; }
.slpy-subrow { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 1rem; padding-top: 0.25rem; }
.slpy-text { display: inline-flex; align-items: center; gap: 0.375rem; border: 0; background: none; padding: 4px 0; color: var(--secondary); font-family: inherit; font-size: 13px; line-height: 18px; font-weight: 600; cursor: pointer; text-decoration: none; }
.slpy-text:hover:not(:disabled) { color: var(--on-secondary-container); }
.slpy-text:disabled { opacity: 0.55; cursor: not-allowed; }
.slpy-text.is-quiet { color: var(--outline); font-weight: 500; }
.slpy-text.is-quiet:hover { color: var(--on-surface); }
.slpy-text:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 4px; }
.slpy-record { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.5rem; padding: 0.75rem; border-radius: 12px; background: var(--surface-low); font-size: 12px; line-height: 18px; color: var(--on-surface-variant); }
.slpy-record div { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.25rem 1rem; }
.slpy-record strong { color: var(--on-surface); font-weight: 600; overflow-wrap: anywhere; }
.slpy-bulk { display: flex; flex-direction: column; gap: 0.75rem; }
.slpy-bulk p { margin: 0; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpy-bulk-row { display: flex; flex-direction: column; gap: 0.5rem; }
.slpy-empty { display: flex; flex-direction: column; align-items: flex-start; gap: 0.75rem; }
.slpy-empty p { margin: 0; font-size: 14px; color: var(--on-surface-variant); }
.slpy-overlay { position: fixed; inset: 0; z-index: 60; display: flex; align-items: flex-end; justify-content: center; background: rgba(30, 26, 35, 0.45); }
.slpy-dialog { display: flex; flex-direction: column; gap: 1rem; width: 100%; max-width: 512px; max-height: 94vh; overflow-y: auto; padding: 1.5rem; border-radius: 20px 20px 0 0; background: var(--surface-lowest); box-shadow: 0 20px 50px rgba(30, 26, 35, 0.35); }
.slpy-dialog-head { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
.slpy-dialog-head .slpy-heading .material-symbols-outlined { color: var(--secondary); }
.slpy-dialog-head h2 { font-size: 18px; line-height: 26px; }
.slpy-close { flex: 0 0 auto; width: 32px; height: 32px; border: 0; border-radius: 999px; background: var(--surface-low); color: var(--on-surface-variant); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.slpy-close:hover { background: var(--surface-high); }
.slpy-dialog p { margin: 0; font-size: 14px; line-height: 22px; color: var(--on-surface-variant); }
.slpy-dialog-foot { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem; padding-top: 0.5rem; }
.slpy-dialog-foot .slpy-btn { width: auto; height: 40px; font-size: 12px; line-height: 16px; padding: 0 20px; }
.slpy-btn.is-danger { background: var(--secondary); color: #fff; }
.slpy-btn.is-danger:hover:not(:disabled) { background: var(--on-secondary-container); }
@media (min-width: 640px) {
  .slpy-actions { flex-direction: row; }
  .slpy-actions .slpy-btn { width: auto; flex: 1 1 0; }
  .slpy-hero { flex-direction: row; align-items: center; justify-content: space-between; }
  .slpy-ring { align-self: center; margin-right: 0.5rem; }
  .slpy-modes { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .slpy-tools { flex-direction: row; align-items: center; }
  .slpy-tools .slpy-jump { flex: 1 1 auto; }
  .slpy-tools .slpy-btn { width: auto; flex: 0 0 auto; }
  .slpy-bulk-row { flex-direction: row; flex-wrap: wrap; }
  .slpy-bulk-row .slpy-btn { width: auto; }
  .slpy-overlay { align-items: center; padding: 1rem; }
  .slpy-dialog { border-radius: 20px; max-height: 90vh; }
}
@media (min-width: 768px) {
  .slpy-head { flex-direction: row; align-items: center; justify-content: space-between; }
  .slpy-pager { align-self: auto; }
}
@media (min-width: 1100px) {
  .slpy-grid { grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 1.5rem; }
}
@media (max-width: 479px) {
  .slpy-card { padding: 1rem; }
  .slpy-card.is-accent { padding-left: 1.25rem; }
  .slpy-score { width: 96px; font-size: 30px; }
}
@media (prefers-reduced-motion: reduce) { .slpy-step, .slpy-btn, .slpy-mode, .slpy-ring .fill { transition: none; } }
`

/* ---------- return for revision dialog ---------- */

function ReturnDialog({ student, initial, pending, error, onConfirm, onClose }) {
  const [text, setText] = useState(initial)
  const fieldRef = useRef(null)
  const [touched, setTouched] = useState(false)
  const missing = text.trim() === ''

  useEffect(() => {
    fieldRef.current?.focus()
  }, [])
  useEffect(() => {
    const onKey = (event) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = () => {
    setTouched(true)
    if (!missing) onConfirm(text.trim())
  }

  return (
    <div className="slpy-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="slpy-dialog" role="dialog" aria-modal="true" aria-labelledby="slpy-return-title">
        <div className="slpy-dialog-head">
          <div className="slpy-heading">
            {renderIcon('replay', 22)}
            <h2 id="slpy-return-title">Return for Revision</h2>
          </div>
          <button type="button" className="slpy-close" onClick={onClose} aria-label="Close">
            {renderIcon('close', 18)}
          </button>
        </div>
        <p>
          Returning this work re-opens submission for {student}, clears any mark and sends your instructions as feedback. They can replace their file while the deadline rules still allow it.
        </p>
        <div className="slpy-field">
          <label className="slpy-label" htmlFor="slpy-return-text">
            Revision instructions
          </label>
          <textarea id="slpy-return-text" ref={fieldRef} rows={4} maxLength={FEEDBACK_MAX} value={text} onChange={(event) => setText(event.target.value)} placeholder="Provide concrete revision requirements..." aria-invalid={touched && missing} />
          {touched && missing && <p className="slpy-error">Tell the student what to change before returning the work.</p>}
        </div>
        {error && (
          <p className="slpc-alert" role="alert">
            {error}
          </p>
        )}
        <div className="slpy-dialog-foot">
          <button type="button" className="slpy-btn is-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="slpy-btn is-danger" onClick={submit} disabled={pending}>
            {pending ? 'Returning…' : 'Confirm & Return'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------- marks, feedback and release (keyed by submission, so it resets per candidate) ---------- */

function GradePanel({ submission, assignment, onSaved, onNotice }) {
  const max = Number(assignment.max_marks)
  const [mark, setMark] = useState(submission.mark == null ? '' : markText(submission.mark))
  const [feedback, setFeedback] = useState(submission.feedback ?? '')
  const [mode, setMode] = useState(submission.grade_released ? 'release' : 'draft')
  const [touched, setTouched] = useState(false)
  const [returning, setReturning] = useState(false)
  const closeReturn = useCallback(() => setReturning(false), [])

  const grade = useMutation({
    mutationFn: (body) => api(`/submissions/${submission.id}/grade`, { method: 'PATCH', body }),
  })

  const error = markError(mark, max)
  const graded = submission.status === 'graded'
  const unchanged = graded && !error && Number(mark) === Number(submission.mark) && feedback.trim() === (submission.feedback ?? '').trim() && (mode === 'release') === Boolean(submission.grade_released)
  const percent = !error ? Math.min(100, Math.max(0, (Number(mark) / max) * 100)) : 0
  const shownPercent = Math.round(percent * 10) / 10
  const releasing = mode === 'release'

  const save = async () => {
    setTouched(true)
    if (error) return
    try {
      const result = await grade.mutateAsync({ mark: Number(mark), feedback: feedback.trim(), release: releasing })
      onSaved(result)
      onNotice(releasing ? `Grade released to ${submission.student_name}.` : `Draft grade saved for ${submission.student_name}. It stays hidden from the student.`)
    } catch {
      /* the alert below shows grade.error */
    }
  }

  const confirmReturn = async (text) => {
    try {
      const result = await grade.mutateAsync({ return_for_revision: true, feedback: text })
      onSaved(result)
      setReturning(false)
      onNotice(`Work returned to ${submission.student_name} for revision.`)
    } catch {
      /* shown inside the dialog */
    }
  }

  return (
    <>
      <section className="slpy-card" aria-labelledby="slpy-marks-title">
        <div className="slpy-row is-center">
          <div className="slpy-heading">
            {renderIcon('fact_check', 22)}
            <div>
              <h2 id="slpy-marks-title">Assessment &amp; Marks Allocation</h2>
              <small>Out of {markText(max)} marks</small>
            </div>
          </div>
          <span className="slpy-badge is-solid">Active Evaluation</span>
        </div>

        <div className="slpy-hero">
          <div className="slpy-hero-main">
            <input
              id="slpy-score"
              className="slpy-score"
              type="number"
              inputMode="decimal"
              min="0"
              max={max}
              step="0.01"
              value={mark}
              onChange={(event) => setMark(event.target.value)}
              aria-label="Awarded mark"
              placeholder="0"
              aria-invalid={touched && Boolean(error)}
              aria-describedby={touched && error ? 'slpy-score-error' : undefined}
            />
            <div className="slpy-of">
              <div className="slpy-of-line">
                <span>/ {markText(max)}</span>
                <strong>{error ? 'Not marked yet' : `${shownPercent}%`}</strong>
              </div>
              <small>Assignment grades are separate from the course result.</small>
            </div>
          </div>
          <div className="slpy-ring" role="img" aria-label={`${shownPercent} percent of the marks`}>
            <svg viewBox="0 0 36 36" aria-hidden="true">
              <circle className="track" cx="18" cy="18" r="15.5" />
              <circle className="fill" cx="18" cy="18" r="15.5" strokeDasharray={RING} strokeDashoffset={RING - (percent / 100) * RING} />
            </svg>
            <span className="slpy-mono">{Math.round(percent)}%</span>
          </div>
        </div>
        {touched && error && (
          <p id="slpy-score-error" className="slpy-error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="slpy-card" aria-labelledby="slpy-feedback-title">
        <div className="slpy-row is-center">
          <div className="slpy-heading">
            {renderIcon('rate_review', 20)}
            <h2 id="slpy-feedback-title">Qualitative Feedback &amp; Review Remarks</h2>
          </div>
        </div>
        <div className="slpy-field">
          <label className="slpc-visually-hidden" htmlFor="slpy-feedback">
            Feedback for the student
          </label>
          <textarea id="slpy-feedback" rows={4} maxLength={FEEDBACK_MAX} value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Write feedback the student will see once the grade is released." />
          <span className="slpy-hint">
            {feedback.length} / {FEEDBACK_MAX} characters. Visible to the student only after release.
          </span>
        </div>
      </section>

      <section className="slpy-card" aria-labelledby="slpy-release-title">
        <div className="slpy-row is-center">
          <div className="slpy-heading">
            {renderIcon('published_with_changes', 20)}
            <h2 id="slpy-release-title">Publication &amp; Release Controls</h2>
          </div>
        </div>
        <div className="slpy-modes" role="radiogroup" aria-label="Release mode">
          <label className={`slpy-mode${mode === 'draft' ? ' is-on' : ''}`}>
            <div className="slpy-mode-top">
              <strong>Save as Unpublished Draft</strong>
              <input type="radio" name="release-mode" value="draft" checked={mode === 'draft'} onChange={() => setMode('draft')} />
            </div>
            <span>Recommended for batch workflows. The mark stays hidden from the student until you release it.</span>
          </label>
          <label className={`slpy-mode${mode === 'release' ? ' is-on' : ''}`}>
            <div className="slpy-mode-top">
              <strong>Save &amp; Release Immediately</strong>
              <input type="radio" name="release-mode" value="release" checked={mode === 'release'} onChange={() => setMode('release')} />
            </div>
            <span>Notifies the student and shows the mark and feedback on their assignment page.</span>
          </label>
        </div>

        {grade.isError && !returning && (
          <p className="slpc-alert" role="alert">
            {errorText(grade.error, 'The grade could not be saved. Please try again.')}
          </p>
        )}

        <div className="slpy-actions">
          <button type="button" className={`slpy-btn ${releasing ? 'is-solid' : 'is-soft'}`} onClick={save} disabled={grade.isPending || unchanged}>
            {renderIcon(releasing ? 'verified' : 'save', 18)}
            {grade.isPending ? 'Saving…' : releasing ? 'Save & Release to Student' : 'Save Grade as Draft'}
          </button>
        </div>
        {unchanged && <span className="slpy-hint">No changes to save.</span>}

        <div className="slpy-subrow">
          <button type="button" className="slpy-text" onClick={() => setReturning(true)} disabled={grade.isPending}>
            {renderIcon('replay', 16)}
            Return Deliverable for Revision
          </button>
          <Link to="/lecturer/assignments" className="slpy-text is-quiet">
            Cancel &amp; Return to Review
          </Link>
        </div>
      </section>

      {returning && <ReturnDialog student={submission.student_name} initial={feedback} pending={grade.isPending} error={grade.isError ? errorText(grade.error, 'The work could not be returned. Please try again.') : ''} onConfirm={confirmReturn} onClose={closeReturn} />}
    </>
  )
}

/* ---------- page ---------- */

export default function LecturerGradeSubmission() {
  useCourseFonts()
  const { assignmentId } = useParams()
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()
  const downloads = useDownloads()
  const [notice, setNotice] = useState('')
  const [bulkConfirm, setBulkConfirm] = useState('')

  const assignmentQuery = useQuery({ queryKey: detailKey(assignmentId), queryFn: () => api(`/assignments/${assignmentId}`) })
  const submissionsQuery = useQuery({ queryKey: subsKey(assignmentId), queryFn: () => fetchSubmissions(assignmentId) })
  const coursesQuery = useQuery({ queryKey: COURSES_KEY, queryFn: fetchCourses })

  const assignment = assignmentQuery.data
  const course = toList(coursesQuery.data).find((item) => item.id === assignment?.course_id)

  const ordered = useMemo(() => [...(submissionsQuery.data ?? [])].sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at)), [submissionsQuery.data])
  const wanted = params.get('submission')
  const foundIndex = ordered.findIndex((item) => item.id === wanted)
  const firstPending = ordered.findIndex((item) => PENDING.includes(item.status))
  const index = foundIndex >= 0 ? foundIndex : Math.max(0, firstPending)
  const current = ordered[index]
  const gradedCount = ordered.filter((item) => item.status === 'graded').length

  // Pin the default candidate into the address so the page does not jump to the next one after you grade.
  useEffect(() => {
    if (!wanted && current) setParams({ submission: current.id }, { replace: true })
  }, [wanted, current, setParams])

  const open = (target) => {
    if (!target) return
    setNotice('')
    setParams({ submission: target.id }, { replace: true })
  }
  const nextToGrade = () => {
    for (let step = 1; step < ordered.length; step += 1) {
      const candidate = ordered[(index + step) % ordered.length]
      if (PENDING.includes(candidate.status)) return open(candidate)
    }
    return undefined
  }
  const hasOtherPending = ordered.some((item, position) => position !== index && PENDING.includes(item.status))

  const refreshCounts = () => {
    queryClient.invalidateQueries({ queryKey: detailKey(assignmentId) })
    queryClient.invalidateQueries({ queryKey: ['lecturer-assignments'] })
  }
  const onSaved = (result) => {
    queryClient.setQueryData(subsKey(assignmentId), (old) => (old ?? []).map((item) => (item.id === result.id ? { ...item, ...result } : item)))
    refreshCounts()
  }

  const bulk = useMutation({
    mutationFn: (released) => api(`/assignments/${assignmentId}/grades/release`, { method: 'POST', body: { released } }),
    onSuccess: (data, released) => {
      const count = Number(data?.updated ?? 0)
      setBulkConfirm('')
      setNotice(count === 0 ? `Nothing to change: every graded submission is already ${released ? 'released' : 'hidden'}.` : `${count} graded ${count === 1 ? 'submission is' : 'submissions are'} now ${released ? 'visible to students' : 'hidden from students'}.`)
      queryClient.invalidateQueries({ queryKey: subsKey(assignmentId) })
      refreshCounts()
    },
  })

  const loading = assignmentQuery.isLoading || submissionsQuery.isLoading
  const failed = assignmentQuery.isError || submissionsQuery.isError
  const status = STATUS[current?.status] ?? STATUS.submitted
  const title = assignment?.title ?? 'Assignment'
  const max = Number(assignment?.max_marks)

  return (
    <div className="slpc" aria-label="Grade submission">
      <style>{COURSE_STYLES}</style>
      <style>{GRADE_STYLES}</style>

      <div className="slpc-stack slpc-gap-lg">
        <div className="slpy-head">
          <div className="slpc-stack" style={{ gap: '0.25rem', minWidth: 0 }}>
            <nav className="slpc-trail" aria-label="Breadcrumb" style={{ fontSize: 11, fontWeight: 600 }}>
              <Link to="/lecturer" className="slpc-trail-link">
                Lecturer Dashboard
              </Link>
              <span className="slpc-trail-sep">/</span>
              <Link to="/lecturer/assignments" className="slpc-trail-link">
                Assignments &amp; Assessment
              </Link>
              <span className="slpc-trail-sep">/</span>
              <span className="slpc-trail-link">Submission Review</span>
              <span className="slpc-trail-sep">/</span>
              <span className="slpc-trail-current">Grade Submission</span>
            </nav>
            <div className="slpy-titlerow">
              {course && <span className="slpy-code">{course.course_code}</span>}
              <h1 className="slpy-title">{title}</h1>
            </div>
          </div>

          {ordered.length > 0 && (
            <div className="slpy-pager" role="group" aria-label="Candidate navigation">
              <button type="button" className="slpy-step" onClick={() => open(ordered[index - 1])} disabled={index <= 0} aria-label="Previous candidate">
                {renderIcon('chevron_left', 18)}
              </button>
              <span className="slpy-count" aria-live="polite">
                Candidate {index + 1} of {ordered.length} <small>({status.queue})</small>
              </span>
              <button type="button" className="slpy-step" onClick={() => open(ordered[index + 1])} disabled={index >= ordered.length - 1} aria-label="Next candidate">
                {renderIcon('chevron_right', 18)}
              </button>
            </div>
          )}
        </div>

        {failed && (
          <ErrorCard
            message={assignmentQuery.error?.status === 404 ? 'This assignment could not be found. It may belong to a course you do not teach.' : errorText(assignmentQuery.error ?? submissionsQuery.error, 'The submissions could not be loaded.')}
            onRetry={() => {
              assignmentQuery.refetch()
              submissionsQuery.refetch()
            }}
          >
            <Link to="/lecturer/assignments" className="slpc-btn slpc-btn-soft">
              Back to assignments
            </Link>
          </ErrorCard>
        )}

        {loading && (
          <div className="slpy-grid" aria-busy="true">
            <div className="slpy-col">
              <Skeleton height={220} label="Loading student" />
              <Skeleton height={260} label="Loading deliverable" />
            </div>
            <div className="slpy-col">
              <Skeleton height={260} label="Loading marks" />
              <Skeleton height={180} label="Loading feedback" />
            </div>
          </div>
        )}

        {!loading && !failed && ordered.length === 0 && (
          <div className="slpc-card slpy-empty">
            <p>
              <strong>No submissions yet.</strong> {assignment?.state === 'draft' ? 'This assignment is still a draft, so students cannot see it.' : 'Students have not handed anything in for this assignment.'}
            </p>
            <Link to="/lecturer/assignments" className="slpc-btn slpc-btn-soft">
              Back to assignments
            </Link>
          </div>
        )}

        {!loading && !failed && current && assignment && (
          <>
            {notice && (
              <p className="slpc-notice" role="status">
                {renderIcon('check_circle', 18)}
                <span>{notice}</span>
              </p>
            )}

            <div className="slpc-card slpy-tools">
              <label className="slpc-visually-hidden" htmlFor="slpy-jump">
                Jump to a student
              </label>
              <select id="slpy-jump" className="slpy-jump" value={current.id} onChange={(event) => open(ordered.find((item) => item.id === event.target.value))}>
                {ordered.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.student_name} · {item.registration_number} · {(STATUS[item.status] ?? STATUS.submitted).queue}
                  </option>
                ))}
              </select>
              <button type="button" className="slpy-btn is-ghost is-small" onClick={nextToGrade} disabled={!hasOtherPending}>
                {renderIcon('skip_next', 16)}
                Next to grade
              </button>
            </div>

            <div className="slpy-grid">
              <div className="slpy-col">
                <section className="slpy-card is-accent" aria-label="Student identity">
                  <div className="slpy-row">
                    <div>
                      <span className="slpy-eyebrow">Student Identity</span>
                      <div className="slpy-name">
                        <strong>{current.student_name}</strong>
                        <span className="slpy-mono">{current.registration_number}</span>
                      </div>
                      <span className="slpy-sub">{current.email}</span>
                    </div>
                    <span className={`slpy-badge is-${status.tone}`}>{status.label}</span>
                  </div>

                  <div className="slpy-specs">
                    <div className="slpy-spec">
                      <span className="slpy-label">Delivery Timestamp</span>
                      <span className="slpy-mono">{stampOf(current.submitted_at)}</span>
                      <small className={current.status === 'late' ? 'is-late' : ''}>{timing(current.submitted_at, assignment.due_at)}</small>
                    </div>
                    <div className="slpy-spec">
                      <span className="slpy-label">Maximum Marks</span>
                      <strong>{markText(max)} pts</strong>
                      <small className="is-plain">{current.grade_released ? 'Grade released' : current.status === 'graded' ? 'Grade hidden' : 'Not graded yet'}</small>
                    </div>
                  </div>

                  {(assignment.instructions || assignment.description) && (
                    <div className="slpy-brief">
                      <div className="slpy-brief-head">
                        {renderIcon('description', 16)}
                        <span>Brief Core Requirements</span>
                      </div>
                      <p>{assignment.instructions || assignment.description}</p>
                    </div>
                  )}
                </section>

                <section className="slpy-card" aria-label="Deliverable">
                  <div className="slpy-row is-center">
                    <div className="slpy-heading">
                      {renderIcon('inventory_2', 20)}
                      <strong>Deliverable Artifact</strong>
                    </div>
                  </div>
                  <div className="slpy-file">
                    <span className="slpy-file-icon">{renderIcon('draft', 24)}</span>
                    <div className="slpy-file-body">
                      <strong title={current.file_name}>{current.file_name}</strong>
                      <span>
                        {formatSize(current.file_size)} • {current.mime_type}
                      </span>
                    </div>
                  </div>
                  {downloads.error && (
                    <p className="slpc-alert" role="alert">
                      {downloads.error}
                    </p>
                  )}
                  <button type="button" className="slpy-btn is-soft" onClick={() => downloads.start(current.id, `/submissions/${current.id}/download`)} disabled={downloads.busy === current.id}>
                    {renderIcon('download', 18)}
                    {downloads.busy === current.id ? 'Preparing link…' : `Download Submission (${formatSize(current.file_size)})`}
                  </button>
                </section>
              </div>

              <div className="slpy-col">
                <GradePanel key={`${current.id}:${current.status}:${current.grade_released}`} submission={current} assignment={assignment} onSaved={onSaved} onNotice={setNotice} />

                <section className="slpy-card" aria-labelledby="slpy-record-title">
                  <div className="slpy-heading">
                    {renderIcon('fingerprint', 18)}
                    <h2 id="slpy-record-title" style={{ fontSize: 12, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      Grading Record
                    </h2>
                  </div>
                  <div className="slpy-record">
                    <div>
                      <span>Status</span>
                      <strong>{status.label}</strong>
                    </div>
                    <div>
                      <span>Visible to student</span>
                      <strong>{current.grade_released ? 'Yes, released' : 'No'}</strong>
                    </div>
                    <div>
                      <span>Graded so far</span>
                      <strong>
                        {gradedCount} of {ordered.length}
                      </strong>
                    </div>
                  </div>
                  <div className="slpy-bulk">
                    <p>Every grade, release and return is written to the audit log with the old and new values. Releasing all grades never touches ungraded work.</p>
                    {bulk.isError && (
                      <p className="slpc-alert" role="alert">
                        {errorText(bulk.error, 'The release could not be completed. Please try again.')}
                      </p>
                    )}
                    {bulkConfirm ? (
                      <div className="slpy-bulk-row">
                        <button type="button" className="slpy-btn is-solid is-small" onClick={() => bulk.mutate(bulkConfirm === 'release')} disabled={bulk.isPending}>
                          {bulk.isPending ? 'Working…' : bulkConfirm === 'release' ? 'Confirm: release all graded' : 'Confirm: hide all graded'}
                        </button>
                        <button type="button" className="slpy-btn is-ghost is-small" onClick={() => setBulkConfirm('')} disabled={bulk.isPending}>
                          Keep as is
                        </button>
                      </div>
                    ) : (
                      <div className="slpy-bulk-row">
                        <button type="button" className="slpy-btn is-ghost is-small" onClick={() => setBulkConfirm('release')} disabled={gradedCount === 0}>
                          {renderIcon('visibility', 16)}
                          Release all graded
                        </button>
                        <button type="button" className="slpy-btn is-ghost is-small" onClick={() => setBulkConfirm('hide')} disabled={gradedCount === 0}>
                          {renderIcon('visibility_off', 16)}
                          Hide all graded
                        </button>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
