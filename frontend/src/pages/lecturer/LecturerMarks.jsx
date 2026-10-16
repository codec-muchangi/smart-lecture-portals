import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/apiClient.js'
import {
  COURSES_KEY,
  COURSE_STYLES,
  ErrorCard,
  Skeleton,
  fetchCourses,
  renderIcon,
  trimNumber,
  useCourseFonts,
} from '../../components/courseKit.jsx'
import { toList } from '../../utils/format.js'

/*
 * Smart Lecture Portal: lecturer Marks & Assessment
 * Place at: src/pages/lecturer/LecturerMarks.jsx
 *
 * Routes (see routes.jsx):
 *   /lecturer/marks                    the first course you teach
 *   /lecturer/courses/:courseId/marks  that course
 *
 * - Renders inside AppShell, which already draws the sidebar and top bar.
 * - Real data only (SRS: no hard-coded figures). Endpoints used (docs/API.md, Marks):
 *     GET   /courses                              assigned courses
 *     GET   /courses/{id}                         enrolled_count
 *     GET   /courses/{id}/assessments             components, with marks_entered
 *     POST  /courses/{id}/assessments             new component (created unpublished)
 *     PATCH /assessments/{id}                     edit, publish / withhold
 *     GET   /assessments/{id}/marks               the marks roster
 *     PUT   /assessments/{id}/marks               save marks (all or nothing)
 * - Averages, spread, pass rate, the distribution and each student's weighted result are
 *   calculated here from the marks you can see. The API has no letter grades, revisions
 *   list, audit stream or bulk CSV upload, so the page shows none of them.
 */

const TYPES = [
  { id: 'cat', label: 'CAT' },
  { id: 'assignment', label: 'Assignment' },
  { id: 'practical', label: 'Practical' },
  { id: 'exam', label: 'Exam' },
  { id: 'other', label: 'Other' },
]
const TYPE_LABELS = Object.fromEntries(TYPES.map((item) => [item.id, item.label]))
const TYPE_ICONS = { cat: 'quiz', assignment: 'assignment', practical: 'terminal', exam: 'school', other: 'grading' }
const TABS = [
  { id: 'all', label: 'All components' },
  { id: 'cat', label: 'CAT' },
  { id: 'assignment', label: 'Assignments' },
  { id: 'practical', label: 'Practicals' },
  { id: 'exam', label: 'Exams' },
  { id: 'draft', label: 'Drafts pending release' },
]
const SORTS = [
  { id: 'order', label: 'Sort: Component order' },
  { id: 'weight', label: 'Sort: Weight (high to low)' },
  { id: 'completion', label: 'Sort: Least marked first' },
]
const PASS_PERCENT = 50
const BANDS = [
  { id: 'a', label: '80%+', test: (p) => p >= 80, tone: 'a' },
  { id: 'b', label: '70-79%', test: (p) => p >= 70 && p < 80, tone: 'b' },
  { id: 'c', label: '60-69%', test: (p) => p >= 60 && p < 70, tone: 'c' },
  { id: 'd', label: '50-59%', test: (p) => p >= 50 && p < 60, tone: 'd' },
  { id: 'f', label: 'Below 50%', test: (p) => p < 50, tone: 'f' },
]
const NAME_MIN = 2
const NAME_MAX = 100
const MAX_LIMIT = 1000
const FEEDBACK_MAX = 1000

const assessmentsKey = (courseId) => ['course-assessments', courseId]
const assessmentsPath = (courseId) => `/courses/${courseId}/assessments?page_size=100`
const rosterKey = (assessmentId) => ['assessment-marks', assessmentId]
const rosterPath = (assessmentId) => `/assessments/${assessmentId}/marks?page_size=200`

const MARKS_STYLES = `
.slpk-topbar { display: flex; flex-direction: column; gap: 1rem; }
.slpk-title-row { display: flex; flex-direction: column; gap: 1rem; }
.slpk-title { font-size: 26px; line-height: 34px; font-weight: 700; letter-spacing: -0.02em; overflow-wrap: anywhere; }
.slpk-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.slpk-actions .slpc-btn { height: 40px; padding: 0 16px; }
.slpk-badge { padding: 1px 8px; border-radius: 999px; background: var(--tertiary-fixed); color: var(--on-tertiary-fixed); font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 10px; line-height: 16px; font-weight: 700; }
.slpk-scope { display: flex; align-items: center; gap: 0.5rem; overflow-x: auto; padding-bottom: 4px; }
.slpk-scope-label { flex: 0 0 auto; font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); margin-right: 4px; }
.slpk-scope-btn { display: inline-flex; align-items: center; gap: 0.5rem; flex: 0 0 auto; padding: 6px 16px; border: 0; border-radius: 999px; background: var(--surface-lowest); color: var(--on-surface-variant); box-shadow: 0 1px 2px rgba(30, 26, 35, 0.08); font-size: 12px; line-height: 16px; font-weight: 600; cursor: pointer; }
.slpk-scope-btn:hover { background: var(--surface-mid); }
.slpk-scope-btn.is-active { background: var(--primary-container); color: var(--on-primary-container); }
.slpk-scope-count { padding: 0 8px; border-radius: 999px; background: var(--surface-high); color: var(--on-surface-variant); font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 10px; line-height: 18px; }
.slpk-scope-btn.is-active .slpk-scope-count { background: var(--primary); color: var(--on-primary); }
.slpk-bar { height: 6px; border-radius: 999px; background: var(--surface-mid); overflow: hidden; }
.slpk-bar-wide { width: 100%; max-width: 180px; flex: 0 0 auto; }
.slpk-bar > span { display: block; height: 100%; border-radius: 999px; background: var(--primary); transition: width 0.4s; }
.slpk-stat-note { display: flex; align-items: center; gap: 0.25rem; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpk-stat-note.is-warn { color: var(--error); }
.slpk-mono { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; }
.slpk-confirm { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.875rem 1rem; border-radius: 12px; background: var(--tertiary-fixed); color: var(--on-tertiary-fixed); font-size: 13px; line-height: 18px; font-weight: 600; }
.slpk-button-row { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.slpk-toolbar { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.75rem; }
.slpk-tabs { display: flex; align-items: center; gap: 6px; overflow-x: auto; padding: 2px; }
.slpk-tab { display: inline-flex; align-items: center; gap: 0.375rem; flex: 0 0 auto; padding: 8px 16px; border: 0; border-radius: 12px; background: var(--surface-low); color: var(--on-surface-variant); font-size: 12px; line-height: 16px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.slpk-tab:hover { background: var(--surface-mid); }
.slpk-tab.is-active { background: var(--primary); color: var(--on-primary); box-shadow: 0 1px 2px rgba(30, 26, 35, 0.2); }
.slpk-tab.is-draft { color: var(--tertiary); }
.slpk-tab.is-draft.is-active { background: var(--tertiary); color: var(--on-primary); }
.slpk-dot { width: 8px; height: 8px; border-radius: 999px; background: currentColor; flex: 0 0 auto; }
.slpk-tools { display: flex; flex-direction: column; gap: 0.5rem; }
.slpk-tools .slpc-select { height: 40px; border-radius: 12px; }
.slpk-tools .slpc-search { height: 40px; border-radius: 12px; }
.slpk-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.slpk-main, .slpk-side { display: flex; flex-direction: column; gap: 1.5rem; min-width: 0; }
.slpk-sheet { padding: 0; overflow: hidden; box-shadow: 0 4px 12px rgba(30, 26, 35, 0.1); }
.slpk-sheet-head { display: flex; flex-direction: column; gap: 1rem; padding: 1.25rem; background: var(--surface-low); }
.slpk-sheet-id { display: flex; align-items: flex-start; gap: 1rem; min-width: 0; }
.slpk-sheet-icon { width: 48px; height: 48px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; background: var(--tertiary-container); color: var(--on-tertiary-container); box-shadow: 0 1px 2px rgba(30, 26, 35, 0.15); }
.slpk-sheet-title { font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.slpk-sheet-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin-bottom: 4px; }
.slpk-progress { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.75rem 1.25rem; font-size: 13px; line-height: 18px; }
.slpk-progress-main { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; }
.slpk-incomplete { display: inline-flex; align-items: center; gap: 0.375rem; color: var(--error); font-size: 11px; line-height: 14px; font-weight: 700; }
.slpk-scroll { overflow-x: auto; }
.slpk-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; line-height: 18px; }
.slpk-table th { padding: 12px 10px; background: var(--surface-mid); font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); white-space: nowrap; }
.slpk-table th:first-child, .slpk-table td:first-child { padding-left: 16px; }
.slpk-table th:last-child, .slpk-table td:last-child { padding-right: 16px; }
.slpk-table td { padding: 12px 10px; vertical-align: middle; }
.slpk-table td:last-child { white-space: nowrap; }
.slpk-of { white-space: nowrap; }
.slpk-table tbody tr:nth-child(even) { background: rgba(250, 240, 254, 0.5); }
.slpk-table tbody tr.is-error { background: rgba(255, 218, 214, 0.35); }
.slpk-student { display: flex; flex-direction: column; min-width: 0; }
.slpk-student strong { font-weight: 600; font-size: 14px; line-height: 20px; overflow-wrap: anywhere; }
.slpk-reg { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 16px; color: var(--outline); }
.slpk-mark-field { display: inline-flex; align-items: center; gap: 6px; }
.slpk-input { height: 36px; border: 0; border-radius: 8px; background: var(--surface-mid); color: var(--on-surface); padding: 0 10px; font-size: 13px; }
.slpk-input:focus { outline: 0; background: var(--surface-lowest); box-shadow: 0 0 0 2px var(--primary-container); }
.slpk-input.is-mark { width: 84px; text-align: center; font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-weight: 700; }
.slpk-input.is-feedback { width: 100%; min-width: 120px; height: 32px; background: var(--surface-low); font-size: 12px; }
.slpk-input.is-invalid { background: var(--error-container); }
.slpk-of { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 12px; color: var(--outline); }
.slpk-row-error { display: block; margin-top: 4px; font-size: 11px; line-height: 14px; font-weight: 600; color: var(--error); }
.slpk-footer { display: flex; flex-direction: column; gap: 0.75rem; padding: 1.25rem; background: var(--surface-low); }
.slpk-footer-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.slpk-list-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.25rem 1rem; padding: 0 4px; }
.slpk-component { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.slpk-component.is-selected { box-shadow: 0 0 0 2px var(--primary-container), 0 4px 12px rgba(30, 26, 35, 0.08); }
.slpk-component-main { display: flex; align-items: flex-start; gap: 1rem; min-width: 0; }
.slpk-index { width: 40px; height: 40px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; background: var(--primary-fixed); color: var(--on-primary-fixed); font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-weight: 700; font-size: 13px; }
.slpk-component-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.slpk-component-title { font-size: 16px; line-height: 24px; font-weight: 600; overflow-wrap: anywhere; }
.slpk-component-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.slpk-component-actions .slpc-btn { height: 36px; padding: 0 14px; font-size: 12px; }
.slpk-editor, .slpk-new { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.875rem; border-radius: 12px; background: var(--surface-low); }
.slpk-grid-fields { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.75rem; }
.slpk-field { display: flex; flex-direction: column; gap: 0.375rem; min-width: 0; }
.slpk-field label { font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpk-field input, .slpk-field select, .slpk-field textarea { width: 100%; min-width: 0; height: 40px; border: 0; border-radius: 10px; background: var(--surface-lowest); color: var(--on-surface); padding: 0 12px; font-size: 13px; }
.slpk-field input:focus, .slpk-field select:focus, .slpk-field textarea:focus { outline: 0; box-shadow: 0 0 0 2px var(--primary-container); }
.slpk-field-error { font-size: 12px; line-height: 16px; font-weight: 600; color: var(--error); }
.slpk-hint { font-size: 11px; line-height: 16px; color: var(--on-surface-variant); }
.slpk-ok { padding: 0.5rem 0.75rem; border-radius: 12px; background: var(--ok-bg); color: var(--ok); font-size: 13px; line-height: 18px; font-weight: 600; }
.slpk-inspector-head { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 0.875rem; border-radius: 12px; background: var(--surface-low); }
.slpk-score { font-size: 24px; line-height: 32px; font-weight: 700; color: var(--primary); text-align: right; }
.slpk-breakdown { display: flex; flex-direction: column; gap: 0.5rem; font-size: 13px; line-height: 18px; }
.slpk-breakdown-row { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 8px 10px; border-radius: 8px; background: var(--surface-low); min-width: 0; }
.slpk-breakdown-row span:first-child { min-width: 0; overflow-wrap: anywhere; }
.slpk-breakdown-row strong { flex: 0 0 auto; font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 12px; }
.slpk-breakdown-total { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding-top: 4px; font-size: 14px; font-weight: 600; }
.slpk-breakdown-total strong { color: var(--primary); font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; }
.slpk-rule { display: flex; flex-direction: column; gap: 4px; padding: 0.75rem; border-radius: 12px; background: var(--surface-low); font-size: 12px; line-height: 18px; color: var(--on-surface-variant); }
.slpk-rule-title { display: flex; align-items: center; gap: 0.375rem; font-weight: 700; color: var(--primary); }
.slpk-dist { display: flex; flex-direction: column; gap: 0.625rem; }
.slpk-dist-row { display: grid; grid-template-columns: 76px minmax(0, 1fr) 28px; align-items: center; gap: 0.625rem; font-size: 12px; line-height: 16px; }
.slpk-dist-label { font-weight: 600; color: var(--on-surface-variant); white-space: nowrap; }
.slpk-dist-track { height: 14px; border-radius: 6px; background: var(--surface-mid); overflow: hidden; }
.slpk-dist-track > span { display: block; height: 100%; min-width: 2px; border-radius: 6px; }
.slpk-dist-track .is-a { background: #a03223; }
.slpk-dist-track .is-b { background: #c14a38; }
.slpk-dist-track .is-c { background: #b2563e; }
.slpk-dist-track .is-d { background: #9e3e49; }
.slpk-dist-track .is-f { background: #ba1a1a; }
.slpk-dist-count { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-weight: 700; text-align: right; }
.slpk-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.25rem 1rem; font-size: 11px; line-height: 16px; font-weight: 600; color: var(--on-surface-variant); }
.slpk-table-wrap { display: block; }
@media (max-width: 767px) {
  .slpk-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .slpk-table, .slpk-table tbody, .slpk-table tr, .slpk-table td { display: block; width: 100%; }
  .slpk-table tr { padding: 0.75rem 1rem; border-top: 1px solid var(--surface-mid); }
  .slpk-table td, .slpk-table td:first-child, .slpk-table td:last-child { padding: 4px 0; }
  .slpk-table td[data-label]::before { content: attr(data-label); display: block; margin-bottom: 2px; font-size: 10px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); }
  .slpk-input.is-feedback { min-width: 0; }
}
@media (min-width: 640px) {
  .slpk-grid-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .slpk-tools { flex-direction: row; flex-wrap: wrap; align-items: center; }
  .slpk-tabs { flex-wrap: wrap; overflow: visible; }
  .slpk-tools .slpc-search { flex: 1 1 220px; }
}
@media (min-width: 768px) {
  .slpk-title-row { flex-direction: row; align-items: flex-start; justify-content: space-between; }
  .slpk-sheet-head { flex-direction: row; align-items: center; justify-content: space-between; }
  .slpk-progress { flex-direction: row; align-items: center; justify-content: space-between; }
  .slpk-footer { flex-direction: row; align-items: center; justify-content: space-between; }
  .slpk-component { flex-direction: row; align-items: center; justify-content: space-between; }
  .slpk-grid-fields.is-four { grid-template-columns: 2fr 1fr 1fr 1fr; }
}
@media (min-width: 1024px) {
  .slpk-toolbar { flex-direction: column; align-items: stretch; }
  .slpk-tools .slpc-search { flex: 1 1 260px; }
  .slpk-split { grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr); }
  .slpk-title { font-size: 32px; line-height: 40px; }
}
`

const errorText = (error, fallback) => error?.message || fallback
const numberOr = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const percentOf = (mark, max) => (max > 0 ? (mark / max) * 100 : 0)
const decimals = (text) => (String(text).split('.')[1] || '').length

function statsOf(roster, max) {
  const marked = roster.filter((row) => numberOr(row.mark) !== null)
  if (marked.length === 0) return { entered: 0, total: roster.length }
  const percents = marked.map((row) => percentOf(row.mark, max))
  const mean = percents.reduce((sum, value) => sum + value, 0) / percents.length
  const variance = percents.reduce((sum, value) => sum + (value - mean) ** 2, 0) / percents.length
  return {
    entered: marked.length,
    total: roster.length,
    mean,
    spread: Math.sqrt(variance),
    high: Math.max(...percents),
    low: Math.min(...percents),
    passing: (percents.filter((value) => value >= PASS_PERCENT).length / percents.length) * 100,
    percents,
  }
}

function csvCell(value) {
  let text = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function buildCsv(assessments, rosters) {
  const students = new Map()
  rosters.forEach((roster) => roster.forEach((row) => students.set(row.student_id, row)))
  const lines = [['Student', 'Registration number', ...assessments.map((item) => `${item.name} (max ${trimNumber(item.max_marks)})`)]]
  ;[...students.values()]
    .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)))
    .forEach((student) => {
      lines.push([
        student.full_name,
        student.registration_number,
        ...rosters.map((roster) => {
          const found = roster.find((row) => row.student_id === student.student_id)
          return numberOr(found?.mark) === null ? '' : found.mark
        }),
      ])
    })
  return lines.map((line) => line.map(csvCell).join(',')).join('\n')
}

function downloadCsv(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function weightedResult(assessments, rosters, studentId) {
  let earned = 0
  let graded = 0
  const rows = assessments.map((item, index) => {
    const found = rosters[index]?.find((row) => row.student_id === studentId)
    const mark = numberOr(found?.mark)
    const weight = numberOr(item.weight)
    const points = mark !== null && weight !== null ? (mark / item.max_marks) * weight : null
    if (points !== null) {
      earned += points
      graded += weight
    }
    return { id: item.id, name: item.name, max: item.max_marks, weight, mark, points }
  })
  return { rows, earned, graded, percent: graded > 0 ? (earned / graded) * 100 : null }
}

function NewAssessmentForm({ courseId, weightUsed, onCreated, onClose }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('cat')
  const [maxMarks, setMaxMarks] = useState('')
  const [weight, setWeight] = useState('')
  const [errors, setErrors] = useState({})
  const create = useMutation({ mutationFn: (body) => api(`/courses/${courseId}/assessments`, { method: 'POST', body }) })

  const submit = async (event) => {
    event.preventDefault()
    const next = {}
    const cleanName = name.trim()
    const max = Number(maxMarks)
    const weightText = weight.trim()
    if (cleanName.length < NAME_MIN || cleanName.length > NAME_MAX) next.name = `The name must be between ${NAME_MIN} and ${NAME_MAX} characters.`
    if (!maxMarks.trim() || !Number.isFinite(max) || max <= 0 || max > MAX_LIMIT || decimals(maxMarks) > 2) next.max = `Maximum marks must be above 0 and at most ${MAX_LIMIT} (2 decimals at most).`
    if (weightText) {
      const value = Number(weightText)
      if (!Number.isFinite(value) || value <= 0 || value > 100 || decimals(weightText) > 2) next.weight = 'Weight must be above 0 and at most 100 (2 decimals at most).'
      else if (weightUsed + value > 100 + 1e-9) next.weight = `Only ${trimNumber(Math.max(0, 100 - weightUsed))}% of the weight is still free.`
    }
    setErrors(next)
    if (Object.keys(next).length) return
    try {
      await create.mutateAsync({ name: cleanName, type, max_marks: max, weight: weightText ? Number(weightText) : null })
    } catch (caught) {
      setErrors({ form: errorText(caught, 'The assessment could not be created. Please try again.') })
      return
    }
    onCreated()
  }

  return (
    <form className="slpk-new slpc-card" onSubmit={submit} aria-label="New assessment" noValidate>
      <h2 className="slpc-h3">New assessment</h2>
      <div className="slpk-grid-fields is-four">
        <div className="slpk-field">
          <label htmlFor="slpk-new-name">Name</label>
          <input id="slpk-new-name" type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. CAT 2: Distributed Systems" maxLength={NAME_MAX} aria-invalid={Boolean(errors.name)} />
          {errors.name && <span className="slpk-field-error">{errors.name}</span>}
        </div>
        <div className="slpk-field">
          <label htmlFor="slpk-new-type">Type</label>
          <select id="slpk-new-type" value={type} onChange={(event) => setType(event.target.value)}>
            {TYPES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="slpk-field">
          <label htmlFor="slpk-new-max">Maximum marks</label>
          <input id="slpk-new-max" type="text" inputMode="decimal" value={maxMarks} onChange={(event) => setMaxMarks(event.target.value)} placeholder="e.g. 50" aria-invalid={Boolean(errors.max)} />
          {errors.max && <span className="slpk-field-error">{errors.max}</span>}
        </div>
        <div className="slpk-field">
          <label htmlFor="slpk-new-weight">Weight % (optional)</label>
          <input id="slpk-new-weight" type="text" inputMode="decimal" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="e.g. 20" aria-invalid={Boolean(errors.weight)} />
          {errors.weight && <span className="slpk-field-error">{errors.weight}</span>}
        </div>
      </div>
      <span className="slpk-hint">New assessments start as drafts, hidden from students, until you release them. Weights across the course add up to at most 100%.</span>
      {errors.form && (
        <p className="slpc-alert" role="alert">
          {errors.form}
        </p>
      )}
      <div className="slpk-button-row">
        <button type="submit" className="slpc-btn slpc-btn-primary" disabled={create.isPending}>
          {renderIcon('add_circle', 18)}
          {create.isPending ? 'Creating…' : 'Create assessment'}
        </button>
        <button type="button" className="slpc-btn slpc-btn-soft" onClick={onClose} disabled={create.isPending}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function ComponentCard({ item, index, selected, enrolled, mean, busy, onSelect, onTogglePublish, onSave }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(item.name)
  const [type, setType] = useState(item.type)
  const [maxMarks, setMaxMarks] = useState(String(item.max_marks))
  const [weight, setWeight] = useState(item.weight === null || item.weight === undefined ? '' : String(item.weight))
  const [formError, setFormError] = useState('')
  const live = Boolean(item.published)
  const entered = numberOr(item.marks_entered)

  const open = () => {
    setName(item.name)
    setType(item.type)
    setMaxMarks(String(item.max_marks))
    setWeight(item.weight === null || item.weight === undefined ? '' : String(item.weight))
    setFormError('')
    setEditing(true)
  }

  const save = async (event) => {
    event.preventDefault()
    const cleanName = name.trim()
    const max = Number(maxMarks)
    const weightText = weight.trim()
    if (cleanName.length < NAME_MIN || cleanName.length > NAME_MAX) return setFormError(`The name must be between ${NAME_MIN} and ${NAME_MAX} characters.`)
    if (!maxMarks.trim() || !Number.isFinite(max) || max <= 0 || max > MAX_LIMIT || decimals(maxMarks) > 2) return setFormError(`Maximum marks must be above 0 and at most ${MAX_LIMIT}.`)
    let weightValue = null
    if (weightText) {
      weightValue = Number(weightText)
      if (!Number.isFinite(weightValue) || weightValue <= 0 || weightValue > 100 || decimals(weightText) > 2) return setFormError('Weight must be above 0 and at most 100.')
    }
    const ok = await onSave(item, { name: cleanName, type, max_marks: max, weight: weightValue })
    if (ok) setEditing(false)
    return undefined
  }

  return (
    <article className={`slpc-card slpk-component ${selected ? 'is-selected' : ''}`} aria-label={item.name}>
      <div className="slpk-component-main">
        <span className="slpk-index">{String(index + 1).padStart(2, '0')}</span>
        <div className="slpk-component-body">
          <div className="slpc-chips">
            <span className="slpc-chip is-info">{TYPE_LABELS[item.type] ?? item.type}</span>
            <span className={`slpc-chip ${live ? 'is-ok' : 'is-warn'}`}>
              {renderIcon(live ? 'check_circle' : 'visibility_off', 14)}
              {live ? 'Published, released' : 'Draft, withheld'}
            </span>
            <span className="slpk-mono slpc-muted">
              Max: {trimNumber(item.max_marks)} pts • Weight: {numberOr(item.weight) === null ? 'none' : `${trimNumber(item.weight)}%`}
            </span>
          </div>
          <h3 className="slpk-component-title">{item.name}</h3>
          <p className="slpc-muted">
            {entered === null ? 'Marks entered: unknown' : `${entered}${typeof enrolled === 'number' ? ` / ${enrolled}` : ''} marks entered`}
            {mean !== null && mean !== undefined ? ` • Class mean: ${mean.toFixed(1)}%` : ''}
          </p>
        </div>
      </div>

      {!editing && (
        <div className="slpk-component-actions" role="group" aria-label={`Actions for ${item.name}`}>
          <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => onSelect(item.id)} aria-pressed={selected}>
            {renderIcon('edit_note', 16)}
            {selected ? 'Marks sheet open' : 'Marks sheet'}
          </button>
          <button type="button" className="slpc-btn slpc-btn-soft" onClick={open} disabled={busy}>
            {renderIcon('tune', 16)}
            Edit
          </button>
          <button type="button" className={`slpc-btn ${live ? 'slpc-btn-soft' : 'slpc-btn-primary'}`} onClick={() => onTogglePublish(item)} disabled={busy}>
            {renderIcon(live ? 'visibility_off' : 'send', 16)}
            {busy ? 'Working…' : live ? 'Withhold' : 'Release'}
          </button>
        </div>
      )}

      {editing && (
        <form className="slpk-editor" onSubmit={save} aria-label={`Edit ${item.name}`} style={{ width: '100%' }}>
          <div className="slpk-grid-fields is-four">
            <div className="slpk-field">
              <label htmlFor={`slpk-edit-name-${item.id}`}>Name</label>
              <input id={`slpk-edit-name-${item.id}`} type="text" value={name} onChange={(event) => setName(event.target.value)} maxLength={NAME_MAX} />
            </div>
            <div className="slpk-field">
              <label htmlFor={`slpk-edit-type-${item.id}`}>Type</label>
              <select id={`slpk-edit-type-${item.id}`} value={type} onChange={(event) => setType(event.target.value)}>
                {TYPES.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="slpk-field">
              <label htmlFor={`slpk-edit-max-${item.id}`}>Maximum marks</label>
              <input id={`slpk-edit-max-${item.id}`} type="text" inputMode="decimal" value={maxMarks} onChange={(event) => setMaxMarks(event.target.value)} />
            </div>
            <div className="slpk-field">
              <label htmlFor={`slpk-edit-weight-${item.id}`}>Weight %</label>
              <input id={`slpk-edit-weight-${item.id}`} type="text" inputMode="decimal" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="none" />
            </div>
          </div>
          {formError && (
            <p className="slpk-field-error" role="alert">
              {formError}
            </p>
          )}
          <div className="slpk-button-row">
            <button type="submit" className="slpc-btn slpc-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </article>
  )
}

function MarksSheet({ assessment, roster, rosterTotal, onSaved }) {
  const [edits, setEdits] = useState({})
  const [rowErrors, setRowErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [success, setSuccess] = useState('')
  const max = Number(assessment.max_marks)
  const weight = numberOr(assessment.weight)
  const live = Boolean(assessment.published)
  const stats = statsOf(roster, max)
  const enteredPercent = stats.total > 0 ? (stats.entered / stats.total) * 100 : 0
  const pending = stats.total - stats.entered

  const save = useMutation({
    mutationFn: (marks) => api(`/assessments/${assessment.id}/marks`, { method: 'PUT', body: { marks } }),
  })

  const valueOf = (row, field) => {
    const edited = edits[row.student_id]?.[field]
    if (edited !== undefined) return edited
    if (field === 'mark') return numberOr(row.mark) === null ? '' : String(row.mark)
    return row.feedback ?? ''
  }
  const isDirty = (row) => {
    const edit = edits[row.student_id]
    if (!edit) return false
    const markChanged = edit.mark !== undefined && edit.mark !== (numberOr(row.mark) === null ? '' : String(row.mark))
    const feedbackChanged = edit.feedback !== undefined && edit.feedback !== (row.feedback ?? '')
    return markChanged || feedbackChanged
  }
  const dirtyRows = roster.filter(isDirty)

  const change = (row, field, value) => {
    setEdits((current) => ({ ...current, [row.student_id]: { ...current[row.student_id], [field]: value } }))
    setRowErrors((current) => {
      if (!current[row.student_id]) return current
      const { [row.student_id]: removed, ...rest } = current
      void removed
      return rest
    })
    setSuccess('')
  }

  const discard = () => {
    setEdits({})
    setRowErrors({})
    setFormError('')
    setSuccess('')
  }

  const submit = async () => {
    setFormError('')
    setSuccess('')
    const problems = {}
    const payload = []
    dirtyRows.forEach((row) => {
      const markText = valueOf(row, 'mark').trim()
      const feedback = valueOf(row, 'feedback').trim()
      if (!markText) {
        problems[row.student_id] = numberOr(row.mark) !== null ? 'A saved mark cannot be removed. Enter the correct mark instead.' : 'Enter a mark before adding feedback.'
        return
      }
      const mark = Number(markText)
      if (!Number.isFinite(mark) || mark < 0 || mark > max) problems[row.student_id] = `Enter a mark from 0 to ${trimNumber(max)}.`
      else if (decimals(markText) > 2) problems[row.student_id] = 'Use at most 2 decimal places.'
      else if (feedback.length > FEEDBACK_MAX) problems[row.student_id] = `Feedback can be at most ${FEEDBACK_MAX} characters.`
      else payload.push({ student_id: row.student_id, mark, feedback })
    })
    setRowErrors(problems)
    if (Object.keys(problems).length) {
      setFormError(`${Object.keys(problems).length} ${Object.keys(problems).length === 1 ? 'row needs' : 'rows need'} attention. Nothing was saved.`)
      return
    }
    if (payload.length === 0) return
    try {
      const result = await save.mutateAsync(payload)
      setEdits({})
      setSuccess(`Saved: ${result?.created ?? 0} new, ${result?.updated ?? 0} updated, ${result?.unchanged ?? 0} unchanged.`)
      await onSaved()
    } catch (caught) {
      const rows = Array.isArray(caught?.details?.rows) ? caught.details.rows : []
      if (rows.length) {
        const mapped = {}
        rows.forEach((item) => {
          if (item?.student_id) mapped[item.student_id] = item.message || 'This row was rejected.'
        })
        setRowErrors(mapped)
      }
      setFormError(errorText(caught, 'The marks could not be saved. Nothing was changed.'))
    }
  }

  return (
    <section className="slpc-card slpk-sheet" aria-label={`Marks sheet for ${assessment.name}`}>
      <div className="slpk-sheet-head">
        <div className="slpk-sheet-id">
          <span className="slpk-sheet-icon">{renderIcon(TYPE_ICONS[assessment.type] ?? 'grading', 24)}</span>
          <div style={{ minWidth: 0 }}>
            <div className="slpk-sheet-meta">
              <span className="slpc-chip is-info">{TYPE_LABELS[assessment.type] ?? assessment.type}</span>
              <span className={`slpc-chip ${live ? 'is-ok' : 'is-warn'}`}>
                {renderIcon(live ? 'check_circle' : 'visibility_off', 13)}
                {live ? 'Published, released' : 'Draft, withheld from students'}
              </span>
              <span className="slpk-mono slpc-muted">Weight: {weight === null ? 'none' : `${trimNumber(weight)}% of total`}</span>
            </div>
            <h2 className="slpk-sheet-title">{assessment.name}</h2>
            <p className="slpc-muted">Maximum mark: {trimNumber(max)} pts. Marks can be 0 to {trimNumber(max)}.</p>
          </div>
        </div>
      </div>

      <div className="slpk-progress">
        <div className="slpk-progress-main">
          <span className="slpc-strong">Marks entered</span>
          <span className="slpk-mono slpc-strong" style={{ color: 'var(--primary)' }}>
            {stats.entered} / {stats.total} ({enteredPercent.toFixed(1)}%)
          </span>
          {pending > 0 && <span className="slpk-incomplete">{renderIcon('pending', 14)}{pending} not marked</span>}
        </div>
        <div className="slpk-bar slpk-bar-wide" aria-hidden="true">
          <span style={{ width: `${enteredPercent}%` }} />
        </div>
      </div>

      {roster.length === 0 && <p className="slpc-empty" style={{ margin: '0 1.25rem 1.25rem' }}>No students are enrolled in this course yet.</p>}

      {roster.length > 0 && (
        <div className="slpk-scroll">
          <table className="slpk-table">
            <thead>
              <tr>
                <th scope="col">Student / Registration</th>
                <th scope="col">Mark (max {trimNumber(max)})</th>
                <th scope="col">Weighted{weight === null ? '' : ` (${trimNumber(weight)}%)`}</th>
                <th scope="col">Feedback note</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((row) => {
                const markText = valueOf(row, 'mark')
                const parsed = markText.trim() === '' ? null : Number(markText)
                const points = parsed !== null && Number.isFinite(parsed) && weight !== null ? (parsed / max) * weight : null
                const dirty = isDirty(row)
                const error = rowErrors[row.student_id]
                const saved = numberOr(row.mark) !== null
                return (
                  <tr key={row.student_id} className={error ? 'is-error' : ''}>
                    <td data-label="Student">
                      <div className="slpk-student">
                        <strong>{row.full_name}</strong>
                        <span className="slpk-reg">{row.registration_number}</span>
                      </div>
                    </td>
                    <td data-label="Mark">
                      <div className="slpk-mark-field">
                        <input
                          className={`slpk-input is-mark ${error ? 'is-invalid' : ''}`}
                          type="number"
                          inputMode="decimal"
                          min="0"
                          max={max}
                          step="any"
                          value={markText}
                          placeholder="--"
                          onChange={(event) => change(row, 'mark', event.target.value)}
                          aria-label={`Mark for ${row.full_name}`}
                          aria-invalid={Boolean(error)}
                        />
                        <span className="slpk-of">/ {trimNumber(max)}</span>
                      </div>
                      {error && <span className="slpk-row-error">{error}</span>}
                    </td>
                    <td data-label="Weighted" className="slpk-mono slpc-strong">
                      {points === null ? <span className="slpc-muted">--</span> : `${points.toFixed(1)}%`}
                    </td>
                    <td data-label="Feedback">
                      <input
                        className="slpk-input is-feedback"
                        type="text"
                        value={valueOf(row, 'feedback')}
                        placeholder="Optional note for the student"
                        maxLength={FEEDBACK_MAX}
                        onChange={(event) => change(row, 'feedback', event.target.value)}
                        aria-label={`Feedback for ${row.full_name}`}
                      />
                    </td>
                    <td data-label="Status">
                      {dirty ? <span className="slpc-chip is-info">Unsaved</span> : saved ? <span className="slpc-chip is-ok">{live ? 'Entered, released' : 'Entered, draft'}</span> : <span className="slpc-chip is-warn">{renderIcon('priority_high', 12)}Not marked</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {rosterTotal > roster.length && (
        <p className="slpc-notice" role="status" style={{ margin: '0 1.25rem 1.25rem' }}>
          {renderIcon('info', 18)}
          <span>Showing the first {roster.length} of {rosterTotal} students.</span>
        </p>
      )}

      <div className="slpk-footer">
        <div style={{ minWidth: 0 }}>
          <p className="slpc-muted">
            {dirtyRows.length === 0 ? 'No unsaved changes.' : `${dirtyRows.length} ${dirtyRows.length === 1 ? 'row' : 'rows'} changed.`} Saving checks every row first, and one bad row stops the whole save.
          </p>
          {formError && (
            <p className="slpc-alert" role="alert" style={{ marginTop: 8 }}>
              {formError}
            </p>
          )}
          {success && (
            <p className="slpk-ok" role="status" style={{ marginTop: 8 }}>
              {success}
            </p>
          )}
        </div>
        <div className="slpk-footer-actions">
          <button type="button" className="slpc-btn slpc-btn-soft" onClick={discard} disabled={save.isPending || dirtyRows.length === 0}>
            Discard changes
          </button>
          <button type="button" className="slpc-btn slpc-btn-primary" onClick={submit} disabled={save.isPending || dirtyRows.length === 0}>
            {renderIcon('save', 18)}
            {save.isPending ? 'Saving…' : 'Save marks'}
          </button>
        </div>
      </div>
    </section>
  )
}

function Inspector({ assessments, rosters, studentId, onPick }) {
  const students = new Map()
  rosters.forEach((roster) => roster.forEach((row) => students.set(row.student_id, row)))
  const list = [...students.values()].sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)))
  const current = students.get(studentId) ?? list[0]
  const result = current ? weightedResult(assessments, rosters, current.student_id) : null
  const weightedRows = result ? result.rows.filter((row) => row.weight !== null) : []

  return (
    <section className="slpc-card slpc-stack" aria-labelledby="slpk-inspector">
      <div className="slpc-inline">
        <span className="slpc-accent">{renderIcon('person_search', 20)}</span>
        <h2 id="slpk-inspector" className="slpc-h3">
          Student quick inspector
        </h2>
      </div>

      {list.length === 0 && <p className="slpc-empty">Students appear here once the course has assessments and enrolled students.</p>}

      {current && result && (
        <>
          <div className="slpk-field">
            <label htmlFor="slpk-student">Student</label>
            <select id="slpk-student" value={current.student_id} onChange={(event) => onPick(event.target.value)}>
              {list.map((student) => (
                <option key={student.student_id} value={student.student_id}>
                  {student.full_name} ({student.registration_number})
                </option>
              ))}
            </select>
          </div>

          <div className="slpk-inspector-head">
            <div className="slpk-student">
              <strong>{current.full_name}</strong>
              <span className="slpk-reg">{current.registration_number}</span>
            </div>
            <div>
              <div className="slpk-score">{result.percent === null ? '—' : `${result.percent.toFixed(1)}%`}</div>
              <span className="slpc-muted">Weighted so far</span>
            </div>
          </div>

          <div className="slpk-breakdown">
            <span className="slpc-eyebrow">Weight contribution</span>
            {weightedRows.length === 0 && <p className="slpc-empty">No assessment has a weight yet, so there is no weighted result.</p>}
            {weightedRows.map((row) => (
              <div key={row.id} className="slpk-breakdown-row">
                <span>
                  {row.name} ({trimNumber(row.weight)}%)
                </span>
                <strong>{row.mark === null ? 'not marked' : `${trimNumber(row.mark)} / ${trimNumber(row.max)} (${row.points.toFixed(1)}%)`}</strong>
              </div>
            ))}
            {weightedRows.length > 0 && (
              <div className="slpk-breakdown-total">
                <span>Points earned</span>
                <strong>
                  {result.earned.toFixed(1)} / {result.graded.toFixed(1)}
                </strong>
              </div>
            )}
          </div>
          <p className="slpc-muted">Counts every marked, weighted assessment, including drafts that students cannot see yet.</p>
        </>
      )}

      <div className="slpk-rule">
        <span className="slpk-rule-title">
          {renderIcon('verified', 16)}
          How marks are protected
        </span>
        <p>A mark must be between 0 and the maximum. Saved marks are never deleted: correct a mistake by entering the right value, and every change is recorded by the server.</p>
      </div>
    </section>
  )
}

function Distribution({ assessment, stats }) {
  const counts = BANDS.map((band) => ({ ...band, count: (stats.percents ?? []).filter(band.test).length }))
  const top = Math.max(1, ...counts.map((band) => band.count))
  return (
    <section className="slpc-card slpc-stack" aria-labelledby="slpk-dist">
      <div className="slpc-inline" style={{ justifyContent: 'space-between', width: '100%' }}>
        <div>
          <h2 id="slpk-dist" className="slpc-h3">
            Grade distribution
          </h2>
          <p className="slpc-muted">{assessment ? assessment.name : 'No assessment selected'}</p>
        </div>
        {assessment && <span className="slpk-badge">N={stats.entered}</span>}
      </div>
      {(!assessment || stats.entered === 0) && <p className="slpc-empty">The distribution appears once some marks are entered.</p>}
      {assessment && stats.entered > 0 && (
        <>
          <div className="slpk-dist" role="img" aria-label={counts.map((band) => `${band.label}: ${band.count}`).join(', ')}>
            {counts.map((band) => (
              <div key={band.id} className="slpk-dist-row">
                <span className="slpk-dist-label">{band.label}</span>
                <span className="slpk-dist-track">
                  <span className={`is-${band.tone}`} style={{ width: `${(band.count / top) * 100}%` }} />
                </span>
                <span className="slpk-dist-count">{band.count}</span>
              </div>
            ))}
          </div>
          <div className="slpk-foot">
            <span>Pass threshold: {PASS_PERCENT}%</span>
            <span style={{ color: 'var(--tertiary)' }}>{stats.percents.filter((value) => value < PASS_PERCENT).length} below the pass mark</span>
          </div>
        </>
      )}
    </section>
  )
}

export default function LecturerMarks() {
  useCourseFonts()
  const { courseId: routeCourseId } = useParams()
  const queryClient = useQueryClient()

  const [pickedCourse, setPickedCourse] = useState(routeCourseId || '')
  const [selectedId, setSelectedId] = useState('')
  const [studentId, setStudentId] = useState('')
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('order')
  const [showNew, setShowNew] = useState(false)
  const [confirmRelease, setConfirmRelease] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')

  const coursesQuery = useQuery({ queryKey: COURSES_KEY, queryFn: fetchCourses })
  const courses = toList(coursesQuery.data)
  const courseId = courses.some((course) => course.id === pickedCourse) ? pickedCourse : courses[0]?.id
  const course = courses.find((entry) => entry.id === courseId)

  const details = useQueries({
    queries: courses.map((entry) => ({ queryKey: ['course', entry.id], queryFn: () => api(`/courses/${entry.id}`) })),
  })
  const enrolledOf = (id) => {
    const value = details[courses.findIndex((entry) => entry.id === id)]?.data?.enrolled_count
    return typeof value === 'number' ? value : undefined
  }

  const assessmentsQuery = useQuery({
    queryKey: assessmentsKey(courseId),
    queryFn: () => api(assessmentsPath(courseId)),
    enabled: Boolean(courseId),
  })
  const assessments = toList(assessmentsQuery.data)

  const rosterQueries = useQueries({
    queries: assessments.map((item) => ({ queryKey: rosterKey(item.id), queryFn: () => api(rosterPath(item.id)) })),
  })
  const rosters = assessments.map((_, index) => toList(rosterQueries[index]?.data))
  const rostersReady = assessments.length > 0 && rosterQueries.every((query) => query.isSuccess)
  const rosterFailed = rosterQueries.some((query) => query.isError)

  const activeId = assessments.some((item) => item.id === selectedId) ? selectedId : assessments[0]?.id
  const activeIndex = assessments.findIndex((item) => item.id === activeId)
  const active = activeIndex >= 0 ? assessments[activeIndex] : undefined
  const activeRoster = activeIndex >= 0 ? rosters[activeIndex] : []
  const activeStats = active ? statsOf(activeRoster, Number(active.max_marks)) : { entered: 0, total: 0 }
  const activeQuery = activeIndex >= 0 ? rosterQueries[activeIndex] : undefined

  const publishedCount = assessments.filter((item) => item.published).length
  const draftItems = assessments.filter((item) => !item.published)
  const weightUsed = assessments.reduce((sum, item) => sum + (numberOr(item.weight) ?? 0), 0)
  const typeSummary = TYPES.map((type) => ({ ...type, count: assessments.filter((item) => item.type === type.id).length })).filter((type) => type.count > 0)
  const enrolled = enrolledOf(courseId)

  const needle = search.trim().toLowerCase()
  const meanOf = (index) => {
    const stats = statsOf(rosters[index] ?? [], Number(assessments[index].max_marks))
    return stats.mean ?? null
  }
  const visible = assessments
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => (tab === 'all' ? true : tab === 'draft' ? !item.published : item.type === tab))
    .filter(({ item }) => !needle || `${item.name} ${TYPE_LABELS[item.type] ?? ''}`.toLowerCase().includes(needle))
    .sort((a, b) => {
      if (sort === 'weight') return (numberOr(b.item.weight) ?? -1) - (numberOr(a.item.weight) ?? -1)
      if (sort === 'completion') return (numberOr(a.item.marks_entered) ?? 0) - (numberOr(b.item.marks_entered) ?? 0)
      return a.index - b.index
    })

  const refreshAssessments = () => queryClient.invalidateQueries({ queryKey: assessmentsKey(courseId) })
  const refreshAll = async () => {
    await refreshAssessments()
    await queryClient.invalidateQueries({ queryKey: ['assessment-marks'] })
  }

  const patch = useMutation({ mutationFn: ({ id, body }) => api(`/assessments/${id}`, { method: 'PATCH', body }) })

  const runPatch = async (item, body, failure) => {
    setBusyId(item.id)
    setActionError('')
    setNotice('')
    try {
      await patch.mutateAsync({ id: item.id, body })
      await refreshAssessments()
      return true
    } catch (caught) {
      setActionError(errorText(caught, failure))
      return false
    } finally {
      setBusyId('')
    }
  }
  const togglePublish = (item) => runPatch(item, { published: !item.published }, 'The release status could not be changed. Please try again.')
  const saveDetails = (item, body) => runPatch(item, body, 'The changes could not be saved. Please try again.')

  const releaseAll = async () => {
    setBulkBusy(true)
    setActionError('')
    setNotice('')
    const results = await Promise.allSettled(draftItems.map((item) => patch.mutateAsync({ id: item.id, body: { published: true } })))
    const failed = results.filter((result) => result.status === 'rejected')
    await refreshAssessments()
    setBulkBusy(false)
    setConfirmRelease(false)
    if (failed.length) setActionError(`${failed.length} of ${draftItems.length} assessments could not be released. ${errorText(failed[0].reason, '')}`.trim())
    else setNotice(`Released ${draftItems.length} ${draftItems.length === 1 ? 'assessment' : 'assessments'} to students.`)
  }

  const exportCsv = () => {
    setActionError('')
    try {
      downloadCsv(`${course?.course_code ?? 'course'}-marks.csv`, buildCsv(assessments, rosters))
    } catch {
      setActionError('The marks file could not be created. Please try again.')
    }
  }

  const pickCourse = (id) => {
    setPickedCourse(id)
    setSelectedId('')
    setStudentId('')
    setTab('all')
    setSearch('')
    setShowNew(false)
    setConfirmRelease(false)
    setActionError('')
    setNotice('')
  }

  const loadingAssessments = coursesQuery.isPending || (Boolean(courseId) && assessmentsQuery.isPending)

  return (
    <div className="slpc" aria-label="Marks and assessment">
      <style>{COURSE_STYLES}</style>
      <style>{MARKS_STYLES}</style>

      <div className="slpc-stack slpc-gap-lg">
        <div className="slpk-topbar">
          <div className="slpk-title-row">
            <div className="slpc-stack" style={{ gap: 4 }}>
              <nav className="slpc-trail" aria-label="Breadcrumb">
                <Link to="/lecturer" className="slpc-trail-link">
                  Dashboard
                </Link>
                <span className="slpc-trail-sep">{renderIcon('chevron_right', 14)}</span>
                <span>Marks &amp; Assessment</span>
                {course && (
                  <>
                    <span className="slpc-trail-sep">{renderIcon('chevron_right', 14)}</span>
                    <span className="slpc-trail-current">
                      {course.course_code}: {course.course_name}
                    </span>
                  </>
                )}
              </nav>
              <h1 className="slpk-title">Marks &amp; Assessment Management</h1>
              <p className="slpc-muted" style={{ maxWidth: '48rem' }}>
                Set up each assessment, enter marks for your cohort, and release results when you are ready. Marks stay hidden from students until their assessment is released.
              </p>
            </div>
            <div className="slpk-actions">
              <button type="button" className="slpc-btn slpc-btn-soft" onClick={exportCsv} disabled={!rostersReady}>
                {renderIcon('file_download', 18)}
                Export marks (CSV)
              </button>
              <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => setConfirmRelease((open) => !open)} disabled={draftItems.length === 0 || bulkBusy} aria-expanded={confirmRelease}>
                <span style={{ color: 'var(--tertiary)', display: 'inline-flex' }}>{renderIcon('lock_reset', 18)}</span>
                Release marks
                {draftItems.length > 0 && <span className="slpk-badge">{draftItems.length} draft</span>}
              </button>
              <button type="button" className="slpc-btn slpc-btn-primary" onClick={() => setShowNew((open) => !open)} disabled={!courseId} aria-expanded={showNew}>
                {renderIcon('add_circle', 18)}
                New assessment
              </button>
            </div>
          </div>

          {courses.length > 0 && (
            <div className="slpk-scope" role="group" aria-label="Active course">
              <span className="slpk-scope-label">Active course:</span>
              {courses.map((entry) => {
                const isActive = entry.id === courseId
                const count = enrolledOf(entry.id)
                return (
                  <button key={entry.id} type="button" className={`slpk-scope-btn ${isActive ? 'is-active' : ''}`} onClick={() => pickCourse(entry.id)} aria-pressed={isActive}>
                    {isActive && <span className="slpk-dot" aria-hidden="true" />}
                    {entry.course_code}: {entry.course_name}
                    {typeof count === 'number' && <span className="slpk-scope-count">{isActive ? `${count} Enrolled` : count}</span>}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {confirmRelease && (
          <div className="slpk-confirm" role="alertdialog" aria-label="Release marks">
            <p>
              Release {draftItems.length} draft {draftItems.length === 1 ? 'assessment' : 'assessments'} to students? They will see the assessment and their own mark straight away.
            </p>
            <div className="slpk-button-row">
              <button type="button" className="slpc-btn slpc-btn-primary" onClick={releaseAll} disabled={bulkBusy}>
                {bulkBusy ? 'Releasing…' : 'Yes, release'}
              </button>
              <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => setConfirmRelease(false)} disabled={bulkBusy}>
                Not yet
              </button>
            </div>
          </div>
        )}

        {notice && (
          <p className="slpk-ok" role="status">
            {notice}
          </p>
        )}
        {actionError && (
          <p className="slpc-alert" role="alert">
            {actionError}
          </p>
        )}

        {showNew && courseId && (
          <NewAssessmentForm
            key={courseId}
            courseId={courseId}
            weightUsed={weightUsed}
            onClose={() => setShowNew(false)}
            onCreated={async () => {
              setShowNew(false)
              setNotice('Assessment created as a draft. Release it when you are ready.')
              await refreshAssessments()
            }}
          />
        )}

        {coursesQuery.isError && <ErrorCard message="Your courses could not be loaded." onRetry={() => coursesQuery.refetch()} />}
        {coursesQuery.isSuccess && courses.length === 0 && <p className="slpc-empty">You are not assigned to any courses yet, so there are no marks to manage.</p>}
        {loadingAssessments && <Skeleton height={200} label="Loading assessments" />}
        {assessmentsQuery.isError && <ErrorCard message="The assessments for this course could not be loaded." onRetry={() => assessmentsQuery.refetch()} />}

        {courseId && assessmentsQuery.isSuccess && (
          <>
            <div className="slpc-stats" aria-label="Assessment summary">
              <div className="slpc-card slpc-stat">
                <div className="slpc-stat-top">
                  <span className="slpc-stat-label">Total assessments</span>
                  <span className="slpc-stat-icon is-fixed">{renderIcon('assessment', 18)}</span>
                </div>
                <div className="slpc-stat-body">
                  <span className="slpc-stat-value">{assessments.length}</span>
                  <span className="slpc-stat-unit">{weightUsed > 0 ? `${trimNumber(weightUsed)}% weight` : 'no weights yet'}</span>
                </div>
                <div className="slpc-stat-foot">{typeSummary.length ? typeSummary.map((type) => `${type.count} ${type.label}`).join(' • ') : 'Nothing created yet'}</div>
              </div>
              <div className="slpc-card slpc-stat">
                <div className="slpc-stat-top">
                  <span className="slpc-stat-label">Cohort entered</span>
                  <span className="slpc-stat-icon is-warm">{renderIcon('fact_check', 18)}</span>
                </div>
                <div className="slpc-stat-body">
                  <span className="slpc-stat-value">{active && activeQuery?.isSuccess ? `${activeStats.entered} / ${activeStats.total}` : '—'}</span>
                  {active && activeQuery?.isSuccess && activeStats.total > 0 && <span className="slpc-stat-unit">{((activeStats.entered / activeStats.total) * 100).toFixed(1)}%</span>}
                </div>
                <div className="slpc-stat-foot">
                  <span className={`slpk-stat-note ${active && activeQuery?.isSuccess && activeStats.total - activeStats.entered > 0 ? 'is-warn' : ''}`}>
                    {active && activeQuery?.isSuccess
                      ? activeStats.total - activeStats.entered > 0
                        ? `${activeStats.total - activeStats.entered} pending in ${active.name}`
                        : `All marks entered for ${active.name}`
                      : 'Select an assessment'}
                  </span>
                </div>
              </div>
              <div className="slpc-card slpc-stat">
                <div className="slpc-stat-top">
                  <span className="slpc-stat-label">Cohort mean &amp; spread</span>
                  <span className="slpc-stat-icon is-mid">{renderIcon('analytics', 18)}</span>
                </div>
                <div className="slpc-stat-body">
                  <span className="slpc-stat-value">{activeStats.mean === undefined ? '—' : `${activeStats.mean.toFixed(1)}%`}</span>
                  {activeStats.mean !== undefined && <span className="slpc-stat-unit">StdDev ±{activeStats.spread.toFixed(1)}</span>}
                </div>
                <div className="slpc-stat-foot">
                  <span>{activeStats.mean === undefined ? 'Needs entered marks' : `High ${activeStats.high.toFixed(1)}% • Low ${activeStats.low.toFixed(1)}%`}</span>
                  {activeStats.mean !== undefined && <span style={{ color: 'var(--tertiary)' }}>{activeStats.passing.toFixed(1)}% passing</span>}
                </div>
              </div>
              <div className="slpc-card slpc-stat">
                <div className="slpc-stat-top">
                  <span className="slpc-stat-label">Release protection</span>
                  <span className="slpc-stat-icon is-mid">{renderIcon('visibility_off', 18)}</span>
                </div>
                <div className="slpc-stat-body">
                  <span className="slpc-stat-value" style={{ fontSize: 26 }}>
                    {publishedCount} Pub • {draftItems.length} Draft
                  </span>
                </div>
                <div className="slpc-stat-foot">Drafts are withheld from students</div>
              </div>
            </div>

            <section className="slpc-card slpk-toolbar" aria-label="Filter assessments">
              <div className="slpk-tabs" role="tablist" aria-label="Assessment type">
                {TABS.map((entry) => {
                  const count = entry.id === 'all' ? assessments.length : entry.id === 'draft' ? draftItems.length : assessments.filter((item) => item.type === entry.id).length
                  return (
                    <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} className={`slpk-tab ${entry.id === 'draft' ? 'is-draft' : ''} ${tab === entry.id ? 'is-active' : ''}`} onClick={() => setTab(entry.id)}>
                      {entry.id === 'draft' && <span className="slpk-dot" aria-hidden="true" />}
                      {entry.label} ({count})
                    </button>
                  )
                })}
              </div>
              <div className="slpk-tools">
                <label className="slpc-search">
                  {renderIcon('search', 18)}
                  <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search assessments..." aria-label="Search assessments" />
                </label>
                <select className="slpc-select" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort assessments">
                  {SORTS.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            {assessments.length === 0 && <p className="slpc-empty">No assessments yet for this course. Use “New assessment” to add the first CAT, assignment, practical or exam.</p>}
            {rosterFailed && (
              <p className="slpc-alert" role="alert">
                Some marks could not be loaded, so the figures that depend on them are hidden.
              </p>
            )}

            {assessments.length > 0 && (
              <div className="slpk-split">
                <div className="slpk-main">
                  {active && activeQuery?.isPending && <Skeleton height={220} label="Loading marks" />}
                  {active && activeQuery?.isError && <ErrorCard message="The marks for this assessment could not be loaded." onRetry={() => activeQuery.refetch()} />}
                  {active && activeQuery?.isSuccess && <MarksSheet key={active.id} assessment={active} roster={activeRoster} rosterTotal={numberOr(activeQuery.data?.total) ?? activeRoster.length} onSaved={refreshAll} />}

                  <div className="slpc-stack">
                    <div className="slpk-list-head">
                      <h2 className="slpc-h3">Assessment components</h2>
                      <span className="slpc-muted">Scheme total: {trimNumber(weightUsed) || '0'}% weight</span>
                    </div>
                    {visible.length === 0 && <p className="slpc-empty">No assessments match these filters.</p>}
                    {visible.map(({ item, index }) => (
                      <ComponentCard
                        key={item.id}
                        item={item}
                        index={index}
                        selected={item.id === activeId}
                        enrolled={enrolled}
                        mean={rosterQueries[index]?.isSuccess ? meanOf(index) : null}
                        busy={busyId === item.id}
                        onSelect={setSelectedId}
                        onTogglePublish={togglePublish}
                        onSave={saveDetails}
                      />
                    ))}
                  </div>
                </div>

                <div className="slpk-side">
                  {rostersReady ? <Inspector assessments={assessments} rosters={rosters} studentId={studentId} onPick={setStudentId} /> : <Skeleton height={200} label="Loading students" />}
                  <Distribution assessment={active} stats={activeStats} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
