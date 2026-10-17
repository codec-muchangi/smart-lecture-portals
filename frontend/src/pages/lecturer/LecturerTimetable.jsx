import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueries, useQuery } from '@tanstack/react-query'
import { api } from '../../services/apiClient.js'
import {
  COURSES_KEY,
  COURSE_STYLES,
  ErrorCard,
  PhasePanel,
  Skeleton,
  fetchCourses,
  renderIcon,
  useClock,
  useCourseFonts,
} from '../../components/courseKit.jsx'
import { toList } from '../../utils/format.js'

/*
 * Smart Lecture Portal: lecturer Timetable & Schedule
 * Place at: src/pages/lecturer/LecturerTimetable.jsx
 *
 * Route (see routes.jsx):
 *   /lecturer/timetable   your teaching sessions for one week at a time
 *
 * - Renders inside AppShell, which already draws the sidebar and top bar.
 * - Built on the contract in docs/API.md (Timetable) and the timetable_entries table in docs/ERD.md.
 *   Endpoints used:
 *     GET /courses                          assigned courses (names, colours, filters)
 *     GET /courses/{id}                     enrolled_count for the session inspector
 *     GET /timetable?from=YYYY-MM-DD&to=..  entries for the week shown (the server limits them to your courses)
 * - An entry is { id, course_id, day_of_week, specific_date, start_time, end_time, room, notes }.
 *   specific_date places a one-off session; otherwise day_of_week repeats it every week
 *   (1 = Monday ... 6 = Saturday, and 0 or 7 = Sunday). Times are shown exactly as stored.
 * - The timetable backend arrives in Phase 8. Until the server answers GET /timetable the page says so
 *   plainly and shows no figures. It never invents sessions, session types, enrolment counts or
 *   "conflict free" claims: the clash check below is computed from the entries it actually received.
 * - The API has no session types, recurrence rules, attached files or deadlines, so none are drawn.
 *   Exports (iCal and CSV) are built in the browser from the week you are looking at.
 */

const NOT_READY = [404, 405, 501]
const HOUR_PX = 64
const MIN_START_HOUR = 8
const MIN_END_HOUR = 17
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const VIEWS = [
  { id: 'grid', label: 'Weekly grid', icon: 'grid_view' },
  { id: 'day', label: 'Daily', icon: 'today' },
  { id: 'list', label: 'Compact list', icon: 'view_list' },
]
const TONES = ['t0', 't1', 't2']

const isNotReady = (error) => NOT_READY.includes(error?.status)
const pad = (value) => String(value).padStart(2, '0')
const isoOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const addDays = (date, amount) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount)
const mondayOf = (date) => addDays(date, -((date.getDay() + 6) % 7))
const parseDay = (text) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(text ?? ''))
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
}
const parseMinutes = (text) => {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(text ?? '').trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours > 23 || minutes > 59 ? null : hours * 60 + minutes
}
const clock = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
const shortDate = (date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const longDate = (date) => date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
const hoursText = (minutes) => `${(Math.round((minutes / 60) * 10) / 10).toFixed(1)} hrs`

const TIMETABLE_STYLES = `
.slpt-topbar { display: flex; flex-direction: column; gap: 0.75rem; }
.slpt-hero { display: flex; flex-direction: column; gap: 1rem; padding: 1.25rem; }
.slpt-title { font-size: 26px; line-height: 34px; font-weight: 700; letter-spacing: -0.02em; overflow-wrap: anywhere; }
.slpt-hero-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.slpt-nav { display: inline-flex; align-items: center; gap: 2px; padding: 4px; border-radius: 999px; background: var(--surface-mid); }
.slpt-nav-today { height: 32px; padding: 0 14px; border: 0; border-radius: 999px; background: var(--surface-lowest); color: var(--primary); font-size: 12px; line-height: 16px; font-weight: 700; cursor: pointer; box-shadow: 0 1px 2px rgba(30, 26, 35, 0.12); }
.slpt-nav-step { width: 32px; height: 32px; border: 0; border-radius: 999px; background: transparent; color: var(--on-surface-variant); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.slpt-nav-step:hover { background: var(--surface-high); color: var(--on-surface); }
.slpt-range { display: inline-flex; align-items: center; gap: 0.375rem; padding: 0 14px; height: 40px; border-radius: 12px; background: var(--surface-low); font-size: 13px; line-height: 18px; font-weight: 700; }
.slpt-range .material-symbols-outlined { color: var(--primary); }
.slpt-hero-tools .slpc-btn { height: 40px; padding: 0 16px; }
.slpt-foot-chips { display: flex; flex-wrap: wrap; gap: 4px 6px; }
.slpt-filters { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.875rem; }
.slpt-filter-row { display: flex; flex-direction: column; gap: 0.75rem; }
.slpt-pills { display: flex; flex-wrap: wrap; align-items: center; gap: 0.375rem; }
.slpt-pill { display: inline-flex; align-items: center; gap: 0.375rem; padding: 7px 14px; border: 0; border-radius: 999px; background: var(--surface-mid); color: var(--on-surface); font-size: 12px; line-height: 16px; font-weight: 600; cursor: pointer; transition: background 0.2s; text-align: left; }
.slpt-pill:hover { background: var(--surface-high); }
.slpt-pill.is-active { background: var(--primary); color: var(--on-primary); font-weight: 700; box-shadow: 0 1px 2px rgba(30, 26, 35, 0.2); }
.slpt-views { display: inline-flex; align-self: flex-start; align-items: center; gap: 2px; padding: 4px; border-radius: 999px; background: var(--surface-mid); max-width: 100%; overflow-x: auto; }
.slpt-view { display: inline-flex; align-items: center; gap: 0.375rem; flex: 0 0 auto; height: 32px; padding: 0 14px; border: 0; border-radius: 999px; background: transparent; color: var(--on-surface-variant); font-size: 12px; line-height: 16px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.slpt-view:hover { color: var(--on-surface); }
.slpt-view.is-active { background: var(--surface-lowest); color: var(--on-surface); font-weight: 700; box-shadow: 0 1px 2px rgba(30, 26, 35, 0.12); }
.slpt-tools { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.5rem; }
.slpt-tools .slpc-search, .slpt-tools .slpc-select, .slpt-tools .slpc-btn { height: 40px; border-radius: 12px; }
.slpt-tools .slpc-select { width: 100%; padding-left: 12px; }
.slpt-tool-btns { display: flex; align-items: center; gap: 0.5rem; }
.slpt-tool-btns .slpc-btn { flex: 1 1 auto; padding: 0 14px; }
.slpt-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.slpt-board { display: flex; flex-direction: column; gap: 0.75rem; min-width: 0; padding: 1rem; overflow: hidden; }
.slpt-board-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 1rem; }
.slpt-board-title { font-size: 16px; line-height: 24px; font-weight: 600; }
.slpt-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; font-size: 11px; line-height: 14px; font-weight: 600; color: var(--on-surface-variant); }
.slpt-legend span { display: inline-flex; align-items: center; gap: 0.375rem; }
.slpt-swatch { width: 10px; height: 10px; border-radius: 3px; flex: 0 0 auto; }
.slpt-swatch.is-t0, .slpt-tone.is-t0 { --tone: var(--primary); --tone-bg: rgba(255, 218, 212, 0.55); --tone-bg-hover: rgba(255, 218, 212, 0.9); }
.slpt-swatch.is-t1, .slpt-tone.is-t1 { --tone: var(--tertiary); --tone-bg: rgba(255, 219, 210, 0.7); --tone-bg-hover: rgba(255, 219, 210, 1); }
.slpt-swatch.is-t2, .slpt-tone.is-t2 { --tone: var(--secondary); --tone-bg: rgba(255, 218, 219, 0.65); --tone-bg-hover: rgba(255, 218, 219, 1); }
.slpt-swatch { background: var(--tone); }
.slpt-scroll { overflow-x: auto; }
.slpt-matrix { min-width: 700px; display: flex; flex-direction: column; }
.slpt-days { display: grid; gap: 0; padding: 8px 4px; border-radius: 12px; background: var(--surface-low); text-align: center; font-size: 12px; line-height: 16px; }
.slpt-day-head { display: flex; flex-direction: column; border-radius: 8px; padding: 2px 0; }
.slpt-day-head strong { font-weight: 700; }
.slpt-day-head span { font-size: 11px; line-height: 14px; color: var(--on-surface-variant); }
.slpt-day-head.is-today { background: rgba(255, 218, 212, 0.45); color: var(--primary); }
.slpt-day-head.is-today span { color: var(--primary); font-weight: 600; }
.slpt-time-head { text-align: left; padding-left: 8px; font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 16px; color: var(--on-surface-variant); align-self: center; }
.slpt-body { display: grid; margin-top: 6px; position: relative; }
.slpt-hours { position: relative; }
.slpt-hour { position: absolute; left: 0; right: 0; padding: 4px 0 0 8px; font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 16px; color: var(--on-surface-variant); }
.slpt-col { position: relative; border-left: 1px solid var(--surface-mid); background-image: repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, var(--surface-mid) ${HOUR_PX - 1}px, var(--surface-mid) ${HOUR_PX}px); }
.slpt-col.is-today { background-color: rgba(255, 218, 212, 0.14); }
.slpt-event { position: absolute; display: flex; flex-direction: column; justify-content: space-between; gap: 2px; overflow: hidden; margin: 2px; padding: 6px 8px; border: 0; border-radius: 10px; background: var(--tone-bg); color: var(--on-surface); text-align: left; cursor: pointer; box-shadow: 0 1px 2px rgba(30, 26, 35, 0.1); font-family: inherit; transition: background 0.2s; }
.slpt-event:hover { background: var(--tone-bg-hover); }
.slpt-event.is-selected { box-shadow: 0 0 0 2px var(--tone); }
.slpt-event-code { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 14px; font-weight: 700; color: var(--tone); }
.slpt-event-name { font-size: 13px; line-height: 16px; font-weight: 700; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.slpt-event-meta { display: flex; align-items: center; gap: 0.25rem; font-size: 11px; line-height: 14px; color: var(--on-surface-variant); min-width: 0; }
.slpt-event-meta span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slpt-event-time { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 14px; color: var(--on-surface-variant); }
.slpt-now { position: absolute; left: 0; right: 0; display: flex; align-items: center; pointer-events: none; z-index: 3; }
.slpt-now-dot { width: 10px; height: 10px; border-radius: 999px; background: var(--error); margin-left: -5px; flex: 0 0 auto; }
.slpt-now-line { flex: 1 1 auto; height: 2px; background: rgba(186, 26, 26, 0.7); }
.slpt-now-label { margin-left: 4px; padding: 0 4px; border-radius: 4px; background: var(--surface); color: var(--error); font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 10px; line-height: 14px; font-weight: 700; white-space: nowrap; }
.slpt-day-tabs { display: flex; gap: 4px; overflow-x: auto; padding: 2px; }
.slpt-day-tab { flex: 0 0 auto; display: flex; flex-direction: column; align-items: center; min-width: 64px; padding: 6px 10px; border: 0; border-radius: 12px; background: var(--surface-low); color: var(--on-surface-variant); font-size: 12px; line-height: 16px; font-weight: 600; cursor: pointer; }
.slpt-day-tab small { font-size: 11px; line-height: 14px; }
.slpt-day-tab.is-active { background: var(--primary-container); color: var(--on-primary-container); font-weight: 700; }
.slpt-list { display: flex; flex-direction: column; gap: 0.5rem; margin: 0; padding: 0; list-style: none; }
.slpt-list-day { margin: 0.5rem 0 0; font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpt-row { width: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.75rem; align-items: center; padding: 10px 12px; border: 0; border-radius: 12px; background: var(--tone-bg); color: var(--on-surface); text-align: left; cursor: pointer; font-family: inherit; }
.slpt-row:hover { background: var(--tone-bg-hover); }
.slpt-row.is-selected { box-shadow: 0 0 0 2px var(--tone); }
.slpt-row-time { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 12px; line-height: 16px; font-weight: 700; color: var(--tone); white-space: nowrap; }
.slpt-row-main { display: flex; flex-direction: column; min-width: 0; }
.slpt-row-main strong { font-size: 14px; line-height: 20px; font-weight: 700; overflow-wrap: anywhere; }
.slpt-row-main span { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 12px; line-height: 16px; color: var(--on-surface-variant); }
.slpt-board-foot { display: flex; flex-direction: column; gap: 0.25rem; padding-top: 0.5rem; font-size: 12px; line-height: 18px; color: var(--on-surface-variant); }
.slpt-board-foot span { display: inline-flex; align-items: flex-start; gap: 0.375rem; }
.slpt-board-foot .material-symbols-outlined { color: var(--tertiary); }
.slpt-side { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.slpt-inspector { display: flex; flex-direction: column; gap: 1rem; }
.slpt-inspector-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; }
.slpt-dot { width: 12px; height: 12px; border-radius: 999px; background: var(--primary); flex: 0 0 auto; }
.slpt-code { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 12px; line-height: 16px; font-weight: 700; color: var(--primary); background: var(--primary-fixed); padding: 2px 8px; border-radius: 6px; }
.slpt-inspector h2 { margin: 0; font-size: 20px; line-height: 28px; font-weight: 700; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.slpt-facts { display: flex; flex-direction: column; gap: 0.625rem; margin: 0; padding: 0.875rem; border-radius: 12px; background: var(--surface-low); font-size: 13px; line-height: 18px; }
.slpt-fact { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; }
.slpt-fact dt { display: inline-flex; align-items: center; gap: 0.375rem; color: var(--on-surface-variant); font-weight: 500; flex: 0 0 auto; }
.slpt-fact dd { margin: 0; font-weight: 600; text-align: right; min-width: 0; overflow-wrap: anywhere; }
.slpt-notes { padding: 0.75rem; border-radius: 12px; background: var(--surface-lowest); box-shadow: inset 0 1px 3px rgba(30, 26, 35, 0.08); font-size: 13px; line-height: 20px; white-space: pre-wrap; overflow-wrap: anywhere; }
.slpt-actions { display: flex; flex-direction: column; gap: 0.5rem; }
.slpt-actions .slpc-btn { width: 100%; justify-content: center; height: 40px; }
.slpt-lock { display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.625rem 0.75rem; border-radius: 12px; background: var(--surface-low); font-size: 12px; line-height: 18px; color: var(--on-surface-variant); }
.slpt-lock .material-symbols-outlined { color: var(--primary); flex: 0 0 auto; margin-top: 1px; }
@media (min-width: 640px) {
  .slpt-tools { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .slpt-tool-btns { grid-column: 1 / -1; justify-content: flex-end; }
  .slpt-tool-btns .slpc-btn { flex: 0 0 auto; }
}
@media (min-width: 768px) {
  .slpt-hero { flex-direction: row; align-items: center; justify-content: space-between; }
  .slpt-board-foot { flex-direction: row; justify-content: space-between; align-items: center; }
}
@media (min-width: 1024px) {
  .slpt-title { font-size: 32px; line-height: 40px; }
  .slpt-filter-row { flex-direction: row; align-items: center; justify-content: space-between; }
  .slpt-tools { grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto; }
  .slpt-tool-btns { grid-column: auto; }
  .slpt-split { grid-template-columns: minmax(0, 2fr) minmax(300px, 1fr); }
  .slpt-inspector-card { position: sticky; top: 5rem; }
}
@media print {
  .slpt-hero-tools, .slpt-filters, .slpt-side, .slpt-topbar { display: none; }
  .slpt-split { grid-template-columns: minmax(0, 1fr); }
}
`

const errorText = (error, fallback) => error?.message || fallback

/* ---------- data helpers ---------- */

function normalise(raw, weekDays, courseById) {
  const course = courseById.get(raw?.course_id)
  if (!course) return null
  const start = parseMinutes(raw.start_time)
  const end = parseMinutes(raw.end_time)
  if (start === null || end === null || end <= start) return null

  let dayIndex = -1
  const once = parseDay(raw.specific_date)
  if (once) {
    dayIndex = weekDays.findIndex((day) => isoOf(day) === isoOf(once))
  } else {
    const dow = Number(raw.day_of_week)
    if (Number.isInteger(dow) && dow >= 0 && dow <= 7) dayIndex = dow === 0 || dow === 7 ? 6 : dow - 1
  }
  if (dayIndex < 0 || dayIndex > 6) return null

  return {
    id: String(raw.id ?? `${raw.course_id}-${dayIndex}-${start}`),
    courseId: course.id,
    courseCode: course.course_code,
    courseName: course.course_name,
    dayIndex,
    date: weekDays[dayIndex],
    start,
    end,
    room: String(raw.room ?? '').trim(),
    notes: String(raw.notes ?? '').trim(),
    recurring: !once,
  }
}

const byTime = (a, b) => a.dayIndex - b.dayIndex || a.start - b.start || a.end - b.end

function findClashes(entries) {
  let count = 0
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i]
      const b = entries[j]
      if (a.dayIndex === b.dayIndex && a.start < b.end && b.start < a.end) count += 1
    }
  }
  return count
}

// Side-by-side lanes for sessions that overlap on the same day.
function layoutLanes(dayEntries) {
  const sorted = [...dayEntries].sort(byTime)
  const laneEnds = []
  const placed = sorted.map((entry) => {
    let lane = laneEnds.findIndex((end) => end <= entry.start)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = entry.end
    return { entry, lane }
  })
  return placed.map((item) => ({ ...item, lanes: Math.max(1, laneEnds.length) }))
}

const csvCell = (value) => {
  let text = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function buildCsv(entries) {
  const lines = [['Date', 'Day', 'Start', 'End', 'Course', 'Course name', 'Room', 'Notes'].map(csvCell).join(',')]
  entries.forEach((entry) => {
    lines.push([isoOf(entry.date), DAYS[entry.dayIndex], clock(entry.start), clock(entry.end), entry.courseCode, entry.courseName, entry.room, entry.notes].map(csvCell).join(','))
  })
  return lines.join('\n')
}

const icsText = (value) => String(value ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const icsStamp = (date, minutes) => `${isoOf(date).replace(/-/g, '')}T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`

function buildIcs(entries) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Smart Lecture Portal//Timetable//EN', 'CALSCALE:GREGORIAN']
  entries.forEach((entry) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${entry.id}-${isoOf(entry.date)}@smart-lecture-portal`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      `DTSTART:${icsStamp(entry.date, entry.start)}`,
      `DTEND:${icsStamp(entry.date, entry.end)}`,
      `SUMMARY:${icsText(`${entry.courseCode}: ${entry.courseName}`)}`,
      ...(entry.room ? [`LOCATION:${icsText(entry.room)}`] : []),
      ...(entry.notes ? [`DESCRIPTION:${icsText(entry.notes)}`] : []),
      'END:VEVENT',
    )
  })
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
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

/* ---------- pieces ---------- */

function Inspector({ entry, cohort }) {
  if (!entry) {
    return (
      <section className="slpc-card slpt-inspector slpt-inspector-card" aria-label="Session inspector">
        <div className="slpt-inspector-head">
          <span className="slpc-inline">
            <span className="slpt-dot" />
            <span className="slpc-eyebrow">Session inspector</span>
          </span>
        </div>
        <p className="slpc-empty">Select a session in the timetable to see its details here.</p>
      </section>
    )
  }
  return (
    <section className="slpc-card slpt-inspector slpt-inspector-card" aria-label="Session inspector">
      <div className="slpt-inspector-head">
        <span className="slpc-inline">
          <span className="slpt-dot" />
          <span className="slpc-eyebrow">Session inspector</span>
        </span>
        <span className="slpt-code">{entry.courseCode}</span>
      </div>
      <div className="slpc-stack" style={{ gap: '0.25rem' }}>
        <h2>{entry.courseName}</h2>
        <p className="slpc-muted">{entry.recurring ? 'Repeats every week' : 'One-off session'}</p>
      </div>
      <dl className="slpt-facts">
        <div className="slpt-fact">
          <dt>
            {renderIcon('event', 16)}
            Date &amp; slot
          </dt>
          <dd>
            {longDate(entry.date)} • {clock(entry.start)} - {clock(entry.end)}
          </dd>
        </div>
        <div className="slpt-fact">
          <dt>
            {renderIcon('meeting_room', 16)}
            Venue
          </dt>
          <dd>{entry.room || 'Not set'}</dd>
        </div>
        <div className="slpt-fact">
          <dt>
            {renderIcon('groups', 16)}
            Cohort
          </dt>
          <dd>{typeof cohort === 'number' ? `${cohort} enrolled ${cohort === 1 ? 'student' : 'students'}` : '—'}</dd>
        </div>
        <div className="slpt-fact">
          <dt>
            {renderIcon('repeat', 16)}
            Recurrence
          </dt>
          <dd>{entry.recurring ? `Every ${DAYS[entry.dayIndex]}` : shortDate(entry.date)}</dd>
        </div>
      </dl>
      <div className="slpc-stack" style={{ gap: '0.375rem' }}>
        <span className="slpc-eyebrow">Session notes</span>
        <div className="slpt-notes">{entry.notes || 'No notes were added for this session.'}</div>
      </div>
      <div className="slpt-actions">
        <Link to={`/lecturer/courses/${entry.courseId}/attendance`} className="slpc-btn slpc-btn-primary">
          {renderIcon('co_present', 18)}
          Open attendance tracker
        </Link>
        <Link to={`/lecturer/courses/${entry.courseId}/materials`} className="slpc-btn slpc-btn-soft">
          {renderIcon('folder_open', 18)}
          View course materials ({entry.courseCode})
        </Link>
      </div>
      <p className="slpt-lock">
        {renderIcon('lock', 16)}
        <span>This timetable is read-only here. To change a room or time, contact the faculty office.</span>
      </p>
    </section>
  )
}

/* ---------- page ---------- */

export default function LecturerTimetable() {
  useCourseFonts()
  const now = useClock()

  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))
  const [scope, setScope] = useState('all')
  const [room, setRoom] = useState('')
  const [search, setSearch] = useState('')
  const [view, setView] = useState(() => (typeof window !== 'undefined' && window.innerWidth < 768 ? 'day' : 'grid'))
  const [dayPick, setDayPick] = useState(() => (new Date().getDay() + 6) % 7)
  const [selectedId, setSelectedId] = useState('')

  const coursesQuery = useQuery({ queryKey: COURSES_KEY, queryFn: fetchCourses })
  const courses = toList(coursesQuery.data)
  const courseById = new Map(courses.map((course) => [course.id, course]))
  const toneOf = (courseId) => TONES[Math.max(0, courses.findIndex((course) => course.id === courseId)) % TONES.length]

  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
  const from = isoOf(weekDays[0])
  const to = isoOf(weekDays[6])
  const timetable = useQuery({
    queryKey: ['timetable', from, to],
    queryFn: () => api(`/timetable?from=${from}&to=${to}`),
    retry: false,
  })

  const details = useQueries({
    queries: courses.map((course) => ({
      queryKey: ['course', course.id],
      queryFn: () => api(`/courses/${course.id}`),
    })),
  })
  const enrolledOf = (courseId) => {
    const index = courses.findIndex((course) => course.id === courseId)
    const value = details[index]?.data?.enrolled_count
    return typeof value === 'number' ? value : undefined
  }

  const ready = coursesQuery.isSuccess && timetable.isSuccess
  const notReady = timetable.isError && isNotReady(timetable.error)
  const failed = timetable.isError && !notReady
  const loading = coursesQuery.isPending || (timetable.isPending && !coursesQuery.isError)

  const weekEntries = ready
    ? toList(timetable.data)
        .map((raw) => normalise(raw, weekDays, courseById))
        .filter(Boolean)
        .sort(byTime)
    : []
  const scoped = weekEntries.filter((entry) => scope === 'all' || entry.courseId === scope)
  const rooms = [...new Set(scoped.map((entry) => entry.room).filter(Boolean))].sort()
  const needle = search.trim().toLowerCase()
  const visible = scoped
    .filter((entry) => !room || entry.room === room)
    .filter((entry) => !needle || `${entry.courseCode} ${entry.courseName} ${entry.room} ${entry.notes}`.toLowerCase().includes(needle))

  const selected = visible.find((entry) => entry.id === selectedId) ?? visible[0]
  const filtered = Boolean(room || needle || scope !== 'all')

  const contactMinutes = scoped.reduce((sum, entry) => sum + (entry.end - entry.start), 0)
  const clashes = findClashes(weekEntries)
  const sunday = weekEntries.some((entry) => entry.dayIndex === 6)
  const dayCount = sunday ? 7 : 6

  const gridStart = Math.min(MIN_START_HOUR, ...weekEntries.map((entry) => Math.floor(entry.start / 60)))
  const gridEnd = Math.max(MIN_END_HOUR, ...weekEntries.map((entry) => Math.ceil(entry.end / 60)))
  const gridHeight = (gridEnd - gridStart) * HOUR_PX
  const hourMarks = Array.from({ length: gridEnd - gridStart }, (_, index) => gridStart + index)
  const columns = `56px repeat(${dayCount}, minmax(0, 1fr))`

  const todayIso = isoOf(new Date(now))
  const nowMinutes = new Date(now).getHours() * 60 + new Date(now).getMinutes()
  const todayIndex = weekDays.findIndex((day) => isoOf(day) === todayIso)
  const showNow = todayIndex >= 0 && todayIndex < dayCount && nowMinutes >= gridStart * 60 && nowMinutes <= gridEnd * 60

  const pickScope = (id) => {
    setScope(id)
    setRoom('')
  }
  const reset = () => {
    setScope('all')
    setRoom('')
    setSearch('')
  }
  const shiftWeek = (amount) => setWeekStart((current) => addDays(current, amount * 7))
  const goToday = () => {
    setWeekStart(mondayOf(new Date()))
    setDayPick((new Date().getDay() + 6) % 7)
  }
  const exportName = `timetable-${from}`

  const dayEntries = visible.filter((entry) => entry.dayIndex === dayPick)

  const renderRow = (entry) => (
    <li key={entry.id}>
      <button type="button" className={`slpt-row slpt-tone is-${toneOf(entry.courseId)} ${selected?.id === entry.id ? 'is-selected' : ''}`} onClick={() => setSelectedId(entry.id)} aria-pressed={selected?.id === entry.id}>
        <span className="slpt-row-time">
          {clock(entry.start)} - {clock(entry.end)}
        </span>
        <span className="slpt-row-main">
          <strong>
            {entry.courseCode}: {entry.courseName}
          </strong>
          <span>
            {renderIcon('location_on', 14)}
            {entry.room || 'Room not set'}
          </span>
        </span>
      </button>
    </li>
  )

  return (
    <div className="slpc" aria-label="Timetable and schedule">
      <style>{COURSE_STYLES}</style>
      <style>{TIMETABLE_STYLES}</style>

      <div className="slpc-stack slpc-gap-lg">
        <div className="slpt-topbar">
          <nav className="slpc-trail" aria-label="Breadcrumb">
            <Link to="/lecturer" className="slpc-trail-link">
              {renderIcon('home', 16)}
              Dashboard
            </Link>
            <span className="slpc-trail-sep">{renderIcon('chevron_right', 16)}</span>
            <span className="slpc-trail-current">Timetable &amp; Schedule</span>
            <span className="slpc-trail-sep">{renderIcon('chevron_right', 16)}</span>
            <span className="slpc-pill is-primary">Weekly view</span>
          </nav>
        </div>

        <section className="slpc-card slpt-hero" aria-labelledby="slpt-heading">
          <div className="slpc-stack" style={{ gap: '0.25rem' }}>
            <h1 id="slpt-heading" className="slpt-title">
              Timetable &amp; Teaching Schedule
            </h1>
            <p className="slpc-lead">Your teaching sessions for the courses you are assigned to, one week at a time. Rooms and times come from the institutional timetable and are read-only.</p>
          </div>
          <div className="slpt-hero-tools">
            <div className="slpt-nav" role="group" aria-label="Week navigation">
              <button type="button" className="slpt-nav-today" onClick={goToday}>
                Today
              </button>
              <button type="button" className="slpt-nav-step" onClick={() => shiftWeek(-1)} aria-label="Previous week" title="Previous week">
                {renderIcon('chevron_left', 18)}
              </button>
              <button type="button" className="slpt-nav-step" onClick={() => shiftWeek(1)} aria-label="Next week" title="Next week">
                {renderIcon('chevron_right', 18)}
              </button>
            </div>
            <span className="slpt-range" aria-live="polite">
              {renderIcon('calendar_today', 18)}
              {shortDate(weekDays[0])} – {shortDate(weekDays[6])}, {weekDays[6].getFullYear()}
            </span>
            <button type="button" className="slpc-btn slpc-btn-primary" onClick={() => downloadText(`${exportName}.ics`, buildIcs(visible), 'text/calendar')} disabled={!ready || visible.length === 0}>
              {renderIcon('file_download', 18)}
              Export iCal
            </button>
            <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => downloadText(`${exportName}.csv`, buildCsv(visible), 'text/csv')} disabled={!ready || visible.length === 0}>
              {renderIcon('table_view', 18)}
              CSV
            </button>
          </div>
        </section>

        <div className="slpc-stats" aria-label="Week summary">
          <div className="slpc-card slpc-stat">
            <div className="slpc-stat-top">
              <span className="slpc-stat-label">Weekly contact hours</span>
              <span className="slpc-stat-icon is-fixed">{renderIcon('schedule', 18)}</span>
            </div>
            <div className="slpc-stat-body">
              <span className="slpc-stat-value">{ready ? hoursText(contactMinutes).replace(' hrs', '') : '—'}</span>
              <span className="slpc-stat-unit">hrs</span>
            </div>
            <div className="slpc-stat-foot">Teaching time in this week</div>
          </div>
          <div className="slpc-card slpc-stat">
            <div className="slpc-stat-top">
              <span className="slpc-stat-label">Total sessions</span>
              <span className="slpc-stat-icon is-mid">{renderIcon('school', 18)}</span>
            </div>
            <div className="slpc-stat-body">
              <span className="slpc-stat-value">{ready ? scoped.length : '—'}</span>
              <span className="slpc-stat-unit">scheduled</span>
            </div>
            <div className="slpc-stat-foot">{ready ? `Across ${new Set(scoped.map((entry) => entry.courseId)).size} ${new Set(scoped.map((entry) => entry.courseId)).size === 1 ? 'course' : 'courses'}` : 'Waiting for the timetable'}</div>
          </div>
          <div className="slpc-card slpc-stat">
            <div className="slpc-stat-top">
              <span className="slpc-stat-label">Teaching venues</span>
              <span className="slpc-stat-icon is-warm">{renderIcon('meeting_room', 18)}</span>
            </div>
            <div className="slpc-stat-body">
              <span className="slpc-stat-value">{ready ? rooms.length : '—'}</span>
              <span className="slpc-stat-unit">{rooms.length === 1 ? 'room' : 'rooms'}</span>
            </div>
            <div className="slpc-stat-foot">{ready && rooms.length > 0 ? rooms.slice(0, 4).join(', ') : 'No rooms listed'}</div>
          </div>
          <div className="slpc-card slpc-stat">
            <div className="slpc-stat-top">
              <span className="slpc-stat-label">Clash check</span>
              <span className={`slpc-stat-icon ${ready && clashes > 0 ? 'is-warm' : 'is-ok'}`}>{renderIcon(ready && clashes > 0 ? 'warning' : 'rule', 18)}</span>
            </div>
            <div className="slpc-stat-body">
              <span className="slpc-stat-value" style={{ fontSize: 24, lineHeight: '32px', color: ready ? (clashes > 0 ? 'var(--warn)' : 'var(--ok)') : undefined }}>
                {ready ? (clashes === 0 ? 'No clashes' : `${clashes} ${clashes === 1 ? 'clash' : 'clashes'}`) : '—'}
              </span>
            </div>
            <div className="slpc-stat-foot">Overlapping sessions this week</div>
          </div>
        </div>

        <section className="slpc-card slpt-filters" aria-label="Filter timetable">
          <div className="slpt-filter-row">
            <div className="slpt-pills" role="group" aria-label="Course scope">
              <button type="button" className={`slpt-pill ${scope === 'all' ? 'is-active' : ''}`} onClick={() => pickScope('all')} aria-pressed={scope === 'all'}>
                All assigned courses{coursesQuery.isSuccess ? ` (${courses.length})` : ''}
              </button>
              {courses.map((course) => (
                <button key={course.id} type="button" className={`slpt-pill ${scope === course.id ? 'is-active' : ''}`} onClick={() => pickScope(course.id)} aria-pressed={scope === course.id}>
                  {course.course_code}: {course.course_name}
                </button>
              ))}
            </div>
            <div className="slpt-views" role="tablist" aria-label="Timetable view">
              {VIEWS.map((entry) => (
                <button key={entry.id} type="button" role="tab" aria-selected={view === entry.id} className={`slpt-view ${view === entry.id ? 'is-active' : ''}`} onClick={() => setView(entry.id)}>
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
          <div className="slpt-tools">
            <label className="slpc-search">
              {renderIcon('search', 18)}
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter by course, room or notes" aria-label="Search sessions" />
            </label>
            <select className="slpc-select" value={room} onChange={(event) => setRoom(event.target.value)} aria-label="Filter by room">
              <option value="">All teaching locations</option>
              {rooms.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <div className="slpt-tool-btns">
              <button type="button" className="slpc-btn slpc-btn-soft" onClick={reset} disabled={!filtered}>
                {renderIcon('restart_alt', 18)}
                Reset view
              </button>
              <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => window.print()}>
                {renderIcon('print', 18)}
                Print grid
              </button>
            </div>
          </div>
        </section>

        <div className="slpt-split">
          <section className="slpc-card slpt-board" aria-label="Weekly timetable">
            <div className="slpt-board-head">
              <span className="slpt-board-title">Weekly timetable</span>
              {courses.length > 0 && (
                <div className="slpt-legend" aria-label="Course colours">
                  {courses.map((course) => (
                    <span key={course.id}>
                      <span className={`slpt-swatch is-${toneOf(course.id)}`} />
                      {course.course_code}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {loading && <Skeleton height={320} label="Loading timetable" />}
            {coursesQuery.isError && <ErrorCard message="Your courses could not be loaded." onRetry={() => coursesQuery.refetch()} />}
            {coursesQuery.isSuccess && courses.length === 0 && <p className="slpc-empty">You are not assigned to any courses yet, so there is no timetable to show.</p>}
            {failed && <ErrorCard message={errorText(timetable.error, 'The timetable could not be loaded.')} onRetry={() => timetable.refetch()} />}
            {notReady && (
              <PhasePanel icon="calendar_month" title="The timetable is not switched on yet" phase="Phase 8">
                The timetable service is not available on the server yet. This page is ready: once it is enabled, your sessions for each week will appear here.
              </PhasePanel>
            )}

            {ready && courses.length > 0 && weekEntries.length === 0 && <p className="slpc-empty">No teaching sessions are scheduled for {shortDate(weekDays[0])} – {shortDate(weekDays[6])}.</p>}
            {ready && weekEntries.length > 0 && visible.length === 0 && <p className="slpc-empty">No sessions match these filters.</p>}

            {ready && visible.length > 0 && view === 'grid' && (
              <div className="slpt-scroll">
                <div className="slpt-matrix">
                  <div className="slpt-days" style={{ gridTemplateColumns: columns }}>
                    <div className="slpt-time-head">TIME</div>
                    {weekDays.slice(0, dayCount).map((day, index) => (
                      <div key={DAYS[index]} className={`slpt-day-head ${isoOf(day) === todayIso ? 'is-today' : ''}`}>
                        <strong>{DAYS[index]}</strong>
                        <span>
                          {shortDate(day)}
                          {isoOf(day) === todayIso ? ' (Today)' : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="slpt-body" style={{ gridTemplateColumns: columns, height: gridHeight }}>
                    <div className="slpt-hours" aria-hidden="true">
                      {hourMarks.map((hour) => (
                        <div key={hour} className="slpt-hour" style={{ top: (hour - gridStart) * HOUR_PX }}>
                          {pad(hour)}:00
                        </div>
                      ))}
                    </div>
                    {weekDays.slice(0, dayCount).map((day, index) => (
                      <div key={DAYS[index]} className={`slpt-col ${isoOf(day) === todayIso ? 'is-today' : ''}`} role="group" aria-label={`${DAYS[index]} sessions`}>
                        {layoutLanes(visible.filter((entry) => entry.dayIndex === index)).map(({ entry, lane, lanes }) => (
                          <button
                            key={entry.id}
                            type="button"
                            className={`slpt-event slpt-tone is-${toneOf(entry.courseId)} ${selected?.id === entry.id ? 'is-selected' : ''}`}
                            style={{
                              top: ((entry.start - gridStart * 60) / 60) * HOUR_PX,
                              height: ((entry.end - entry.start) / 60) * HOUR_PX - 4,
                              left: `${(lane / lanes) * 100}%`,
                              width: `calc(${100 / lanes}% - 4px)`,
                            }}
                            onClick={() => setSelectedId(entry.id)}
                            aria-pressed={selected?.id === entry.id}
                            aria-label={`${entry.courseCode} ${entry.courseName}, ${DAYS[entry.dayIndex]} ${clock(entry.start)} to ${clock(entry.end)}${entry.room ? `, ${entry.room}` : ''}`}
                          >
                            <span>
                              <span className="slpt-event-code">{entry.courseCode}</span>
                              <span className="slpt-event-name" style={{ display: 'block' }}>
                                {entry.courseName}
                              </span>
                              {entry.room && (
                                <span className="slpt-event-meta">
                                  {renderIcon('location_on', 14)}
                                  <span>{entry.room}</span>
                                </span>
                              )}
                            </span>
                            <span className="slpt-event-time">
                              {clock(entry.start)} - {clock(entry.end)}
                            </span>
                          </button>
                        ))}
                      </div>
                    ))}
                    {showNow && (
                      <div className="slpt-now" style={{ top: ((nowMinutes - gridStart * 60) / 60) * HOUR_PX, left: 56 }} aria-hidden="true">
                        <span className="slpt-now-dot" />
                        <span className="slpt-now-line" />
                        <span className="slpt-now-label">{clock(nowMinutes)} NOW</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {ready && weekEntries.length > 0 && view === 'day' && (
              <>
                <div className="slpt-day-tabs" role="tablist" aria-label="Day of the week">
                  {weekDays.slice(0, dayCount).map((day, index) => (
                    <button key={DAYS[index]} type="button" role="tab" aria-selected={dayPick === index} className={`slpt-day-tab ${dayPick === index ? 'is-active' : ''}`} onClick={() => setDayPick(index)}>
                      {DAYS[index].slice(0, 3)}
                      <small>{shortDate(day)}</small>
                    </button>
                  ))}
                </div>
                {dayEntries.length === 0 ? <p className="slpc-empty">No sessions on {longDate(weekDays[dayPick])}.</p> : <ul className="slpt-list">{dayEntries.map(renderRow)}</ul>}
              </>
            )}

            {ready && visible.length > 0 && view === 'list' && (
              <ul className="slpt-list">
                {weekDays.slice(0, dayCount).flatMap((day, index) => {
                  const rows = visible.filter((entry) => entry.dayIndex === index)
                  if (rows.length === 0) return []
                  return [
                    <li key={`h-${DAYS[index]}`} className="slpt-list-day" aria-hidden="true">
                      {longDate(day)}
                    </li>,
                    ...rows.map(renderRow),
                  ]
                })}
              </ul>
            )}

            <div className="slpt-board-foot">
              <span>
                {renderIcon('info', 16)}
                Times are shown exactly as stored in the institutional timetable.
              </span>
              <span className="slpt-foot-chips">
                <span className="slpc-chip is-info">Read-only</span>
                <span className="slpc-chip is-quiet">
                  {from} to {to}
                </span>
              </span>
            </div>
          </section>

          <div className="slpt-side">
            <Inspector entry={ready ? selected : undefined} cohort={selected ? enrolledOf(selected.courseId) : undefined} />
          </div>
        </div>
      </div>
    </div>
  )
}
