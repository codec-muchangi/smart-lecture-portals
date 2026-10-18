import { useEffect, useRef, useState } from 'react'
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
  initials,
  renderIcon,
  trimNumber,
  useCourseFonts,
} from '../../components/courseKit.jsx'
import { toList } from '../../utils/format.js'

/*
 * Smart Lecture Portal: lecturer Attendance Tracker & Class Log
 * Place at: src/pages/lecturer/LecturerAttendance.jsx
 *
 * Routes (see routes.jsx):
 *   /lecturer/attendance                      the first course you teach
 *   /lecturer/courses/:courseId/attendance    that course
 *
 * - Renders inside AppShell, which already draws the sidebar and top bar.
 * - Built on the contract in docs/API.md (Attendance, Reports) and the attendance tables in docs/ERD.md:
 *     GET  /courses                                    assigned courses
 *     GET  /courses/{id}                               enrolled_count
 *     GET  /courses/{id}/attendance/sessions           sessions of one course
 *     POST /courses/{id}/attendance/sessions           { session_date, start_time, end_time, topic? } (409 on duplicate)
 *     GET  /attendance/sessions/{id}                   the session plus its roster with current statuses
 *     POST /attendance/sessions/{id}/records           { records: [{ student_id, status, note? }] } in one transaction
 *     GET  /courses/{id}/reports/attendance            per-student totals (present / late / excused / absent)
 * - A roster row is { student_id, full_name, registration_number, status | null, note }. status is one of
 *   present | late | excused | absent. The roster may be called roster, records or students.
 * - Only marks you changed are sent, so untouched marks are not re-written and the audit trail stays clean.
 * - The attendance backend arrives in Phase 6. Until the server answers, the page says so plainly and
 *   shows no figures. It never invents students, sessions, rooms or "audited" claims.
 * - Ratio policy follows db/migrations/0002_views.sql: attended = present + late, counted = present +
 *   late + absent, excused sessions are not counted. ATTENDANCE_MIN is the portal's reference threshold
 *   (the same number the student pages use); change that one constant if the institution's policy differs.
 * - The API has no session editing or deleting, rooms, geofenced check-in, semester length, department
 *   averages, senate notices or medical attachments, so none are drawn. "Download report" builds a CSV
 *   in the browser from the attendance report.
 */

const NOT_READY = [404, 405, 501]
const ATTENDANCE_MIN = 75
const PAGE_SIZE = 5
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const STATUSES = ['present', 'absent', 'late', 'excused']
const STATUS_LABELS = { present: 'Present', absent: 'Absent', late: 'Late', excused: 'Excused' }
const FILTERS = [
  { id: 'all', label: 'All sessions' },
  { id: 'absences', label: 'Has absences' },
  { id: 'unmarked', label: 'Not marked yet' },
]

const courseKey = (courseId) => ['course', courseId]
const sessionsKey = (courseId) => ['attendance-sessions', courseId]
const sessionKey = (sessionId) => ['attendance-session', sessionId]
const reportKey = (courseId) => ['attendance-report', courseId]
const isNotReady = (error) => NOT_READY.includes(error?.status)

const ATTENDANCE_STYLES = `
.slpe-head { display: flex; flex-direction: column; gap: 1rem; }
.slpe-head-text { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
.slpe-title { font-size: 26px; line-height: 34px; font-weight: 800; letter-spacing: -0.02em; overflow-wrap: anywhere; }
.slpe-head-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.slpe-head-actions .slpc-btn { height: 44px; padding: 0 20px; }
.slpe-crumb-code { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-weight: 700; color: var(--primary); overflow-wrap: anywhere; }
.slpe-scope { display: flex; gap: 0.5rem; overflow-x: auto; padding-bottom: 4px; }
.slpe-scope-btn { display: inline-flex; align-items: center; gap: 0.5rem; flex: 0 0 auto; padding: 10px 20px; border: 0; border-radius: 999px; background: var(--surface-lowest); color: var(--on-surface-variant); font-size: 13px; line-height: 18px; font-weight: 700; cursor: pointer; white-space: nowrap; box-shadow: 0 1px 2px rgba(30, 26, 35, 0.08); }
.slpe-scope-btn:hover { background: var(--surface-low); color: var(--on-surface); }
.slpe-scope-btn.is-active { background: var(--primary-container); color: var(--on-primary-container); box-shadow: 0 2px 8px rgba(193, 74, 56, 0.2); }
.slpe-scope-btn i { width: 8px; height: 8px; border-radius: 999px; background: #fff; }
.slpe-scope-count { padding: 2px 8px; border-radius: 999px; background: var(--surface-high); font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 14px; font-weight: 600; }
.slpe-scope-btn.is-active .slpe-scope-count { background: rgba(255, 255, 255, 0.22); }
.slpe-cards { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; }
.slpe-card { display: flex; flex-direction: column; justify-content: space-between; gap: 0.75rem; min-width: 0; padding: 1.25rem; overflow: hidden; }
.slpe-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; }
.slpe-eyebrow { font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpe-chip { display: inline-flex; align-items: center; gap: 0.25rem; padding: 2px 8px; border-radius: 999px; background: var(--surface-high); color: var(--primary); font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 16px; font-weight: 700; white-space: nowrap; }
.slpe-chip.is-warn { background: var(--warn-bg); color: var(--warn); }
.slpe-chip.is-info { background: var(--info-bg); color: var(--info); }
.slpe-chip.is-ok { background: var(--ok-bg); color: var(--ok); }
.slpe-big { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.5rem; }
.slpe-big strong { font-size: 40px; line-height: 44px; font-weight: 800; letter-spacing: -0.025em; }
.slpe-big strong.is-warn { color: var(--warn); }
.slpe-big strong.is-secondary { color: var(--secondary); }
.slpe-big span { font-size: 14px; line-height: 20px; font-weight: 600; color: var(--on-surface-variant); }
.slpe-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.25rem 0.75rem; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpe-foot strong { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; color: var(--primary); }
.slpe-link { display: inline-flex; align-items: center; gap: 2px; border: 0; background: none; padding: 0; color: var(--primary); font-size: 12px; font-weight: 700; cursor: pointer; text-decoration: none; }
.slpe-link:hover { text-decoration: underline; }
.slpe-banner { display: flex; align-items: center; gap: 0.375rem; margin: 0 -1.25rem -1.25rem; padding: 0.625rem 1.25rem; background: var(--warn-bg); color: var(--warn); font-size: 12px; line-height: 16px; font-weight: 700; }
.slpe-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.slpe-col { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.slpe-panel { display: flex; flex-direction: column; gap: 1rem; padding: 1.5rem; min-width: 0; }
.slpe-panel-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 0.75rem; }
.slpe-h { font-size: 18px; line-height: 26px; font-weight: 700; letter-spacing: -0.005em; }
.slpe-sub { margin-top: 2px; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); overflow-wrap: anywhere; }
.slpe-filter-row { display: flex; align-items: center; gap: 0.5rem; font-size: 12px; font-weight: 700; color: var(--on-surface-variant); }
.slpe-filter-row .slpc-select { height: 36px; border-radius: 12px; background: var(--surface-low); min-width: 0; }
.slpe-subbar { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.75rem 1rem; border-radius: 12px; background: var(--surface-low); }
.slpe-subbar .slpc-search { height: 36px; border-radius: 10px; background: var(--surface-lowest); }
.slpe-dates { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; font-size: 12px; font-weight: 600; color: var(--on-surface-variant); }
.slpe-date-input { flex: 1 1 130px; height: 36px; padding: 0 10px; border: 0; border-radius: 10px; background: var(--surface-lowest); color: var(--on-surface); font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 12px; min-width: 0; }
.slpe-sessions { display: flex; flex-direction: column; gap: 0.75rem; margin: 0; padding: 0; list-style: none; }
.slpe-session { display: flex; flex-direction: column; gap: 0.875rem; padding: 1.25rem; border-radius: 16px; background: var(--surface-lowest); box-shadow: 0 1px 2px rgba(30, 26, 35, 0.08); min-width: 0; }
.slpe-session.is-active { background: var(--surface-low); box-shadow: 0 0 0 2px var(--primary-container); }
.slpe-session-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; }
.slpe-session-title { font-size: 16px; line-height: 24px; font-weight: 700; overflow-wrap: anywhere; }
.slpe-meta { display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; margin-top: 2px; font-size: 12px; line-height: 18px; color: var(--on-surface-variant); }
.slpe-meta span { display: inline-flex; align-items: center; gap: 0.25rem; }
.slpe-ratio { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 0 0 auto; width: 80px; padding: 8px; border-radius: 12px; background: var(--surface-lowest); box-shadow: 0 1px 2px rgba(30, 26, 35, 0.08); }
.slpe-ratio strong { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 15px; line-height: 20px; font-weight: 700; color: var(--primary); }
.slpe-ratio span { font-size: 10px; line-height: 12px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpe-counts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem; }
.slpe-count { display: flex; flex-direction: column; padding: 8px 12px; border-radius: 12px; background: var(--surface-lowest); min-width: 0; }
.slpe-count span { font-size: 11px; line-height: 14px; font-weight: 700; color: var(--on-surface-variant); }
.slpe-count strong { font-size: 18px; line-height: 24px; font-weight: 800; }
.slpe-count.is-present strong { color: var(--ok); }
.slpe-count.is-absent strong { color: var(--error); }
.slpe-count.is-late strong { color: var(--warn); }
.slpe-count.is-excused strong { color: #4338ca; }
.slpe-line { font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpe-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.slpe-actions .slpc-btn { height: 36px; padding: 0 16px; font-size: 12px; }
.slpe-pager { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; font-size: 12px; color: var(--on-surface-variant); }
.slpe-upcoming { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; padding: 1.25rem; }
.slpe-upcoming-icon { width: 48px; height: 48px; border-radius: 16px; background: var(--tertiary-fixed); color: var(--tertiary); display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.slpe-upcoming-main { flex: 1 1 220px; min-width: 0; }
.slpe-live { width: 8px; height: 8px; border-radius: 999px; background: var(--ok); display: inline-block; margin-left: 6px; }
.slpe-bulk { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.75rem 1rem; border-radius: 12px; background: var(--surface-low); }
.slpe-bulk-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; }
.slpe-bulk .slpc-search { height: 36px; border-radius: 10px; background: var(--surface-lowest); }
.slpe-roster { display: flex; flex-direction: column; gap: 0.75rem; max-height: 620px; overflow-y: auto; margin: 0; padding: 0 4px 0 0; list-style: none; }
.slpe-student { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.875rem; border-radius: 12px; background: var(--surface-lowest); box-shadow: 0 1px 2px rgba(30, 26, 35, 0.08); }
.slpe-student.is-risk { background: rgba(255, 218, 214, 0.35); }
.slpe-student-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; }
.slpe-who { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
.slpe-avatar { width: 40px; height: 40px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; font-size: 13px; font-weight: 800; background: var(--primary-fixed); color: var(--primary); }
.slpe-avatar.is-t1 { background: var(--secondary-container); color: var(--on-secondary-container); }
.slpe-avatar.is-t2 { background: var(--tertiary-fixed); color: var(--on-tertiary-fixed); }
.slpe-student.is-risk .slpe-avatar { background: var(--error); color: #fff; }
.slpe-name { display: flex; align-items: center; gap: 0.375rem; font-size: 14px; line-height: 20px; font-weight: 700; overflow-wrap: anywhere; }
.slpe-name .material-symbols-outlined { color: var(--error); }
.slpe-reg { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 12px; line-height: 16px; color: var(--outline); overflow-wrap: anywhere; }
.slpe-comp { display: flex; flex-direction: column; align-items: flex-end; flex: 0 0 auto; text-align: right; }
.slpe-comp strong { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 16px; font-weight: 700; color: var(--ok); }
.slpe-comp span { font-size: 10px; line-height: 14px; color: var(--outline); }
.slpe-comp.is-risk strong, .slpe-comp.is-risk span { color: var(--error); font-weight: 700; }
.slpe-mark-row { display: flex; flex-direction: column; gap: 0.5rem; }
.slpe-seg { display: flex; flex-wrap: wrap; gap: 6px; }
.slpe-seg button { padding: 5px 12px; border: 0; border-radius: 999px; background: var(--surface-high); color: var(--on-surface-variant); font-size: 12px; line-height: 16px; font-weight: 600; cursor: pointer; transition: background 0.15s; }
.slpe-seg button:hover { background: var(--surface-highest); }
.slpe-seg button.is-present { background: var(--ok); color: #fff; font-weight: 700; }
.slpe-seg button.is-absent { background: var(--error); color: #fff; font-weight: 700; }
.slpe-seg button.is-late { background: var(--warn); color: #fff; font-weight: 700; }
.slpe-seg button.is-excused { background: #4338ca; color: #fff; font-weight: 700; }
.slpe-note { width: 100%; height: 34px; padding: 0 12px; border: 0; border-radius: 10px; background: var(--surface-low); color: var(--on-surface); font-family: inherit; font-size: 13px; text-align: left; min-width: 0; }
.slpe-note:focus, .slpe-date-input:focus { outline: 2px solid var(--primary-container); outline-offset: 0; }
.slpe-save { width: 100%; height: 44px; justify-content: center; }
.slpe-trail { display: flex; align-items: center; justify-content: center; gap: 0.375rem; font-size: 11px; line-height: 16px; color: var(--outline); text-align: center; }
.slpe-ok { padding: 0.5rem 0.75rem; border-radius: 12px; background: var(--ok-bg); color: var(--ok); font-size: 13px; line-height: 18px; font-weight: 600; }
.slpe-backdrop { position: fixed; inset: 0; z-index: 60; background: rgba(51, 47, 56, 0.4); backdrop-filter: blur(2px); }
.slpe-drawer { position: fixed; top: 0; right: 0; bottom: 0; z-index: 61; width: 100%; max-width: 448px; display: flex; flex-direction: column; background: var(--surface-lowest); box-shadow: -8px 0 32px rgba(30, 26, 35, 0.2); }
.slpe-drawer-head { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 1.25rem 1.5rem; background: var(--surface-low); }
.slpe-drawer-icon { width: 40px; height: 40px; border-radius: 12px; background: var(--primary); color: var(--on-primary); display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.slpe-close { width: 36px; height: 36px; border: 0; border-radius: 999px; background: transparent; color: var(--on-surface-variant); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.slpe-close:hover { background: var(--surface-high); }
.slpe-form { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.slpe-form-body { display: flex; flex-direction: column; gap: 1.25rem; padding: 1.5rem; overflow-y: auto; flex: 1 1 auto; }
.slpe-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.slpe-field label { font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpe-input { width: 100%; height: 44px; padding: 0 14px; border: 0; border-radius: 12px; background: var(--surface-low); color: var(--on-surface); font-family: inherit; font-size: 14px; min-width: 0; }
.slpe-input:focus { outline: 2px solid var(--primary-container); outline-offset: 0; background: var(--surface-lowest); }
.slpe-input.is-static { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; font-weight: 600; }
.slpe-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem; }
.slpe-three { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.75rem; }
.slpe-three > :first-child { grid-column: 1 / -1; }
.slpe-drawer-foot { display: flex; align-items: center; gap: 0.75rem; padding: 1.25rem 1.5rem; background: var(--surface-low); }
.slpe-drawer-foot .slpc-btn { flex: 1 1 0; height: 44px; justify-content: center; }
@media (min-width: 640px) {
  .slpe-counts { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .slpe-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 1024px) {
  .slpe-head { flex-direction: row; align-items: center; justify-content: space-between; }
  .slpe-head-text { flex: 1 1 0; }
  .slpe-head-actions { flex: 0 0 auto; flex-wrap: nowrap; }
  .slpe-title { font-size: 32px; line-height: 40px; }
}
@media (min-width: 1280px) {
  .slpe-cards { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .slpe-split { grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); }
}
@media (max-width: 479px) {
  .slpe-ratio { display: none; }
  .slpe-panel { padding: 1.125rem; }
}
`

/* ---------- helpers ---------- */

const pad = (value) => String(value).padStart(2, '0')
const isoOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const clock = (value) => (/^\d{2}:\d{2}/.test(String(value ?? '')) ? String(value).slice(0, 5) : '')
const numberOr = (value) => (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null)

function parseDay(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(text ?? ''))
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), iso: `${match[1]}-${match[2]}-${match[3]}` } : null
}

const dayLabel = (session) => (session.date ? `${session.date.day} ${MONTHS[session.date.month - 1].charAt(0)}${MONTHS[session.date.month - 1].slice(1).toLowerCase()} ${session.date.year}` : 'Date not recorded')
const timeRange = (session) => [clock(session.start), clock(session.end)].filter(Boolean).join(' - ')
const sessionTitle = (session) => session.topic || 'Class session'
const stamp = (session) => (session.date ? session.date.iso : '') + clock(session.start)
const errorText = (error, fallback) => (error?.status === 409 ? 'A session already exists for that date and time.' : error?.message || fallback)

function readCounts(raw) {
  const source = raw?.counts && typeof raw.counts === 'object' ? raw.counts : raw?.summary && typeof raw.summary === 'object' ? raw.summary : raw
  const counts = {}
  STATUSES.forEach((key) => {
    counts[key] = numberOr(source?.[key])
  })
  return STATUSES.some((key) => counts[key] !== null) ? Object.fromEntries(STATUSES.map((key) => [key, counts[key] ?? 0])) : null
}

function normaliseSession(raw, index) {
  const id = raw?.id ?? raw?.session_id
  if (!id) return null
  return {
    id: String(id),
    index,
    date: parseDay(raw.session_date),
    start: raw.start_time ?? null,
    end: raw.end_time ?? null,
    topic: raw.topic ?? null,
    counts: readCounts(raw),
  }
}

function listRoster(data) {
  for (const key of ['roster', 'records', 'students', 'items']) {
    if (Array.isArray(data?.[key])) return data[key]
  }
  return []
}

function normaliseStudent(raw) {
  const id = raw?.student_id ?? raw?.id
  if (!id) return null
  const status = String(raw.status ?? '').toLowerCase()
  const student = raw.student && typeof raw.student === 'object' ? raw.student : {}
  return {
    id: String(id),
    name: raw.full_name ?? raw.name ?? student.full_name ?? 'Student',
    reg: raw.registration_number ?? raw.reg_no ?? student.registration_number ?? '',
    status: STATUSES.includes(status) ? status : null,
    note: raw.note ?? '',
  }
}

// Per-student totals. Counts win; if a row only carries a percentage, that percentage is used as is.
function normaliseReportStudent(raw) {
  const id = raw?.student_id ?? raw?.id
  if (!id) return null
  const present = numberOr(raw.present)
  const late = numberOr(raw.late)
  const absent = numberOr(raw.absent)
  const excused = numberOr(raw.excused)
  const haveCounts = present !== null || late !== null || absent !== null
  const attended = haveCounts ? (present ?? 0) + (late ?? 0) : numberOr(raw.attended)
  const counted = haveCounts ? (present ?? 0) + (late ?? 0) + (absent ?? 0) : numberOr(raw.counted_sessions ?? raw.counted)
  const pct = counted > 0 && attended !== null ? (attended / counted) * 100 : numberOr(raw.attendance_pct)
  return {
    id: String(id),
    name: raw.full_name ?? raw.name ?? '',
    reg: raw.registration_number ?? raw.reg_no ?? '',
    present,
    late,
    absent,
    excused,
    attended,
    counted,
    pct,
  }
}

function listReport(data) {
  for (const key of ['students', 'items', 'per_student']) {
    if (Array.isArray(data?.[key])) return data[key]
  }
  return Array.isArray(data) ? data : []
}

function tallyStatuses(list) {
  const counts = { present: 0, absent: 0, late: 0, excused: 0 }
  list.forEach((entry) => {
    if (entry.status) counts[entry.status] += 1
  })
  return counts
}

function csvCell(value) {
  let text = String(value ?? '')
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function buildCsv(students) {
  const lines = [['Student', 'Registration no.', 'Present', 'Late', 'Excused', 'Absent', 'Attended', 'Counted', 'Attendance %'].map(csvCell).join(',')]
  students.forEach((student) => {
    lines.push([student.name, student.reg, student.present, student.late, student.excused, student.absent, student.attended, student.counted, student.pct === null ? '' : trimNumber(student.pct)].map(csvCell).join(','))
  })
  return lines.join('\n')
}

function downloadText(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

const pctText = (value) => (value === null || value === undefined ? '—' : `${trimNumber(value)}%`)

/* ---------- pieces ---------- */

function CreateSessionDrawer({ course, onClose, onCreated }) {
  const topicRef = useRef(null)
  const [topic, setTopic] = useState('')
  const [date, setDate] = useState(() => isoOf(new Date()))
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('11:00')
  const [problem, setProblem] = useState('')

  useEffect(() => {
    topicRef.current?.focus()
  }, [])

  const create = useMutation({
    mutationFn: (body) => api(`/courses/${course.id}/attendance/sessions`, { method: 'POST', body }),
    onSuccess: (created) => onCreated(created),
    onError: (error) => setProblem(errorText(error, 'The session could not be created.')),
  })

  const submit = (event) => {
    event.preventDefault()
    if (!date) return setProblem('Choose the session date.')
    if (!start || !end) return setProblem('Choose a start and end time.')
    if (end <= start) return setProblem('The end time must be after the start time.')
    setProblem('')
    const body = { session_date: date, start_time: start, end_time: end }
    if (topic.trim()) body.topic = topic.trim()
    create.mutate(body)
  }

  return (
    <>
      <div className="slpe-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="slpe-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="slpe-drawer-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <div className="slpe-drawer-head">
          <div className="slpc-inline">
            <span className="slpe-drawer-icon">{renderIcon('event_note', 22)}</span>
            <div>
              <h2 id="slpe-drawer-title" className="slpe-h">
                New attendance session
              </h2>
              <span className="slpe-sub">{course.course_code}</span>
            </div>
          </div>
          <button type="button" className="slpe-close" aria-label="Close" onClick={onClose}>
            {renderIcon('close', 20)}
          </button>
        </div>
        <form className="slpe-form" onSubmit={submit} noValidate>
          <div className="slpe-form-body">
            <div className="slpe-field">
              <label>Assigned course</label>
              <div className="slpe-input is-static">
                <span>
                  {course.course_code}: {course.course_name}
                </span>
              </div>
            </div>
            <div className="slpe-field">
              <label htmlFor="slpe-topic">Lecture session topic (optional)</label>
              <input id="slpe-topic" ref={topicRef} className="slpe-input" type="text" value={topic} maxLength={200} onChange={(event) => setTopic(event.target.value)} placeholder="e.g. Fault tolerance & circuit breakers" />
            </div>
            <div className="slpe-three">
              <div className="slpe-field">
                <label htmlFor="slpe-date">Session date</label>
                <input id="slpe-date" className="slpe-input" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </div>
              <div className="slpe-field">
                <label htmlFor="slpe-start">Starts</label>
                <input id="slpe-start" className="slpe-input" type="time" value={start} onChange={(event) => setStart(event.target.value)} />
              </div>
              <div className="slpe-field">
                <label htmlFor="slpe-end">Ends</label>
                <input id="slpe-end" className="slpe-input" type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
              </div>
            </div>
            <p className="slpe-sub">The roster loads from your enrolled students when you open the session. Nobody is marked until you save a roll-call.</p>
            {problem && (
              <div className="slpc-alert" role="alert">
                {problem}
              </div>
            )}
          </div>
          <div className="slpe-drawer-foot">
            <button type="button" className="slpc-btn slpc-btn-soft" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="slpc-btn slpc-btn-primary" disabled={create.isPending}>
              {create.isPending ? 'Publishing…' : 'Publish session'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

function SessionCard({ session, counts, active, onOpen }) {
  const time = timeRange(session)
  const marked = counts ? counts.present + counts.absent + counts.late + counts.excused : null
  return (
    <li className={`slpe-session ${active ? 'is-active' : ''}`}>
      <div className="slpe-session-top">
        <div style={{ minWidth: 0 }}>
          <h3 className="slpe-session-title">{sessionTitle(session)}</h3>
          <div className="slpe-meta">
            <span>
              {renderIcon('calendar_today', 14)}
              {dayLabel(session)}
            </span>
            {time && (
              <span>
                {renderIcon('schedule', 14)}
                {time}
              </span>
            )}
          </div>
        </div>
        {counts && marked > 0 && (
          <div className="slpe-ratio" aria-label={`${counts.present} of ${marked} present`}>
            <strong>
              {counts.present}/{marked}
            </strong>
            <span>Present</span>
          </div>
        )}
      </div>
      {counts ? (
        active ? (
          <div className="slpe-counts">
            {STATUSES.map((key) => (
              <div key={key} className={`slpe-count is-${key}`}>
                <span>{STATUS_LABELS[key]}</span>
                <strong>{counts[key]}</strong>
              </div>
            ))}
          </div>
        ) : (
          <p className="slpe-line">
            {counts.present} Present • {counts.absent} Absent • {counts.late} Late • {counts.excused} Excused
          </p>
        )
      ) : (
        <p className="slpe-line">Open this session to see who has been marked.</p>
      )}
      <div className="slpe-actions">
        <button type="button" className="slpc-btn slpc-btn-primary" onClick={() => onOpen(session.id)} aria-label={`Mark attendance: ${sessionTitle(session)}`}>
          {renderIcon('how_to_reg', 18)}
          {active ? 'Marking now' : 'Mark attendance'}
        </button>
      </div>
    </li>
  )
}

/* ---------- page ---------- */

export default function LecturerAttendance() {
  useCourseFonts()
  const { courseId: routeCourseId } = useParams()
  const queryClient = useQueryClient()
  const [pickedCourse, setPickedCourse] = useState(routeCourseId || '')
  const [selectedId, setSelectedId] = useState('')
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [studentSearch, setStudentSearch] = useState('')
  const [drafts, setDrafts] = useState({})
  const [drawer, setDrawer] = useState(false)
  const [saved, setSaved] = useState('')
  const [saveError, setSaveError] = useState('')

  const coursesQuery = useQuery({ queryKey: COURSES_KEY, queryFn: fetchCourses })
  const courses = toList(coursesQuery.data)
  const course = courses.find((entry) => entry.id === pickedCourse) ?? courses[0]
  const courseId = course?.id

  const details = useQueries({ queries: courses.map((entry) => ({ queryKey: courseKey(entry.id), queryFn: () => api(`/courses/${entry.id}`) })) })
  const enrolledOf = (id) => {
    const query = details[courses.findIndex((entry) => entry.id === id)]
    return typeof query?.data?.enrolled_count === 'number' ? query.data.enrolled_count : null
  }

  const sessionsQuery = useQuery({
    queryKey: sessionsKey(courseId),
    queryFn: () => api(`/courses/${courseId}/attendance/sessions?page_size=100`),
    enabled: Boolean(courseId),
    retry: false,
  })
  const reportQuery = useQuery({
    queryKey: reportKey(courseId),
    queryFn: () => api(`/courses/${courseId}/reports/attendance`),
    enabled: Boolean(courseId),
    retry: false,
  })

  const sessions = []
  toList(sessionsQuery.data).forEach((raw, index) => {
    const session = normaliseSession(raw, index)
    if (session) sessions.push(session)
  })
  sessions.sort((a, b) => stamp(b).localeCompare(stamp(a)))

  // Marking opens on the latest session that has already happened (or the newest one if none has).
  const todayIso = isoOf(new Date())
  const activeId = sessions.find((session) => session.id === selectedId)?.id ?? (sessions.find((session) => session.date && session.date.iso <= todayIso) ?? sessions[0])?.id
  const activeSession = sessions.find((session) => session.id === activeId)

  const rosterQuery = useQuery({
    queryKey: sessionKey(activeId),
    queryFn: () => api(`/attendance/sessions/${activeId}`),
    enabled: Boolean(activeId),
    retry: false,
  })

  const notReady = [sessionsQuery, reportQuery, rosterQuery].some((query) => query.isError && isNotReady(query.error))
  const sessionsReady = sessionsQuery.isSuccess
  const reportReady = reportQuery.isSuccess
  const reportFailed = reportQuery.isError && !isNotReady(reportQuery.error)

  const reportStudents = []
  listReport(reportQuery.data).forEach((raw) => {
    const student = normaliseReportStudent(raw)
    if (student) reportStudents.push(student)
  })
  const reportById = Object.fromEntries(reportStudents.map((student) => [student.id, student]))
  const withData = reportStudents.filter((student) => student.counted > 0)
  const attendedTotal = withData.reduce((sum, student) => sum + student.attended, 0)
  const countedTotal = withData.reduce((sum, student) => sum + student.counted, 0)
  const overall = reportReady && countedTotal > 0 ? (attendedTotal / countedTotal) * 100 : null
  const atRisk = withData.filter((student) => student.pct !== null && student.pct < ATTENDANCE_MIN).length
  const excusedTotal = reportStudents.reduce((sum, student) => sum + (student.excused ?? 0), 0)
  const hasExcused = reportStudents.some((student) => student.excused !== null)

  const roster = []
  listRoster(rosterQuery.data).forEach((raw) => {
    const student = normaliseStudent(raw)
    if (student) roster.push(student)
  })
  const draft = drafts[activeId] ?? {}
  const merged = roster.map((student) => {
    const edit = draft[student.id]
    return { ...student, status: edit && 'status' in edit ? edit.status : student.status, note: edit && 'note' in edit ? edit.note : student.note }
  })
  const changes = roster.filter((student, index) => merged[index].status !== student.status || merged[index].note !== student.note)
  const changedRecords = merged
    .filter((student, index) => student.status && (student.status !== roster[index].status || student.note !== roster[index].note))
    .map((student) => ({ student_id: student.id, status: student.status, ...(student.note.trim() ? { note: student.note.trim() } : {}) }))
  const loggedCount = merged.filter((student) => student.status).length

  const liveCounts = rosterQuery.isSuccess ? tallyStatuses(roster) : null
  const countsFor = (session) => (session.id === activeId && liveCounts && roster.length > 0 && Object.values(liveCounts).some(Boolean) ? liveCounts : session.counts)

  const needle = search.trim().toLowerCase()
  const visible = sessions
    .filter((session) => !needle || `${session.topic ?? ''}`.toLowerCase().includes(needle))
    .filter((session) => !from || (session.date && session.date.iso >= from))
    .filter((session) => !to || (session.date && session.date.iso <= to))
    .filter((session) => {
      const counts = countsFor(session)
      if (filter === 'absences') return Boolean(counts) && counts.absent > 0
      if (filter === 'unmarked') return Boolean(counts) && counts.present + counts.absent + counts.late + counts.excused === 0
      return true
    })
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageItems = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const upcoming = [...sessions].filter((session) => session.date && session.date.iso > todayIso).sort((a, b) => stamp(a).localeCompare(stamp(b)))[0]
  const latest = sessions[0]

  const studentNeedle = studentSearch.trim().toLowerCase()
  const shownStudents = merged.filter((student) => !studentNeedle || `${student.name} ${student.reg}`.toLowerCase().includes(studentNeedle))

  const setStudent = (studentId, patch) => {
    setSaved('')
    setDrafts((current) => ({ ...current, [activeId]: { ...current[activeId], [studentId]: { ...current[activeId]?.[studentId], ...patch } } }))
  }
  const markAllPresent = () => {
    setSaved('')
    setDrafts((current) => ({ ...current, [activeId]: Object.fromEntries(roster.map((student) => [student.id, { ...current[activeId]?.[student.id], status: 'present' }])) }))
  }
  const resetDraft = () => {
    setSaved('')
    setSaveError('')
    setDrafts((current) => ({ ...current, [activeId]: {} }))
  }

  const save = useMutation({
    mutationFn: (records) => api(`/attendance/sessions/${activeId}/records`, { method: 'POST', body: { records } }),
    onSuccess: async (_result, records) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sessionKey(activeId) }),
        queryClient.invalidateQueries({ queryKey: sessionsKey(courseId) }),
        queryClient.invalidateQueries({ queryKey: reportKey(courseId) }),
      ])
      setDrafts((current) => ({ ...current, [activeId]: {} }))
      setSaveError('')
      setSaved(`Saved ${records.length} ${records.length === 1 ? 'record' : 'records'}.`)
    },
    onError: (error) => {
      setSaved('')
      setSaveError(errorText(error, 'The roll-call could not be saved.'))
    },
  })

  const pickCourse = (id) => {
    setPickedCourse(id)
    setSelectedId('')
    setPage(1)
    setSaved('')
    setSaveError('')
  }
  const openSession = (id) => {
    setSelectedId(id)
    setSaved('')
    setSaveError('')
    document.getElementById('slpe-roster')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
  }
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: sessionsKey(courseId) })
    queryClient.invalidateQueries({ queryKey: reportKey(courseId) })
    queryClient.invalidateQueries({ queryKey: sessionKey(activeId) })
  }
  const onCreated = async (created) => {
    await queryClient.invalidateQueries({ queryKey: sessionsKey(courseId) })
    if (created?.id) setSelectedId(String(created.id))
    setDrawer(false)
    setFilter('all')
    setSearch('')
    setFrom('')
    setTo('')
    setPage(1)
  }

  const heading = (
    <header className="slpe-head">
      <div className="slpe-head-text">
        <h1 className="slpe-title">Attendance Tracker &amp; Class Log</h1>
        <p className="slpc-lead">Schedule lecture sessions, record live roll-call, manage attendance exceptions, and monitor cohort compliance thresholds.</p>
      </div>
      <div className="slpe-head-actions">
        <button type="button" className="slpc-btn slpc-btn-primary" onClick={() => setDrawer(true)} disabled={!course || notReady}>
          {renderIcon('add', 20)}
          Create attendance session
        </button>
        <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => downloadText(`attendance-${course?.course_code ?? 'course'}.csv`, buildCsv(reportStudents), 'text/csv')} disabled={!reportReady || reportStudents.length === 0}>
          {renderIcon('description', 19)}
          Download report
        </button>
      </div>
    </header>
  )

  return (
    <div className="slpc" aria-label="Attendance tracker and class log">
      <style>{COURSE_STYLES}</style>
      <style>{ATTENDANCE_STYLES}</style>

      <div className="slpc-stack slpc-gap-lg">
        <nav className="slpc-trail" aria-label="Breadcrumb">
          <Link to="/lecturer" className="slpc-trail-link">
            {renderIcon('home', 16)}
            Dashboard
          </Link>
          <span className="slpc-trail-sep">{renderIcon('chevron_right', 16)}</span>
          <span className="slpc-trail-current">Attendance Tracker</span>
          {course && (
            <>
              <span className="slpc-trail-sep">{renderIcon('chevron_right', 16)}</span>
              <span className="slpe-crumb-code">
                {course.course_code}: {course.course_name}
              </span>
            </>
          )}
        </nav>

        {heading}

        {coursesQuery.isPending && <Skeleton height={160} label="Loading your courses" />}
        {coursesQuery.isError && <ErrorCard message="Your courses could not be loaded." onRetry={() => coursesQuery.refetch()} />}
        {coursesQuery.isSuccess && courses.length === 0 && <p className="slpc-empty">You are not assigned to any course yet, so there is no attendance to record.</p>}

        {courses.length > 0 && (
          <>
            <div className="slpe-scope" role="group" aria-label="Course">
              {courses.map((entry) => {
                const enrolled = enrolledOf(entry.id)
                return (
                  <button key={entry.id} type="button" className={`slpe-scope-btn ${entry.id === courseId ? 'is-active' : ''}`} aria-pressed={entry.id === courseId} onClick={() => pickCourse(entry.id)}>
                    {entry.id === courseId && <i aria-hidden="true" />}
                    {entry.course_code}: {entry.course_name}
                    {enrolled !== null && <span className="slpe-scope-count">{enrolled} Enrolled</span>}
                  </button>
                )
              })}
            </div>

            {notReady && (
              <PhasePanel icon="how_to_reg" title="Attendance tracking is not switched on yet" phase="Phase 6">
                Creating sessions and recording roll-call will work here as soon as the attendance service goes live. Nothing is shown until the server can answer, so no figure here is ever a guess.
              </PhasePanel>
            )}
            {!notReady && sessionsQuery.isError && <ErrorCard message="Sessions could not be loaded." onRetry={() => sessionsQuery.refetch()} />}

            {!notReady && !sessionsQuery.isError && (
              <>
                {reportFailed && (
                  <div className="slpc-alert" role="alert">
                    The attendance report could not be loaded, so the figures and each student&apos;s standing are hidden.
                    <button type="button" className="slpc-btn slpc-btn-soft" style={{ marginLeft: 8 }} onClick={() => reportQuery.refetch()}>
                      Try again
                    </button>
                  </div>
                )}

                <section className="slpe-cards" aria-label="Attendance summary">
                  <div className="slpc-card slpe-card">
                    <div className="slpe-card-top">
                      <span className="slpe-eyebrow">Overall attendance</span>
                    </div>
                    <div className="slpe-big">
                      <strong aria-label="Overall attendance">{pctText(overall)}</strong>
                    </div>
                    <div className="slpe-foot">
                      <span>{sessionsReady ? `${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'} conducted` : '—'}</span>
                      <strong>{enrolledOf(courseId) !== null ? `${enrolledOf(courseId)} enrolled` : ''}</strong>
                    </div>
                  </div>

                  <div className="slpc-card slpe-card">
                    <div className="slpe-card-top">
                      <span className="slpe-eyebrow">Sessions logged</span>
                    </div>
                    <div className="slpe-big">
                      <strong aria-label="Sessions logged">{sessionsReady ? sessions.length : '—'}</strong>
                    </div>
                    <div className="slpe-foot">
                      <span>{sessionsReady ? (latest ? `Latest: ${dayLabel(latest)}` : 'No sessions yet') : 'Loading…'}</span>
                    </div>
                  </div>

                  <div className="slpc-card slpe-card">
                    <div className="slpe-card-top">
                      <span className="slpe-eyebrow">At-risk students (&lt;{ATTENDANCE_MIN}%)</span>
                      <span className="slpe-chip is-warn">
                        {renderIcon('warning', 13)}
                        Min {ATTENDANCE_MIN}%
                      </span>
                    </div>
                    <div className="slpe-big">
                      <strong className={reportReady && atRisk > 0 ? 'is-warn' : ''} aria-label="At-risk students">
                        {reportReady ? atRisk : '—'}
                      </strong>
                      <span>{atRisk === 1 ? 'Student' : 'Students'}</span>
                    </div>
                    {reportReady && atRisk > 0 ? (
                      <div className="slpe-banner">
                        {renderIcon('priority_high', 16)}
                        Below the {ATTENDANCE_MIN}% minimum
                      </div>
                    ) : (
                      <div className="slpe-foot">
                        <span>{reportReady ? 'Nobody is below the minimum' : 'Waiting for the report'}</span>
                      </div>
                    )}
                  </div>

                  <div className="slpc-card slpe-card">
                    <div className="slpe-card-top">
                      <span className="slpe-eyebrow">Excused records</span>
                      <span className="slpe-chip is-info">Excused</span>
                    </div>
                    <div className="slpe-big">
                      <strong className="is-secondary" aria-label="Excused records">
                        {reportReady && hasExcused ? excusedTotal : '—'}
                      </strong>
                      <span>{excusedTotal === 1 ? 'Excused mark' : 'Excused marks'}</span>
                    </div>
                    <div className="slpe-foot">
                      <span>Left out of the ratio</span>
                      <button type="button" className="slpe-link" onClick={() => document.getElementById('slpe-roster')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })}>
                        Review {renderIcon('arrow_forward', 14)}
                      </button>
                    </div>
                  </div>
                </section>

                <div className="slpe-split">
                  <div className="slpe-col">
                    <section className="slpc-card slpe-panel" aria-label="Lecture attendance sessions">
                      <div className="slpe-panel-head">
                        <div>
                          <h2 className="slpe-h">Lecture attendance sessions</h2>
                          <p className="slpe-sub">Every session recorded for this course</p>
                        </div>
                        <label className="slpe-filter-row">
                          Filter:
                          <select
                            className="slpc-select"
                            value={filter}
                            onChange={(event) => {
                              setFilter(event.target.value)
                              setPage(1)
                            }}
                            aria-label="Filter sessions"
                          >
                            {FILTERS.map((entry) => (
                              <option key={entry.id} value={entry.id}>
                                {entry.id === 'all' && sessionsReady ? `${entry.label} (${sessions.length})` : entry.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div className="slpe-subbar">
                        <label className="slpc-search">
                          {renderIcon('search', 18)}
                          <input
                            type="search"
                            value={search}
                            onChange={(event) => {
                              setSearch(event.target.value)
                              setPage(1)
                            }}
                            placeholder="Search topic or session keyword..."
                            aria-label="Search sessions"
                          />
                        </label>
                        <div className="slpe-dates">
                          <span>Date range:</span>
                          <input
                            type="date"
                            className="slpe-date-input"
                            value={from}
                            max={to || undefined}
                            onChange={(event) => {
                              setFrom(event.target.value)
                              setPage(1)
                            }}
                            aria-label="From date"
                          />
                          <span aria-hidden="true">–</span>
                          <input
                            type="date"
                            className="slpe-date-input"
                            value={to}
                            min={from || undefined}
                            onChange={(event) => {
                              setTo(event.target.value)
                              setPage(1)
                            }}
                            aria-label="To date"
                          />
                        </div>
                      </div>

                      {sessionsQuery.isPending && <Skeleton height={140} label="Loading sessions" />}
                      {sessionsReady && sessions.length === 0 && (
                        <p className="slpc-empty">
                          No attendance sessions yet. Create the first one, then record roll-call from the roster.
                        </p>
                      )}
                      {sessionsReady && sessions.length > 0 && visible.length === 0 && <p className="slpc-empty">No sessions match these filters.</p>}
                      {visible.length > 0 && (
                        <ul className="slpe-sessions" aria-label="Session list">
                          {pageItems.map((session) => (
                            <SessionCard key={session.id} session={session} counts={countsFor(session)} active={session.id === activeId} onOpen={openSession} />
                          ))}
                        </ul>
                      )}
                      {visible.length > PAGE_SIZE && (
                        <div className="slpe-pager">
                          <span>
                            Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, visible.length)} of {visible.length} sessions
                          </span>
                          <span className="slpc-inline">
                            <button type="button" className="slpc-btn slpc-btn-soft" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
                              Previous
                            </button>
                            <button type="button" className="slpc-btn slpc-btn-soft" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>
                              Next
                            </button>
                          </span>
                        </div>
                      )}
                    </section>

                    {upcoming && (
                      <section className="slpc-card slpe-upcoming" aria-label="Upcoming session">
                        <span className="slpe-upcoming-icon">{renderIcon('event_available', 26)}</span>
                        <div className="slpe-upcoming-main">
                          <p className="slpe-h">Upcoming session scheduled</p>
                          <p className="slpe-sub">
                            {dayLabel(upcoming)}
                            {timeRange(upcoming) ? ` • ${timeRange(upcoming)}` : ''}
                            {upcoming.topic ? ` • ${upcoming.topic}` : ''}
                          </p>
                        </div>
                        <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => openSession(upcoming.id)}>
                          Open session
                        </button>
                      </section>
                    )}
                  </div>

                  <div className="slpe-col" id="slpe-roster">
                    <section className="slpc-card slpe-panel" aria-label="Live session marking">
                      <div className="slpe-panel-head">
                        <div>
                          <h2 className="slpe-h">
                            Live session marking
                            {activeSession && <i className="slpe-live" aria-hidden="true" />}
                          </h2>
                          <p className="slpe-sub">{activeSession ? `${sessionTitle(activeSession)} • ${dayLabel(activeSession)}` : 'Create a session to start marking'}</p>
                        </div>
                        {activeSession && rosterQuery.isSuccess && (
                          <span className="slpe-chip" aria-label="Students logged">
                            {loggedCount} / {roster.length} Logged
                          </span>
                        )}
                      </div>

                      {!activeSession && sessionsReady && <p className="slpc-empty">There is no session to mark yet.</p>}
                      {activeSession && rosterQuery.isPending && <Skeleton height={160} label="Loading the roster" />}
                      {activeSession && rosterQuery.isError && !notReady && <ErrorCard message="The roster could not be loaded." onRetry={() => rosterQuery.refetch()} />}

                      {activeSession && rosterQuery.isSuccess && (
                        <>
                          <div className="slpe-bulk">
                            <div className="slpe-bulk-row">
                              <span className="slpe-eyebrow">Bulk actions</span>
                              <span className="slpc-inline">
                                <button type="button" className="slpc-btn slpc-btn-soft" onClick={markAllPresent} disabled={roster.length === 0}>
                                  {renderIcon('done_all', 15)}
                                  Mark all present
                                </button>
                                <button type="button" className="slpc-btn slpc-btn-soft" onClick={resetDraft} disabled={changes.length === 0}>
                                  Reset
                                </button>
                              </span>
                            </div>
                            <label className="slpc-search">
                              {renderIcon('search', 16)}
                              <input type="search" value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="Search student by name or Reg No..." aria-label="Search students" />
                            </label>
                          </div>

                          {roster.length === 0 && <p className="slpc-empty">No students are enrolled in this course yet.</p>}
                          {roster.length > 0 && shownStudents.length === 0 && <p className="slpc-empty">No student matches your search.</p>}
                          {shownStudents.length > 0 && (
                            <ul className="slpe-roster" aria-label="Roll-call">
                              {shownStudents.map((student, index) => {
                                const standing = reportById[student.id]
                                const risk = Boolean(standing) && standing.pct !== null && standing.counted > 0 && standing.pct < ATTENDANCE_MIN
                                return (
                                  <li key={student.id} className={`slpe-student ${risk ? 'is-risk' : ''}`}>
                                    <div className="slpe-student-top">
                                      <div className="slpe-who">
                                        <span className={`slpe-avatar is-t${index % 3}`} aria-hidden="true">
                                          {initials(student.name)}
                                        </span>
                                        <div style={{ minWidth: 0 }}>
                                          <h3 className="slpe-name">
                                            {student.name}
                                            {risk && <span title="Below the attendance minimum">{renderIcon('warning', 16)}</span>}
                                          </h3>
                                          {student.reg && <span className="slpe-reg">#{student.reg}</span>}
                                        </div>
                                      </div>
                                      <div className={`slpe-comp ${risk ? 'is-risk' : ''}`}>
                                        <strong>{standing && standing.pct !== null ? (standing.counted > 0 ? `${standing.attended}/${standing.counted} (${pctText(standing.pct)})` : pctText(standing.pct)) : '—'}</strong>
                                        <span>{risk ? `<${ATTENDANCE_MIN}% minimum` : standing && standing.pct !== null ? 'Compliance OK' : 'No record yet'}</span>
                                      </div>
                                    </div>
                                    <div className="slpe-mark-row">
                                      <div className="slpe-seg" role="group" aria-label={`Status for ${student.name}`}>
                                        {STATUSES.map((key) => (
                                          <button key={key} type="button" className={student.status === key ? `is-${key}` : ''} aria-pressed={student.status === key} onClick={() => setStudent(student.id, { status: key })}>
                                            {STATUS_LABELS[key]}
                                          </button>
                                        ))}
                                      </div>
                                      <input className="slpe-note" type="text" value={student.note} maxLength={200} placeholder="Note..." aria-label={`Note for ${student.name}`} onChange={(event) => setStudent(student.id, { note: event.target.value })} />
                                    </div>
                                  </li>
                                )
                              })}
                            </ul>
                          )}

                          {saveError && (
                            <div className="slpc-alert" role="alert">
                              {saveError}
                            </div>
                          )}
                          {saved && (
                            <div className="slpe-ok" role="status">
                              {saved}
                            </div>
                          )}
                          <button type="button" className="slpc-btn slpc-btn-primary slpe-save" disabled={save.isPending || changedRecords.length === 0} onClick={() => save.mutate(changedRecords)}>
                            {renderIcon('verified_user', 19)}
                            {save.isPending ? 'Saving…' : changedRecords.length > 0 ? `Save roll-call (${changedRecords.length})` : 'Save roll-call'}
                          </button>
                          <p className="slpe-trail">
                            {renderIcon('lock', 14)}
                            <span>Changes to a saved mark are recorded in the audit trail.</span>
                          </p>
                        </>
                      )}
                    </section>
                    <button type="button" className="slpc-btn slpc-btn-soft" onClick={refresh}>
                      {renderIcon('sync', 18)}
                      Refresh from server
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {drawer && course && (
        <CreateSessionDrawer
          course={course}
          onClose={() => setDrawer(false)}
          onCreated={onCreated}
        />
      )}
    </div>
  )
}
