import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/apiClient.js'
import { COURSES_KEY, COURSE_STYLES, ErrorCard, Skeleton, fetchCourses, renderIcon, useClock, useCourseFonts, useDownloads } from '../../components/courseKit.jsx'
import { csvCell, downloadText } from '../../utils/timetable.js'
import { dueInfo, formatDue, formatSemester, toList } from '../../utils/format.js'

/*
 * Smart Lecture Portal: lecturer Assignments Management
 * Place at: src/pages/lecturer/LecturerAssignments.jsx
 *
 * Routes (see routes.jsx):
 *   /lecturer/assignments                    every assignment across the courses you teach
 *   /lecturer/courses/:courseId/assignments  the same page with that course preselected
 *
 * - Renders inside AppShell, which already draws the sidebar and top bar. The sidebar's
 *   "Assignments & Grading" entry now points at /lecturer/assignments, so it lights up here.
 * - Built on the contract in docs/API.md (Assignments & submissions, Phase 4). Endpoints used:
 *     GET    /courses                              the courses you teach
 *     GET    /courses/{id}                         enrolled_count and term
 *     GET    /courses/{id}/assignments             drafts included for lecturers
 *     GET    /assignments/{id}                     submission_counts {submitted, late, graded, returned, total}
 *     POST   /courses/{id}/assignments             create (a draft unless "publish now" is chosen)
 *     PATCH  /assignments/{id}                     edit, publish, move back to draft, close
 *     PUT    /assignments/{id}/attachment          optional brief (multipart)
 *     DELETE /assignments/{id}/attachment          remove the brief
 *     GET    /assignments/{id}/attachment          signed link for the brief
 * - Every figure is counted from those answers. The API has no syllabus weight, grace period,
 *   penalty rate, SHA-256 receipt or SLA clock, so the page shows none of them. Assignments are
 *   never deleted by the server: they are closed instead, which keeps the audit trail.
 * - Dates are entered and shown in your own time zone and sent to the server with their offset.
 * - Grading itself happens on /lecturer/assignments/{id}/submissions.
 */

const PAGE_SIZE = 5
const MAX_ATTACHMENT_MB = 25
const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'pptx', 'xlsx', 'csv', 'png', 'jpg', 'jpeg', 'zip']
const MAX_DUE_DAYS = 366
const DAY = 86400000

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Published' },
  { id: 'draft', label: 'Drafts' },
  { id: 'grading', label: 'Grading Active' },
  { id: 'closed', label: 'Closed' },
]
const SORTS = [
  { id: 'due_asc', label: 'Due Date: Soonest First' },
  { id: 'due_desc', label: 'Due Date: Latest First' },
  { id: 'created_desc', label: 'Created: Newest First' },
  { id: 'pending_desc', label: 'Pending Grading: High to Low' },
]

const listKey = (courseId) => ['lecturer-assignments', courseId]
const detailKey = (assignmentId) => ['lecturer-assignment', assignmentId]
const errorText = (error, fallback) => error?.message || fallback
const stamp = (value) => {
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}
const pad = (value) => String(value).padStart(2, '0')
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`
const extensionOf = (fileName) => String(fileName ?? '').split('.').pop().toLowerCase()
const marksText = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? `${Math.round(number * 100) / 100}` : ''
}
// "2026-02-28T23:59" in the viewer's own time zone, for <input type="datetime-local">.
const toLocalInput = (value) => {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
const longStamp = (value) => {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return ''
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
const stateOf = (item) => (item.state === 'draft' || item.state === 'closed' ? item.state : item.published === false ? 'draft' : item.closed ? 'closed' : 'open')
const STATE_LABELS = { open: 'Published', draft: 'Draft', closed: 'Closed' }

const ASSIGNMENT_STYLES = `
.slpw-head { display: flex; flex-direction: column; gap: 1rem; }
.slpw-title { margin: 0; font-size: 26px; line-height: 34px; font-weight: 700; letter-spacing: -0.02em; overflow-wrap: anywhere; }
.slpw-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.slpw-actions .slpc-btn { height: 44px; padding: 0 20px; }
.slpw-stats { grid-template-columns: minmax(0, 1fr); }
.slpw-stat { display: flex; flex-direction: column; justify-content: space-between; overflow: hidden; padding: 0; }
.slpw-stat-body { display: flex; flex-direction: column; gap: 0.75rem; padding: 1.25rem 1.25rem 1rem; }
.slpw-stat-top { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; min-height: 24px; }
.slpw-stat-label { font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpw-stat-top .material-symbols-outlined { color: var(--primary); }
.slpw-tag { display: inline-flex; align-items: center; gap: 0.25rem; padding: 2px 8px; border-radius: 999px; background: var(--tertiary-fixed); color: var(--on-tertiary-fixed); font-size: 11px; line-height: 16px; font-weight: 700; }
.slpw-stat-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.5rem; }
.slpw-stat-num { font-size: 34px; line-height: 40px; font-weight: 800; letter-spacing: -0.02em; }
.slpw-stat-num.is-primary { color: var(--primary); }
.slpw-stat-unit { font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpw-rate { padding: 1px 8px; border-radius: 999px; background: var(--ok-bg); color: var(--ok); font-size: 13px; line-height: 18px; font-weight: 700; }
.slpw-stat-sub { margin: 0.25rem 0 0; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); overflow-wrap: anywhere; }
.slpw-bar { width: 100%; height: 6px; border-radius: 999px; background: var(--surface-high); overflow: hidden; margin-top: 0.625rem; }
.slpw-bar > span { display: block; height: 100%; border-radius: 999px; background: var(--primary); }
.slpw-stat-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.25rem 0.75rem; padding: 0.625rem 1.25rem; background: var(--surface-low); font-size: 11px; line-height: 16px; font-weight: 600; color: var(--on-surface-variant); }
.slpw-mono { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; }
.slpw-stat-foot .slpw-mono { color: var(--primary); font-weight: 600; }
.slpw-filters { display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem; }
.slpw-filter-row { display: flex; flex-direction: column; gap: 0.5rem; }
.slpw-filters .slpc-search, .slpw-filters .slpc-select { height: 44px; border-radius: 12px; }
.slpw-filters .slpc-select { width: 100%; padding: 0 12px; }
.slpw-pills { display: flex; align-items: center; gap: 0.5rem; overflow-x: auto; padding: 2px 0 4px; scrollbar-width: none; }
.slpw-pills::-webkit-scrollbar { display: none; }
.slpw-pill { flex: 0 0 auto; padding: 7px 16px; border: 0; border-radius: 999px; background: var(--surface-lowest); color: var(--on-surface-variant); font-family: inherit; font-size: 12px; line-height: 16px; font-weight: 600; white-space: nowrap; cursor: pointer; box-shadow: 0 1px 3px rgba(30, 26, 35, 0.1); transition: background 0.2s; }
.slpw-pill:hover { background: var(--surface-mid); }
.slpw-pill.is-active { background: var(--primary-container); color: var(--on-primary-container); }
.slpw-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.slpw-main { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.slpw-ledger-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.25rem 1rem; padding: 0 0.25rem; }
.slpw-ledger-head > span:first-child { display: inline-flex; align-items: center; gap: 0.5rem; font-size: 18px; line-height: 26px; font-weight: 700; }
.slpw-count { padding: 2px 8px; border-radius: 999px; background: var(--surface-high); font-size: 11px; line-height: 16px; font-weight: 700; }
.slpw-hint { font-size: 11px; line-height: 14px; font-weight: 600; color: var(--on-surface-variant); }
.slpw-feed { display: flex; flex-direction: column; gap: 1rem; margin: 0; padding: 0; list-style: none; }
.slpw-card { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 1rem; padding: 1.25rem; border-radius: 16px; background: var(--surface-lowest); box-shadow: 0 1px 3px rgba(30, 26, 35, 0.08); transition: box-shadow 0.2s; }
.slpw-card:hover { box-shadow: 0 4px 12px rgba(30, 26, 35, 0.12); }
.slpw-card.is-selected { box-shadow: 0 0 0 2px var(--primary-container), 0 4px 12px rgba(30, 26, 35, 0.12); padding-left: 1.5rem; }
.slpw-card.is-selected::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: var(--primary); }
.slpw-card-top { display: flex; flex-direction: column; gap: 0.5rem; }
.slpw-card-main { min-width: 0; }
.slpw-badges { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem; }
.slpw-badge { display: inline-flex; align-items: center; gap: 0.25rem; padding: 2px 10px; border-radius: 999px; background: var(--surface-high); color: var(--on-surface-variant); font-size: 11px; line-height: 16px; font-weight: 700; letter-spacing: 0.02em; text-transform: uppercase; white-space: nowrap; }
.slpw-badge .material-symbols-outlined { color: inherit; }
.slpw-badge.is-code { background: var(--primary-fixed); color: var(--on-primary-fixed); font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; letter-spacing: 0.02em; }
.slpw-badge.is-ok { background: var(--ok-bg); color: var(--ok); }
.slpw-badge.is-draft { background: var(--tertiary-fixed); color: var(--on-tertiary-fixed); }
.slpw-badge.is-live { background: var(--primary-fixed); color: var(--on-primary-fixed-variant, #872013); }
.slpw-card h2 { margin: 0; font-size: 18px; line-height: 26px; font-weight: 700; letter-spacing: -0.005em; }
.slpw-card h2 button { all: unset; box-sizing: border-box; cursor: pointer; overflow-wrap: anywhere; }
.slpw-card h2 button:hover { color: var(--primary); }
.slpw-card h2 button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 4px; }
.slpw-sub { margin: 0.125rem 0 0; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); overflow-wrap: anywhere; }
.slpw-card-side { text-align: left; flex: 0 0 auto; }
.slpw-pts { display: block; font-size: 18px; line-height: 26px; font-weight: 800; color: var(--primary); }
.slpw-due { display: block; font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 16px; font-weight: 600; color: var(--on-surface-variant); }
.slpw-due.is-urgent { color: var(--error); }
.slpw-due.is-soon { color: var(--tertiary); }
.slpw-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem 0.5rem; margin: 0; padding: 0.75rem; border-radius: 12px; background: var(--surface-low); }
.slpw-metric dt { margin: 0; font-size: 10px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpw-metric dd { margin: 0; font-size: 16px; line-height: 24px; font-weight: 700; }
.slpw-metric dd small { font-size: 13px; font-weight: 400; color: var(--on-surface-variant); }
.slpw-metric dd.is-ok { color: var(--ok); }
.slpw-metric dd.is-primary { color: var(--primary); }
.slpw-note { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.75rem; border-radius: 12px; background: var(--tertiary-fixed); color: var(--on-tertiary-fixed); font-size: 13px; line-height: 18px; }
.slpw-note > span { display: flex; align-items: flex-start; gap: 0.5rem; }
.slpw-note .material-symbols-outlined { flex: 0 0 auto; }
.slpw-card-foot { display: flex; flex-direction: column; gap: 0.75rem; }
.slpw-file { display: inline-flex; align-items: center; gap: 0.5rem; min-width: 0; font-size: 12px; line-height: 16px; color: var(--on-surface-variant); }
.slpw-file .material-symbols-outlined { flex: 0 0 auto; color: var(--primary); }
.slpw-file span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; }
.slpw-btns { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.slpw-btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.375rem; height: 36px; padding: 0 14px; border: 0; border-radius: 999px; background: var(--surface-mid); color: var(--on-surface); font-family: inherit; font-size: 12px; line-height: 16px; font-weight: 700; cursor: pointer; transition: background 0.2s; }
.slpw-btn:hover:not(:disabled) { background: var(--surface-high); }
.slpw-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.slpw-btn.is-solid { background: var(--primary-container); color: var(--on-primary-container); box-shadow: 0 1px 2px rgba(30, 26, 35, 0.2); }
.slpw-btn.is-solid:hover:not(:disabled) { background: var(--primary); color: var(--on-primary); }
.slpw-btn.is-ok { background: var(--ok); color: #fff; }
.slpw-btn.is-round { width: 36px; padding: 0; }
.slpw-btn .material-symbols-outlined { color: inherit; }
a.slpw-btn { text-decoration: none; }
.slpw-pager { display: flex; flex-direction: column; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.25rem 0.5rem; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--on-surface-variant); }
.slpw-pager-btns { display: flex; align-items: center; gap: 0.375rem; }
.slpw-page { min-width: 32px; height: 32px; padding: 0; border: 0; border-radius: 8px; background: var(--surface-lowest); color: var(--on-surface); display: inline-flex; align-items: center; justify-content: center; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
.slpw-page:hover:not(:disabled) { background: var(--surface-mid); }
.slpw-page:disabled { opacity: 0.5; cursor: not-allowed; background: var(--surface-mid); }
.slpw-page.is-current { background: var(--primary-container); color: var(--on-primary-container); }
.slpw-side { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.slpw-inspector { display: flex; flex-direction: column; gap: 1rem; padding: 1.25rem; scroll-margin-top: 5rem; }
.slpw-inspector-head { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
.slpw-inspector-title { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
.slpw-inspector-icon { flex: 0 0 auto; width: 40px; height: 40px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; background: var(--primary-fixed); color: var(--primary); }
.slpw-kicker { display: block; font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpw-inspector h3 { margin: 0; font-size: 18px; line-height: 26px; font-weight: 700; overflow-wrap: anywhere; }
.slpw-brief { margin: 0; font-size: 13px; line-height: 20px; color: var(--on-surface-variant); white-space: pre-wrap; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.slpw-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem 1rem; margin: 0; }
.slpw-grid dt { margin: 0 0 2px; font-size: 10px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpw-grid dd { margin: 0; font-size: 13px; line-height: 18px; font-weight: 600; overflow-wrap: anywhere; }
.slpw-grid .is-wide { grid-column: 1 / -1; }
.slpw-progress { display: flex; flex-direction: column; gap: 0.375rem; }
.slpw-progress-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.25rem 0.5rem; font-size: 11px; line-height: 16px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpw-progress-top .slpw-mono { color: var(--primary); letter-spacing: 0; text-transform: none; }
.slpw-progress .slpw-bar { height: 8px; margin: 0; }
.slpw-progress small { font-size: 12px; line-height: 16px; color: var(--on-surface-variant); }
.slpw-cta { display: flex; flex-direction: column; gap: 0.5rem; }
.slpw-cta .slpc-btn { justify-content: center; height: 44px; }
.slpw-cta-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem; }
.slpw-cta-row .slpw-btn { height: 40px; border-radius: 12px; }
.slpw-danger { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.875rem; border-radius: 12px; background: var(--error-container); color: var(--on-error-container); }
.slpw-danger strong { display: block; font-size: 12px; line-height: 16px; font-weight: 700; }
.slpw-danger span { font-size: 12px; line-height: 16px; }
.slpw-danger .slpw-btn { background: rgba(255, 255, 255, 0.55); color: var(--error); align-self: flex-start; border-radius: 10px; }
.slpw-danger-row { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.slpw-warn { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.75rem 1rem; border-radius: 12px; background: var(--error-container); color: var(--on-error-container); font-size: 13px; line-height: 18px; }
.slpw-ok { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.75rem 1rem; border-radius: 12px; background: var(--ok-bg); color: var(--ok); font-size: 13px; line-height: 18px; font-weight: 600; }
.slpw-overlay { position: fixed; inset: 0; z-index: 60; display: flex; align-items: flex-end; justify-content: center; padding: 0; background: rgba(30, 26, 35, 0.45); }
.slpw-dialog { display: flex; flex-direction: column; width: 100%; max-width: 680px; max-height: 94vh; overflow: hidden; border-radius: 20px 20px 0 0; background: var(--surface-lowest); box-shadow: 0 20px 50px rgba(30, 26, 35, 0.35); }
.slpw-dialog-head { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 1rem 1.25rem; background: var(--surface-low); }
.slpw-dialog-head h2 { margin: 0; font-size: 18px; line-height: 26px; font-weight: 700; }
.slpw-dialog-head small { display: block; font-size: 11px; line-height: 16px; color: var(--on-surface-variant); }
.slpw-close { flex: 0 0 auto; width: 36px; height: 36px; border: 0; border-radius: 999px; background: var(--surface-mid); color: var(--on-surface-variant); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.slpw-close:hover { background: var(--surface-high); }
.slpw-form { display: flex; flex-direction: column; gap: 1rem; padding: 1.25rem; overflow-y: auto; }
.slpw-field { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
.slpw-field > label, .slpw-label { font-size: 12px; line-height: 16px; font-weight: 700; }
.slpw-field input[type='text'], .slpw-field input[type='number'], .slpw-field input[type='datetime-local'], .slpw-field select, .slpw-field textarea { width: 100%; box-sizing: border-box; padding: 0 12px; border: 0; border-radius: 12px; background: var(--surface-low); color: var(--on-surface); font-family: inherit; font-size: 14px; line-height: 20px; outline: 0; }
.slpw-field input[type='text'], .slpw-field input[type='number'], .slpw-field input[type='datetime-local'], .slpw-field select { height: 44px; }
.slpw-field textarea { min-height: 84px; padding: 10px 12px; resize: vertical; }
.slpw-field input:focus, .slpw-field select:focus, .slpw-field textarea:focus { box-shadow: 0 0 0 2px var(--primary-container); background: var(--surface-lowest); }
.slpw-field [aria-invalid='true'] { box-shadow: 0 0 0 2px var(--error); }
.slpw-field-error { font-size: 12px; line-height: 16px; font-weight: 600; color: var(--error); }
.slpw-help { font-size: 11px; line-height: 16px; color: var(--on-surface-variant); }
.slpw-three { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.75rem; }
.slpw-toggle { display: flex; align-items: flex-start; gap: 0.75rem; padding: 0.875rem; border-radius: 12px; background: var(--surface-low); font-size: 13px; line-height: 18px; cursor: pointer; }
.slpw-toggle input { width: 18px; height: 18px; margin: 1px 0 0; accent-color: var(--primary); flex: 0 0 auto; }
.slpw-toggle strong { display: block; font-size: 13px; }
.slpw-toggle span span { color: var(--on-surface-variant); font-size: 12px; }
.slpw-drop { display: flex; flex-direction: column; align-items: center; gap: 0.25rem; padding: 1rem; border: 1px dashed var(--outline-variant); border-radius: 12px; background: var(--surface-low); text-align: center; cursor: pointer; overflow-wrap: anywhere; }
.slpw-drop:hover { background: var(--surface-mid); }
.slpw-drop .material-symbols-outlined { color: var(--primary); }
.slpw-drop strong { font-size: 13px; line-height: 18px; }
.slpw-radios { display: flex; flex-wrap: wrap; gap: 0.5rem 1.25rem; font-size: 13px; }
.slpw-radios label { display: inline-flex; align-items: center; gap: 0.5rem; cursor: pointer; }
.slpw-radios input { accent-color: var(--primary); }
.slpw-dialog-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 0.5rem; padding: 0.875rem 1.25rem; background: var(--surface-low); }
.slpw-dialog-foot .slpc-btn { height: 40px; padding: 0 20px; }
@media (min-width: 640px) {
  .slpw-filter-row { flex-direction: row; align-items: center; }
  .slpw-filter-row .slpc-search { flex: 1 1 auto; }
  .slpw-filter-row .slpc-select { width: 220px; flex: 0 0 auto; }
  .slpw-card-top { flex-direction: row; align-items: flex-start; justify-content: space-between; gap: 1rem; }
  .slpw-card-side { text-align: right; }
  .slpw-metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .slpw-card-foot { flex-direction: row; align-items: center; justify-content: space-between; }
  .slpw-pager { flex-direction: row; }
  .slpw-three { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .slpw-overlay { align-items: center; padding: 1rem; }
  .slpw-dialog { border-radius: 20px; max-height: 90vh; }
}
@media (min-width: 768px) {
  .slpw-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .slpw-head { flex-direction: row; align-items: flex-end; justify-content: space-between; }
}
@media (min-width: 1024px) {
  .slpw-title { font-size: 32px; line-height: 40px; }
}
@media (min-width: 1180px) {
  .slpw-split { grid-template-columns: minmax(0, 3fr) minmax(320px, 2fr); }
  .slpw-sticky { position: sticky; top: 5rem; }
}
@media (max-width: 479px) {
  .slpw-card { padding: 1rem; }
  .slpw-card.is-selected { padding-left: 1.25rem; }
  .slpw-actions .slpc-btn { flex: 1 1 auto; justify-content: center; }
  .slpw-inspector { padding: 1rem; }
}
@media print {
  .slpw-actions, .slpw-filters, .slpw-side, .slpw-btns, .slpw-pager { display: none; }
  .slpw-split { grid-template-columns: minmax(0, 1fr); }
}
`

/* ---------- create / edit dialog ---------- */

function AssignmentDialog({ courses, assignment, defaultCourseId, onClose, onSaved }) {
  const editing = Boolean(assignment)
  const titleRef = useRef(null)
  const fileInput = useRef(null)
  const [courseId, setCourseId] = useState(assignment?.courseId || defaultCourseId || (courses.length === 1 ? courses[0].id : ''))
  const [title, setTitle] = useState(assignment?.title ?? '')
  const [description, setDescription] = useState(assignment?.description ?? '')
  const [instructions, setInstructions] = useState(assignment?.instructions ?? '')
  const [due, setDue] = useState(assignment ? toLocalInput(assignment.due_at) : '')
  const [maxMarks, setMaxMarks] = useState(assignment ? marksText(assignment.max_marks) : '100')
  const [allowLate, setAllowLate] = useState(assignment?.allow_late ?? false)
  const [publish, setPublish] = useState(false)
  const [file, setFile] = useState(null)
  const [removeFile, setRemoveFile] = useState(false)
  const [errors, setErrors] = useState({})

  useEffect(() => {
    titleRef.current?.focus()
  }, [])
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = useMutation({
    mutationFn: async ({ payload, attachment, remove }) => {
      let saved = editing
        ? Object.keys(payload).length > 0
          ? await api(`/assignments/${assignment.id}`, { method: 'PATCH', body: payload })
          : assignment
        : await api(`/courses/${courseId}/assignments`, { method: 'POST', body: payload })
      const id = saved?.id ?? assignment?.id
      let warning = ''
      try {
        if (attachment) {
          const form = new FormData()
          form.append('file', attachment)
          saved = await api(`/assignments/${id}/attachment`, { method: 'PUT', form })
        } else if (remove) {
          saved = await api(`/assignments/${id}/attachment`, { method: 'DELETE' })
        }
      } catch (caught) {
        warning = `The assignment was saved, but the attachment could not be updated: ${errorText(caught, 'please try again')}`
      }
      return { saved, warning }
    },
  })

  const submit = async (event) => {
    event.preventDefault()
    const next = {}
    const cleanTitle = title.trim()
    const marks = Number(maxMarks)
    const dueTime = new Date(due).getTime()
    const dueChanged = !editing || toLocalInput(assignment.due_at) !== due
    if (!editing && !courseId) next.course = 'Choose a course.'
    if (cleanTitle.length < 2 || cleanTitle.length > 200) next.title = 'The title must be between 2 and 200 characters.'
    if (!due || Number.isNaN(dueTime)) next.due = 'Choose a due date and time.'
    else if (dueChanged && dueTime <= Date.now()) next.due = 'The deadline must be in the future.'
    else if (dueChanged && dueTime - Date.now() > MAX_DUE_DAYS * DAY) next.due = `The deadline can be at most ${MAX_DUE_DAYS} days ahead.`
    if (!/^\d+(\.\d{1,2})?$/.test(maxMarks.trim()) || !(marks > 0) || marks > 1000) next.marks = 'Enter marks above 0 and up to 1000, with at most 2 decimals.'
    if (file) {
      if (!ALLOWED_EXTENSIONS.includes(extensionOf(file.name))) next.file = `This file type is not allowed. Use ${ALLOWED_EXTENSIONS.join(', ').toUpperCase()}.`
      else if (file.size > MAX_ATTACHMENT_MB * 1024 * 1024) next.file = `The file is larger than ${MAX_ATTACHMENT_MB} MB.`
    }
    setErrors(next)
    if (Object.keys(next).length) return

    let payload
    if (editing) {
      payload = {}
      if (cleanTitle !== assignment.title) payload.title = cleanTitle
      if (description.trim() !== (assignment.description ?? '').trim()) payload.description = description.trim()
      if (instructions.trim() !== (assignment.instructions ?? '').trim()) payload.instructions = instructions.trim()
      if (dueChanged) payload.due_at = new Date(due).toISOString()
      if (marks !== Number(assignment.max_marks)) payload.max_marks = marks
      if (allowLate !== Boolean(assignment.allow_late)) payload.allow_late = allowLate
      if (publish && assignment.state === 'draft') payload.published = true
    } else {
      payload = { title: cleanTitle, due_at: new Date(due).toISOString(), max_marks: marks, allow_late: allowLate, published: publish }
      if (description.trim()) payload.description = description.trim()
      if (instructions.trim()) payload.instructions = instructions.trim()
    }
    try {
      const result = await save.mutateAsync({ payload, attachment: file, remove: removeFile && !file && assignment?.has_attachment })
      const targetCourse = assignment?.courseId || courseId
      const published = result.saved?.published ?? publish
      onSaved({
        courseId: targetCourse,
        id: result.saved?.id ?? assignment?.id,
        warning: result.warning,
        message: editing ? 'Changes saved.' : published ? 'Assignment created and published. Enrolled students have been notified.' : 'Assignment saved as a draft. Students cannot see it yet.',
      })
    } catch (caught) {
      setErrors({ form: errorText(caught, 'The assignment could not be saved. Please try again.') })
    }
  }

  const isDraft = !editing || assignment.state === 'draft'

  return (
    <div className="slpw-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="slpw-dialog" role="dialog" aria-modal="true" aria-labelledby="slpw-dialog-title">
        <div className="slpw-dialog-head">
          <div>
            <h2 id="slpw-dialog-title">{editing ? 'Edit assignment' : 'Create new assignment'}</h2>
            <small>{editing ? 'Course, creator and state history cannot be changed.' : 'Saved as a private draft unless you publish it now.'}</small>
          </div>
          <button type="button" className="slpw-close" onClick={onClose} aria-label="Close">
            {renderIcon('close', 18)}
          </button>
        </div>
        <form className="slpw-form" onSubmit={submit} noValidate id="slpw-form">
          {!editing && (
            <div className="slpw-field">
              <label htmlFor="slpw-course">Course *</label>
              <select id="slpw-course" value={courseId} onChange={(event) => setCourseId(event.target.value)} aria-invalid={Boolean(errors.course)}>
                <option value="">Select a course</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.course_code}: {course.course_name}
                  </option>
                ))}
              </select>
              {errors.course && <span className="slpw-field-error">{errors.course}</span>}
            </div>
          )}
          <div className="slpw-field">
            <label htmlFor="slpw-title">Assignment title *</label>
            <input id="slpw-title" ref={titleRef} type="text" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="e.g. Milestone 2: Replicated state machine" aria-invalid={Boolean(errors.title)} />
            {errors.title && <span className="slpw-field-error">{errors.title}</span>}
          </div>
          <div className="slpw-field">
            <label htmlFor="slpw-description">Short description (optional)</label>
            <textarea id="slpw-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} />
          </div>
          <div className="slpw-field">
            <label htmlFor="slpw-instructions">Detailed instructions (optional)</label>
            <textarea id="slpw-instructions" value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength={10000} placeholder="Delivery goals, test scripts and grading criteria" />
          </div>
          <div className="slpw-three">
            <div className="slpw-field">
              <label htmlFor="slpw-due">Due date and time *</label>
              <input id="slpw-due" type="datetime-local" value={due} onChange={(event) => setDue(event.target.value)} aria-invalid={Boolean(errors.due)} />
              {errors.due ? <span className="slpw-field-error">{errors.due}</span> : <span className="slpw-help">In your own time zone.</span>}
            </div>
            <div className="slpw-field">
              <label htmlFor="slpw-marks">Maximum marks *</label>
              <input id="slpw-marks" type="number" inputMode="decimal" min="0" max="1000" step="0.01" value={maxMarks} onChange={(event) => setMaxMarks(event.target.value)} aria-invalid={Boolean(errors.marks)} />
              {errors.marks && <span className="slpw-field-error">{errors.marks}</span>}
            </div>
          </div>
          <label className="slpw-toggle" htmlFor="slpw-late">
            <input id="slpw-late" type="checkbox" checked={allowLate} onChange={(event) => setAllowLate(event.target.checked)} />
            <span>
              <strong>Accept late submissions</strong>
              <span>Work handed in after the deadline is accepted and marked as late.</span>
            </span>
          </label>
          <div className="slpw-field">
            <span className="slpw-label">Reference brief (optional)</span>
            {editing && assignment.has_attachment && !file && (
              <label className="slpw-toggle" htmlFor="slpw-remove">
                <input id="slpw-remove" type="checkbox" checked={removeFile} onChange={(event) => setRemoveFile(event.target.checked)} />
                <span>
                  <strong>Remove current file</strong>
                  <span>{assignment.attachment_name || 'The attached brief'} will no longer be available to students.</span>
                </span>
              </label>
            )}
            <label className="slpw-drop" htmlFor="slpw-file">
              {renderIcon('cloud_upload', 26)}
              <strong>{file ? file.name : editing && assignment.has_attachment ? 'Choose a replacement file' : 'Choose a file'}</strong>
              <span className="slpw-help">
                {ALLOWED_EXTENSIONS.join(', ').toUpperCase()} · up to {MAX_ATTACHMENT_MB} MB
              </span>
            </label>
            <input id="slpw-file" ref={fileInput} className="slpc-visually-hidden" type="file" accept={ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(',')} onChange={(event) => setFile(event.target.files?.[0] ?? null)} aria-label="Reference brief" />
            {errors.file && <span className="slpw-field-error">{errors.file}</span>}
          </div>
          {isDraft && (
            <div className="slpw-radios" role="radiogroup" aria-label="Visibility">
              <label htmlFor="slpw-mode-draft">
                <input id="slpw-mode-draft" type="radio" name="slpw-mode" checked={!publish} onChange={() => setPublish(false)} />
                Save as draft (private)
              </label>
              <label htmlFor="slpw-mode-publish">
                <input id="slpw-mode-publish" type="radio" name="slpw-mode" checked={publish} onChange={() => setPublish(true)} />
                Publish now (notify students)
              </label>
            </div>
          )}
          {errors.form && (
            <p className="slpc-alert" role="alert">
              {errors.form}
            </p>
          )}
        </form>
        <div className="slpw-dialog-foot">
          <button type="button" className="slpc-btn slpc-btn-soft" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="slpw-form" className="slpc-btn slpc-btn-primary" disabled={save.isPending}>
            {renderIcon('save', 18)}
            {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create assignment'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------- ledger card and inspector ---------- */

function LedgerCard({ row, selected, now, busy, onSelect, onEdit, onPublish, onDownload }) {
  const due = row.state === 'open' ? dueInfo(row.due_at, now) : null
  const known = row.counts !== null
  return (
    <li>
      <article className={`slpw-card ${selected ? 'is-selected' : ''}`} data-state={row.state}>
        <div className="slpw-card-top">
          <div className="slpw-card-main">
            <div className="slpw-badges">
              <span className="slpw-badge is-code">{row.code}</span>
              <span className={`slpw-badge ${row.state === 'open' ? 'is-ok' : row.state === 'draft' ? 'is-draft' : ''}`}>
                {row.state === 'draft' ? renderIcon('lock', 13) : <span aria-hidden="true">●</span>}
                {row.state === 'draft' ? 'Draft (hidden from students)' : STATE_LABELS[row.state]}
              </span>
              {known && row.pending > 0 && <span className="slpw-badge is-live">Grading active</span>}
              {row.state === 'open' && !row.allow_late && <span className="slpw-badge">No late work</span>}
            </div>
            <h2>
              <button type="button" onClick={onSelect} aria-pressed={selected}>
                {row.title}
              </button>
            </h2>
            <p className="slpw-sub">
              {row.courseName}
              {row.term ? ` • ${row.term}` : ''}
            </p>
          </div>
          <div className="slpw-card-side">
            <span className="slpw-pts">{marksText(row.max_marks)} pts</span>
            <span className={`slpw-due ${due ? `is-${due.tone}` : ''}`}>{row.state === 'draft' ? 'Unpublished' : row.state === 'closed' ? 'Closed' : due?.label}</span>
          </div>
        </div>

        {row.state === 'draft' ? (
          <div className="slpw-note">
            <span>
              {renderIcon('info', 20)}
              Drafts stay hidden from students and send no notifications until you publish. Planned deadline: {longStamp(row.due_at)}.
            </span>
          </div>
        ) : (
          <dl className="slpw-metrics">
            <div className="slpw-metric">
              <dt>Turn-in</dt>
              <dd>
                {known ? row.turnIn : '—'}
                {row.enrolled !== null && <small> / {row.enrolled}</small>}
              </dd>
            </div>
            <div className="slpw-metric">
              <dt>Graded</dt>
              <dd className={known && row.graded > 0 ? 'is-ok' : ''}>{known ? row.graded : '—'}</dd>
            </div>
            <div className="slpw-metric">
              <dt>Pending</dt>
              <dd className={known && row.pending > 0 ? 'is-primary' : ''}>{known ? plural(row.pending, 'sub') : '—'}</dd>
            </div>
            <div className="slpw-metric">
              <dt>Late</dt>
              <dd>{known ? row.late : '—'}</dd>
            </div>
          </dl>
        )}

        <div className="slpw-card-foot">
          <div className="slpw-file">
            {row.has_attachment ? (
              <>
                {renderIcon('attach_file', 18)}
                <span>{row.attachment_name || 'Reference brief'}</span>
              </>
            ) : row.state === 'draft' ? null : (
              <span style={{ fontFamily: 'inherit' }}>Due {formatDue(row.due_at, now)}</span>
            )}
          </div>
          <div className="slpw-btns">
            {row.state === 'draft' ? (
              <button type="button" className="slpw-btn is-solid" onClick={onPublish} disabled={busy}>
                {renderIcon('publish', 16)}
                {busy ? 'Publishing…' : 'Publish'}
              </button>
            ) : (
              <Link to={`/lecturer/assignments/${row.id}/submissions`} className="slpw-btn is-solid">
                {renderIcon('how_to_reg', 16)}
                {known && row.pending > 0 ? `Grade (${row.pending})` : 'Submissions'}
              </Link>
            )}
            <button type="button" className="slpw-btn is-round" onClick={onEdit} title="Edit assignment" aria-label={`Edit ${row.title}`}>
              {renderIcon('edit', 18)}
            </button>
            {row.has_attachment && (
              <button type="button" className="slpw-btn is-round" onClick={onDownload} title="Download reference brief" aria-label={`Download brief for ${row.title}`}>
                {renderIcon('file_download', 18)}
              </button>
            )}
          </div>
        </div>
      </article>
    </li>
  )
}

function Inspector({ row, now, busy, confirming, setConfirming, onEdit, onPublish, onUnpublish, onClose, onDownload }) {
  if (!row) {
    return (
      <section className="slpc-card slpw-inspector slpw-sticky" aria-label="Assignment inspector">
        <span className="slpw-kicker">Active inspector</span>
        <p className="slpc-empty">Select an assignment to see its settings and grading progress here.</p>
      </section>
    )
  }
  const known = row.counts !== null
  const share = known && row.turnIn > 0 ? Math.round(((row.graded) / row.turnIn) * 1000) / 10 : 0
  const canUnpublish = row.state === 'open' && known && row.turnIn === 0
  return (
    <section className="slpc-card slpw-inspector slpw-sticky" aria-label="Assignment inspector">
      <div className="slpw-inspector-head">
        <div className="slpw-inspector-title">
          <span className="slpw-inspector-icon">{renderIcon('assignment', 20)}</span>
          <div style={{ minWidth: 0 }}>
            <span className="slpw-kicker">Active inspector</span>
            <h3>
              {row.code} • {row.title}
            </h3>
          </div>
        </div>
        <span className={`slpw-badge ${row.state === 'open' ? 'is-ok' : row.state === 'draft' ? 'is-draft' : ''}`}>{STATE_LABELS[row.state]}</span>
      </div>

      {(row.instructions || row.description) && <p className="slpw-brief">{row.instructions || row.description}</p>}

      <dl className="slpw-grid">
        <div>
          <dt>Offering scope</dt>
          <dd>
            {row.code}
            {row.term ? ` (${row.term})` : ''}
          </dd>
        </div>
        <div>
          <dt>Publication state</dt>
          <dd>{row.state === 'draft' ? 'Draft • hidden' : row.state === 'open' ? 'Published • visible' : 'Closed • visible'}</dd>
        </div>
        <div>
          <dt>Due date</dt>
          <dd className="slpw-mono" style={{ fontSize: 12 }}>
            {longStamp(row.due_at)}
          </dd>
        </div>
        <div>
          <dt>Maximum marks</dt>
          <dd className="slpw-mono" style={{ fontSize: 12, color: 'var(--primary)' }}>
            {marksText(row.max_marks)} pts
          </dd>
        </div>
        <div>
          <dt>Late submissions</dt>
          <dd>{row.allow_late ? 'Accepted, marked late' : 'Not accepted'}</dd>
        </div>
        <div>
          <dt>Time left</dt>
          <dd>{row.state === 'open' ? dueInfo(row.due_at, now).label : row.state === 'closed' ? 'Closed' : 'Not published'}</dd>
        </div>
        <div className="is-wide">
          <dt>Reference brief</dt>
          <dd>
            {row.has_attachment ? (
              <button type="button" className="slpw-btn" onClick={onDownload} style={{ height: 32 }}>
                {renderIcon('file_download', 16)}
                {row.attachment_name || 'Download brief'}
              </button>
            ) : (
              'None attached'
            )}
          </dd>
        </div>
      </dl>

      {row.state !== 'draft' && (
        <div className="slpw-progress">
          <div className="slpw-progress-top">
            <span>Grading queue progress</span>
            <span className="slpw-mono">{known ? `${row.graded} / ${row.turnIn} (${share}%)` : '—'}</span>
          </div>
          <div className="slpw-bar" role="progressbar" aria-label="Grading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share)}>
            <span style={{ width: `${Math.min(100, share)}%` }} />
          </div>
          <small>{known ? (row.pending > 0 ? `${plural(row.pending, 'submission')} remaining to grade` : row.turnIn > 0 ? 'Everything received has been graded' : 'No submissions received yet') : 'Counting submissions'}</small>
        </div>
      )}

      <div className="slpw-cta">
        {row.state === 'draft' ? (
          <button type="button" className="slpc-btn slpc-btn-primary" onClick={onPublish} disabled={busy}>
            {renderIcon('publish', 18)}
            {busy ? 'Publishing…' : 'Publish assignment'}
          </button>
        ) : (
          <Link to={`/lecturer/assignments/${row.id}/submissions`} className="slpc-btn slpc-btn-primary">
            {renderIcon('how_to_reg', 18)}
            {known && row.pending > 0 ? `Launch grading queue (${row.pending} pending)` : 'Open submissions'}
          </Link>
        )}
        <div className="slpw-cta-row">
          <button type="button" className="slpw-btn" onClick={onEdit}>
            {renderIcon('tune', 16)}
            Edit settings
          </button>
          {canUnpublish ? (
            <button type="button" className="slpw-btn" onClick={onUnpublish} disabled={busy}>
              {renderIcon('lock_reset', 16)}
              Back to draft
            </button>
          ) : (
            <Link to={`/lecturer/courses/${row.courseId}`} className="slpw-btn">
              {renderIcon('menu_book', 16)}
              Open course
            </Link>
          )}
        </div>
      </div>

      {row.state === 'open' && (
        <div className="slpw-danger">
          <div>
            <strong>Close assignment</strong>
            <span>Assignments are never deleted. Closing stops new submissions and keeps the audit trail.</span>
          </div>
          {confirming ? (
            <div className="slpw-danger-row">
              <button type="button" className="slpw-btn" onClick={onClose} disabled={busy}>
                {busy ? 'Closing…' : 'Yes, close it'}
              </button>
              <button type="button" className="slpw-btn" onClick={() => setConfirming('')}>
                Keep open
              </button>
            </div>
          ) : (
            <button type="button" className="slpw-btn" onClick={() => setConfirming(row.id)}>
              Close
            </button>
          )}
        </div>
      )}
    </section>
  )
}

/* ---------- page ---------- */

export default function LecturerAssignments() {
  useCourseFonts()
  const now = useClock()
  const queryClient = useQueryClient()
  const downloads = useDownloads()
  const { courseId: routeCourseId } = useParams()
  const inspectorRef = useRef(null)

  const [course, setCourse] = useState(routeCourseId || 'all')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState('due_asc')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState('')
  const [dialog, setDialog] = useState(null)
  const [confirming, setConfirming] = useState('')
  const [notice, setNotice] = useState(null)

  const coursesQuery = useQuery({ queryKey: COURSES_KEY, queryFn: fetchCourses })
  const courses = toList(coursesQuery.data)

  const lists = useQueries({
    queries: courses.map((entry) => ({ queryKey: listKey(entry.id), queryFn: () => api(`/courses/${entry.id}/assignments?page_size=100`), retry: false })),
  })
  const details = useQueries({
    queries: courses.map((entry) => ({ queryKey: ['course', entry.id], queryFn: () => api(`/courses/${entry.id}`) })),
  })

  const base = courses.flatMap((entry, index) => {
    const enrolled = details[index]?.data?.enrolled_count
    const term = [formatSemester(details[index]?.data?.semester ?? entry.semester), details[index]?.data?.academic_year ?? entry.academic_year].filter(Boolean).join(' • ')
    return toList(lists[index]?.data).map((item) => ({
      ...item,
      id: String(item.id),
      courseId: entry.id,
      code: entry.course_code,
      courseName: entry.course_name,
      term,
      state: stateOf(item),
      enrolled: Number.isFinite(Number(enrolled)) && enrolled !== null && enrolled !== undefined ? Number(enrolled) : null,
      title: String(item.title ?? ''),
    }))
  })
  const counted = base.filter((row) => row.state !== 'draft')
  const countQueries = useQueries({
    queries: counted.map((row) => ({ queryKey: detailKey(row.id), queryFn: () => api(`/assignments/${row.id}`), retry: false })),
  })
  const countsById = new Map(counted.map((row, index) => [row.id, countQueries[index]?.data?.submission_counts ?? null]))

  const all = base.map((row) => {
    const counts = countsById.get(row.id) ?? null
    const submitted = Number(counts?.submitted) || 0
    const late = Number(counts?.late) || 0
    const graded = (Number(counts?.graded) || 0) + (Number(counts?.returned) || 0)
    const total = counts ? (Number.isFinite(Number(counts.total)) && counts.total !== null && counts.total !== undefined ? Number(counts.total) : submitted + late + graded) : 0
    return { ...row, counts: row.state === 'draft' ? {} : counts, submitted, late, graded, pending: submitted + late, turnIn: total }
  })
  // Drafts have no submissions by definition; their counts object is empty so the card shows no metrics.
  const loadingLists = coursesQuery.isPending || (courses.length > 0 && lists.some((query) => query.isPending))
  const failedCourses = courses.filter((_, index) => lists[index]?.isError)
  const ready = coursesQuery.isSuccess && !loadingLists
  const countsReady = ready && countQueries.every((query) => !query.isPending)
  const countsComplete = countsReady && countQueries.every((query) => query.isSuccess)

  const open = all.filter((row) => row.state === 'open')
  const drafts = all.filter((row) => row.state === 'draft')
  const closed = all.filter((row) => row.state === 'closed')
  const published = all.filter((row) => row.state !== 'draft')
  const turnInTotal = published.reduce((sum, row) => sum + row.turnIn, 0)
  const pendingTotal = published.reduce((sum, row) => sum + row.pending, 0)
  const gradedTotal = published.reduce((sum, row) => sum + row.graded, 0)
  const expectedTotal = published.reduce((sum, row) => sum + (row.enrolled ?? 0), 0)
  const expectedKnown = published.length > 0 && published.every((row) => row.enrolled !== null)
  const rate = countsComplete && expectedKnown && expectedTotal > 0 ? Math.round((turnInTotal / expectedTotal) * 1000) / 10 : null
  const dueSoon = open.filter((row) => stamp(row.due_at) > now && stamp(row.due_at) - now <= 2 * DAY).length
  const term = details[0]?.data ? [formatSemester(details[0].data.semester), details[0].data.academic_year].filter(Boolean).join(' • ') : ''

  const needle = search.trim().toLowerCase()
  const filterCounts = {
    all: all.length,
    open: open.length,
    draft: drafts.length,
    grading: published.filter((row) => row.pending > 0).length,
    closed: closed.length,
  }
  const filtered = all
    .filter((row) => course === 'all' || row.courseId === course)
    .filter((row) => {
      if (filter === 'open') return row.state === 'open'
      if (filter === 'draft') return row.state === 'draft'
      if (filter === 'closed') return row.state === 'closed'
      if (filter === 'grading') return row.state !== 'draft' && row.pending > 0
      return true
    })
    .filter((row) => !needle || `${row.title} ${row.code} ${row.courseName} ${row.description ?? ''} ${row.instructions ?? ''}`.toLowerCase().includes(needle))
    .sort((a, b) => {
      if (sort === 'due_desc') return stamp(b.due_at) - stamp(a.due_at)
      if (sort === 'created_desc') return stamp(b.created_at) - stamp(a.created_at)
      if (sort === 'pending_desc') return b.pending - a.pending || stamp(a.due_at) - stamp(b.due_at)
      return stamp(a.due_at) - stamp(b.due_at)
    })

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const shown = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
  const selected = filtered.find((row) => row.id === selectedId) ?? shown[0]

  const change = (setter) => (value) => {
    setter(value)
    setPage(1)
  }
  const choose = (id) => {
    setSelectedId(id)
    setConfirming('')
    if (typeof window !== 'undefined' && window.innerWidth < 1180) inspectorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }
  const refreshRow = (courseId, id) => {
    queryClient.invalidateQueries({ queryKey: listKey(courseId) })
    if (id) queryClient.invalidateQueries({ queryKey: detailKey(id) })
  }

  const patch = useMutation({
    mutationFn: ({ row, body }) => api(`/assignments/${row.id}`, { method: 'PATCH', body }),
    onSuccess: (_result, { row }) => refreshRow(row.courseId, row.id),
  })
  const run = async (row, body, message) => {
    setNotice(null)
    setConfirming('')
    try {
      await patch.mutateAsync({ row, body })
      setNotice({ kind: 'ok', text: message })
    } catch (caught) {
      setNotice({ kind: 'error', text: errorText(caught, 'That change could not be saved. Please try again.') })
    }
  }
  const busyFor = (row) => patch.isPending && patch.variables?.row.id === row.id

  const handleSaved = ({ courseId, id, message, warning }) => {
    refreshRow(courseId, id)
    setDialog(null)
    if (id) setSelectedId(String(id))
    setNotice(warning ? { kind: 'error', text: warning } : { kind: 'ok', text: message })
  }
  const exportCsv = () => {
    const lines = [['Course', 'Title', 'State', 'Due', 'Max marks', 'Turn-in', 'Enrolled', 'Graded', 'Pending', 'Late'].map(csvCell).join(',')]
    filtered.forEach((row) => {
      const draft = row.state === 'draft'
      lines.push([row.code, row.title, STATE_LABELS[row.state], longStamp(row.due_at), marksText(row.max_marks), draft ? '' : row.turnIn, draft ? '' : (row.enrolled ?? ''), draft ? '' : row.graded, draft ? '' : row.pending, draft ? '' : row.late].map(csvCell).join(','))
    })
    downloadText('assignment-ledger.csv', lines.join('\r\n'), 'text/csv;charset=utf-8')
  }
  const closeDialog = () => setDialog(null)
  const download = (row) => downloads.start(row.id, `/assignments/${row.id}/attachment`)

  return (
    <div className="slpc" aria-label="Assignments management">
      <style>{COURSE_STYLES}</style>
      <style>{ASSIGNMENT_STYLES}</style>

      <div className="slpc-stack slpc-gap-lg">
        <div className="slpc-stack" style={{ gap: '0.25rem' }}>
          <nav className="slpc-trail" aria-label="Breadcrumb" style={{ fontSize: 11, fontWeight: 600 }}>
            <Link to="/lecturer" className="slpc-trail-link">
              Lecturer Workspace
            </Link>
            <span className="slpc-trail-sep">/</span>
            <Link to="/lecturer/courses" className="slpc-trail-link">
              Course Offerings
            </Link>
            <span className="slpc-trail-sep">/</span>
            <span className="slpc-trail-current">Assignments &amp; Assessment Lifecycle</span>
          </nav>
          <div className="slpw-head" style={{ paddingTop: '0.25rem' }}>
            <div className="slpc-stack" style={{ gap: '0.25rem', maxWidth: 760 }}>
              <h1 className="slpw-title">Assignments Management</h1>
              <p className="slpc-lead">Create coursework, publish it to enrolled students, follow submissions and open the grading queue for every course you teach.</p>
            </div>
            <div className="slpw-actions">
              <button type="button" className="slpc-btn slpc-btn-primary" onClick={() => setDialog({ assignment: null })} disabled={!coursesQuery.isSuccess || courses.length === 0}>
                {renderIcon('add_circle', 18)}
                Create Assignment
              </button>
              <button type="button" className="slpc-btn slpc-btn-soft" onClick={exportCsv} disabled={filtered.length === 0}>
                {renderIcon('download', 18)}
                Export Ledger
              </button>
            </div>
          </div>
        </div>

        {coursesQuery.isError && <ErrorCard message={errorText(coursesQuery.error, 'Your courses could not be loaded.')} onRetry={() => coursesQuery.refetch()} />}

        <section className="slpc-stats slpw-stats" aria-label="Assignment summary">
          <div className="slpc-card slpw-stat">
            <div className="slpw-stat-body">
              <div className="slpw-stat-top">
                <span className="slpw-stat-label">Active coursework</span>
              </div>
              <div>
                <div className="slpw-stat-line">
                  <span className="slpw-stat-num">{ready ? open.length : '—'}</span>
                  <span className="slpw-stat-unit">{open.length === 1 ? 'Assignment' : 'Assignments'}</span>
                </div>
                <p className="slpw-stat-sub">{ready ? `Across ${plural(courses.length, 'assigned course')}${courses.length > 0 ? ` (${courses.map((entry) => entry.course_code).join(', ')})` : ''}` : 'Loading your courses'}</p>
              </div>
            </div>
            <div className="slpw-stat-foot">
              <span>{term || 'Current term'}</span>
              <span className="slpw-mono">{ready ? `${plural(drafts.length, 'draft')} • ${closed.length} closed` : '—'}</span>
            </div>
          </div>

          <div className="slpc-card slpw-stat">
            <div className="slpw-stat-body">
              <div className="slpw-stat-top">
                <span className="slpw-stat-label">Total submissions</span>
                {renderIcon('inventory_2', 20)}
              </div>
              <div>
                <div className="slpw-stat-line">
                  <span className="slpw-stat-num">{countsComplete ? turnInTotal : '—'}</span>
                  {rate !== null && <span className="slpw-rate">{rate}% rate</span>}
                </div>
                <div className="slpw-bar" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, rate ?? 0)}%` }} />
                </div>
              </div>
            </div>
            <div className="slpw-stat-foot">
              <span>Received so far</span>
              <span className="slpw-mono">{countsComplete && expectedKnown ? `${turnInTotal} / ${expectedTotal} expected` : countsComplete ? 'Enrolment unknown' : 'Counting'}</span>
            </div>
          </div>

          <div className="slpc-card slpw-stat">
            <div className="slpw-stat-body">
              <div className="slpw-stat-top">
                <span className="slpw-stat-label">Awaiting evaluation</span>
                {dueSoon > 0 && (
                  <span className="slpw-tag">
                    {renderIcon('timer', 14)}
                    {dueSoon} due in 48h
                  </span>
                )}
              </div>
              <div>
                <div className="slpw-stat-line">
                  <span className="slpw-stat-num is-primary">{countsComplete ? pendingTotal : '—'}</span>
                  <span className="slpw-stat-unit">Pending grading</span>
                </div>
                <p className="slpw-stat-sub">{countsComplete ? `${gradedTotal} graded or returned` : 'Counting submissions'}</p>
              </div>
            </div>
            <div className="slpw-stat-foot">
              <span>{countsComplete && pendingTotal > 0 ? 'Grading queue open' : 'Nothing waiting'}</span>
              <span className="slpw-mono">{countsComplete ? plural(published.filter((row) => row.pending > 0).length, 'assignment') : '—'}</span>
            </div>
          </div>
        </section>

        <section className="slpc-card slpw-filters" aria-label="Filter assignments">
          <div className="slpw-filter-row">
            <label className="slpc-search">
              {renderIcon('search', 18)}
              <input type="search" value={search} onChange={(event) => change(setSearch)(event.target.value)} placeholder="Search assignments by title, course code or instruction keyword" aria-label="Search assignments" />
            </label>
            <select className="slpc-select" value={course} onChange={(event) => change(setCourse)(event.target.value)} aria-label="Filter by course">
              <option value="all">All Assigned Courses ({courses.length})</option>
              {courses.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.course_code}: {entry.course_name}
                </option>
              ))}
            </select>
            <select className="slpc-select" value={sort} onChange={(event) => change(setSort)(event.target.value)} aria-label="Sort assignments">
              {SORTS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>
          <div className="slpw-pills" role="group" aria-label="Assignment state">
            {FILTERS.map((entry) => (
              <button key={entry.id} type="button" className={`slpw-pill ${filter === entry.id ? 'is-active' : ''}`} onClick={() => change(setFilter)(entry.id)} aria-pressed={filter === entry.id}>
                {entry.label} ({ready ? filterCounts[entry.id] : 0})
              </button>
            ))}
          </div>
        </section>

        {notice && (
          <div className={notice.kind === 'ok' ? 'slpw-ok' : 'slpw-warn'} role={notice.kind === 'ok' ? 'status' : 'alert'}>
            <span>{notice.text}</span>
            <button type="button" className="slpw-btn" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        )}
        {downloads.error && (
          <p className="slpc-alert" role="alert">
            {downloads.error}
          </p>
        )}
        {failedCourses.length > 0 && (
          <div className="slpw-warn" role="alert">
            <span>Assignments for {failedCourses.map((entry) => entry.course_code).join(', ')} could not be loaded.</span>
            <button type="button" className="slpw-btn" onClick={() => lists.forEach((query) => query.isError && query.refetch())}>
              Try again
            </button>
          </div>
        )}

        <div className="slpw-split">
          <div className="slpw-main">
            <div className="slpw-ledger-head">
              <span>
                Assignment Ledger
                <span className="slpw-count">{plural(filtered.length, 'Entry', 'Entries')}</span>
              </span>
              <span className="slpw-hint">Select an assignment to inspect it</span>
            </div>

            {loadingLists && <Skeleton height={260} label="Loading assignments" />}
            {coursesQuery.isSuccess && courses.length === 0 && <p className="slpc-card slpc-empty">You are not assigned to any courses yet, so there is nothing to manage.</p>}
            {ready && courses.length > 0 && all.length === 0 && failedCourses.length < courses.length && <p className="slpc-card slpc-empty">No assignments yet. Use Create Assignment to add the first one. It stays a private draft until you publish it.</p>}
            {ready && all.length > 0 && filtered.length === 0 && <p className="slpc-card slpc-empty">No assignments match these filters.</p>}

            {shown.length > 0 && (
              <>
                <ul className="slpw-feed" aria-label="Assignments">
                  {shown.map((row) => (
                    <LedgerCard
                      key={row.id}
                      row={row}
                      now={now}
                      selected={selected?.id === row.id}
                      busy={busyFor(row)}
                      onSelect={() => choose(row.id)}
                      onEdit={() => setDialog({ assignment: row })}
                      onPublish={() => run(row, { published: true }, row.state === 'draft' ? 'Assignment published. Enrolled students have been notified.' : 'Done.')}
                      onDownload={() => download(row)}
                    />
                  ))}
                </ul>
                <nav className="slpw-pager" aria-label="Pagination">
                  <span>
                    Showing {(current - 1) * PAGE_SIZE + 1} to {(current - 1) * PAGE_SIZE + shown.length} of {plural(filtered.length, 'assignment')}
                  </span>
                  <span className="slpw-pager-btns">
                    <button type="button" className="slpw-page" onClick={() => setPage(current - 1)} disabled={current <= 1} aria-label="Previous page">
                      {renderIcon('chevron_left', 16)}
                    </button>
                    {Array.from({ length: pages }, (_, index) => index + 1).map((number) => (
                      <button key={number} type="button" className={`slpw-page ${number === current ? 'is-current' : ''}`} onClick={() => setPage(number)} aria-label={`Page ${number}`} aria-current={number === current ? 'page' : undefined}>
                        {number}
                      </button>
                    ))}
                    <button type="button" className="slpw-page" onClick={() => setPage(current + 1)} disabled={current >= pages} aria-label="Next page">
                      {renderIcon('chevron_right', 16)}
                    </button>
                  </span>
                </nav>
              </>
            )}
          </div>

          <aside className="slpw-side" ref={inspectorRef} aria-label="Assignment details">
            <Inspector
              row={ready ? selected : undefined}
              now={now}
              busy={selected ? busyFor(selected) : false}
              confirming={Boolean(selected) && confirming === selected.id}
              setConfirming={setConfirming}
              onEdit={() => selected && setDialog({ assignment: selected })}
              onPublish={() => selected && run(selected, { published: true }, 'Assignment published. Enrolled students have been notified.')}
              onUnpublish={() => selected && run(selected, { published: false }, 'Moved back to draft. Students can no longer see it.')}
              onClose={() => selected && run(selected, { closed: true }, 'Assignment closed. It stays in the ledger and the audit trail.')}
              onDownload={() => selected && download(selected)}
            />
          </aside>
        </div>
      </div>

      {dialog && <AssignmentDialog key={dialog.assignment?.id ?? 'new'} courses={courses} assignment={dialog.assignment} defaultCourseId={course === 'all' ? '' : course} onClose={closeDialog} onSaved={handleSaved} />}
    </div>
  )
}
