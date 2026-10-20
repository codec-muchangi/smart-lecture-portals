import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
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
import { formatSemester, sentenceCase, toList } from '../../utils/format.js'

/*
 * Smart Lecture Portal: lecturer Academic Reports & Cohort Analytics
 * Place at: src/pages/lecturer/LecturerReports.jsx
 *
 * Routes (see routes.jsx):
 *   /lecturer/reports                    the first course you teach
 *   /lecturer/courses/:courseId/reports  that course
 *
 * - Renders inside AppShell, which already draws the sidebar and top bar.
 * - Built on the contract in docs/API.md (Dashboards & reports) and docs/FRONTEND.md (Reports):
 *     GET /courses                                    assigned courses
 *     GET /courses/{id}                               enrolled_count, credit_hours, status
 *     GET /courses/{id}/reports/attendance            per-student totals and per-session counts
 *     GET /courses/{id}/reports/performance           per-assessment stats and per-student weighted totals
 *     GET /courses/{id}/reports/submissions           per-assignment submitted / late / graded / missing counts
 * - Assumed shapes (the docs name the contents, not the keys; the page accepts the usual spellings):
 *     attendance   { students: [{ student_id, full_name, registration_number, present, late, absent, excused }],
 *                    sessions: [{ id, session_date, topic, present, late, absent, excused }] }
 *     performance  { students: [{ student_id, full_name, registration_number, weighted_total, weight_covered }],
 *                    assessments: [{ id, name, type, max_marks, weight, marks_entered, mean, min, max }] }
 *     submissions  { assignments: [{ id, title, due_at, max_marks, total, submitted, late, graded, missing }] }
 * - The report backend arrives in Phase 8. Until the server answers, the page says so plainly and shows no
 *   figures. It never invents students, grades, syllabus progress or "verified" claims.
 * - Everything on the page is worked out from the rows the server returned, so the totals reconcile with
 *   the tables: attendance follows db/migrations/0002_views.sql (attended = present + late, counted =
 *   present + late + absent, excused not counted); a student's weighted result is weighted_total as a
 *   percentage of weight_covered (the weight marked so far). ATTENDANCE_MIN and PASS_PERCENT are the
 *   portal's reference thresholds; change those two constants if the institution's policy differs.
 * - The API has no letter grades, credit-hour progress, syllabus completion, disputes, audit hashes, PDF
 *   export or messaging, so none are drawn. "Export CSV" builds the table you are looking at in the browser.
 */

const NOT_READY = [404, 405, 501]
const ATTENDANCE_MIN = 75
const PASS_PERCENT = 50
const PAGE_SIZE = 8
const TABS = [
  { id: 'overview', label: 'Performance overview', icon: 'dashboard_customize' },
  { id: 'attendance', label: 'Attendance summary', icon: 'calendar_month' },
  { id: 'submissions', label: 'Assignment submissions', icon: 'folder_shared' },
  { id: 'marks', label: 'Assessment & marks', icon: 'grading' },
]
const BANDS = [
  { id: 'a', label: '80% – 100%', test: (p) => p >= 80 },
  { id: 'b', label: '70% – 79%', test: (p) => p >= 70 && p < 80 },
  { id: 'c', label: '60% – 69%', test: (p) => p >= 60 && p < 70 },
  { id: 'd', label: '50% – 59%', test: (p) => p >= 50 && p < 60 },
  { id: 'f', label: 'Below 50%', test: (p) => p < 50 },
]
const RISKS = [
  { id: 'all', label: 'All standings' },
  { id: 'risk', label: 'Needs attention' },
  { id: 'good', label: 'Good standing' },
]
const SORTS = [
  { id: 'name', label: 'Sort: Name (A–Z)' },
  { id: 'result', label: 'Sort: Weighted result (high to low)' },
  { id: 'attendance', label: 'Sort: Attendance (lowest first)' },
]
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const courseKey = (courseId) => ['course', courseId]
const attendanceKey = (courseId) => ['attendance-report', courseId]
const performanceKey = (courseId) => ['performance-report', courseId]
const submissionsKey = (courseId) => ['submissions-report', courseId]
const isNotReady = (error) => NOT_READY.includes(error?.status)

const REPORT_STYLES = `
.slpr-topbar { display: flex; flex-direction: column; gap: 0.75rem; }
.slpr-crumb-code { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-weight: 700; color: var(--primary); overflow-wrap: anywhere; }
.slpr-scope { display: flex; gap: 0.5rem; overflow-x: auto; padding-bottom: 4px; }
.slpr-scope-btn { display: inline-flex; align-items: center; gap: 0.5rem; flex: 0 0 auto; padding: 8px 18px; border: 0; border-radius: 999px; background: var(--surface-low); color: var(--on-surface); font-size: 12px; line-height: 18px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.slpr-scope-btn:hover { background: var(--surface-mid); }
.slpr-scope-btn.is-active { background: var(--primary-container); color: var(--on-primary-container); box-shadow: 0 2px 8px rgba(193, 74, 56, 0.2); }
.slpr-scope-btn i { width: 8px; height: 8px; border-radius: 999px; background: #fff; }
.slpr-hero { display: flex; flex-direction: column; gap: 0.75rem; padding: 1.5rem; }
.slpr-title { font-size: 24px; line-height: 32px; font-weight: 800; letter-spacing: -0.02em; overflow-wrap: anywhere; }
.slpr-badges { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.slpr-badge { display: inline-flex; align-items: center; gap: 0.375rem; padding: 3px 10px; border-radius: 999px; background: var(--surface-high); color: var(--on-surface-variant); font-size: 11px; line-height: 16px; font-weight: 700; }
.slpr-badge.is-ok { background: var(--ok-bg); color: var(--ok); }
.slpr-badge.is-warm { background: var(--primary-fixed); color: var(--on-primary-fixed); }
.slpr-badge i { width: 6px; height: 6px; border-radius: 999px; background: currentColor; }
.slpr-facts { display: flex; flex-wrap: wrap; gap: 0.25rem 0.75rem; margin: 0; padding: 0; list-style: none; font-size: 11px; line-height: 16px; font-weight: 600; color: var(--on-surface-variant); }
.slpr-facts strong { color: var(--on-surface); }
.slpr-facts li + li::before { content: '•'; margin-right: 0.75rem; color: var(--outline); }
.slpr-cards { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; }
.slpr-card { display: flex; flex-direction: column; gap: 0.75rem; min-width: 0; padding: 1.25rem; overflow: hidden; }
.slpr-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; }
.slpr-eyebrow { font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpr-icon { width: 32px; height: 32px; border-radius: 10px; background: var(--surface-low); color: var(--primary); display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.slpr-big { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.5rem; }
.slpr-big strong { font-size: 36px; line-height: 40px; font-weight: 800; letter-spacing: -0.025em; }
.slpr-big span { font-size: 12px; line-height: 16px; font-weight: 600; color: var(--on-surface-variant); }
.slpr-chip { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; background: var(--ok-bg); color: var(--ok); font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 16px; font-weight: 700; white-space: nowrap; }
.slpr-chip.is-warn { background: var(--warn-bg); color: var(--warn); }
.slpr-chip.is-risk { background: var(--error-container); color: var(--on-error-container); }
.slpr-bar { height: 6px; border-radius: 999px; background: var(--surface-high); overflow: hidden; }
.slpr-bar > span { display: block; height: 100%; border-radius: 999px; background: var(--primary); transition: width 0.4s; }
.slpr-bar.is-ok > span { background: var(--ok); }
.slpr-bar.is-low > span { background: var(--tertiary); }
.slpr-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.25rem 0.75rem; font-size: 12px; line-height: 16px; color: var(--on-surface-variant); }
.slpr-foot strong { font-weight: 700; }
.slpr-foot .is-ok { color: var(--ok); }
.slpr-foot .is-risk { color: var(--error); }
.slpr-spark { display: flex; align-items: flex-end; gap: 4px; height: 28px; }
.slpr-spark span { flex: 1 1 0; min-height: 3px; border-radius: 3px 3px 0 0; background: var(--primary-container); opacity: 0.55; }
.slpr-spark span.is-f { background: var(--error); opacity: 0.8; }
.slpr-tabs { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.5rem; background: var(--surface-low); }
.slpr-tablist { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; max-width: 100%; }
.slpr-tab { display: inline-flex; align-items: center; gap: 0.5rem; flex: 0 0 auto; padding: 9px 16px; border: 0; border-radius: 12px; background: transparent; color: var(--on-surface-variant); font-size: 13px; line-height: 18px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.slpr-tab:hover { background: var(--surface-high); color: var(--on-surface); }
.slpr-tab.is-active { background: var(--surface-lowest); color: var(--primary); font-weight: 700; box-shadow: 0 1px 2px rgba(30, 26, 35, 0.12); }
.slpr-filters { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.5rem; padding: 0.75rem; background: var(--surface-low); align-items: center; }
.slpr-filters .slpc-search { height: 40px; border-radius: 12px; background: var(--surface-lowest); }
.slpr-filters .slpc-select { height: 40px; border-radius: 12px; background: var(--surface-lowest); width: 100%; min-width: 0; }
.slpr-reset { width: 40px; height: 40px; border: 0; border-radius: 12px; background: var(--surface-lowest); color: var(--on-surface-variant); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.slpr-reset:hover { background: var(--surface-high); color: var(--on-surface); }
.slpr-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.slpr-col { display: flex; flex-direction: column; gap: 1.25rem; min-width: 0; }
.slpr-panel { display: flex; flex-direction: column; gap: 1rem; padding: 1.5rem; min-width: 0; }
.slpr-panel-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 0.75rem; }
.slpr-h { font-size: 17px; line-height: 24px; font-weight: 700; letter-spacing: -0.005em; }
.slpr-sub { margin-top: 2px; font-size: 12px; line-height: 18px; color: var(--on-surface-variant); overflow-wrap: anywhere; }
.slpr-legend { display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; font-size: 11px; font-weight: 600; color: var(--on-surface-variant); }
.slpr-legend span { display: inline-flex; align-items: center; gap: 0.375rem; }
.slpr-legend i { width: 10px; height: 10px; border-radius: 3px; background: var(--ok); }
.slpr-legend i.is-risk { background: var(--error); }
.slpr-hist { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 0.5rem; align-items: end; }
.slpr-band { display: flex; flex-direction: column; align-items: stretch; gap: 6px; min-width: 0; padding: 0.625rem 0.375rem; border-radius: 12px; background: var(--surface-low); text-align: center; }
.slpr-band.is-f { background: rgba(255, 218, 214, 0.45); }
.slpr-band strong { font-size: 18px; line-height: 24px; font-weight: 800; }
.slpr-band-track { display: flex; align-items: flex-end; height: 96px; }
.slpr-band-fill { width: 100%; border-radius: 8px 8px 0 0; background: var(--ok); min-height: 4px; transition: height 0.4s; }
.slpr-band.is-b .slpr-band-fill { background: #5b9e86; }
.slpr-band.is-c .slpr-band-fill { background: #c28a3a; }
.slpr-band.is-d .slpr-band-fill { background: #b2563e; }
.slpr-band.is-f .slpr-band-fill { background: var(--error); }
.slpr-band span { font-size: 10px; line-height: 14px; font-weight: 600; color: var(--on-surface-variant); }
.slpr-band span.is-range { font-size: 11px; font-weight: 700; color: var(--on-surface); }
.slpr-banner { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.875rem 1rem; border-radius: 12px; background: var(--error-container); color: var(--on-error-container); }
.slpr-banner-main { display: flex; align-items: flex-start; gap: 0.625rem; min-width: 0; font-size: 13px; line-height: 18px; }
.slpr-banner-main strong { display: block; font-weight: 700; }
.slpr-banner-main span:last-child { overflow-wrap: anywhere; }
.slpr-table-wrap { overflow-x: auto; border-radius: 12px; }
.slpr-table { width: 100%; border-collapse: collapse; font-size: 13px; line-height: 18px; }
.slpr-table th { padding: 10px 12px; background: var(--surface-low); color: var(--on-surface-variant); font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; text-align: left; white-space: nowrap; }
.slpr-table td { padding: 12px; vertical-align: middle; border-top: 1px solid var(--surface-mid); }
.slpr-table tr.is-selected td { background: var(--surface-low); }
.slpr-person { display: flex; align-items: center; gap: 0.625rem; min-width: 0; }
.slpr-avatar { width: 34px; height: 34px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; font-size: 12px; font-weight: 800; background: var(--primary-fixed); color: var(--primary); }
.slpr-avatar.is-t1 { background: var(--secondary-container); color: var(--on-secondary-container); }
.slpr-avatar.is-t2 { background: var(--tertiary-fixed); color: var(--on-tertiary-fixed); }
.slpr-avatar.is-risk { background: var(--error); color: #fff; }
.slpr-name { font-weight: 700; overflow-wrap: anywhere; }
.slpr-reg { display: block; font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 16px; color: var(--outline); overflow-wrap: anywhere; }
.slpr-mono { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
.slpr-ok { color: var(--ok); font-weight: 700; }
.slpr-bad { color: var(--error); font-weight: 700; }
.slpr-stand { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px; background: var(--ok-bg); color: var(--ok); font-size: 11px; line-height: 16px; font-weight: 700; white-space: nowrap; }
.slpr-stand.is-warn { background: var(--warn-bg); color: var(--warn); }
.slpr-stand.is-risk { background: var(--error-container); color: var(--on-error-container); }
.slpr-stand.is-none { background: var(--surface-high); color: var(--on-surface-variant); }
.slpr-act { height: 30px; padding: 0 12px; border: 0; border-radius: 999px; background: var(--surface-high); color: var(--on-surface); font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.slpr-act:hover { background: var(--surface-highest); }
.slpr-act.is-active { background: var(--primary-container); color: var(--on-primary-container); }
.slpr-pager { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; font-size: 12px; color: var(--on-surface-variant); }
.slpr-sessions { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 0.5rem; margin: 0; padding: 0; list-style: none; }
.slpr-session { display: flex; flex-direction: column; gap: 2px; padding: 0.625rem 0.75rem; border-radius: 12px; background: var(--surface-low); min-width: 0; }
.slpr-session strong { font-size: 11px; line-height: 14px; font-weight: 700; color: var(--on-surface-variant); }
.slpr-session b { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 14px; line-height: 20px; }
.slpr-session span { font-size: 10px; line-height: 14px; color: var(--ok); font-weight: 600; }
.slpr-session.is-low span { color: var(--error); }
.slpr-session .slpr-bar { margin-top: 4px; }
.slpr-side { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.slpr-dossier { display: flex; flex-direction: column; gap: 1rem; }
.slpr-dossier-who { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
.slpr-dossier-who .slpr-avatar { width: 52px; height: 52px; font-size: 17px; background: var(--primary); color: var(--on-primary); }
.slpr-dossier-who h3 { font-size: 18px; line-height: 24px; font-weight: 800; overflow-wrap: anywhere; }
.slpr-ringrow { display: flex; align-items: center; gap: 1rem; padding: 0.875rem; border-radius: 16px; background: var(--surface-low); }
.slpr-ring { position: relative; width: 80px; height: 80px; flex: 0 0 auto; }
.slpr-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); display: block; }
.slpr-ring-track { stroke: var(--surface-high); }
.slpr-ring-fill { stroke: var(--primary); stroke-linecap: round; }
.slpr-ring-fill.is-low { stroke: var(--error); }
.slpr-ring-text { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 800; letter-spacing: -0.02em; }
.slpr-rows { display: flex; flex-direction: column; gap: 0.5rem; margin: 0; padding: 0; list-style: none; }
.slpr-row { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.625rem 0.75rem; border-radius: 12px; background: var(--surface-low); font-size: 13px; line-height: 18px; }
.slpr-row span:first-child { display: inline-flex; align-items: center; gap: 0.5rem; min-width: 0; }
.slpr-row .material-symbols-outlined { color: var(--primary); }
.slpr-row b { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 12px; white-space: nowrap; }
.slpr-callout { display: flex; align-items: flex-start; gap: 0.625rem; padding: 0.75rem; border-radius: 12px; background: var(--ok-bg); color: var(--ok); font-size: 13px; line-height: 18px; }
.slpr-callout strong { display: block; font-weight: 700; }
.slpr-callout.is-warn { background: var(--warn-bg); color: var(--warn); }
.slpr-callout.is-risk { background: var(--error-container); color: var(--on-error-container); }
.slpr-note { display: flex; align-items: flex-start; gap: 0.5rem; font-size: 12px; line-height: 18px; color: var(--on-surface-variant); }
.slpr-note .material-symbols-outlined { color: var(--outline); }
@media (min-width: 640px) {
  .slpr-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .slpr-filters { grid-template-columns: minmax(0, 1fr) 190px 260px auto; }
}
@media (min-width: 1024px) {
  .slpr-topbar { flex-direction: row; align-items: center; justify-content: space-between; }
  .slpr-title { font-size: 28px; line-height: 36px; }
}
@media (min-width: 1280px) {
  .slpr-cards { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .slpr-split { grid-template-columns: minmax(0, 2fr) minmax(300px, 1fr); }
  .slpr-sticky { position: sticky; top: 5rem; }
}
@media (max-width: 767px) {
  .slpr-table-wrap { overflow: visible; }
  .slpr-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .slpr-table, .slpr-table tbody, .slpr-table tr, .slpr-table td { display: block; width: 100%; }
  .slpr-table tr { margin-bottom: 0.75rem; padding: 0.75rem; border-radius: 12px; background: var(--surface-low); }
  .slpr-table tr.is-selected { box-shadow: 0 0 0 2px var(--primary-container); }
  .slpr-table td { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 6px 0; border: 0; text-align: right; }
  .slpr-table tr.is-selected td { background: transparent; }
  .slpr-table td::before { content: attr(data-label); flex: 0 0 auto; font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--on-surface-variant); text-align: left; }
  .slpr-table td.is-primary { display: block; text-align: left; padding-bottom: 8px; }
  .slpr-table td.is-primary::before { display: none; }
  .slpr-panel { padding: 1.125rem; }
  .slpr-hist { gap: 0.25rem; }
  .slpr-band { padding: 0.5rem 0.125rem; }
  .slpr-band span.is-range { font-size: 9px; }
}
@media (max-width: 479px) {
  .slpr-hero { padding: 1.125rem; }
  .slpr-ringrow { flex-direction: column; align-items: flex-start; }
}
`

/* ---------- helpers ---------- */

const numberOr = (value) => (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null)
const pctText = (value) => (value === null || value === undefined ? '—' : `${trimNumber(value)}%`)
const num = (value) => (value === null || value === undefined ? '—' : trimNumber(value))

function pickList(data, keys) {
  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key]
  }
  return Array.isArray(data) ? data : toList(data)
}

function parseDay(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(text ?? ''))
  return match ? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), iso: `${match[1]}-${match[2]}-${match[3]}` } : null
}

const shortDay = (day) => (day ? `${day.day} ${MONTHS[day.month - 1]}` : '')
const fullDay = (day) => (day ? `${day.day} ${MONTHS[day.month - 1]} ${day.year}` : '—')

function readAttendance(raw) {
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
  return { id: String(id), name: raw.full_name ?? raw.name ?? '', reg: raw.registration_number ?? raw.reg_no ?? '', present, late, absent, excused, attended, counted, pct }
}

function readPerformance(raw) {
  const id = raw?.student_id ?? raw?.id
  if (!id) return null
  const total = numberOr(raw.weighted_total ?? raw.total)
  const covered = numberOr(raw.weight_covered ?? raw.covered)
  const pct = covered > 0 && total !== null ? (total / covered) * 100 : numberOr(raw.percentage ?? raw.percent)
  return { id: String(id), name: raw.full_name ?? raw.name ?? '', reg: raw.registration_number ?? raw.reg_no ?? '', total, covered, pct }
}

function readSession(raw, index) {
  const present = numberOr(raw?.present) ?? 0
  const late = numberOr(raw?.late) ?? 0
  const absent = numberOr(raw?.absent) ?? 0
  const excused = numberOr(raw?.excused) ?? 0
  const attended = present + late
  const counted = attended + absent
  return { key: String(raw?.id ?? raw?.session_id ?? index), date: parseDay(raw?.session_date), topic: raw?.topic ?? '', present, late, absent, excused, attended, counted, pct: counted > 0 ? (attended / counted) * 100 : null }
}

function readAssessment(raw, index) {
  return {
    key: String(raw?.id ?? raw?.assessment_id ?? index),
    name: raw?.name ?? raw?.title ?? 'Assessment',
    type: raw?.type ?? '',
    maxMarks: numberOr(raw?.max_marks),
    weight: numberOr(raw?.weight),
    entered: numberOr(raw?.marks_entered ?? raw?.count),
    mean: numberOr(raw?.mean ?? raw?.average ?? raw?.avg),
    min: numberOr(raw?.min ?? raw?.lowest),
    max: numberOr(raw?.max ?? raw?.highest),
  }
}

function readAssignment(raw, index, enrolled) {
  const submitted = numberOr(raw?.submitted) ?? 0
  const late = numberOr(raw?.late) ?? 0
  const graded = numberOr(raw?.graded) ?? 0
  const missing = numberOr(raw?.missing) ?? 0
  const total = numberOr(raw?.total ?? raw?.enrolled ?? raw?.expected) ?? enrolled
  const received = total !== null && total !== undefined ? Math.max(0, total - missing) : submitted + late + graded
  const expected = total !== null && total !== undefined ? total : received + missing
  return {
    key: String(raw?.id ?? raw?.assignment_id ?? index),
    title: raw?.title ?? raw?.name ?? 'Assignment',
    due: parseDay(raw?.due_at),
    maxMarks: numberOr(raw?.max_marks),
    submitted,
    late,
    graded,
    missing,
    received,
    expected,
    pct: expected > 0 ? (received / expected) * 100 : null,
  }
}

// A student's standing combines the attendance rule and the pass mark on the weight marked so far.
function standingOf(student) {
  const lowAttendance = student.attendance && student.attendance.counted > 0 && student.attendance.pct !== null && student.attendance.pct < ATTENDANCE_MIN
  const lowMarks = student.performance && student.performance.pct !== null && student.performance.pct < PASS_PERCENT
  if (lowAttendance && lowMarks) return { id: 'both', label: 'Needs attention', tone: 'risk', flagged: true, reason: `Attendance is under ${ATTENDANCE_MIN}% and marks are under ${PASS_PERCENT}% of the weight marked so far.` }
  if (lowMarks) return { id: 'marks', label: 'Marks at risk', tone: 'risk', flagged: true, reason: `Marks are under ${PASS_PERCENT}% of the weight marked so far.` }
  if (lowAttendance) return { id: 'attendance', label: 'Attendance warning', tone: 'warn', flagged: true, reason: `Attendance is under the ${ATTENDANCE_MIN}% minimum.` }
  const hasData = (student.attendance && student.attendance.pct !== null) || (student.performance && student.performance.pct !== null)
  return hasData ? { id: 'good', label: 'Good standing', tone: 'ok', flagged: false, reason: 'Attendance and marks are both within the portal thresholds.' } : { id: 'none', label: 'No data yet', tone: 'none', flagged: false, reason: 'Nothing has been recorded for this student yet.' }
}

function csvCell(value) {
  let text = String(value ?? '')
  if (/^[=+\-@]/.test(text)) text = `'${text}`
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function toCsv(header, rows) {
  return [header, ...rows].map((line) => line.map(csvCell).join(',')).join('\n')
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

function Table({ label, columns, rows, rowKey, selectedKey }) {
  return (
    <div className="slpr-table-wrap">
      <table className="slpr-table" aria-label={label}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className={selectedKey && selectedKey === rowKey(row) ? 'is-selected' : ''}>
              {columns.map((column, index) => (
                <td key={column.key} data-label={column.label} className={index === 0 ? 'is-primary' : ''}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Person({ student, index }) {
  const standing = student.standing
  return (
    <div className="slpr-person">
      <span className={`slpr-avatar is-t${index % 3} ${standing.tone === 'risk' ? 'is-risk' : ''}`} aria-hidden="true">
        {initials(student.name)}
      </span>
      <span style={{ minWidth: 0 }}>
        <span className="slpr-name">{student.name || 'Student'}</span>
        {student.reg && <span className="slpr-reg">#{student.reg}</span>}
      </span>
    </div>
  )
}

function Waiting({ phase, children }) {
  return (
    <p className="slpc-empty">
      {children} <span className="slpc-pill">Coming in {phase}</span>
    </p>
  )
}

/* ---------- page ---------- */

export default function LecturerReports() {
  useCourseFonts()
  const { courseId: routeCourseId } = useParams()
  const [pickedCourse, setPickedCourse] = useState(routeCourseId || '')
  const [tab, setTab] = useState('overview')
  const [search, setSearch] = useState('')
  const [risk, setRisk] = useState('all')
  const [sort, setSort] = useState('name')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState('')

  const coursesQuery = useQuery({ queryKey: COURSES_KEY, queryFn: fetchCourses })
  const courses = toList(coursesQuery.data)
  const course = courses.find((entry) => entry.id === pickedCourse) ?? courses[0]
  const courseId = course?.id

  const detailQuery = useQuery({ queryKey: courseKey(courseId), queryFn: () => api(`/courses/${courseId}`), enabled: Boolean(courseId) })
  const attendanceQuery = useQuery({ queryKey: attendanceKey(courseId), queryFn: () => api(`/courses/${courseId}/reports/attendance`), enabled: Boolean(courseId), retry: false })
  const performanceQuery = useQuery({ queryKey: performanceKey(courseId), queryFn: () => api(`/courses/${courseId}/reports/performance`), enabled: Boolean(courseId), retry: false })
  const submissionsQuery = useQuery({ queryKey: submissionsKey(courseId), queryFn: () => api(`/courses/${courseId}/reports/submissions`), enabled: Boolean(courseId), retry: false })

  const info = { ...course, ...(detailQuery.data ?? {}) }
  const enrolled = typeof detailQuery.data?.enrolled_count === 'number' ? detailQuery.data.enrolled_count : null

  const reports = [attendanceQuery, performanceQuery, submissionsQuery]
  const allNotReady = reports.every((query) => query.isError && isNotReady(query.error))
  const attReady = attendanceQuery.isSuccess
  const perfReady = performanceQuery.isSuccess
  const subReady = submissionsQuery.isSuccess
  const attMissing = attendanceQuery.isError && isNotReady(attendanceQuery.error)
  const perfMissing = performanceQuery.isError && isNotReady(performanceQuery.error)
  const subMissing = submissionsQuery.isError && isNotReady(submissionsQuery.error)

  // ----- normalise -----
  const attendanceStudents = []
  pickList(attendanceQuery.data, ['students', 'per_student', 'items']).forEach((raw) => {
    const student = readAttendance(raw)
    if (student) attendanceStudents.push(student)
  })
  const performanceStudents = []
  pickList(performanceQuery.data, ['students', 'per_student', 'items']).forEach((raw) => {
    const student = readPerformance(raw)
    if (student) performanceStudents.push(student)
  })
  const sessions = pickList(attendanceQuery.data?.sessions ? attendanceQuery.data : { sessions: attendanceQuery.data?.per_session }, ['sessions']).map(readSession).sort((a, b) => (a.date?.iso ?? '').localeCompare(b.date?.iso ?? ''))
  const assessments = pickList(performanceQuery.data?.assessments ? performanceQuery.data : { assessments: performanceQuery.data?.per_assessment }, ['assessments']).map(readAssessment)
  const assignments = pickList(submissionsQuery.data, ['assignments', 'per_assignment', 'items']).map((raw, index) => readAssignment(raw, index, enrolled))

  // ----- merge students from both reports -----
  const byId = new Map()
  attendanceStudents.forEach((entry) => byId.set(entry.id, { id: entry.id, name: entry.name, reg: entry.reg, attendance: entry, performance: null }))
  performanceStudents.forEach((entry) => {
    const known = byId.get(entry.id)
    if (known) {
      known.performance = entry
      known.name = known.name || entry.name
      known.reg = known.reg || entry.reg
    } else {
      byId.set(entry.id, { id: entry.id, name: entry.name, reg: entry.reg, attendance: null, performance: entry })
    }
  })
  const students = [...byId.values()].map((student) => ({ ...student, standing: standingOf(student) }))
  const ranked = students.filter((student) => student.performance && student.performance.pct !== null).sort((a, b) => b.performance.pct - a.performance.pct)
  const rankOf = (student) => ranked.findIndex((entry) => entry.id === student.id) + 1

  // ----- KPIs -----
  const withAttendance = attendanceStudents.filter((student) => student.counted > 0)
  const attendedTotal = withAttendance.reduce((sum, student) => sum + student.attended, 0)
  const countedTotal = withAttendance.reduce((sum, student) => sum + student.counted, 0)
  const cohortAttendance = attReady && countedTotal > 0 ? (attendedTotal / countedTotal) * 100 : null
  const lowAttendance = withAttendance.filter((student) => student.pct !== null && student.pct < ATTENDANCE_MIN).length

  const receivedTotal = assignments.reduce((sum, entry) => sum + entry.received, 0)
  const expectedTotal = assignments.reduce((sum, entry) => sum + entry.expected, 0)
  const lateTotal = assignments.reduce((sum, entry) => sum + entry.late, 0)
  const missingTotal = assignments.reduce((sum, entry) => sum + entry.missing, 0)
  const submissionRate = subReady && expectedTotal > 0 ? (receivedTotal / expectedTotal) * 100 : null

  const percents = ranked.map((student) => student.performance.pct)
  const mean = perfReady && percents.length > 0 ? percents.reduce((sum, value) => sum + value, 0) / percents.length : null
  const deviation = mean !== null ? Math.sqrt(percents.reduce((sum, value) => sum + (value - mean) ** 2, 0) / percents.length) : null
  const passing = percents.length > 0 ? (percents.filter((value) => value >= PASS_PERCENT).length / percents.length) * 100 : null
  const bandCounts = BANDS.map((band) => ({ ...band, count: percents.filter(band.test).length }))
  const bandMax = Math.max(1, ...bandCounts.map((band) => band.count))
  const lowMarks = ranked.filter((student) => student.performance.pct < PASS_PERCENT)
  const coveredWeight = performanceStudents.find((student) => student.covered !== null)?.covered ?? null
  const flagged = students.filter((student) => student.standing.flagged)
  const dataReady = attReady || perfReady

  // ----- roster filters -----
  const needle = search.trim().toLowerCase()
  const filtered = students
    .filter((student) => !needle || `${student.name} ${student.reg}`.toLowerCase().includes(needle))
    .filter((student) => risk === 'all' || (risk === 'risk' ? student.standing.flagged : student.standing.id === 'good'))
    .sort((a, b) => {
      if (sort === 'result') return (b.performance?.pct ?? -1) - (a.performance?.pct ?? -1)
      if (sort === 'attendance') return (a.attendance?.pct ?? 101) - (b.attendance?.pct ?? 101)
      return String(a.name).localeCompare(String(b.name))
    })
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const selected = students.find((student) => student.id === selectedId) ?? filtered[0]
  const filtersOn = Boolean(needle) || risk !== 'all' || sort !== 'name'

  const resetFilters = () => {
    setSearch('')
    setRisk('all')
    setSort('name')
    setPage(1)
  }
  const pickCourse = (id) => {
    setPickedCourse(id)
    setSelectedId('')
    resetFilters()
  }

  // ----- exports -----
  const exportCsv = () => {
    const code = course?.course_code ?? 'course'
    if (tab === 'submissions') {
      downloadText(`submissions-${code}.csv`, toCsv(['Assignment', 'Due', 'Max marks', 'Expected', 'Received', 'Late', 'Graded', 'Missing', 'Rate %'], assignments.map((e) => [e.title, e.due?.iso ?? '', e.maxMarks ?? '', e.expected, e.received, e.late, e.graded, e.missing, e.pct === null ? '' : trimNumber(e.pct)])), 'text/csv')
    } else if (tab === 'marks') {
      downloadText(`assessments-${code}.csv`, toCsv(['Assessment', 'Type', 'Max marks', 'Weight %', 'Marks entered', 'Mean', 'Lowest', 'Highest'], assessments.map((e) => [e.name, e.type, e.maxMarks ?? '', e.weight ?? '', e.entered ?? '', e.mean ?? '', e.min ?? '', e.max ?? ''])), 'text/csv')
    } else if (tab === 'attendance') {
      downloadText(`attendance-${code}.csv`, toCsv(['Student', 'Registration no.', 'Present', 'Late', 'Excused', 'Absent', 'Attended', 'Counted', 'Attendance %'], filtered.filter((s) => s.attendance).map((s) => [s.name, s.reg, s.attendance.present ?? '', s.attendance.late ?? '', s.attendance.excused ?? '', s.attendance.absent ?? '', s.attendance.attended ?? '', s.attendance.counted ?? '', s.attendance.pct === null ? '' : trimNumber(s.attendance.pct)])), 'text/csv')
    } else {
      downloadText(`roster-${code}.csv`, toCsv(['Student', 'Registration no.', 'Attended', 'Counted', 'Attendance %', 'Weighted total', 'Weight marked', 'Weighted result %', 'Standing'], filtered.map((s) => [s.name, s.reg, s.attendance?.attended ?? '', s.attendance?.counted ?? '', s.attendance?.pct == null ? '' : trimNumber(s.attendance.pct), s.performance?.total ?? '', s.performance?.covered ?? '', s.performance?.pct == null ? '' : trimNumber(s.performance.pct), s.standing.label])), 'text/csv')
    }
  }
  const exportReady = (tab === 'submissions' && subReady && assignments.length > 0) || (tab === 'marks' && perfReady && assessments.length > 0) || (tab === 'attendance' && attReady && filtered.some((s) => s.attendance)) || (tab === 'overview' && dataReady && filtered.length > 0)

  const showFilters = (tab === 'overview' || tab === 'attendance') && dataReady

  const failedReports = [
    { query: attendanceQuery, name: 'attendance' },
    { query: performanceQuery, name: 'performance' },
    { query: submissionsQuery, name: 'submissions' },
  ].filter((entry) => entry.query.isError && !isNotReady(entry.query.error))

  return (
    <div className="slpc" aria-label="Academic reports and cohort analytics">
      <style>{COURSE_STYLES}</style>
      <style>{REPORT_STYLES}</style>

      <div className="slpc-stack slpc-gap-lg">
        <div className="slpr-topbar">
          <nav className="slpc-trail" aria-label="Breadcrumb">
            <Link to="/lecturer" className="slpc-trail-link">
              {renderIcon('home', 16)}
              Dashboard
            </Link>
            <span className="slpc-trail-sep">{renderIcon('chevron_right', 16)}</span>
            <span className="slpc-trail-current">Academic Reports</span>
            {course && (
              <>
                <span className="slpc-trail-sep">{renderIcon('chevron_right', 16)}</span>
                <span className="slpr-crumb-code">
                  {course.course_code}: {course.course_name}
                </span>
              </>
            )}
          </nav>
        </div>

        {coursesQuery.isPending && <Skeleton height={160} label="Loading your courses" />}
        {coursesQuery.isError && <ErrorCard message="Your courses could not be loaded." onRetry={() => coursesQuery.refetch()} />}
        {coursesQuery.isSuccess && courses.length === 0 && <p className="slpc-empty">You are not assigned to any course yet, so there are no reports to show.</p>}

        {course && (
          <>
            <div className="slpr-scope" role="group" aria-label="Course">
              {courses.map((entry) => (
                <button key={entry.id} type="button" className={`slpr-scope-btn ${entry.id === courseId ? 'is-active' : ''}`} aria-pressed={entry.id === courseId} onClick={() => pickCourse(entry.id)}>
                  {entry.id === courseId && <i aria-hidden="true" />}
                  {entry.course_code}: {entry.course_name}
                </button>
              ))}
            </div>

            <section className="slpc-card slpr-hero" aria-label="Course summary">
              <h1 className="slpr-title">Academic Reports &amp; Cohort Analytics</h1>
              <div className="slpr-badges">
                {info.status && (
                  <span className={`slpr-badge ${info.status === 'active' ? 'is-ok' : ''}`}>
                    <i aria-hidden="true" />
                    {info.status === 'active' ? 'Active course' : sentenceCase(info.status)}
                  </span>
                )}
                {info.credit_hours ? <span className="slpr-badge is-warm">{info.credit_hours} Credit Hours</span> : null}
                {(info.academic_year || info.semester) && (
                  <span className="slpr-badge">
                    {[info.academic_year, formatSemester(info.semester)].filter(Boolean).join(' • ')}
                  </span>
                )}
              </div>
              <p className="slpc-lead">Course-level analytics for attendance, assignment delivery and weighted assessment results, worked out from the records of the students enrolled in this course.</p>
              <ul className="slpr-facts" aria-label="Course figures">
                <li>
                  Students <strong>{enrolled ?? '—'}</strong>
                </li>
                <li>
                  Assignments <strong>{subReady ? assignments.length : '—'}</strong>
                </li>
                <li>
                  Assessments <strong>{perfReady ? assessments.length : '—'}</strong>
                </li>
                <li>
                  Attendance <strong>{pctText(cohortAttendance)}</strong>
                </li>
              </ul>
            </section>

            {allNotReady && (
              <PhasePanel icon="analytics" title="Reports are not switched on yet" phase="Phase 8">
                Attendance, submission and performance reports for this course will appear here as soon as the reporting service goes live. Nothing is shown until the server can answer, so no figure here is ever a guess.
              </PhasePanel>
            )}

            {failedReports.length > 0 && (
              <div className="slpc-alert" role="alert">
                The {failedReports.map((entry) => entry.name).join(', ')} {failedReports.length === 1 ? 'report' : 'reports'} could not be loaded, so the figures that depend on {failedReports.length === 1 ? 'it are' : 'them are'} hidden.
                <button type="button" className="slpc-btn slpc-btn-soft" style={{ marginLeft: 8 }} onClick={() => failedReports.forEach((entry) => entry.query.refetch())}>
                  Try again
                </button>
              </div>
            )}

            {!allNotReady && (
              <>
                <section className="slpr-cards" aria-label="Report summary">
                  <div className="slpc-card slpr-card">
                    <div className="slpr-card-top">
                      <span className="slpr-eyebrow">Cohort attendance</span>
                      <span className="slpr-icon">{renderIcon('fact_check', 18)}</span>
                    </div>
                    <div className="slpr-big">
                      <strong aria-label="Cohort attendance">{pctText(cohortAttendance)}</strong>
                      {attReady && lowAttendance > 0 && <span className="slpr-chip is-risk">{lowAttendance} &lt; {ATTENDANCE_MIN}% limit</span>}
                    </div>
                    <div className={`slpr-bar ${cohortAttendance !== null && cohortAttendance < ATTENDANCE_MIN ? 'is-low' : ''}`} aria-hidden="true">
                      <span style={{ width: `${cohortAttendance ?? 0}%` }} />
                    </div>
                    <div className="slpr-foot">
                      <span>{attReady ? `${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'} held` : attMissing ? 'Not switched on yet' : '—'}</span>
                      <span>{enrolled !== null ? `${enrolled} enrolled` : ''}</span>
                    </div>
                  </div>

                  <div className="slpc-card slpr-card">
                    <div className="slpr-card-top">
                      <span className="slpr-eyebrow">Submission rate</span>
                      <span className="slpr-icon">{renderIcon('assignment_turned_in', 18)}</span>
                    </div>
                    <div className="slpr-big">
                      <strong aria-label="Submission rate">{pctText(submissionRate)}</strong>
                      {subReady && expectedTotal > 0 && (
                        <span>
                          {receivedTotal}/{expectedTotal}
                        </span>
                      )}
                    </div>
                    <div className="slpr-bar is-ok" aria-hidden="true">
                      <span style={{ width: `${submissionRate ?? 0}%` }} />
                    </div>
                    <div className="slpr-foot">
                      <span>{subReady ? `${assignments.length} ${assignments.length === 1 ? 'assignment' : 'assignments'}` : subMissing ? 'Not switched on yet' : '—'}</span>
                      <span>{subReady ? `${lateTotal} late • ${missingTotal} missing` : ''}</span>
                    </div>
                  </div>

                  <div className="slpc-card slpr-card">
                    <div className="slpr-card-top">
                      <span className="slpr-eyebrow">Weighted assessment mean</span>
                      <span className="slpr-icon">{renderIcon('analytics', 18)}</span>
                    </div>
                    <div className="slpr-big">
                      <strong aria-label="Weighted assessment mean">{pctText(mean)}</strong>
                      {deviation !== null && <span>±{trimNumber(deviation)}% SD</span>}
                    </div>
                    <div className="slpr-spark" aria-hidden="true">
                      {bandCounts.map((band) => (
                        <span key={band.id} className={band.id === 'f' ? 'is-f' : ''} style={{ height: `${(band.count / bandMax) * 100}%` }} />
                      ))}
                    </div>
                    <div className="slpr-foot">
                      <span>{perfReady ? (coveredWeight !== null ? `${trimNumber(coveredWeight)}% of the weight marked` : 'Weighted results') : perfMissing ? 'Not switched on yet' : '—'}</span>
                      <strong className="is-ok">{passing !== null ? `${trimNumber(passing)}% at or above ${PASS_PERCENT}%` : ''}</strong>
                    </div>
                  </div>

                  <div className="slpc-card slpr-card">
                    <div className="slpr-card-top">
                      <span className="slpr-eyebrow">Needs attention</span>
                      <span className="slpr-icon">{renderIcon('flag', 18)}</span>
                    </div>
                    <div className="slpr-big">
                      <strong aria-label="Students needing attention">{dataReady ? flagged.length : '—'}</strong>
                      <span>{flagged.length === 1 ? 'Student' : 'Students'}</span>
                    </div>
                    <div className={`slpr-bar ${flagged.length > 0 ? 'is-low' : 'is-ok'}`} aria-hidden="true">
                      <span style={{ width: `${dataReady && students.length > 0 ? (flagged.length / students.length) * 100 : 0}%` }} />
                    </div>
                    <div className="slpr-foot">
                      <span>{dataReady ? `${lowAttendance} on attendance • ${lowMarks.length} on marks` : '—'}</span>
                    </div>
                  </div>
                </section>

                <section className="slpc-card slpr-tabs" aria-label="Report views">
                  <div className="slpr-tablist" role="group" aria-label="Report">
                    {TABS.map((entry) => (
                      <button key={entry.id} type="button" className={`slpr-tab ${tab === entry.id ? 'is-active' : ''}`} aria-pressed={tab === entry.id} onClick={() => { setTab(entry.id); setPage(1) }}>
                        {renderIcon(entry.icon, 18)}
                        {entry.label}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="slpc-btn slpc-btn-soft" onClick={exportCsv} disabled={!exportReady}>
                    {renderIcon('table_view', 18)}
                    Export CSV
                  </button>
                </section>

                {showFilters && (
                  <section className="slpc-card slpr-filters" aria-label="Filter students">
                    <label className="slpc-search">
                      {renderIcon('person_search', 18)}
                      <input
                        type="search"
                        value={search}
                        onChange={(event) => {
                          setSearch(event.target.value)
                          setPage(1)
                        }}
                        placeholder="Search by name or reg. no."
                        aria-label="Search students"
                      />
                    </label>
                    <select
                      className="slpc-select"
                      value={risk}
                      onChange={(event) => {
                        setRisk(event.target.value)
                        setPage(1)
                      }}
                      aria-label="Standing"
                    >
                      {RISKS.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.id === 'risk' ? `Needs attention (${flagged.length})` : entry.label}
                        </option>
                      ))}
                    </select>
                    <select className="slpc-select" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort students">
                      {SORTS.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.label}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="slpr-reset" aria-label="Clear filters" title="Clear filters" onClick={resetFilters} disabled={!filtersOn}>
                      {renderIcon('restart_alt', 20)}
                    </button>
                  </section>
                )}

                {tab === 'overview' && (
                  <div className="slpr-split">
                    <div className="slpr-col">
                      <section className="slpc-card slpr-panel" aria-label="Grade distribution">
                        <div className="slpr-panel-head">
                          <div>
                            <h2 className="slpr-h">Cohort grade distribution</h2>
                            <p className="slpr-sub">Weighted results as a percentage of the weight marked so far{coveredWeight !== null ? ` (${trimNumber(coveredWeight)}%)` : ''}</p>
                          </div>
                          <div className="slpr-legend">
                            <span>
                              <i aria-hidden="true" />
                              Pass
                            </span>
                            <span>
                              <i className="is-risk" aria-hidden="true" />
                              Below {PASS_PERCENT}%
                            </span>
                          </div>
                        </div>
                        {perfMissing && <Waiting phase="Phase 8">The performance report is not switched on yet.</Waiting>}
                        {performanceQuery.isPending && <Skeleton height={140} label="Loading the distribution" />}
                        {perfReady && ranked.length === 0 && <p className="slpc-empty">No marks have been entered yet, so there is no distribution to show.</p>}
                        {perfReady && ranked.length > 0 && (
                          <>
                            <div className="slpr-hist" role="list" aria-label="Students per band">
                              {bandCounts.map((band) => (
                                <div key={band.id} role="listitem" className={`slpr-band is-${band.id}`} aria-label={`${band.label}: ${band.count} students`}>
                                  <strong>{band.count}</strong>
                                  <div className="slpr-band-track" aria-hidden="true">
                                    <div className="slpr-band-fill" style={{ height: `${(band.count / bandMax) * 100}%` }} />
                                  </div>
                                  <span className="is-range">{band.label}</span>
                                  <span>{trimNumber((band.count / ranked.length) * 100)}% of cohort</span>
                                </div>
                              ))}
                            </div>
                            {lowMarks.length > 0 && (
                              <div className="slpr-banner" role="status">
                                <div className="slpr-banner-main">
                                  {renderIcon('warning', 22)}
                                  <span>
                                    <strong>
                                      {lowMarks.length} {lowMarks.length === 1 ? 'student is' : 'students are'} below {PASS_PERCENT}% of the weight marked so far
                                    </strong>
                                    <span>These students may need early academic support.</span>
                                  </span>
                                </div>
                                <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => { setRisk('risk'); setPage(1) }}>
                                  Show these students
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </section>

                      <section className="slpc-card slpr-panel" aria-label="Student roster">
                        <div className="slpr-panel-head">
                          <div>
                            <h2 className="slpr-h">Consolidated student roster</h2>
                            <p className="slpr-sub">{dataReady ? `${filtered.length} of ${students.length} students` : 'Attendance and marks side by side'}</p>
                          </div>
                        </div>
                        {(attendanceQuery.isPending || performanceQuery.isPending) && <Skeleton height={140} label="Loading the roster" />}
                        {dataReady && students.length === 0 && <p className="slpc-empty">No student records yet.</p>}
                        {dataReady && students.length > 0 && filtered.length === 0 && <p className="slpc-empty">No students match these filters.</p>}
                        {pageRows.length > 0 && (
                          <Table
                            label="Student roster"
                            rowKey={(row) => row.id}
                            selectedKey={selected?.id}
                            rows={pageRows}
                            columns={[
                              { key: 'student', label: 'Student', render: (row) => <Person student={row} index={filtered.indexOf(row)} /> },
                              {
                                key: 'attendance',
                                label: 'Attendance',
                                render: (row) =>
                                  row.attendance && row.attendance.pct !== null ? (
                                    <span className={`slpr-mono ${row.attendance.pct < ATTENDANCE_MIN ? 'slpr-bad' : ''}`}>
                                      {row.attendance.counted > 0 ? `${row.attendance.attended}/${row.attendance.counted} • ` : ''}
                                      {pctText(row.attendance.pct)}
                                    </span>
                                  ) : (
                                    '—'
                                  ),
                              },
                              {
                                key: 'result',
                                label: 'Weighted result',
                                render: (row) =>
                                  row.performance && row.performance.pct !== null ? (
                                    <span className="slpr-mono">
                                      <b>{num(row.performance.total)}</b> / {num(row.performance.covered)} • {pctText(row.performance.pct)}
                                    </span>
                                  ) : (
                                    '—'
                                  ),
                              },
                              { key: 'standing', label: 'Standing', render: (row) => <span className={`slpr-stand is-${row.standing.tone}`}>{row.standing.label}</span> },
                              {
                                key: 'actions',
                                label: 'Actions',
                                render: (row) => (
                                  <button type="button" className={`slpr-act ${selected?.id === row.id ? 'is-active' : ''}`} aria-label={`Inspect ${row.name || 'student'}`} onClick={() => setSelectedId(row.id)}>
                                    {selected?.id === row.id ? 'Viewing' : 'Inspect'}
                                  </button>
                                ),
                              },
                            ]}
                          />
                        )}
                        {filtered.length > PAGE_SIZE && (
                          <div className="slpr-pager">
                            <span>
                              Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length} students
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
                    </div>

                    <aside className="slpr-side slpr-sticky" aria-label="Student dossier">
                      <section className="slpc-card slpr-panel" aria-label="Student dossier inspector">
                        <div className="slpr-panel-head">
                          <h2 className="slpr-h">Student dossier</h2>
                          {selected && rankOf(selected) > 0 && (
                            <span className="slpr-chip is-warn">
                              Rank {rankOf(selected)} / {ranked.length}
                            </span>
                          )}
                        </div>
                        {!selected && <p className="slpc-empty">Select a student to see their dossier.</p>}
                        {selected && (
                          <div className="slpr-dossier">
                            <div className="slpr-dossier-who">
                              <span className="slpr-avatar" aria-hidden="true">
                                {initials(selected.name)}
                              </span>
                              <div style={{ minWidth: 0 }}>
                                <h3>{selected.name || 'Student'}</h3>
                                {selected.reg && <span className="slpr-reg">#{selected.reg}</span>}
                              </div>
                            </div>
                            <div className="slpr-ringrow">
                              <div className="slpr-ring" role="img" aria-label={selected.performance && selected.performance.pct !== null ? `${trimNumber(selected.performance.pct)} percent weighted result` : 'Weighted result not available'}>
                                <svg viewBox="0 0 36 36" aria-hidden="true">
                                  <circle cx="18" cy="18" r="15.9155" fill="none" strokeWidth="3.5" className="slpr-ring-track" />
                                  <circle cx="18" cy="18" r="15.9155" fill="none" strokeWidth="3.5" className={`slpr-ring-fill ${selected.performance && selected.performance.pct !== null && selected.performance.pct < PASS_PERCENT ? 'is-low' : ''}`} strokeDasharray={`${Math.min(100, selected.performance?.pct ?? 0)} 100`} />
                                </svg>
                                <span className="slpr-ring-text">{selected.performance && selected.performance.pct !== null ? trimNumber(selected.performance.pct) : '—'}</span>
                              </div>
                              <div>
                                <p className="slpr-eyebrow">Weighted result</p>
                                <p className="slpr-sub">{selected.performance && selected.performance.pct !== null ? `${num(selected.performance.total)} of ${num(selected.performance.covered)} marked so far` : 'No marks entered yet'}</p>
                              </div>
                            </div>
                            <ul className="slpr-rows" aria-label="Components">
                              <li className="slpr-row">
                                <span>
                                  {renderIcon('done_all', 18)}
                                  Attendance compliance
                                </span>
                                <b>{selected.attendance && selected.attendance.pct !== null ? `${selected.attendance.counted > 0 ? `${selected.attendance.attended} / ${selected.attendance.counted} ` : ''}(${pctText(selected.attendance.pct)})` : '—'}</b>
                              </li>
                              {selected.attendance && (
                                <>
                                  <li className="slpr-row">
                                    <span>
                                      {renderIcon('check_circle', 18)}
                                      Present • Late
                                    </span>
                                    <b>
                                      {num(selected.attendance.present)} • {num(selected.attendance.late)}
                                    </b>
                                  </li>
                                  <li className="slpr-row">
                                    <span>
                                      {renderIcon('event_busy', 18)}
                                      Absent • Excused
                                    </span>
                                    <b>
                                      {num(selected.attendance.absent)} • {num(selected.attendance.excused)}
                                    </b>
                                  </li>
                                </>
                              )}
                            </ul>
                            <div className={`slpr-callout ${selected.standing.tone === 'risk' ? 'is-risk' : selected.standing.tone === 'warn' ? 'is-warn' : ''}`}>
                              {renderIcon(selected.standing.flagged ? 'warning' : 'verified', 20)}
                              <span>
                                <strong>{selected.standing.label}</strong>
                                {selected.standing.reason}
                              </span>
                            </div>
                          </div>
                        )}
                      </section>
                      <p className="slpr-note">
                        {renderIcon('security', 16)}
                        <span>Only the courses you are assigned to appear here, and only their enrolled students.</span>
                      </p>
                    </aside>
                  </div>
                )}

                {tab === 'attendance' && (
                  <div className="slpr-col">
                    <section className="slpc-card slpr-panel" aria-label="Per-session attendance">
                      <div className="slpr-panel-head">
                        <div>
                          <h2 className="slpr-h">Per-session attendance</h2>
                          <p className="slpr-sub">{attReady ? `${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'} held` : 'Present and late students out of those counted'}</p>
                        </div>
                      </div>
                      {attMissing && <Waiting phase="Phase 8">The attendance report is not switched on yet.</Waiting>}
                      {attendanceQuery.isPending && <Skeleton height={120} label="Loading attendance" />}
                      {attReady && sessions.length === 0 && <p className="slpc-empty">No sessions have been recorded yet.</p>}
                      {attReady && sessions.length > 0 && (
                        <ul className="slpr-sessions" aria-label="Sessions">
                          {sessions.map((session) => (
                            <li key={session.key} className={`slpr-session ${session.pct !== null && session.pct < ATTENDANCE_MIN ? 'is-low' : ''}`} title={session.topic || undefined}>
                              <strong>{shortDay(session.date) || 'Session'}</strong>
                              <b>{session.counted > 0 ? `${session.attended} / ${session.counted}` : '—'}</b>
                              <span>{session.pct !== null ? `${trimNumber(session.pct)}% present` : 'Not marked'}</span>
                              <div className="slpr-bar" aria-hidden="true">
                                <span style={{ width: `${session.pct ?? 0}%` }} />
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                    <section className="slpc-card slpr-panel" aria-label="Attendance by student">
                      <div className="slpr-panel-head">
                        <div>
                          <h2 className="slpr-h">Attendance by student</h2>
                          <p className="slpr-sub">Excused sessions are not counted</p>
                        </div>
                      </div>
                      {attReady && filtered.filter((s) => s.attendance).length === 0 && <p className="slpc-empty">{students.length === 0 ? 'No attendance has been recorded yet.' : 'No students match these filters.'}</p>}
                      {attReady && filtered.some((s) => s.attendance) && (
                        <Table
                          label="Attendance by student"
                          rowKey={(row) => row.id}
                          rows={filtered.filter((s) => s.attendance)}
                          columns={[
                            { key: 'student', label: 'Student', render: (row) => <Person student={row} index={filtered.indexOf(row)} /> },
                            { key: 'present', label: 'Present', render: (row) => num(row.attendance.present) },
                            { key: 'late', label: 'Late', render: (row) => num(row.attendance.late) },
                            { key: 'excused', label: 'Excused', render: (row) => num(row.attendance.excused) },
                            { key: 'absent', label: 'Absent', render: (row) => num(row.attendance.absent) },
                            {
                              key: 'rate',
                              label: 'Attendance',
                              render: (row) => (
                                <span className={`slpr-mono ${row.attendance.pct !== null && row.attendance.pct < ATTENDANCE_MIN ? 'slpr-bad' : 'slpr-ok'}`}>
                                  {row.attendance.counted > 0 ? `${row.attendance.attended}/${row.attendance.counted} • ` : ''}
                                  {pctText(row.attendance.pct)}
                                </span>
                              ),
                            },
                          ]}
                        />
                      )}
                    </section>
                  </div>
                )}

                {tab === 'submissions' && (
                  <section className="slpc-card slpr-panel" aria-label="Assignment submissions">
                    <div className="slpr-panel-head">
                      <div>
                        <h2 className="slpr-h">Assignment submissions</h2>
                        <p className="slpr-sub">Received = expected submissions minus missing</p>
                      </div>
                    </div>
                    {subMissing && <Waiting phase="Phase 8">The submissions report is not switched on yet.</Waiting>}
                    {submissionsQuery.isPending && <Skeleton height={120} label="Loading submissions" />}
                    {subReady && assignments.length === 0 && <p className="slpc-empty">No assignments have been published for this course yet.</p>}
                    {subReady && assignments.length > 0 && (
                      <Table
                        label="Assignment submissions"
                        rowKey={(row) => row.key}
                        rows={assignments}
                        columns={[
                          { key: 'title', label: 'Assignment', render: (row) => <span className="slpr-name">{row.title}</span> },
                          { key: 'due', label: 'Due', render: (row) => fullDay(row.due) },
                          { key: 'received', label: 'Received', render: (row) => <span className="slpr-mono">{row.received}/{row.expected}</span> },
                          { key: 'late', label: 'Late', render: (row) => row.late },
                          { key: 'graded', label: 'Graded', render: (row) => row.graded },
                          { key: 'missing', label: 'Missing', render: (row) => <span className={row.missing > 0 ? 'slpr-bad' : ''}>{row.missing}</span> },
                          { key: 'rate', label: 'Rate', render: (row) => <span className="slpr-mono">{pctText(row.pct)}</span> },
                        ]}
                      />
                    )}
                  </section>
                )}

                {tab === 'marks' && (
                  <section className="slpc-card slpr-panel" aria-label="Assessment results">
                    <div className="slpr-panel-head">
                      <div>
                        <h2 className="slpr-h">Assessment &amp; marks</h2>
                        <p className="slpr-sub">{perfReady && coveredWeight !== null ? `${trimNumber(coveredWeight)}% of the course weight has been marked so far` : 'Per-assessment statistics'}</p>
                      </div>
                    </div>
                    {perfMissing && <Waiting phase="Phase 8">The performance report is not switched on yet.</Waiting>}
                    {performanceQuery.isPending && <Skeleton height={120} label="Loading assessments" />}
                    {perfReady && assessments.length === 0 && <p className="slpc-empty">No assessment components have been set up yet.</p>}
                    {perfReady && assessments.length > 0 && (
                      <Table
                        label="Assessment results"
                        rowKey={(row) => row.key}
                        rows={assessments}
                        columns={[
                          { key: 'name', label: 'Assessment', render: (row) => <span className="slpr-name">{row.name}{row.type ? <span className="slpr-reg">{sentenceCase(row.type)}</span> : null}</span> },
                          { key: 'weight', label: 'Weight', render: (row) => (row.weight === null ? '—' : `${trimNumber(row.weight)}%`) },
                          { key: 'max', label: 'Out of', render: (row) => num(row.maxMarks) },
                          { key: 'entered', label: 'Marks entered', render: (row) => num(row.entered) },
                          { key: 'mean', label: 'Mean', render: (row) => <span className="slpr-mono">{num(row.mean)}</span> },
                          { key: 'min', label: 'Lowest', render: (row) => <span className="slpr-mono">{num(row.min)}</span> },
                          { key: 'highest', label: 'Highest', render: (row) => <span className="slpr-mono">{num(row.max)}</span> },
                        ]}
                      />
                    )}
                  </section>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
