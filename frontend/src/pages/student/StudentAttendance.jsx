import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/apiClient.js'
import {
  COURSES_KEY,
  COURSE_STYLES,
  ErrorCard,
  PhasePanel,
  Skeleton,
  fetchCourses,
  renderIcon,
  trimNumber,
  useCourseFonts,
} from '../../components/courseKit.jsx'
import { toList } from '../../utils/format.js'

/*
 * Smart Lecture Portal: student Attendance Tracker & Session Ledger
 * Place at: src/pages/student/StudentAttendance.jsx
 *
 * Routes (see routes.jsx):
 *   /student/attendance                      attendance from every course you are enrolled in
 *   /student/courses/:courseId/attendance    the same page with that course preselected
 *
 * - Renders inside AppShell, which already draws the sidebar and top bar.
 * - Built on the contract in docs/API.md (Attendance) and the attendance tables in docs/ERD.md.
 *   Endpoints used:
 *     GET /courses                            enrolled courses
 *     GET /courses/{id}/attendance/me         my history for one course (read only)
 * - A history row is { id, session_date, start_time, end_time, topic, status, note?, room? }.
 *   status is one of present | late | excused | absent. The row may also nest the session fields
 *   under `session`. Times are shown exactly as stored.
 * - The attendance backend arrives in Phase 6. Until the server answers GET .../attendance/me the
 *   page says so plainly and shows no figures. It never invents sessions, lecturers, rooms or
 *   "verified" claims.
 * - Ratio policy follows db/migrations/0002_views.sql: attended = present + late, counted =
 *   present + late + absent, excused sessions are not counted. Every figure is worked out from the
 *   rows the server returned, so the totals always reconcile with the list below.
 * - ATTENDANCE_MIN is the portal's reference threshold (also used on the dashboard). The API has no
 *   per-course threshold, so change this one number if the institution's policy differs.
 * - The API has no lecturer names, session types, week numbers, check-in times, hashes or signed PDF
 *   reports, so none are drawn. "Download my record" builds a CSV in the browser from the rows
 *   currently listed.
 */

const NOT_READY = [404, 405, 501]
const ATTENDANCE_MIN = 75
const PAGE_SIZE = 8
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const STATUSES = ['present', 'late', 'excused', 'absent']
const STATUS_META = {
  present: { label: 'Present', icon: 'check_circle' },
  late: { label: 'Late', icon: 'schedule' },
  excused: { label: 'Excused', icon: 'event_available' },
  absent: { label: 'Absent', icon: 'cancel' },
}
const SORTS = [
  { id: 'newest', label: 'Date (newest first)' },
  { id: 'oldest', label: 'Date (oldest first)' },
  { id: 'course', label: 'Course code' },
]

const attendanceKey = (courseId) => ['course-attendance', courseId]
const attendancePath = (courseId) => `/courses/${courseId}/attendance/me?page_size=100`
const isNotReady = (error) => NOT_READY.includes(error?.status)

const ATTENDANCE_STYLES = `
.slpd-head { display: flex; flex-direction: column; gap: 1rem; }
.slpd-title { font-size: 26px; line-height: 34px; font-weight: 800; letter-spacing: -0.02em; overflow-wrap: anywhere; }
.slpd-head-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.slpd-head-text { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
.slpd-head-actions .slpc-btn { height: 40px; padding: 0 18px; }
.slpd-scope { display: flex; gap: 0.5rem; overflow-x: auto; padding-bottom: 4px; }
.slpd-scope-btn { display: inline-flex; align-items: center; gap: 0.375rem; flex: 0 0 auto; padding: 7px 16px; border: 0; border-radius: 999px; background: var(--surface-low); color: var(--on-surface); font-size: 12px; line-height: 18px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.slpd-scope-btn:hover { background: var(--surface-mid); }
.slpd-scope-btn.is-active { background: var(--primary); color: var(--on-primary); box-shadow: 0 1px 2px rgba(30, 26, 35, 0.2); }
.slpd-scope-btn .slpd-code { color: var(--primary); }
.slpd-scope-btn.is-active .slpd-code { color: inherit; }
.slpd-code { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-weight: 700; }
.slpd-scope-count { padding: 0 7px; border-radius: 999px; background: var(--surface-high); color: var(--on-surface-variant); font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 18px; font-weight: 600; }
.slpd-scope-btn.is-active .slpd-scope-count { background: rgba(255, 255, 255, 0.22); color: var(--on-primary); }
.slpd-cards { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; }
.slpd-card { display: flex; flex-direction: column; gap: 1rem; min-width: 0; padding: 1.25rem; }
.slpd-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; }
.slpd-eyebrow { display: block; font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpd-h { margin-top: 2px; font-size: 18px; line-height: 26px; font-weight: 700; letter-spacing: -0.01em; }
.slpd-icon { width: 36px; height: 36px; border-radius: 12px; background: var(--surface-low); color: var(--primary); display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.slpd-gauge { display: flex; align-items: center; gap: 1rem; }
.slpd-ring { position: relative; width: 88px; height: 88px; flex: 0 0 auto; }
.slpd-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); display: block; }
.slpd-ring-track { stroke: var(--surface-high); }
.slpd-ring-fill { stroke: var(--primary); stroke-linecap: round; transition: stroke-dasharray 0.5s; }
.slpd-ring-fill.is-low { stroke: var(--tertiary); }
.slpd-ring-text { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1; }
.slpd-ring-text strong { font-size: 20px; font-weight: 800; letter-spacing: -0.02em; }
.slpd-ring-text span { margin-top: 2px; font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 10px; color: var(--on-surface-variant); }
.slpd-gauge-side { display: flex; flex-direction: column; align-items: flex-start; gap: 0.375rem; min-width: 0; }
.slpd-standing { display: inline-flex; align-items: center; gap: 0.375rem; padding: 4px 10px; border-radius: 999px; background: var(--surface-mid); font-size: 12px; line-height: 16px; font-weight: 700; }
.slpd-standing i { width: 8px; height: 8px; border-radius: 999px; background: var(--primary); }
.slpd-standing.is-ok i { background: var(--ok); }
.slpd-standing.is-low { background: var(--warn-bg); color: var(--warn); }
.slpd-standing.is-low i { background: var(--warn); }
.slpd-mono { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; }
.slpd-small { font-size: 12px; line-height: 18px; color: var(--on-surface-variant); overflow-wrap: anywhere; }
.slpd-bar { position: relative; height: 6px; border-radius: 999px; background: var(--surface-high); overflow: hidden; }
.slpd-bar > span { display: block; height: 100%; border-radius: 999px; background: var(--primary); transition: width 0.4s; }
.slpd-bar.is-ok > span { background: var(--ok); }
.slpd-bar.is-low > span { background: var(--tertiary); }
.slpd-tallies { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem; }
.slpd-tally { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.625rem 0.75rem; border-radius: 12px; background: var(--surface-low); min-width: 0; }
.slpd-tally-name { display: inline-flex; align-items: center; gap: 0.5rem; font-size: 12px; line-height: 16px; font-weight: 700; min-width: 0; }
.slpd-tally strong { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 20px; line-height: 26px; font-weight: 700; }
.slpd-dot { width: 10px; height: 10px; border-radius: 999px; flex: 0 0 auto; background: var(--outline); }
.slpd-dot.is-present { background: #2a7f62; }
.slpd-dot.is-late { background: #d97706; }
.slpd-dot.is-excused { background: #2563eb; }
.slpd-dot.is-absent { background: var(--error); }
.slpd-formula { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.25rem 0.75rem; font-size: 12px; line-height: 18px; color: var(--on-surface-variant); }
.slpd-formula strong { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; color: var(--on-surface); }
.slpd-pass { padding: 4px 10px; border-radius: 999px; background: var(--surface-mid); font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 14px; font-weight: 700; white-space: nowrap; }
.slpd-units { display: flex; flex-direction: column; gap: 0.75rem; margin: 0; padding: 0; list-style: none; }
.slpd-unit-row { display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; margin-bottom: 4px; font-size: 12px; line-height: 16px; font-weight: 700; }
.slpd-unit-row span:first-child { min-width: 0; overflow-wrap: anywhere; }
.slpd-unit-row span:last-child { flex: 0 0 auto; font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; color: var(--on-surface-variant); }
.slpd-tick { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--on-surface); opacity: 0.35; }
.slpd-verdict { display: flex; align-items: center; gap: 0.375rem; font-size: 12px; line-height: 16px; font-weight: 700; color: var(--ok); }
.slpd-verdict.is-low { color: var(--warn); }
.slpd-verdict.is-quiet { color: var(--on-surface-variant); }
.slpd-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.slpd-main { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.slpd-toolbar { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.75rem; background: var(--surface-low); }
.slpd-tools { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.5rem; }
.slpd-tools .slpc-search { height: 40px; border-radius: 12px; background: var(--surface-lowest); }
.slpd-tools .slpc-select { height: 40px; border-radius: 12px; background: var(--surface-lowest); width: 100%; min-width: 0; }
.slpd-filters { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.slpd-filter { display: inline-flex; align-items: center; gap: 0.375rem; padding: 6px 12px; border: 0; border-radius: 999px; background: var(--surface-lowest); color: var(--on-surface); font-size: 12px; line-height: 16px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.slpd-filter:hover { background: var(--surface-high); }
.slpd-filter.is-active { background: var(--secondary); color: #fff; box-shadow: 0 1px 2px rgba(30, 26, 35, 0.2); }
.slpd-filter .slpd-dot { width: 8px; height: 8px; }
.slpd-filter em { font-style: normal; padding: 0 6px; border-radius: 999px; background: var(--surface-mid); color: var(--on-surface-variant); font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; }
.slpd-filter.is-active em { background: rgba(255, 255, 255, 0.22); color: #fff; }
.slpd-list { display: flex; flex-direction: column; gap: 0.75rem; margin: 0; padding: 0; list-style: none; }
.slpd-row { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 0.75rem 1rem; padding: 1rem; min-width: 0; }
.slpd-row.is-selected { box-shadow: 0 0 0 2px var(--primary-container), 0 4px 12px rgba(30, 26, 35, 0.1); }
.slpd-date { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 52px; height: 56px; flex: 0 0 auto; border-radius: 12px; background: var(--surface-mid); }
.slpd-date span { font-size: 10px; line-height: 12px; font-weight: 700; letter-spacing: 0.08em; color: var(--primary); }
.slpd-date strong { font-size: 20px; line-height: 24px; font-weight: 800; }
.slpd-row-main { display: flex; flex-direction: column; gap: 0.375rem; flex: 1 1 200px; min-width: 0; }
.slpd-row-course { display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem; font-size: 11px; line-height: 16px; font-weight: 700; color: var(--on-surface-variant); }
.slpd-row-course .slpd-code { color: var(--primary); }
.slpd-row-title { font-size: 16px; line-height: 24px; font-weight: 700; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.slpd-meta { display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; font-size: 12px; line-height: 18px; color: var(--on-surface-variant); }
.slpd-meta span { display: inline-flex; align-items: center; gap: 0.25rem; }
.slpd-row-side { display: flex; align-items: center; gap: 0.5rem; flex: 0 0 auto; margin-left: auto; }
.slpd-status { display: inline-flex; align-items: center; gap: 0.25rem; padding: 5px 12px; border-radius: 999px; font-size: 11px; line-height: 14px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; background: var(--surface-mid); color: var(--on-surface-variant); white-space: nowrap; }
.slpd-status.is-present { background: var(--ok-bg); color: var(--ok); }
.slpd-status.is-late { background: var(--warn-bg); color: var(--warn); }
.slpd-status.is-excused { background: var(--info-bg); color: var(--info); }
.slpd-status.is-absent { background: var(--error-container); color: var(--on-error-container); }
.slpd-open { width: 36px; height: 36px; border: 0; border-radius: 999px; background: var(--surface-lowest); color: var(--on-surface-variant); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 1px 2px rgba(30, 26, 35, 0.12); }
.slpd-open:hover { background: var(--surface-high); color: var(--on-surface); }
.slpd-pager { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; font-size: 12px; color: var(--on-surface-variant); }
.slpd-side { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.slpd-facts { display: flex; flex-direction: column; gap: 0.5rem; margin: 0; padding: 0; list-style: none; }
.slpd-fact { display: flex; align-items: flex-start; gap: 0.625rem; padding: 0.625rem 0.75rem; border-radius: 12px; background: var(--surface-low); font-size: 13px; line-height: 20px; min-width: 0; }
.slpd-fact .material-symbols-outlined { color: var(--primary); margin-top: 1px; }
.slpd-fact div { display: flex; flex-direction: column; min-width: 0; overflow-wrap: anywhere; }
.slpd-fact small { font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpd-rules { display: flex; flex-direction: column; gap: 0.5rem; margin: 0; padding: 0; list-style: none; font-size: 13px; line-height: 20px; color: var(--on-surface-variant); }
.slpd-rules li { display: flex; align-items: flex-start; gap: 0.5rem; }
.slpd-rules .material-symbols-outlined { color: var(--primary); margin-top: 1px; }
@media (min-width: 640px) {
  .slpd-tools { grid-template-columns: minmax(0, 1fr) auto; }
  .slpd-tools .slpc-select { width: 220px; }
}
@media (min-width: 768px) {
  .slpd-head { flex-direction: row; align-items: flex-end; justify-content: space-between; }
  .slpd-head-text { flex: 1 1 0; }
  .slpd-head-actions { flex: 0 0 auto; flex-wrap: nowrap; }
  .slpd-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .slpd-cards > .slpd-wide { grid-column: 1 / -1; }
}
@media (min-width: 1024px) {
  .slpd-title { font-size: 32px; line-height: 40px; }
}
@media (min-width: 1280px) {
  .slpd-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .slpd-cards > .slpd-wide { grid-column: auto; }
  .slpd-split { grid-template-columns: minmax(0, 2fr) minmax(300px, 1fr); }
  .slpd-sticky { position: sticky; top: 5rem; }
}
@media (max-width: 479px) {
  .slpd-row-side { flex: 1 1 100%; justify-content: space-between; margin-left: 0; }
}
`

/* ---------- helpers ---------- */

const pad = (value) => String(value).padStart(2, '0')

function parseDay(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(text ?? ''))
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), iso: `${match[1]}-${match[2]}-${match[3]}` } : null
}

const clock = (value) => (/^\d{2}:\d{2}/.test(String(value ?? '')) ? String(value).slice(0, 5) : '')
const timeRange = (session) => [clock(session.start), clock(session.end)].filter(Boolean).join(' - ')
const dayLabel = (session) => (session.date ? `${session.date.day} ${MONTHS[session.date.month - 1]?.charAt(0)}${MONTHS[session.date.month - 1]?.slice(1).toLowerCase()} ${session.date.year}` : 'Date not recorded')
const sessionTitle = (session) => session.topic || 'Class session'

// Accepts a bare array or { history | records | sessions | items }, with the session fields either
// on the row or nested under `session`. Rows without a known status cannot be counted, so they are skipped.
function listRows(data) {
  if (Array.isArray(data)) return data
  for (const key of ['history', 'records', 'sessions', 'items']) {
    if (Array.isArray(data?.[key])) return data[key]
  }
  return toList(data)
}

function normalise(raw, course, index) {
  const status = String(raw?.status ?? '').toLowerCase()
  if (!STATUSES.includes(status)) return null
  const nested = raw?.session && typeof raw.session === 'object' ? raw.session : {}
  const pick = (key) => raw?.[key] ?? nested[key] ?? null
  return {
    key: `${course.id}:${raw?.id ?? raw?.session_id ?? nested.id ?? index}`,
    courseId: course.id,
    courseCode: course.course_code,
    courseName: course.course_name,
    date: parseDay(pick('session_date')),
    start: pick('start_time'),
    end: pick('end_time'),
    topic: pick('topic'),
    room: pick('room'),
    note: raw?.note ?? null,
    status,
  }
}

// Same policy as v_student_attendance_summary: excused sessions are not counted.
function tally(list) {
  const counts = { present: 0, late: 0, excused: 0, absent: 0 }
  list.forEach((session) => {
    counts[session.status] += 1
  })
  const counted = counts.present + counts.late + counts.absent
  const attended = counts.present + counts.late
  return { ...counts, counted, attended, pct: counted > 0 ? (attended / counted) * 100 : null }
}

const stamp = (session) => (session.date ? session.date.iso : '') + clock(session.start)

function sortSessions(list, sort) {
  const copy = [...list]
  if (sort === 'oldest') return copy.sort((a, b) => stamp(a).localeCompare(stamp(b)))
  if (sort === 'course') return copy.sort((a, b) => a.courseCode.localeCompare(b.courseCode) || stamp(b).localeCompare(stamp(a)))
  return copy.sort((a, b) => stamp(b).localeCompare(stamp(a)))
}

function csvCell(value) {
  let text = String(value ?? '')
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function buildCsv(list) {
  const lines = [['Date', 'Start', 'End', 'Course', 'Course name', 'Topic', 'Room', 'Status', 'Note'].map(csvCell).join(',')]
  list.forEach((session) => {
    lines.push([session.date?.iso ?? '', clock(session.start), clock(session.end), session.courseCode, session.courseName, session.topic, session.room, STATUS_META[session.status].label, session.note].map(csvCell).join(','))
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

const pctText = (value) => (value === null ? '—' : `${trimNumber(value)}%`)

/* ---------- pieces ---------- */

function StatusBadge({ status }) {
  const meta = STATUS_META[status]
  return (
    <span className={`slpd-status is-${status}`}>
      {renderIcon(meta.icon, 14)}
      {meta.label}
    </span>
  )
}

function SessionRow({ session, selected, onOpen }) {
  const time = timeRange(session)
  return (
    <li className={`slpc-card slpd-row ${selected ? 'is-selected' : ''}`}>
      <div className="slpd-date" aria-hidden="true">
        <span>{session.date ? MONTHS[session.date.month - 1] : '—'}</span>
        <strong>{session.date ? pad(session.date.day) : '—'}</strong>
      </div>
      <div className="slpd-row-main">
        <div className="slpd-row-course">
          <span className="slpd-code">{session.courseCode}</span>
          <span aria-hidden="true">•</span>
          <span>{session.courseName}</span>
        </div>
        <h3 className="slpd-row-title">{sessionTitle(session)}</h3>
        <div className="slpd-meta">
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
          {session.room && (
            <span>
              {renderIcon('location_on', 14)}
              {session.room}
            </span>
          )}
        </div>
      </div>
      <div className="slpd-row-side">
        <StatusBadge status={session.status} />
        <button type="button" className="slpd-open" aria-label={`View details: ${sessionTitle(session)}`} onClick={() => onOpen(session.key)}>
          {renderIcon('chevron_right', 20)}
        </button>
      </div>
    </li>
  )
}

function Inspector({ session }) {
  if (!session) {
    return <p className="slpc-empty">Select a session to see its details.</p>
  }
  const time = timeRange(session)
  return (
    <div className="slpc-stack">
      <div className="slpc-inline" style={{ flexWrap: 'wrap' }}>
        <span className="slpd-pass">{session.courseCode}</span>
        <StatusBadge status={session.status} />
      </div>
      <h3 className="slpd-h">{sessionTitle(session)}</h3>
      <ul className="slpd-facts">
        <li className="slpd-fact">
          {renderIcon('school', 18)}
          <div>
            <small>Course</small>
            <span>{session.courseName}</span>
          </div>
        </li>
        <li className="slpd-fact">
          {renderIcon('calendar_today', 18)}
          <div>
            <small>Date{time ? ' & time' : ''}</small>
            <span>{time ? `${dayLabel(session)} · ${time}` : dayLabel(session)}</span>
          </div>
        </li>
        {session.room && (
          <li className="slpd-fact">
            {renderIcon('location_on', 18)}
            <div>
              <small>Room</small>
              <span>{session.room}</span>
            </div>
          </li>
        )}
        {session.note && (
          <li className="slpd-fact">
            {renderIcon('sticky_note_2', 18)}
            <div>
              <small>Lecturer note</small>
              <span>{session.note}</span>
            </div>
          </li>
        )}
      </ul>
    </div>
  )
}

/* ---------- page ---------- */

export default function StudentAttendance() {
  useCourseFonts()
  const { courseId: routeCourseId } = useParams()
  const queryClient = useQueryClient()
  const [scope, setScope] = useState(routeCourseId || 'all')
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(1)
  const [selectedKey, setSelectedKey] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const coursesQuery = useQuery({ queryKey: COURSES_KEY, queryFn: fetchCourses })
  const courses = toList(coursesQuery.data)

  const lists = useQueries({
    queries: courses.map((course) => ({
      queryKey: attendanceKey(course.id),
      queryFn: () => api(attendancePath(course.id)),
      retry: false,
    })),
  })

  const notReady = lists.some((query) => query.isError && isNotReady(query.error))
  const failed = courses.filter((_, index) => lists[index]?.isError && !isNotReady(lists[index].error))
  const anyPending = lists.some((query) => query.isPending)
  const allLoaded = coursesQuery.isSuccess && courses.length > 0 && !anyPending && !notReady && failed.length === 0

  const sessions = []
  courses.forEach((course, index) => {
    listRows(lists[index]?.data).forEach((raw, rowIndex) => {
      const session = normalise(raw, course, rowIndex)
      if (session) sessions.push(session)
    })
  })

  const scoped = sessions.filter((session) => scope === 'all' || session.courseId === scope)
  const scopedCourses = courses.filter((course) => scope === 'all' || course.id === scope)
  const total = tally(scoped)
  const perCourse = scopedCourses.map((course) => ({ course, ...tally(sessions.filter((session) => session.courseId === course.id)) }))
  const withData = perCourse.filter((entry) => entry.counted > 0)
  const passing = withData.filter((entry) => entry.pct >= ATTENDANCE_MIN)
  const below = withData.length - passing.length

  const needle = search.trim().toLowerCase()
  const visible = sortSessions(
    scoped
      .filter((session) => status === 'all' || session.status === status)
      .filter((session) => !needle || `${session.topic ?? ''} ${session.room ?? ''} ${session.courseCode} ${session.courseName}`.toLowerCase().includes(needle)),
    sort,
  )
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageItems = visible.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const selected = sessions.find((session) => session.key === selectedKey) ?? visible[0]

  const standing = !allLoaded || total.pct === null ? null : total.pct >= ATTENDANCE_MIN ? 'ok' : 'low'
  const ringPct = allLoaded && total.pct !== null ? Math.min(100, total.pct) : 0

  const pickScope = (value) => {
    setScope(value)
    setPage(1)
  }
  const pickStatus = (value) => {
    setStatus(value)
    setPage(1)
  }
  const openSession = (key) => {
    setSelectedKey(key)
    document.getElementById('slpd-inspector')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
  }
  const refresh = async () => {
    setRefreshing(true)
    try {
      await Promise.all([queryClient.invalidateQueries({ queryKey: COURSES_KEY }), ...courses.map((course) => queryClient.invalidateQueries({ queryKey: attendanceKey(course.id) }))])
    } finally {
      setRefreshing(false)
    }
  }

  const scopeCourse = courses.find((course) => course.id === scope)
  const exportName = `attendance-${scopeCourse ? scopeCourse.course_code : 'all-courses'}`

  return (
    <div className="slpc" aria-label="Attendance tracker">
      <style>{COURSE_STYLES}</style>
      <style>{ATTENDANCE_STYLES}</style>

      <div className="slpc-stack slpc-gap-lg">
        <nav className="slpc-trail" aria-label="Breadcrumb">
          <Link to="/student" className="slpc-trail-link">
            {renderIcon('home', 16)}
            Dashboard
          </Link>
          <span className="slpc-trail-sep">{renderIcon('chevron_right', 16)}</span>
          <span className="slpc-trail-current">Attendance Tracker</span>
        </nav>

        <header className="slpd-head">
          <div className="slpd-head-text">
            <h1 className="slpd-title">Attendance Tracker &amp; Session Ledger</h1>
            <p className="slpc-lead">Review your attendance history, calculated attendance ratios and session records across your enrolled courses.</p>
          </div>
          <div className="slpd-head-actions">
            <button type="button" className="slpc-btn slpc-btn-soft" onClick={refresh} disabled={refreshing}>
              {renderIcon('sync', 18)}
              {refreshing ? 'Refreshing…' : 'Refresh ledger'}
            </button>
            <button type="button" className="slpc-btn slpc-btn-primary" onClick={() => downloadText(`${exportName}.csv`, buildCsv(visible), 'text/csv')} disabled={!allLoaded || visible.length === 0}>
              {renderIcon('download', 18)}
              Download my record (CSV)
            </button>
          </div>
        </header>

        {coursesQuery.isPending && <Skeleton height={160} label="Loading your courses" />}
        {coursesQuery.isError && <ErrorCard message="Your courses could not be loaded." onRetry={() => coursesQuery.refetch()} />}
        {coursesQuery.isSuccess && courses.length === 0 && <p className="slpc-empty">You are not enrolled in any course yet, so there is no attendance to show.</p>}

        {courses.length > 0 && (
          <>
            <div className="slpd-scope" role="group" aria-label="Course scope">
              <button type="button" className={`slpd-scope-btn ${scope === 'all' ? 'is-active' : ''}`} onClick={() => pickScope('all')} aria-pressed={scope === 'all'}>
                All enrolled courses
                <span className="slpd-scope-count">{allLoaded ? `${courses.length} ${courses.length === 1 ? 'course' : 'courses'} • ${sessions.length} sessions` : courses.length}</span>
              </button>
              {courses.map((course) => (
                <button key={course.id} type="button" className={`slpd-scope-btn ${scope === course.id ? 'is-active' : ''}`} onClick={() => pickScope(course.id)} aria-pressed={scope === course.id}>
                  <span className="slpd-code">{course.course_code}</span>
                  {course.course_name}
                  {allLoaded && <span className="slpd-scope-count">{sessions.filter((session) => session.courseId === course.id).length}</span>}
                </button>
              ))}
            </div>

            {notReady && (
              <PhasePanel icon="how_to_reg" title="Attendance tracking is not switched on yet" phase="Phase 6">
                Your attendance history will appear here as soon as your lecturers start recording sessions. Nothing is shown until the server can answer, so no figure here is ever a guess.
              </PhasePanel>
            )}
            {failed.length > 0 && (
              <div className="slpc-alert" role="alert">
                Attendance could not be loaded for {failed.map((course) => course.course_code).join(', ')}. Figures are hidden until every course loads.
                <button type="button" className="slpc-btn slpc-btn-soft" style={{ marginLeft: 8 }} onClick={refresh}>
                  Try again
                </button>
              </div>
            )}

            {!notReady && (
              <>
                <section className="slpd-cards" aria-label="Attendance summary">
                  <div className="slpc-card slpd-card">
                    <div className="slpd-card-top">
                      <div>
                        <span className="slpd-eyebrow">Overall ratio</span>
                        <h2 className="slpd-h">Cumulative attendance</h2>
                      </div>
                      <span className="slpd-icon">{renderIcon('percent', 20)}</span>
                    </div>
                    <div className="slpd-gauge">
                      <div className="slpd-ring" role="img" aria-label={allLoaded && total.pct !== null ? `${trimNumber(total.pct)} percent attendance` : 'Attendance ratio not available'}>
                        <svg viewBox="0 0 36 36" aria-hidden="true">
                          <circle cx="18" cy="18" r="15.9155" fill="none" strokeWidth="3.5" className="slpd-ring-track" />
                          <circle cx="18" cy="18" r="15.9155" fill="none" strokeWidth="3.5" className={`slpd-ring-fill ${standing === 'low' ? 'is-low' : ''}`} strokeDasharray={`${ringPct} 100`} />
                        </svg>
                        <div className="slpd-ring-text">
                          <strong>{allLoaded && total.pct !== null ? trimNumber(total.pct) : '—'}</strong>
                          <span>%</span>
                        </div>
                      </div>
                      <div className="slpd-gauge-side">
                        <span className={`slpd-standing ${standing ? `is-${standing}` : ''}`}>
                          <i aria-hidden="true" />
                          {standing === 'ok' ? 'Good standing' : standing === 'low' ? 'Below requirement' : allLoaded ? 'No sessions yet' : 'Loading…'}
                        </span>
                        <span className="slpd-small slpd-mono">{allLoaded ? `${total.attended} / ${total.counted} sessions` : '—'}</span>
                        <span className="slpd-small">
                          Minimum: <strong className="slpd-mono">{ATTENDANCE_MIN}%</strong>
                        </span>
                      </div>
                    </div>
                    <div className={`slpd-bar ${standing === 'low' ? 'is-low' : ''}`} aria-hidden="true">
                      <span style={{ width: `${ringPct}%` }} />
                    </div>
                  </div>

                  <div className="slpc-card slpd-card">
                    <div className="slpd-card-top">
                      <div>
                        <span className="slpd-eyebrow">Session distribution</span>
                        <h2 className="slpd-h">Ledger tallies</h2>
                      </div>
                      <span className="slpd-icon">{renderIcon('donut_small', 20)}</span>
                    </div>
                    <div className="slpd-tallies">
                      {STATUSES.map((key) => (
                        <div key={key} className="slpd-tally">
                          <span className="slpd-tally-name">
                            <i className={`slpd-dot is-${key}`} aria-hidden="true" />
                            {STATUS_META[key].label}
                          </span>
                          <strong aria-label={`${STATUS_META[key].label} sessions`}>{allLoaded ? pad(total[key]) : '—'}</strong>
                        </div>
                      ))}
                    </div>
                    <div className="slpd-formula">
                      <span>(Present + Late) / (Present + Late + Absent)</span>
                      <strong>{allLoaded && total.counted > 0 ? `${total.attended}/${total.counted} = ${pctText(total.pct)}` : '—'}</strong>
                    </div>
                  </div>

                  <div className="slpc-card slpd-card slpd-wide">
                    <div className="slpd-card-top">
                      <div>
                        <span className="slpd-eyebrow">Eligibility check</span>
                        <h2 className="slpd-h">Course compliance</h2>
                      </div>
                      <span className="slpd-pass">{allLoaded && withData.length > 0 ? `${passing.length} / ${withData.length} PASS` : '—'}</span>
                    </div>
                    <ul className="slpd-units">
                      {perCourse.map((entry) => {
                        const low = allLoaded && entry.pct !== null && entry.pct < ATTENDANCE_MIN
                        return (
                          <li key={entry.course.id}>
                            <div className="slpd-unit-row">
                              <span>
                                {entry.course.course_code}: {entry.course.course_name}
                              </span>
                              <span>{allLoaded && entry.counted > 0 ? `${pctText(entry.pct)} (${entry.attended}/${entry.counted})` : '—'}</span>
                            </div>
                            <div className={`slpd-bar ${allLoaded && entry.pct !== null ? (low ? 'is-low' : 'is-ok') : ''}`} aria-hidden="true">
                              <span style={{ width: `${allLoaded && entry.pct !== null ? Math.min(100, entry.pct) : 0}%` }} />
                              <i className="slpd-tick" style={{ left: `${ATTENDANCE_MIN}%` }} />
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                    {allLoaded && withData.length > 0 ? (
                      <span className={`slpd-verdict ${below > 0 ? 'is-low' : ''}`}>
                        {renderIcon(below > 0 ? 'warning' : 'check_circle', 16)}
                        {below > 0 ? `${below} ${below === 1 ? 'course is' : 'courses are'} below the ${ATTENDANCE_MIN}% minimum` : `All ${withData.length} ${withData.length === 1 ? 'course clears' : 'courses clear'} the ${ATTENDANCE_MIN}% minimum`}
                      </span>
                    ) : (
                      <span className="slpd-verdict is-quiet">{renderIcon('hourglass_empty', 16)}{allLoaded ? 'Waiting for sessions to be recorded' : 'Waiting for every course to load'}</span>
                    )}
                  </div>
                </section>

                <div className="slpd-split">
                  <div className="slpd-main">
                    <section className="slpc-card slpd-toolbar" aria-label="Filter sessions">
                      <div className="slpd-tools">
                        <label className="slpc-search">
                          {renderIcon('search', 18)}
                          <input
                            type="search"
                            value={search}
                            onChange={(event) => {
                              setSearch(event.target.value)
                              setPage(1)
                            }}
                            placeholder="Filter by topic, course, room..."
                            aria-label="Search sessions"
                          />
                        </label>
                        <select className="slpc-select" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort sessions">
                          {SORTS.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="slpd-filters" role="group" aria-label="Attendance status">
                        <button type="button" className={`slpd-filter ${status === 'all' ? 'is-active' : ''}`} aria-pressed={status === 'all'} onClick={() => pickStatus('all')}>
                          All sessions
                          {allLoaded && <em>{scoped.length}</em>}
                        </button>
                        {STATUSES.map((key) => (
                          <button key={key} type="button" className={`slpd-filter ${status === key ? 'is-active' : ''}`} aria-pressed={status === key} onClick={() => pickStatus(key)}>
                            <i className={`slpd-dot is-${key}`} aria-hidden="true" />
                            {STATUS_META[key].label}
                            {allLoaded && <em>{total[key]}</em>}
                          </button>
                        ))}
                      </div>
                    </section>

                    {anyPending && <Skeleton height={120} label="Loading attendance" />}
                    {allLoaded && visible.length === 0 && (
                      <p className="slpc-empty">{sessions.length === 0 ? 'No sessions have been recorded for you yet.' : 'No sessions match these filters.'}</p>
                    )}
                    {visible.length > 0 && (
                      <ul className="slpd-list" aria-label="Session history">
                        {pageItems.map((session) => (
                          <SessionRow key={session.key} session={session} selected={selected?.key === session.key} onOpen={openSession} />
                        ))}
                      </ul>
                    )}
                    {visible.length > PAGE_SIZE && (
                      <div className="slpd-pager">
                        <span>
                          Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, visible.length)} of {visible.length}
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
                  </div>

                  <aside className="slpd-side slpd-sticky" aria-label="Session details panel">
                    <section id="slpd-inspector" className="slpc-card slpd-card" aria-label="Session details">
                      <div className="slpd-card-top">
                        <div>
                          <span className="slpd-eyebrow">Session inspector</span>
                          <h2 className="slpd-h">Session details</h2>
                        </div>
                        <span className="slpd-icon">{renderIcon('event_note', 20)}</span>
                      </div>
                      <Inspector session={allLoaded ? selected : null} />
                    </section>
                    <section className="slpc-card slpd-card" aria-label="How attendance is counted">
                      <div className="slpc-inline">
                        <span className="slpd-icon">{renderIcon('rule', 20)}</span>
                        <h2 className="slpd-h">How your ratio is worked out</h2>
                      </div>
                      <ul className="slpd-rules">
                        <li>
                          {renderIcon('check_circle', 16)}
                          <span>Present and late sessions count as attended.</span>
                        </li>
                        <li>
                          {renderIcon('check_circle', 16)}
                          <span>Absent sessions count against you.</span>
                        </li>
                        <li>
                          {renderIcon('check_circle', 16)}
                          <span>Excused sessions are left out of both sides of the ratio.</span>
                        </li>
                        <li>
                          {renderIcon('check_circle', 16)}
                          <span>The portal flags any course under {ATTENDANCE_MIN}%. Your institution&apos;s own rules decide eligibility.</span>
                        </li>
                        <li>
                          {renderIcon('lock', 16)}
                          <span>This page is read only. Corrections are made by your lecturer.</span>
                        </li>
                      </ul>
                    </section>
                  </aside>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
