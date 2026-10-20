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
import { DAYS, addDays, buildCsv, buildIcs, byTime, clock, downloadText, findClashes, hoursText, isoOf, longDate, mondayOf, normalise, shortDate } from '../../utils/timetable.js'

/*
 * Smart Lecture Portal: student Timetable & Academic Schedule
 * Place at: src/pages/student/StudentTimetable.jsx
 *
 * Route (see routes.jsx):
 *   /student/timetable   your sessions for one week at a time
 *
 * - Renders inside AppShell, which already draws the sidebar and top bar.
 * - Built on the contract in docs/API.md (Timetable). Endpoints used:
 *     GET /courses                          the courses you are enrolled in (names, colours, filters)
 *     GET /courses/{id}                     lecturer details shown on cards and in the inspector
 *     GET /timetable?from=YYYY-MM-DD&to=..  entries for the week shown (the server limits them to your courses)
 * - An entry is { id, course_id, day_of_week, specific_date, start_time, end_time, room, notes }.
 *   specific_date places a one-off session; otherwise day_of_week repeats it every week.
 * - The timetable backend arrives in Phase 8. Until the server answers GET /timetable the page says so
 *   plainly and shows no figures. It never invents sessions, session types, walking times, ledger
 *   hashes or "reconciled" claims: every number below is computed from the entries it received.
 * - The API has no session types, so cards say "Weekly" or "One-off" instead of Lecture or Lab.
 *   "Export iCal" and "CSV" are built in the browser from the sessions on screen; "Print / PDF"
 *   uses the browser print dialog.
 */

const NOT_READY = [404, 405, 501]
const VIEWS = [
  { id: 'matrix', label: 'Weekly Matrix', icon: 'calendar_view_week' },
  { id: 'agenda', label: 'Daily Agenda', icon: 'view_day' },
  { id: 'list', label: 'List View', icon: 'format_list_bulleted' },
]
const TONES = ['t0', 't1', 't2', 't3']

const isNotReady = (error) => NOT_READY.includes(error?.status)
const errorText = (error, fallback) => error?.message || fallback
const todayChip = (date) => date.toLocaleDateString('en-GB', { weekday: 'short', month: 'short', day: 'numeric' })
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`
const lecturerName = (lecturer) => [lecturer?.title, lecturer?.full_name].filter(Boolean).join(' ')

const STUDENT_TIMETABLE_STYLES = `
.slpq-hero { display: flex; flex-direction: column; gap: 1rem; padding: 1.25rem; }
.slpq-title { margin: 0; font-size: 26px; line-height: 34px; font-weight: 700; letter-spacing: -0.02em; overflow-wrap: anywhere; }
.slpq-hero-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.slpq-hero-tools .slpc-btn { height: 40px; padding: 0 16px; }
.slpq-views { display: inline-flex; align-items: center; gap: 2px; padding: 4px; border-radius: 999px; background: var(--surface-mid); max-width: 100%; overflow-x: auto; }
.slpq-view { display: inline-flex; align-items: center; gap: 0.375rem; flex: 0 0 auto; height: 32px; padding: 0 14px; border: 0; border-radius: 999px; background: transparent; color: var(--on-surface-variant); font-size: 12px; line-height: 16px; font-weight: 600; cursor: pointer; white-space: nowrap; font-family: inherit; }
.slpq-view:hover { color: var(--on-surface); }
.slpq-view .material-symbols-outlined { color: inherit; }
.slpq-view.is-active { background: var(--surface-lowest); color: var(--on-surface); font-weight: 700; box-shadow: 0 1px 2px rgba(30, 26, 35, 0.12); }
.slpq-view.is-active .material-symbols-outlined { color: var(--primary); }
.slpq-today-chip { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 14px; font-weight: 700; color: var(--primary); background: var(--primary-fixed); padding: 2px 8px; border-radius: 6px; white-space: nowrap; }
.slpq-bar { display: flex; width: 100%; height: 8px; border-radius: 999px; overflow: hidden; background: var(--surface-mid); }
.slpq-bar span { display: block; height: 100%; }
.slpq-legend { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 10px; font-size: 11px; line-height: 14px; font-weight: 600; color: var(--on-surface-variant); }
.slpq-next { display: flex; align-items: flex-start; gap: 0.375rem; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpq-next strong { color: var(--on-surface); }
.slpq-live { flex: 0 0 auto; width: 8px; height: 8px; margin-top: 5px; border-radius: 999px; background: var(--secondary-container); }
.slpq-stat-link { display: inline-flex; align-items: center; gap: 0.375rem; color: var(--primary); font-weight: 600; }
.slpq-stat-link:hover { text-decoration: underline; }
.slpq-stat-title { font-size: 22px; line-height: 30px; font-weight: 700; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.slpq-stat-sub { font-size: 13px; line-height: 18px; color: var(--on-surface-variant); overflow-wrap: anywhere; }
.slpq-nav { display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem; }
.slpq-nav-row { display: flex; flex-direction: column; gap: 0.75rem; padding-bottom: 0.75rem; border-bottom: 1px solid var(--surface-mid); }
.slpq-weekbar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; }
.slpq-stepper { display: inline-flex; align-items: center; gap: 4px; }
.slpq-step { width: 36px; height: 36px; border: 0; border-radius: 999px; background: var(--surface-high); color: var(--on-surface); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.slpq-step:hover { background: var(--surface-mid); }
.slpq-today-btn { height: 36px; padding: 0 14px; border: 0; border-radius: 999px; background: var(--surface-mid); color: var(--on-surface); font-size: 12px; line-height: 16px; font-weight: 600; cursor: pointer; font-family: inherit; }
.slpq-today-btn:hover { background: var(--surface-high); }
.slpq-week-label { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 0.5rem; min-width: 0; }
.slpq-week-label strong { font-size: 16px; line-height: 24px; font-weight: 700; }
.slpq-week-label span { font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpq-select-wrap { position: relative; display: block; min-width: 0; }
.slpq-select-wrap .slpc-select { width: 100%; appearance: none; padding: 0 32px 0 12px; height: 40px; border-radius: 12px; background: var(--surface-high); font-weight: 500; }
.slpq-select-wrap .material-symbols-outlined { position: absolute; right: 8px; top: 12px; pointer-events: none; color: var(--outline); }
.slpq-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.slpq-chips-label { font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); margin-right: 0.25rem; }
.slpq-chip { display: inline-flex; align-items: center; gap: 0.375rem; padding: 7px 14px; border: 0; border-radius: 999px; background: var(--surface-low); color: var(--on-surface); font-size: 12px; line-height: 16px; font-weight: 500; cursor: pointer; text-align: left; font-family: inherit; transition: background 0.2s; }
.slpq-chip:hover { background: var(--surface-mid); }
.slpq-chip.is-active { background: var(--primary-container); color: var(--on-primary-container); font-weight: 600; box-shadow: 0 1px 2px rgba(30, 26, 35, 0.2); }
.slpq-dot { width: 10px; height: 10px; border-radius: 999px; flex: 0 0 auto; background: var(--tone, var(--primary)); }
.slpq-tone.is-t0 { --tone: var(--primary); }
.slpq-tone.is-t1 { --tone: var(--secondary); }
.slpq-tone.is-t2 { --tone: var(--tertiary); }
.slpq-tone.is-t3 { --tone: var(--outline); }
.slpq-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.slpq-main { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.slpq-day { display: flex; flex-direction: column; gap: 0.5rem; padding: 1rem; }
.slpq-day-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.25rem 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--surface-mid); }
.slpq-day-name { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.5rem; }
.slpq-day-name strong { font-size: 16px; line-height: 24px; font-weight: 700; }
.slpq-day-name span { font-size: 12px; line-height: 16px; font-weight: 500; color: var(--on-surface-variant); }
.slpq-day-name .slpq-now-pill { padding: 2px 8px; border-radius: 999px; background: rgba(160, 50, 35, 0.1); color: var(--primary); font-weight: 700; font-size: 11px; line-height: 14px; }
.slpq-day-count { font-size: 11px; line-height: 14px; font-weight: 600; color: var(--on-surface-variant); }
.slpq-day-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.5rem; }
.slpq-session { display: flex; flex-direction: column; justify-content: space-between; gap: 0.75rem; width: 100%; padding: 0.875rem; border: 0; border-radius: 12px; background: var(--surface-low); color: var(--on-surface); text-align: left; cursor: pointer; font-family: inherit; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.02); transition: background 0.2s; }
.slpq-session:hover { background: var(--surface-mid); }
.slpq-session.is-selected { box-shadow: 0 0 0 2px var(--tone, var(--primary)); background: var(--surface-mid); }
.slpq-session-top { display: flex; flex-direction: column; gap: 0.25rem; }
.slpq-session-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.slpq-code { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 12px; line-height: 16px; font-weight: 700; color: var(--tone, var(--primary)); }
.slpq-kind { padding: 2px 8px; border-radius: 999px; background: var(--surface-mid); color: var(--tone, var(--primary)); font-size: 10px; line-height: 14px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.slpq-session-title { font-size: 16px; line-height: 22px; font-weight: 700; overflow-wrap: anywhere; }
.slpq-session-meta { display: flex; flex-direction: column; gap: 0.375rem; padding-top: 0.5rem; border-top: 1px solid var(--surface-mid); font-size: 11px; line-height: 14px; font-weight: 600; color: var(--on-surface-variant); }
.slpq-meta-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.25rem 0.75rem; }
.slpq-meta-item { display: inline-flex; align-items: center; gap: 0.375rem; min-width: 0; }
.slpq-meta-item .material-symbols-outlined { flex: 0 0 auto; color: var(--tone, var(--primary)); }
.slpq-meta-item.is-room span:last-child { font-weight: 600; color: var(--on-surface); overflow-wrap: anywhere; }
.slpq-meta-item.is-plain .material-symbols-outlined { color: var(--on-surface-variant); }
.slpq-free { display: flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.875rem; border: 1px dashed var(--outline-variant); border-radius: 12px; background: rgba(238, 229, 242, 0.4); font-size: 12px; line-height: 16px; font-weight: 600; color: var(--on-surface-variant); text-align: center; }
.slpq-free .material-symbols-outlined { color: var(--outline); }
.slpq-board { display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem; }
.slpq-day-tabs { display: flex; gap: 4px; overflow-x: auto; padding: 2px; }
.slpq-day-tab { flex: 0 0 auto; display: flex; flex-direction: column; align-items: center; min-width: 64px; padding: 6px 10px; border: 0; border-radius: 12px; background: var(--surface-low); color: var(--on-surface-variant); font-size: 12px; line-height: 16px; font-weight: 600; cursor: pointer; font-family: inherit; }
.slpq-day-tab small { font-size: 11px; line-height: 14px; }
.slpq-day-tab.is-active { background: var(--primary-container); color: var(--on-primary-container); font-weight: 700; }
.slpq-list { display: flex; flex-direction: column; gap: 0.5rem; margin: 0; padding: 0; list-style: none; }
.slpq-list-day { margin: 0.5rem 0 0; font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpq-row { width: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.75rem; align-items: center; padding: 10px 12px; border: 0; border-radius: 12px; background: var(--surface-low); color: var(--on-surface); text-align: left; cursor: pointer; font-family: inherit; }
.slpq-row:hover { background: var(--surface-mid); }
.slpq-row.is-selected { box-shadow: 0 0 0 2px var(--tone, var(--primary)); }
.slpq-row-time { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 12px; line-height: 16px; font-weight: 700; color: var(--tone, var(--primary)); white-space: nowrap; }
.slpq-row-main { display: flex; flex-direction: column; min-width: 0; }
.slpq-row-main strong { font-size: 14px; line-height: 20px; font-weight: 700; overflow-wrap: anywhere; }
.slpq-row-main span { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 12px; line-height: 16px; color: var(--on-surface-variant); }
.slpq-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 1rem; font-size: 12px; line-height: 18px; color: var(--on-surface-variant); }
.slpq-foot > span:first-child { display: inline-flex; align-items: flex-start; gap: 0.375rem; }
.slpq-foot .material-symbols-outlined { color: var(--tertiary); flex: 0 0 auto; margin-top: 1px; }
.slpq-side { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.slpq-inspector { display: flex; flex-direction: column; gap: 1rem; }
.slpq-inspector-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; padding-bottom: 0.75rem; border-bottom: 1px solid var(--surface-mid); }
.slpq-inspector-head .slpc-inline .material-symbols-outlined { color: var(--primary); }
.slpq-inspector-code { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 20px; line-height: 28px; font-weight: 800; color: var(--primary); }
.slpq-inspector h2 { margin: 0; font-size: 18px; line-height: 26px; font-weight: 700; overflow-wrap: anywhere; }
.slpq-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.slpq-facts { display: flex; flex-direction: column; gap: 0.75rem; margin: 0; padding: 0.875rem; border-radius: 12px; background: var(--surface-low); font-size: 13px; line-height: 18px; }
.slpq-fact { display: flex; align-items: flex-start; gap: 0.625rem; }
.slpq-fact .material-symbols-outlined { flex: 0 0 auto; margin-top: 1px; }
.slpq-fact dd { margin: 0; display: flex; flex-direction: column; min-width: 0; }
.slpq-fact dd strong { font-weight: 600; overflow-wrap: anywhere; }
.slpq-fact dd span { color: var(--on-surface-variant); overflow-wrap: anywhere; }
.slpq-notes { padding: 0.75rem; border-radius: 12px; background: var(--surface-mid); font-size: 13px; line-height: 20px; white-space: pre-wrap; overflow-wrap: anywhere; }
.slpq-actions { display: flex; flex-direction: column; gap: 0.5rem; }
.slpq-actions .slpc-btn { width: 100%; justify-content: center; height: 40px; }
.slpq-policy { display: flex; flex-direction: column; gap: 0.5rem; padding: 1rem; }
.slpq-policy h3 { margin: 0; display: inline-flex; align-items: center; gap: 0.5rem; font-size: 12px; line-height: 16px; font-weight: 700; color: var(--primary); }
.slpq-policy p { margin: 0; font-size: 13px; line-height: 20px; color: var(--on-surface-variant); }
@media (max-width: 479px) {
  .slpq-views { width: 100%; }
  .slpq-view { flex: 1 1 auto; justify-content: center; padding: 0 8px; gap: 0.25rem; }
  .slpq-hero-tools .slpc-btn { flex: 1 1 auto; justify-content: center; padding: 0 12px; }
}
@media (min-width: 640px) {
  .slpq-day-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 768px) {
  .slpq-hero { flex-direction: row; align-items: flex-start; justify-content: space-between; }
  .slpq-hero-tools { justify-content: flex-end; max-width: 520px; }
  .slpq-nav-row { flex-direction: row; align-items: center; justify-content: space-between; }
}
@media (min-width: 1024px) {
  .slpq-title { font-size: 32px; line-height: 40px; }
}
@media (min-width: 1280px) {
  .slpq-split { grid-template-columns: minmax(0, 2fr) minmax(320px, 1fr); }
  .slpq-inspector-card { position: sticky; top: 5rem; }
}
@media print {
  .slpq-hero-tools, .slpq-nav, .slpq-side, .slpq-trail { display: none; }
  .slpq-split { grid-template-columns: minmax(0, 1fr); }
}
`

/* ---------- pieces ---------- */

function SessionCard({ entry, tone, lecturer, selected, onSelect }) {
  return (
    <button type="button" className={`slpq-session slpq-tone is-${tone} ${selected ? 'is-selected' : ''}`} onClick={onSelect} aria-pressed={selected} aria-label={`${entry.courseCode} ${entry.courseName}, ${DAYS[entry.dayIndex]} ${clock(entry.start)} to ${clock(entry.end)}${entry.room ? `, ${entry.room}` : ''}`}>
      <span className="slpq-session-top">
        <span className="slpq-session-tags">
          <span className="slpq-code">{entry.courseCode}</span>
          <span className="slpq-kind">{entry.recurring ? 'Weekly' : 'One-off'}</span>
        </span>
        <span className="slpq-session-title">{entry.courseName}</span>
      </span>
      <span className="slpq-session-meta">
        <span className="slpq-meta-item">
          {renderIcon('schedule', 16)}
          <span>
            {clock(entry.start)} – {clock(entry.end)}
          </span>
          <span>·</span>
          <span>{hoursText(entry.end - entry.start)}</span>
        </span>
        <span className="slpq-meta-row">
          <span className="slpq-meta-item is-room">
            {renderIcon('meeting_room', 16)}
            <span>{entry.room || 'Room not set'}</span>
          </span>
          {lecturer && (
            <span className="slpq-meta-item is-plain">
              {renderIcon('person', 15)}
              <span>{lecturer.full_name}</span>
            </span>
          )}
        </span>
      </span>
    </button>
  )
}

function Inspector({ entry, lecturer, tone }) {
  const head = (
    <div className="slpq-inspector-head">
      <span className="slpc-inline">
        {renderIcon('info', 20)}
        <span className="slpc-eyebrow">Session inspector</span>
      </span>
      {entry && <span className="slpq-kind">{entry.recurring ? 'Weekly' : 'One-off'}</span>}
    </div>
  )
  if (!entry) {
    return (
      <section className="slpc-card slpq-inspector slpq-inspector-card" aria-label="Session inspector">
        {head}
        <p className="slpc-empty">Select a session in the timetable to see its details here.</p>
      </section>
    )
  }
  const who = lecturerName(lecturer)
  return (
    <section className={`slpc-card slpq-inspector slpq-inspector-card slpq-tone is-${tone}`} aria-label="Session inspector">
      {head}
      <div className="slpc-stack" style={{ gap: '0.25rem' }}>
        <span className="slpq-inspector-code" style={{ color: 'var(--tone)' }}>
          {entry.courseCode}
        </span>
        <h2>{entry.courseName}</h2>
      </div>
      <dl className="slpq-facts">
        <div className="slpq-fact">
          <dt className="slpq-sr">Date and time</dt>
          {renderIcon('calendar_month', 18)}
          <dd>
            <strong>{longDate(entry.date)}</strong>
            <span>
              {clock(entry.start)} - {clock(entry.end)} ({Math.round(entry.end - entry.start)} mins)
            </span>
          </dd>
        </div>
        <div className="slpq-fact">
          <dt className="slpq-sr">Venue</dt>
          {renderIcon('pin_drop', 18)}
          <dd>
            <strong>{entry.room || 'Room not set'}</strong>
          </dd>
        </div>
        {who && (
          <div className="slpq-fact">
            <dt className="slpq-sr">Lecturer</dt>
            {renderIcon('badge', 18)}
            <dd>
              <strong>{who}</strong>
              {lecturer.department && <span>{lecturer.department}</span>}
            </dd>
          </div>
        )}
        <div className="slpq-fact">
          <dt className="slpq-sr">Recurrence</dt>
          {renderIcon('repeat', 18)}
          <dd>
            <strong>{entry.recurring ? `Every ${DAYS[entry.dayIndex]}` : 'One-off session'}</strong>
          </dd>
        </div>
      </dl>
      <div className="slpc-stack" style={{ gap: '0.375rem' }}>
        <span className="slpc-eyebrow">Preparation notes</span>
        <div className="slpq-notes">{entry.notes || 'No notes were added for this session.'}</div>
      </div>
      <div className="slpq-actions">
        <Link to={`/student/courses/${entry.courseId}/materials`} className="slpc-btn slpc-btn-primary">
          {renderIcon('folder_open', 18)}
          View lecture materials
        </Link>
        <Link to={`/student/courses/${entry.courseId}`} className="slpc-btn slpc-btn-soft">
          {renderIcon('menu_book', 18)}
          Open course page
        </Link>
      </div>
    </section>
  )
}

/* ---------- page ---------- */

export default function StudentTimetable() {
  useCourseFonts()
  const now = useClock()

  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))
  const [scope, setScope] = useState('all')
  const [room, setRoom] = useState('')
  const [view, setView] = useState('matrix')
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
  const lecturerOf = (courseId) => {
    const index = courses.findIndex((course) => course.id === courseId)
    return details[index]?.data?.lecturers?.[0]
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
  const visible = scoped.filter((entry) => !room || entry.room === room)
  const selected = visible.find((entry) => entry.id === selectedId) ?? visible[0]

  const minutesOf = (list) => list.reduce((sum, entry) => sum + (entry.end - entry.start), 0)
  const contactMinutes = minutesOf(scoped)
  const courseSplit = courses
    .map((course) => ({ course, minutes: minutesOf(scoped.filter((entry) => entry.courseId === course.id)) }))
    .filter((item) => item.minutes > 0)
  const scheduledCourses = new Set(weekEntries.map((entry) => entry.courseId)).size
  const clashes = findClashes(weekEntries)
  const weekend = weekEntries.some((entry) => entry.dayIndex >= 5)
  const dayCount = weekend ? 7 : 5

  const current = new Date(now)
  const todayIso = isoOf(current)
  const nowMinutes = current.getHours() * 60 + current.getMinutes()
  const todayInWeek = weekDays.some((day) => isoOf(day) === todayIso)
  const todayEntries = scoped.filter((entry) => isoOf(entry.date) === todayIso)
  const nextToday = todayEntries.find((entry) => entry.start > nowMinutes)

  const pickScope = (id) => {
    setScope(id)
    setRoom('')
  }
  const shiftWeek = (amount) => setWeekStart((value) => addDays(value, amount * 7))
  const goToday = () => {
    setWeekStart(mondayOf(new Date()))
    setDayPick((new Date().getDay() + 6) % 7)
  }
  const exportName = `timetable-${from}`
  const canExport = ready && visible.length > 0
  const dayEntries = visible.filter((entry) => entry.dayIndex === dayPick)

  const renderCard = (entry) => <SessionCard key={entry.id} entry={entry} tone={toneOf(entry.courseId)} lecturer={lecturerOf(entry.courseId)} selected={selected?.id === entry.id} onSelect={() => setSelectedId(entry.id)} />

  const renderRow = (entry) => (
    <li key={entry.id}>
      <button type="button" className={`slpq-row slpq-tone is-${toneOf(entry.courseId)} ${selected?.id === entry.id ? 'is-selected' : ''}`} onClick={() => setSelectedId(entry.id)} aria-pressed={selected?.id === entry.id}>
        <span className="slpq-row-time">
          {clock(entry.start)} - {clock(entry.end)}
        </span>
        <span className="slpq-row-main">
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
    <div className="slpc" aria-label="Timetable and academic schedule">
      <style>{COURSE_STYLES}</style>
      <style>{STUDENT_TIMETABLE_STYLES}</style>

      <div className="slpc-stack slpc-gap-lg">
        <nav className="slpc-trail slpq-trail" aria-label="Breadcrumb">
          <Link to="/student" className="slpc-trail-link">
            {renderIcon('home', 16)}
            Student Dashboard
          </Link>
          <span className="slpc-trail-sep">{renderIcon('chevron_right', 16)}</span>
          <span className="slpc-trail-item">Academic Planning</span>
          <span className="slpc-trail-sep">{renderIcon('chevron_right', 16)}</span>
          <span className="slpc-trail-current">Timetable &amp; Schedule</span>
        </nav>

        <section className="slpc-card slpq-hero" aria-labelledby="slpq-heading">
          <div className="slpc-stack" style={{ gap: '0.25rem', maxWidth: 640 }}>
            <h1 id="slpq-heading" className="slpq-title">
              Timetable &amp; Academic Schedule
            </h1>
            <p className="slpc-lead">View your lecture sessions, laboratory cohorts and seminars across the courses you are enrolled in. Rooms and times come from the institutional timetable and are read-only.</p>
          </div>
          <div className="slpq-hero-tools">
            <div className="slpq-views" role="tablist" aria-label="Timetable view">
              {VIEWS.map((entry) => (
                <button key={entry.id} type="button" role="tab" aria-selected={view === entry.id} className={`slpq-view ${view === entry.id ? 'is-active' : ''}`} onClick={() => setView(entry.id)}>
                  {renderIcon(entry.icon, 16)}
                  {entry.label}
                </button>
              ))}
            </div>
            <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => window.print()}>
              {renderIcon('print', 18)}
              Print / PDF
            </button>
            <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => downloadText(`${exportName}.csv`, buildCsv(visible), 'text/csv')} disabled={!canExport}>
              {renderIcon('table_view', 18)}
              CSV
            </button>
            <button type="button" className="slpc-btn slpc-btn-primary" onClick={() => downloadText(`${exportName}.ics`, buildIcs(visible), 'text/calendar')} disabled={!canExport}>
              {renderIcon('sync', 18)}
              Export iCal
            </button>
          </div>
        </section>

        <div className="slpc-stats" aria-label="Week summary">
          <div className="slpc-card slpc-stat">
            <div className="slpc-stat-top">
              <span className="slpc-stat-label">Weekly contact hours</span>
              <span className="slpc-stat-icon is-fixed">{renderIcon('timelapse', 18)}</span>
            </div>
            <div className="slpc-stat-body">
              <span className="slpc-stat-value">{ready ? hoursText(contactMinutes).replace(' hrs', '') : '—'}</span>
              <span className="slpc-stat-unit">hrs / week</span>
            </div>
            {ready && courseSplit.length > 0 ? (
              <>
                <div className="slpq-bar" aria-hidden="true">
                  {courseSplit.map((item) => (
                    <span key={item.course.id} className={`slpq-tone is-${toneOf(item.course.id)}`} style={{ width: `${(item.minutes / contactMinutes) * 100}%`, background: 'var(--tone)' }} />
                  ))}
                </div>
                <div className="slpq-legend">
                  {courseSplit.map((item) => (
                    <span key={item.course.id}>
                      {hoursText(item.minutes).replace(' hrs', 'h')} {item.course.course_code}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className="slpc-stat-foot">{ready ? 'No sessions in this week' : 'Waiting for the timetable'}</div>
            )}
          </div>

          <div className="slpc-card slpc-stat">
            <div className="slpc-stat-top">
              <span className="slpc-stat-label">Today&apos;s schedule</span>
              <span className="slpq-today-chip">{todayChip(current)}</span>
            </div>
            <div className="slpc-stat-body" style={{ minHeight: 40 }}>
              <span className="slpq-stat-title">{ready && todayInWeek ? plural(todayEntries.length, 'Session') : '—'}</span>
            </div>
            <div className="slpq-next">
              {ready && todayInWeek && nextToday ? (
                <>
                  <span className="slpq-live" />
                  <span>
                    Next: <strong>{nextToday.courseCode}</strong> at {clock(nextToday.start)}
                    {nextToday.room ? ` (${nextToday.room})` : ''}
                  </span>
                </>
              ) : (
                <span>{ready && todayInWeek ? (todayEntries.length > 0 ? 'No more sessions today' : 'Nothing scheduled today') : 'Today is not in the week shown'}</span>
              )}
            </div>
            <div className="slpc-stat-foot">
              <Link to="/student/attendance" className="slpq-stat-link">
                {renderIcon('check_circle', 16)}
                Open attendance tracker
              </Link>
            </div>
          </div>

          <div className="slpc-card slpc-stat">
            <div className="slpc-stat-top">
              <span className="slpc-stat-label">Campus venues</span>
              <span className="slpc-stat-icon is-mid">{renderIcon('location_on', 18)}</span>
            </div>
            <div className="slpc-stat-body">
              <span className="slpc-stat-value">{ready ? rooms.length : '—'}</span>
              <span className="slpc-stat-unit">{rooms.length === 1 ? 'location' : 'locations'}</span>
            </div>
            <div className="slpq-stat-sub">{ready && rooms.length > 0 ? rooms.slice(0, 4).join(', ') : 'No rooms listed'}</div>
            <div className="slpc-stat-foot">Rooms used by the sessions shown</div>
          </div>

          <div className="slpc-card slpc-stat">
            <div className="slpc-stat-top">
              <span className="slpc-stat-label">Modules scheduled</span>
              <span className="slpc-stat-icon is-ok">{renderIcon(ready && clashes > 0 ? 'warning' : 'verified', 18)}</span>
            </div>
            <div className="slpc-stat-body">
              <span className="slpq-stat-title">{ready ? `${scheduledCourses} of ${courses.length}` : '—'}</span>
            </div>
            <div className="slpq-stat-sub">Enrolled modules with sessions this week</div>
            <div className="slpc-stat-foot" style={{ color: ready ? (clashes > 0 ? 'var(--warn)' : 'var(--ok)') : undefined }}>
              {ready ? (clashes === 0 ? 'No overlapping sessions' : `${plural(clashes, 'clash', 'clashes')} this week`) : 'Waiting for the timetable'}
            </div>
          </div>
        </div>

        <section className="slpc-card slpq-nav" aria-label="Choose week and module">
          <div className="slpq-nav-row">
            <div className="slpq-weekbar">
              <div className="slpq-stepper" role="group" aria-label="Week navigation">
                <button type="button" className="slpq-step" onClick={() => shiftWeek(-1)} aria-label="Previous week" title="Previous week">
                  {renderIcon('chevron_left', 18)}
                </button>
                <button type="button" className="slpq-today-btn" onClick={goToday}>
                  Today
                </button>
                <button type="button" className="slpq-step" onClick={() => shiftWeek(1)} aria-label="Next week" title="Next week">
                  {renderIcon('chevron_right', 18)}
                </button>
              </div>
              <div className="slpq-week-label" aria-live="polite">
                <strong>Week of {shortDate(weekDays[0])}</strong>
                <span>
                  · {longDate(weekDays[0])} – {longDate(weekDays[dayCount - 1])}, {weekDays[0].getFullYear()}
                </span>
              </div>
            </div>
            <label className="slpq-select-wrap" style={{ minWidth: 200 }}>
              <select className="slpc-select" value={room} onChange={(event) => setRoom(event.target.value)} aria-label="Filter by venue">
                <option value="">All campus venues</option>
                {rooms.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              {renderIcon('expand_more', 16)}
            </label>
          </div>
          <div className="slpq-chips" role="group" aria-label="Module filter">
            <span className="slpq-chips-label">Modules:</span>
            <button type="button" className={`slpq-chip ${scope === 'all' ? 'is-active' : ''}`} onClick={() => pickScope('all')} aria-pressed={scope === 'all'}>
              All modules{coursesQuery.isSuccess ? ` (${courses.length}${ready ? ` · ${hoursText(minutesOf(weekEntries)).replace(' hrs', 'h')}` : ''})` : ''}
            </button>
            {courses.map((course) => {
              const hours = minutesOf(weekEntries.filter((entry) => entry.courseId === course.id))
              return (
                <button key={course.id} type="button" className={`slpq-chip slpq-tone is-${toneOf(course.id)} ${scope === course.id ? 'is-active' : ''}`} onClick={() => pickScope(course.id)} aria-pressed={scope === course.id}>
                  <span className="slpq-dot" />
                  {course.course_code}: {course.course_name}
                  {ready ? ` (${hoursText(hours).replace(' hrs', 'h')})` : ''}
                </button>
              )
            })}
          </div>
        </section>

        <div className="slpq-split">
          <div className="slpq-main">
            {loading && <Skeleton height={320} label="Loading timetable" />}
            {coursesQuery.isError && <ErrorCard message="Your courses could not be loaded." onRetry={() => coursesQuery.refetch()} />}
            {coursesQuery.isSuccess && courses.length === 0 && <p className="slpc-card slpc-empty">You are not enrolled in any courses yet, so there is no timetable to show.</p>}
            {failed && <ErrorCard message={errorText(timetable.error, 'The timetable could not be loaded.')} onRetry={() => timetable.refetch()} />}
            {notReady && (
              <PhasePanel icon="calendar_month" title="The timetable is not switched on yet" phase="Phase 8">
                The timetable service is not available on the server yet. This page is ready: once it is enabled, your sessions for each week will appear here.
              </PhasePanel>
            )}
            {ready && courses.length > 0 && weekEntries.length === 0 && (
              <p className="slpc-card slpc-empty">
                No sessions are scheduled for {shortDate(weekDays[0])} – {shortDate(weekDays[6])}.
              </p>
            )}
            {ready && weekEntries.length > 0 && visible.length === 0 && <p className="slpc-card slpc-empty">No sessions match these filters.</p>}

            {ready && weekEntries.length > 0 && visible.length > 0 && view === 'matrix' &&
              weekDays.slice(0, dayCount).map((day, index) => {
                const rows = visible.filter((entry) => entry.dayIndex === index)
                const hours = minutesOf(rows)
                return (
                  <section key={DAYS[index]} className="slpc-card slpq-day" aria-label={`${DAYS[index]} sessions`}>
                    <div className="slpq-day-head">
                      <div className="slpq-day-name">
                        <strong>{DAYS[index]}</strong>
                        <span>{day.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                        {isoOf(day) === todayIso && <span className="slpq-now-pill">Today</span>}
                      </div>
                      <span className="slpq-day-count">
                        {rows.length === 0 ? 'No sessions' : `${plural(rows.length, 'Session')} scheduled (${hoursText(hours).replace(' hrs', '')} contact ${hours === 60 ? 'hour' : 'hours'})`}
                      </span>
                    </div>
                    {rows.length === 0 ? (
                      <div className="slpq-free">
                        {renderIcon('auto_stories', 20)}
                        <span>Nothing scheduled: self-directed study time</span>
                      </div>
                    ) : (
                      <div className="slpq-day-grid">{rows.map(renderCard)}</div>
                    )}
                  </section>
                )
              })}

            {ready && weekEntries.length > 0 && view === 'agenda' && (
              <section className="slpc-card slpq-board" aria-label="Daily agenda">
                <div className="slpq-day-tabs" role="tablist" aria-label="Day of the week">
                  {weekDays.slice(0, dayCount).map((day, index) => (
                    <button key={DAYS[index]} type="button" role="tab" aria-selected={dayPick === index} className={`slpq-day-tab ${dayPick === index ? 'is-active' : ''}`} onClick={() => setDayPick(index)}>
                      {DAYS[index].slice(0, 3)}
                      <small>{shortDate(day)}</small>
                    </button>
                  ))}
                </div>
                {dayEntries.length === 0 ? <p className="slpc-empty">No sessions on {longDate(weekDays[dayPick])}.</p> : <ul className="slpq-list">{dayEntries.map(renderRow)}</ul>}
              </section>
            )}

            {ready && visible.length > 0 && view === 'list' && (
              <section className="slpc-card slpq-board" aria-label="Session list">
                <ul className="slpq-list">
                  {weekDays.slice(0, dayCount).flatMap((day, index) => {
                    const rows = visible.filter((entry) => entry.dayIndex === index)
                    if (rows.length === 0) return []
                    return [
                      <li key={`h-${DAYS[index]}`} className="slpq-list-day" aria-hidden="true">
                        {longDate(day)}
                      </li>,
                      ...rows.map(renderRow),
                    ]
                  })}
                </ul>
              </section>
            )}

            <div className="slpq-foot">
              <span>
                {renderIcon('info', 16)}
                Times are shown exactly as stored in the institutional timetable.
              </span>
              <span className="slpc-chip is-quiet">
                {from} to {to}
              </span>
            </div>
          </div>

          <div className="slpq-side">
            <Inspector entry={ready ? selected : undefined} lecturer={selected ? lecturerOf(selected.courseId) : undefined} tone={selected ? toneOf(selected.courseId) : 't0'} />
            <section className="slpc-card slpq-policy" aria-label="Timetable policy">
              <h3>
                {renderIcon('gavel', 18)}
                Matriculation timetable policy
              </h3>
              <p>Your timetable is read-only and follows the courses you are enrolled in. Room changes, relocations or make-up lectures are set by the Academic Registrar and appear here once published.</p>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
