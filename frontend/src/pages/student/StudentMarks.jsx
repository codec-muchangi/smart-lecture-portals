import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueries, useQuery } from '@tanstack/react-query'
import { api } from '../../services/apiClient.js'
import { COURSES_KEY, COURSE_STYLES, ErrorCard, Skeleton, fetchCourses, renderIcon, useCourseFonts } from '../../components/courseKit.jsx'
import { formatSemester, toList } from '../../utils/format.js'
import { csvCell, downloadText } from '../../utils/timetable.js'

/*
 * Smart Lecture Portal: student Marks & Academic Results
 * Place at: src/pages/student/StudentMarks.jsx
 *
 * Route (see routes.jsx):
 *   /student/marks   your released assessment marks, course by course
 *
 * - Renders inside AppShell, which already draws the sidebar and top bar.
 * - Built on the contract in docs/API.md (Marks & grading, Phase 5). Endpoints used:
 *     GET /courses                    the courses you are enrolled in (code, name, credit hours, semester)
 *     GET /courses/{id}               lecturer name for each course
 *     GET /courses/{id}/marks/me      your marks for PUBLISHED assessments:
 *                                     items [{ assessment_id, name, type, max_marks, weight, mark, percentage, feedback }]
 *                                     and totals { weighted_total, weight_graded, weight_published, weighted_percent, marks_total, max_total }
 * - Students only ever receive published assessments and their own marks. A mark of null means "not marked yet".
 * - Every figure on the page is read from those responses or computed from them (a contribution is
 *   mark / max x weight, the same rule the server uses). The API defines no grade letters, grade points,
 *   GPA, class rank, cohort statistics or publish dates, so none are shown and nothing is invented.
 * - Print / PDF uses the browser print dialog; CSV is built in the browser from the rows on screen.
 */

const TYPE_LABELS = { cat: 'CAT', assignment: 'Assignment', practical: 'Practical Lab', exam: 'Exam', other: 'Other' }
const TYPE_PLURALS = { cat: 'CATs', assignment: 'Assignments', practical: 'Practicals', exam: 'Exams', other: 'Other' }
const TYPE_ORDER = ['cat', 'assignment', 'practical', 'exam', 'other']
const TONES = ['t0', 't1', 't2', 't3']
const SORTS = [
  { id: 'course', label: 'Course Code' },
  { id: 'highest', label: 'Highest Score %' },
  { id: 'weight', label: 'Assessment Weight' },
  { id: 'waiting', label: 'Awaiting Mark First' },
]

const errorText = (error, fallback) => error?.message || fallback
const num = (value) => {
  const number = Number(value)
  return value === null || value === undefined || value === '' || !Number.isFinite(number) ? null : number
}
const one = (value) => (num(value) === null ? '—' : Number(value).toFixed(1))
const pct = (value) => (num(value) === null ? '—' : `${Number(value).toFixed(1)}%`)
const typeLabel = (type) => TYPE_LABELS[type] ?? 'Other'
const typeKey = (type) => (TYPE_LABELS[type] ? type : 'other')

const MARKS_STYLES = `
.slpg-head { display: flex; flex-direction: column; gap: 1rem; }
.slpg-title { margin: 0; font-size: 26px; line-height: 34px; font-weight: 800; letter-spacing: -0.02em; overflow-wrap: anywhere; }
.slpg-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
.slpg-actions .slpc-btn { height: 40px; padding: 0 16px; }
.slpg-stat-line { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.5rem; }
.slpg-stat-num { font-size: 36px; line-height: 44px; font-weight: 800; letter-spacing: -0.02em; }
.slpg-stat-unit { font-size: 13px; line-height: 18px; font-weight: 500; color: var(--on-surface-variant); }
.slpg-stat-unit.is-primary { color: var(--primary); font-weight: 700; }
.slpg-stat-sub { margin: 0.25rem 0 0; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); overflow-wrap: anywhere; }
.slpg-bar { width: 100%; height: 8px; border-radius: 999px; background: var(--surface-mid); overflow: hidden; }
.slpg-bar span { display: block; height: 100%; border-radius: 999px; background: var(--primary); }
.slpg-section-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.25rem 1rem; }
.slpg-section-title { margin: 0; display: inline-flex; align-items: center; gap: 0.5rem; font-size: 20px; line-height: 28px; font-weight: 700; letter-spacing: -0.01em; }
.slpg-section-title .material-symbols-outlined { color: var(--primary); }
.slpg-sections { display: flex; flex-direction: column; gap: 0.75rem; }
.slpg-courses { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; margin: 0; padding: 0; list-style: none; }
.slpg-course { width: 100%; display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem; border: 0; border-radius: 16px; background: var(--surface-lowest); color: var(--on-surface); text-align: left; cursor: pointer; font-family: inherit; box-shadow: 0 1px 3px rgba(30, 26, 35, 0.08); transition: box-shadow 0.2s; }
.slpg-course:hover { box-shadow: 0 4px 12px rgba(30, 26, 35, 0.12); }
.slpg-course.is-active { box-shadow: 0 0 0 2px var(--primary); }
.slpg-course-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.25rem 0.5rem; }
.slpg-code { padding: 2px 8px; border-radius: 6px; background: var(--primary-fixed); color: var(--primary); font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 14px; font-weight: 700; }
.slpg-credits { padding: 2px 8px; border-radius: 999px; background: var(--surface-mid); color: var(--on-surface); font-size: 10px; line-height: 14px; font-weight: 700; }
.slpg-course h3 { margin: 0; font-size: 16px; line-height: 22px; font-weight: 700; overflow-wrap: anywhere; }
.slpg-course-lecturer { margin: 0.125rem 0 0; font-size: 12px; line-height: 16px; color: var(--on-surface-variant); }
.slpg-course-box { display: flex; flex-direction: column; gap: 0.375rem; padding: 0.625rem 0.75rem; border-radius: 12px; background: var(--surface-low); }
.slpg-course-total { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; font-size: 11px; line-height: 14px; font-weight: 600; color: var(--on-surface-variant); }
.slpg-course-total strong { font-size: 20px; line-height: 26px; font-weight: 800; color: var(--on-surface); }
.slpg-course-foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.125rem 0.5rem; font-size: 11px; line-height: 14px; font-weight: 600; color: var(--on-surface-variant); }
.slpg-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.slpg-main { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.slpg-filters { display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem; }
.slpg-filter-row { display: flex; flex-direction: column; gap: 0.5rem; }
.slpg-filters .slpc-search, .slpg-filters .slpc-select { height: 44px; border-radius: 12px; }
.slpg-filters .slpc-select { width: 100%; padding: 0 12px; }
.slpg-sort { display: flex; align-items: center; gap: 0.5rem; font-size: 12px; font-weight: 600; color: var(--on-surface-variant); }
.slpg-sort .slpc-select { flex: 1 1 auto; }
.slpg-pill-row { display: flex; flex-direction: column; gap: 0.5rem; }
.slpg-pill-line { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
.slpg-pill-label { flex: 0 0 auto; font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpg-pills { display: flex; align-items: center; gap: 0.375rem; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none; min-width: 0; }
.slpg-pills::-webkit-scrollbar { display: none; }
.slpg-pill { flex: 0 0 auto; padding: 6px 12px; border: 0; border-radius: 999px; background: var(--surface-low); color: var(--on-surface); font-size: 12px; line-height: 16px; font-weight: 600; white-space: nowrap; cursor: pointer; font-family: inherit; transition: background 0.2s; }
.slpg-pill:hover { background: var(--surface-mid); }
.slpg-pill.is-active { background: var(--primary); color: var(--on-primary); box-shadow: 0 1px 2px rgba(30, 26, 35, 0.2); }
.slpg-pill.is-soft.is-active { background: var(--surface-high); color: var(--on-surface); box-shadow: none; }
.slpg-list { display: flex; flex-direction: column; gap: 0.75rem; margin: 0; padding: 0; list-style: none; }
.slpg-item { width: 100%; display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem; border: 0; border-radius: 16px; background: var(--surface-lowest); color: var(--on-surface); text-align: left; cursor: pointer; font-family: inherit; box-shadow: 0 1px 3px rgba(30, 26, 35, 0.08); transition: box-shadow 0.2s; }
.slpg-item:hover { box-shadow: 0 4px 12px rgba(30, 26, 35, 0.12); }
.slpg-item.is-selected { box-shadow: 0 0 0 2px var(--primary); }
.slpg-item-top { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 0.75rem; }
.slpg-item-who { display: flex; align-items: flex-start; gap: 0.75rem; min-width: 0; flex: 1 1 220px; }
.slpg-badge { flex: 0 0 auto; min-width: 40px; height: 40px; padding: 0 6px; border-radius: 12px; background: var(--primary-fixed); color: var(--primary); display: inline-flex; align-items: center; justify-content: center; font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 14px; font-weight: 700; text-align: center; }
.slpg-item-name { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 0.5rem; }
.slpg-item-name strong { font-size: 16px; line-height: 22px; font-weight: 700; overflow-wrap: anywhere; }
.slpg-kind { padding: 2px 8px; border-radius: 999px; background: var(--surface-mid); color: var(--on-surface); font-size: 10px; line-height: 14px; font-weight: 700; letter-spacing: 0.02em; white-space: nowrap; }
.slpg-item-sub { display: block; margin-top: 2px; font-size: 12px; line-height: 16px; color: var(--on-surface-variant); overflow-wrap: anywhere; }
.slpg-score { display: flex; align-items: center; gap: 0.75rem; }
.slpg-score-main { display: flex; flex-direction: column; align-items: flex-end; }
.slpg-score-main > span:first-child { display: inline-flex; align-items: baseline; gap: 0.25rem; }
.slpg-score-main strong { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 22px; line-height: 28px; font-weight: 700; }
.slpg-score-main small { font-size: 12px; line-height: 16px; color: var(--on-surface-variant); }
.slpg-score-main em { font-style: normal; font-size: 11px; line-height: 14px; font-weight: 600; color: var(--on-surface-variant); }
.slpg-percent { padding: 4px 10px; border-radius: 10px; background: var(--primary-fixed); color: var(--primary); display: inline-flex; flex-direction: column; align-items: center; min-width: 52px; font-size: 15px; line-height: 18px; font-weight: 800; }
.slpg-percent.is-waiting { background: var(--surface-mid); color: var(--on-surface-variant); font-size: 11px; line-height: 14px; font-weight: 700; text-align: center; }
.slpg-snippet { display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.625rem 0.75rem; border-radius: 12px; background: var(--surface-low); font-size: 13px; line-height: 19px; font-style: italic; color: var(--on-surface-variant); }
.slpg-snippet .material-symbols-outlined { flex: 0 0 auto; color: var(--primary); margin-top: 1px; font-style: normal; }
.slpg-snippet p { margin: 0; min-width: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
.slpg-item-foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.25rem 1rem; font-size: 11px; line-height: 14px; font-weight: 600; color: var(--on-surface-variant); }
.slpg-item-foot > span:first-child { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 1rem; }
.slpg-item-foot .slpg-meta { display: inline-flex; align-items: center; gap: 0.25rem; }
.slpg-item-foot .material-symbols-outlined { color: var(--primary); }
.slpg-state { padding: 2px 8px; border-radius: 6px; background: var(--surface-mid); text-transform: uppercase; letter-spacing: 0.04em; font-size: 10px; font-weight: 700; }
.slpg-state.is-done { background: var(--ok-bg, #e1f4e6); color: var(--ok, #1b6b3a); }
.slpg-side { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.slpg-inspector { display: flex; flex-direction: column; gap: 1rem; padding: 1.25rem; scroll-margin-top: 5rem; }
.slpg-inspector-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; }
.slpg-inspector-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem; }
.slpg-inspector h2 { margin: 0; font-size: 20px; line-height: 28px; font-weight: 700; letter-spacing: -0.01em; overflow-wrap: anywhere; }
.slpg-inspector-sub { margin: 0.125rem 0 0; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); overflow-wrap: anywhere; }
.slpg-shield { flex: 0 0 auto; width: 32px; height: 32px; border-radius: 10px; background: var(--surface-mid); color: var(--primary); display: inline-flex; align-items: center; justify-content: center; }
.slpg-hero { display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem; border-radius: 16px; background: var(--surface-low); }
.slpg-hero-row { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 0.75rem; }
.slpg-hero-label { display: block; font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpg-hero-score { display: inline-flex; align-items: baseline; gap: 0.25rem; }
.slpg-hero-score strong { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 32px; line-height: 40px; font-weight: 700; letter-spacing: -0.02em; }
.slpg-hero-score small { font-size: 14px; line-height: 20px; color: var(--on-surface-variant); }
.slpg-hero-percent { display: inline-flex; flex-direction: column; align-items: flex-end; }
.slpg-hero-percent strong { padding: 2px 12px; border-radius: 10px; background: var(--primary-fixed); color: var(--primary); font-size: 22px; line-height: 30px; font-weight: 800; }
.slpg-contrib { display: flex; flex-direction: column; gap: 0.375rem; }
.slpg-contrib-row { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.25rem 0.5rem; font-size: 11px; line-height: 14px; font-weight: 600; color: var(--on-surface-variant); }
.slpg-contrib-row strong { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; color: var(--primary); }
.slpg-facts { display: flex; flex-direction: column; gap: 0.5rem; margin: 0; padding: 0.875rem; border-radius: 12px; background: var(--surface-low); font-size: 13px; line-height: 18px; }
.slpg-fact { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
.slpg-fact dt { color: var(--on-surface-variant); }
.slpg-fact dd { margin: 0; font-weight: 700; text-align: right; }
.slpg-eval { display: flex; flex-direction: column; gap: 0.5rem; }
.slpg-eval-card { display: flex; flex-direction: column; gap: 0.625rem; padding: 0.875rem; border-radius: 12px; background: var(--surface-low); }
.slpg-eval-who { display: flex; align-items: center; gap: 0.625rem; }
.slpg-avatar { width: 32px; height: 32px; border-radius: 999px; background: var(--primary-fixed); color: var(--primary); display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.slpg-eval-who strong { display: block; font-size: 13px; line-height: 18px; font-weight: 700; }
.slpg-eval-who span { display: block; font-size: 11px; line-height: 14px; color: var(--on-surface-variant); }
.slpg-eval-body { margin: 0; font-size: 13px; line-height: 21px; font-style: italic; white-space: pre-wrap; overflow-wrap: anywhere; }
.slpg-eval-none { margin: 0; font-size: 13px; line-height: 20px; color: var(--on-surface-variant); }
.slpg-how { padding: 1rem; display: flex; flex-direction: column; gap: 0.375rem; }
.slpg-how h3 { margin: 0; display: inline-flex; align-items: center; gap: 0.5rem; font-size: 13px; line-height: 18px; font-weight: 700; }
.slpg-how h3 .material-symbols-outlined { color: var(--primary); }
.slpg-how p { margin: 0; font-size: 12px; line-height: 18px; color: var(--on-surface-variant); }
.slpg-warn { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.75rem 1rem; border-radius: 12px; background: var(--error-container); color: var(--on-error-container); font-size: 13px; line-height: 18px; }
.slpg-tone.is-t0 { --tone: var(--primary); }
.slpg-tone.is-t1 { --tone: var(--secondary); }
.slpg-tone.is-t2 { --tone: var(--tertiary); }
.slpg-tone.is-t3 { --tone: var(--outline); }
.slpg-tone .slpg-code, .slpg-tone .slpg-badge { color: var(--tone, var(--primary)); }
@media (min-width: 640px) {
  .slpg-courses { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .slpg-filter-row { flex-direction: row; align-items: center; }
  .slpg-filter-row .slpc-search { flex: 1 1 auto; }
  .slpg-sort { flex: 0 0 auto; }
  .slpg-sort .slpc-select { width: 190px; }
  .slpg-pill-row { flex-direction: row; flex-wrap: wrap; align-items: center; gap: 0.5rem 1.5rem; }
}
@media (min-width: 768px) {
  .slpg-head { flex-direction: row; align-items: center; justify-content: space-between; }
}
@media (min-width: 1024px) {
  .slpg-title { font-size: 32px; line-height: 40px; }
  .slpg-courses { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
@media (min-width: 1180px) {
  .slpg-split { grid-template-columns: minmax(0, 2fr) minmax(300px, 1fr); }
  .slpg-inspector-sticky { position: sticky; top: 5rem; }
}
@media (max-width: 479px) {
  .slpg-score { width: 100%; justify-content: space-between; }
  .slpg-stat-num { font-size: 32px; line-height: 40px; }
}
@media print {
  .slpg-actions, .slpg-filters, .slpg-side, .slpg-trail { display: none; }
  .slpg-split { grid-template-columns: minmax(0, 1fr); }
}
`

/* ---------- data helpers ---------- */

function buildRows(courses, marksQueries, detailQueries) {
  return courses.flatMap((course, index) => {
    const lecturer = detailQueries[index]?.data?.lecturers?.[0]
    const lecturerName = [lecturer?.title, lecturer?.full_name].filter(Boolean).join(' ')
    return toList(marksQueries[index]?.data?.items).map((item) => {
      const max = num(item.max_marks)
      const mark = num(item.mark)
      const weight = num(item.weight)
      const percent = mark === null || !max ? null : num(item.percentage) ?? (mark / max) * 100
      return {
        key: `${course.id}:${item.assessment_id}`,
        courseId: course.id,
        code: course.course_code,
        courseName: course.course_name,
        lecturer: lecturerName,
        tone: TONES[index % TONES.length],
        name: String(item.name ?? 'Assessment'),
        type: typeKey(item.type),
        max,
        mark,
        weight,
        percent,
        contribution: mark !== null && max && weight !== null ? (mark / max) * weight : null,
        feedback: String(item.feedback ?? '').trim(),
        marked: mark !== null,
      }
    })
  })
}

const rowsCsv = (rows) => {
  const lines = [['Course', 'Course name', 'Assessment', 'Type', 'Mark', 'Out of', 'Percent', 'Weight %', 'Contribution %', 'Feedback'].map(csvCell).join(',')]
  rows.forEach((row) => {
    lines.push(
      [row.code, row.courseName, row.name, typeLabel(row.type), row.marked ? one(row.mark) : 'Not marked yet', row.max === null ? '' : one(row.max), row.percent === null ? '' : one(row.percent), row.weight === null ? '' : one(row.weight), row.contribution === null ? '' : one(row.contribution), row.feedback]
        .map(csvCell)
        .join(','),
    )
  })
  return lines.join('\n')
}

/* ---------- pieces ---------- */

function Inspector({ row, summary }) {
  if (!row) {
    return (
      <section className="slpc-card slpg-inspector slpg-inspector-sticky" aria-label="Assessment details">
        <span className="slpc-eyebrow">Assessment details</span>
        <p className="slpc-empty">Select an assessment to see your mark, contribution and lecturer feedback here.</p>
      </section>
    )
  }
  const earned = row.contribution
  return (
    <section className={`slpc-card slpg-inspector slpg-inspector-sticky slpg-tone is-${row.tone}`} aria-label="Assessment details">
      <div className="slpg-inspector-head">
        <div style={{ minWidth: 0 }}>
          <div className="slpg-inspector-tags">
            <span className="slpg-code">{row.code}</span>
            <span className="slpg-kind">{typeLabel(row.type)}</span>
          </div>
          <h2>{row.name}</h2>
          <p className="slpg-inspector-sub">{row.courseName}</p>
        </div>
        <span className="slpg-shield" aria-hidden="true">
          {renderIcon('verified_user', 18)}
        </span>
      </div>

      <div className="slpg-hero">
        <div className="slpg-hero-row">
          <div>
            <span className="slpg-hero-label">Raw score</span>
            {row.marked ? (
              <span className="slpg-hero-score">
                <strong>{one(row.mark)}</strong>
                <small>/ {row.max === null ? '—' : trimmed(row.max)}</small>
              </span>
            ) : (
              <span className="slpg-hero-score">
                <strong style={{ fontSize: 22, lineHeight: '30px' }}>Not marked yet</strong>
              </span>
            )}
          </div>
          <div className="slpg-hero-percent">
            <span className="slpg-hero-label">Percentage</span>
            <strong>{pct(row.percent)}</strong>
          </div>
        </div>
        {row.weight !== null && (
          <div className="slpg-contrib">
            <div className="slpg-contrib-row">
              <span>Weighted course contribution</span>
              <strong>{earned === null ? `— / ${one(row.weight)}% max` : `${one(earned)}% / ${one(row.weight)}% max`}</strong>
            </div>
            <div className="slpg-bar" role="img" aria-label={earned === null ? 'Not marked yet' : `${one(earned)} of ${one(row.weight)} weighted points`}>
              <span style={{ width: `${earned === null || !row.weight ? 0 : Math.min(100, (earned / row.weight) * 100)}%` }} />
            </div>
          </div>
        )}
      </div>

      <dl className="slpg-facts">
        <div className="slpg-fact">
          <dt>Counts towards course</dt>
          <dd>{row.weight === null ? 'Not weighted' : `${one(row.weight)}%`}</dd>
        </div>
        {summary && (
          <div className="slpg-fact">
            <dt>Course total so far</dt>
            <dd>{pct(summary.percent)}</dd>
          </div>
        )}
        {summary && (
          <div className="slpg-fact">
            <dt>Weight marked</dt>
            <dd>
              {one(summary.weightGraded)}% of {one(summary.weightPublished)}%
            </dd>
          </div>
        )}
      </dl>

      <div className="slpg-eval">
        <span className="slpc-eyebrow">Lecturer evaluation</span>
        <div className="slpg-eval-card">
          {row.lecturer && (
            <div className="slpg-eval-who">
              <span className="slpg-avatar" aria-hidden="true">
                {renderIcon('person', 18)}
              </span>
              <div>
                <strong>{row.lecturer}</strong>
                <span>Course lecturer</span>
              </div>
            </div>
          )}
          {row.feedback ? <p className="slpg-eval-body">{row.feedback}</p> : <p className="slpg-eval-none">{row.marked ? 'Your lecturer did not add written feedback for this assessment.' : 'Feedback appears here once your lecturer has marked this assessment.'}</p>}
        </div>
      </div>

      <Link to={`/student/courses/${row.courseId}`} className="slpc-btn slpc-btn-soft" style={{ justifyContent: 'center', height: 40 }}>
        {renderIcon('menu_book', 18)}
        Open {row.code} course page
      </Link>
    </section>
  )
}

const trimmed = (value) => String(+Number(value).toFixed(2))

/* ---------- page ---------- */

export default function StudentMarks() {
  useCourseFonts()

  const [course, setCourse] = useState('all')
  const [type, setType] = useState('all')
  const [sort, setSort] = useState('course')
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState('')
  const inspectorRef = useRef(null)

  const coursesQuery = useQuery({ queryKey: COURSES_KEY, queryFn: fetchCourses })
  const courses = toList(coursesQuery.data)

  const marksQueries = useQueries({
    queries: courses.map((item) => ({
      queryKey: ['course-marks', item.id],
      queryFn: () => api(`/courses/${item.id}/marks/me`),
    })),
  })
  const detailQueries = useQueries({
    queries: courses.map((item) => ({
      queryKey: ['course', item.id],
      queryFn: () => api(`/courses/${item.id}`),
    })),
  })

  const loading = coursesQuery.isPending || (courses.length > 0 && marksQueries.some((query) => query.isPending))
  const ready = coursesQuery.isSuccess && !loading
  const failedCourses = courses.filter((_, index) => marksQueries[index]?.isError)

  const rows = ready ? buildRows(courses, marksQueries, detailQueries) : []
  const summaries = courses.map((item, index) => {
    const data = marksQueries[index]?.data
    const items = toList(data?.items)
    return {
      course: item,
      index,
      failed: Boolean(marksQueries[index]?.isError),
      percent: num(data?.totals?.weighted_percent),
      weightGraded: num(data?.totals?.weight_graded) ?? 0,
      weightPublished: num(data?.totals?.weight_published) ?? 0,
      published: items.length,
      marked: items.filter((entry) => num(entry.mark) !== null).length,
      lecturer: [detailQueries[index]?.data?.lecturers?.[0]?.title, detailQueries[index]?.data?.lecturers?.[0]?.full_name].filter(Boolean).join(' '),
    }
  })
  const summaryOf = (courseId) => summaries.find((entry) => entry.course.id === courseId)

  const scored = summaries.filter((entry) => entry.percent !== null)
  const average = scored.length > 0 ? scored.reduce((sum, entry) => sum + entry.percent, 0) / scored.length : null
  const top = scored.length > 0 ? scored.reduce((best, entry) => (entry.percent > best.percent ? entry : best)) : null
  const releasedCount = rows.filter((row) => row.marked).length
  const waitingCount = rows.length - releasedCount
  const credits = courses.reduce((sum, item) => sum + (Number(item.credit_hours) || 0), 0)
  const term = courses[0] ? formatSemester(courses[0].semester) : ''

  const typesPresent = TYPE_ORDER.filter((key) => rows.some((row) => row.type === key))
  const needle = search.trim().toLowerCase()
  const visible = rows
    .filter((row) => course === 'all' || row.courseId === course)
    .filter((row) => type === 'all' || row.type === type)
    .filter((row) => !needle || `${row.name} ${row.code} ${row.courseName} ${row.lecturer} ${row.feedback} ${typeLabel(row.type)}`.toLowerCase().includes(needle))
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      if (sort === 'highest') return (b.row.percent ?? -1) - (a.row.percent ?? -1) || a.index - b.index
      if (sort === 'weight') return (b.row.weight ?? -1) - (a.row.weight ?? -1) || a.index - b.index
      if (sort === 'waiting') return Number(a.row.marked) - Number(b.row.marked) || a.index - b.index
      return a.index - b.index
    })
    .map((entry) => entry.row)

  const selected = visible.find((row) => row.key === selectedKey) ?? visible[0]

  const choose = (key) => {
    setSelectedKey(key)
    if (typeof window !== 'undefined' && window.innerWidth < 1180) inspectorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }
  const pickCourse = (id) => {
    setCourse((current) => (current === id ? 'all' : id))
    setSelectedKey('')
  }
  const retryFailed = () => marksQueries.forEach((query) => query.isError && query.refetch())

  return (
    <div className="slpc" aria-label="Marks and academic results">
      <style>{COURSE_STYLES}</style>
      <style>{MARKS_STYLES}</style>

      <div className="slpc-stack slpc-gap-lg">
        <div className="slpc-stack" style={{ gap: '0.25rem' }}>
          <nav className="slpc-trail slpg-trail" aria-label="Breadcrumb" style={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 11, fontWeight: 600 }}>
            <Link to="/student" className="slpc-trail-link">
              Student Dashboard
            </Link>
            <span className="slpc-trail-sep">{renderIcon('chevron_right', 14)}</span>
            <span className="slpc-trail-item">Academic Records</span>
            <span className="slpc-trail-sep">{renderIcon('chevron_right', 14)}</span>
            <span className="slpc-trail-current">Marks &amp; Results</span>
          </nav>
          <div className="slpg-head">
            <div className="slpc-stack" style={{ gap: '0.25rem', maxWidth: 720 }}>
              <h1 className="slpg-title">Marks &amp; Academic Results</h1>
              <p className="slpc-lead">Your released assessment marks, lecturer feedback and weighted course totals for the courses you are enrolled in.</p>
            </div>
            <div className="slpg-actions">
              <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => window.print()} disabled={!ready}>
                {renderIcon('print', 18)}
                Print / PDF
              </button>
              <button type="button" className="slpc-btn slpc-btn-primary" onClick={() => downloadText('my-marks.csv', rowsCsv(visible), 'text/csv')} disabled={!ready || visible.length === 0}>
                {renderIcon('download', 18)}
                Export CSV
              </button>
            </div>
          </div>
        </div>

        {coursesQuery.isError && <ErrorCard message={errorText(coursesQuery.error, 'Your courses could not be loaded.')} onRetry={() => coursesQuery.refetch()} />}

        <div className="slpc-stats" aria-label="Results summary">
          <div className="slpc-card slpc-stat">
            <div className="slpc-stat-top">
              <span className="slpc-stat-label">Overall average</span>
              <span className="slpc-stat-icon is-fixed">{renderIcon('calculate', 18)}</span>
            </div>
            <div className="slpg-stat-line">
              <span className="slpg-stat-num">{ready && average !== null ? pct(average) : '—'}</span>
            </div>
            <div className="slpg-bar" aria-hidden="true">
              <span style={{ width: `${average === null ? 0 : Math.min(100, average)}%` }} />
            </div>
            <p className="slpg-stat-sub" style={{ margin: 0 }}>
              {ready ? (scored.length > 0 ? `Average of ${scored.length} ${scored.length === 1 ? 'course' : 'courses'} with marks` : 'No marks have been released yet') : 'Loading your marks'}
            </p>
          </div>

          <div className="slpc-card slpc-stat">
            <div className="slpc-stat-top">
              <span className="slpc-stat-label">Strongest course</span>
              <span className="slpc-stat-icon is-warm">{renderIcon('workspace_premium', 18)}</span>
            </div>
            <div>
              <div className="slpg-stat-line">
                <span className="slpg-stat-num">{ready && top ? pct(top.percent) : '—'}</span>
                {ready && top && <span className="slpg-stat-unit is-primary">{top.course.course_code}</span>}
              </div>
              <p className="slpg-stat-sub">{ready ? (top ? top.course.course_name : 'Appears once a mark is released') : 'Loading your marks'}</p>
            </div>
          </div>

          <div className="slpc-card slpc-stat">
            <div className="slpc-stat-top">
              <span className="slpc-stat-label">Assessment status</span>
              <span className="slpc-stat-icon is-ok">{renderIcon('fact_check', 18)}</span>
            </div>
            <div>
              <div className="slpg-stat-line">
                <span className="slpg-stat-num">{ready ? releasedCount : '—'}</span>
                <span className="slpg-stat-unit">Released</span>
              </div>
              <p className="slpg-stat-sub">{ready ? (waitingCount > 0 ? `${waitingCount} published, awaiting a mark` : 'Nothing is waiting to be marked') : 'Loading your marks'}</p>
            </div>
          </div>

          <div className="slpc-card slpc-stat">
            <div className="slpc-stat-top">
              <span className="slpc-stat-label">Enrolled credits</span>
              <span className="slpc-stat-icon is-mid">{renderIcon('rule_folder', 18)}</span>
            </div>
            <div>
              <div className="slpg-stat-line">
                <span className="slpg-stat-num">{coursesQuery.isSuccess ? credits : '—'}</span>
                <span className="slpg-stat-unit">Credit hours</span>
              </div>
              <p className="slpg-stat-sub">{coursesQuery.isSuccess ? `${courses.length} ${courses.length === 1 ? 'course' : 'courses'}${term ? ` • ${term}` : ''}` : 'Loading your courses'}</p>
            </div>
          </div>
        </div>

        <section className="slpg-sections" aria-label="Enrolled course summaries">
          <div className="slpg-section-head">
            <h2 className="slpg-section-title">
              {renderIcon('auto_stories', 22)}
              Enrolled Course Summaries
            </h2>
            {term && <span className="slpc-eyebrow">{term} breakdown</span>}
          </div>
          {loading && <Skeleton height={150} label="Loading course summaries" />}
          {coursesQuery.isSuccess && courses.length === 0 && <p className="slpc-card slpc-empty">You are not enrolled in any courses yet, so there are no marks to show.</p>}
          {ready && courses.length > 0 && (
            <ul className="slpg-courses">
              {summaries.map((entry) => (
                <li key={entry.course.id}>
                  <button type="button" className={`slpg-course slpg-tone is-${TONES[entry.index % TONES.length]} ${course === entry.course.id ? 'is-active' : ''}`} onClick={() => pickCourse(entry.course.id)} aria-pressed={course === entry.course.id} aria-label={`${entry.course.course_code} ${entry.course.course_name}`}>
                    <span className="slpg-course-top">
                      <span className="slpg-code">{entry.course.course_code}</span>
                      <span className="slpg-credits">{Number(entry.course.credit_hours) || 0} Credits</span>
                    </span>
                    <span>
                      <h3>{entry.course.course_name}</h3>
                      {entry.lecturer && <p className="slpg-course-lecturer">{entry.lecturer}</p>}
                    </span>
                    <span className="slpg-course-box">
                      <span className="slpg-course-total">
                        <span>Weighted total</span>
                        <strong>{entry.failed ? '—' : pct(entry.percent)}</strong>
                      </span>
                      <span className="slpg-course-foot">
                        <span>{entry.failed ? 'Could not load' : `Released: ${entry.marked} / ${entry.published}`}</span>
                        <span>{entry.failed ? '' : entry.published === 0 ? 'Nothing published' : entry.marked === entry.published ? 'All marked' : `${entry.published - entry.marked} awaiting`}</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {failedCourses.length > 0 && (
          <div className="slpg-warn" role="alert">
            <span>Marks for {failedCourses.map((item) => item.course_code).join(', ')} could not be loaded.</span>
            <button type="button" className="slpc-btn slpc-btn-soft" onClick={retryFailed}>
              Try again
            </button>
          </div>
        )}

        {ready && courses.length > 0 && (
          <div className="slpg-split">
            <div className="slpg-main">
              <section className="slpc-card slpg-filters" aria-label="Filter assessments">
                <div className="slpg-filter-row">
                  <label className="slpc-search">
                    {renderIcon('search', 18)}
                    <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search assessment, lecturer, module or keyword" aria-label="Search assessments" />
                  </label>
                  <label className="slpg-sort">
                    <span>Sort:</span>
                    <select className="slpc-select" value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort assessments">
                      {SORTS.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="slpg-pill-row">
                  <div className="slpg-pill-line">
                    <div className="slpg-pills" role="group" aria-label="Course filter">
                      <button type="button" className={`slpg-pill ${course === 'all' ? 'is-active' : ''}`} onClick={() => setCourse('all')} aria-pressed={course === 'all'}>
                        All Modules ({courses.length})
                      </button>
                      {courses.map((item) => (
                        <button key={item.id} type="button" className={`slpg-pill ${course === item.id ? 'is-active' : ''}`} onClick={() => setCourse(item.id)} aria-pressed={course === item.id}>
                          {item.course_code}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="slpg-pill-line">
                    <span className="slpg-pill-label">Type:</span>
                    <div className="slpg-pills" role="group" aria-label="Assessment type">
                      <button type="button" className={`slpg-pill is-soft ${type === 'all' ? 'is-active' : ''}`} onClick={() => setType('all')} aria-pressed={type === 'all'}>
                        All
                      </button>
                      {typesPresent.map((key) => (
                        <button key={key} type="button" className={`slpg-pill is-soft ${type === key ? 'is-active' : ''}`} onClick={() => setType(key)} aria-pressed={type === key}>
                          {TYPE_PLURALS[key]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              {rows.length === 0 && <p className="slpc-card slpc-empty">Your lecturers have not published any assessments yet. They will appear here as soon as they do.</p>}
              {rows.length > 0 && visible.length === 0 && <p className="slpc-card slpc-empty">No assessments match these filters.</p>}

              {visible.length > 0 && (
                <ul className="slpg-list" aria-label="Assessments">
                  {visible.map((row) => (
                    <li key={row.key}>
                      <button type="button" className={`slpg-item slpg-tone is-${row.tone} ${selected?.key === row.key ? 'is-selected' : ''}`} onClick={() => choose(row.key)} aria-pressed={selected?.key === row.key} aria-label={`${row.code} ${row.name}, ${row.marked ? `${one(row.mark)} out of ${trimmed(row.max)}` : 'not marked yet'}`}>
                        <span className="slpg-item-top">
                          <span className="slpg-item-who">
                            <span className="slpg-badge">{row.code}</span>
                            <span style={{ minWidth: 0 }}>
                              <span className="slpg-item-name">
                                <strong>{row.name}</strong>
                                <span className="slpg-kind">{typeLabel(row.type)}</span>
                              </span>
                              <span className="slpg-item-sub">
                                {row.code}: {row.courseName}
                                {row.lecturer ? ` • ${row.lecturer}` : ''}
                              </span>
                            </span>
                          </span>
                          <span className="slpg-score">
                            <span className="slpg-score-main">
                              {row.marked ? (
                                <>
                                  <span>
                                    <strong>{one(row.mark)}</strong>
                                    <small>/ {row.max === null ? '—' : trimmed(row.max)}</small>
                                  </span>
                                  {row.contribution !== null && <em>Contribution: {one(row.contribution)}%</em>}
                                </>
                              ) : (
                                <em>Not marked yet</em>
                              )}
                            </span>
                            <span className={`slpg-percent ${row.marked ? '' : 'is-waiting'}`}>{row.marked ? pct(row.percent) : 'Awaiting'}</span>
                          </span>
                        </span>
                        {row.feedback && (
                          <span className="slpg-snippet">
                            {renderIcon('rate_review', 18)}
                            <p>“{row.feedback}”</p>
                          </span>
                        )}
                        <span className="slpg-item-foot">
                          <span>
                            <span className="slpg-meta">
                              {renderIcon('pie_chart', 14)}
                              {row.weight === null ? 'Not weighted' : `Weight: ${one(row.weight)}%`}
                            </span>
                          </span>
                          <span className={`slpg-state ${row.marked ? 'is-done' : ''}`}>{row.marked ? 'Marked' : 'Awaiting mark'}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="slpg-side" ref={inspectorRef}>
              <Inspector row={selected} summary={selected ? summaryOf(selected.courseId) : undefined} />
              <section className="slpc-card slpg-how" aria-label="How totals are worked out">
                <h3>
                  {renderIcon('info', 18)}
                  How your course total is worked out
                </h3>
                <p>Each published assessment that has been marked adds mark ÷ out of × its weight. Assessments that are not published, or not marked yet, are left out until they are. Questions about a mark? Speak to your course lecturer.</p>
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
