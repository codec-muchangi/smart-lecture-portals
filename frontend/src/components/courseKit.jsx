import { useEffect, useState } from 'react'
import { api } from '../services/apiClient.js'
import { toList } from '../utils/format.js'

/*
 * Smart Lecture Portal: shared pieces for the course pages
 * Place at: src/components/courseKit.jsx
 *
 * Used by the student course page and the lecturer course page, so both share one look
 * (the `.slpc` styles), one set of small helpers and the same loading / error cards.
 */

export const FONT_LINKS = [
  {
    id: 'slp-font-jakarta',
    href: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap',
  },
  {
    id: 'slp-font-symbols',
    href: 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap',
  },
  {
    id: 'slp-font-mono',
    href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap',
  },
]


export const CATEGORY_LABELS = {
  lecture_notes: 'Lecture Notes',
  slides: 'Lecture Slides',
  reading: 'Reading',
  lab: 'Lab Worksheets',
  past_paper: 'Past Papers',
  other: 'Other',
}

export const AVATAR_TONES = ['primary', 'tertiary', 'secondary']

// Same query key as AppShell and the dashboard, so the course list is fetched once and shared.
export const COURSES_KEY = ['courses', 'assigned']
export const fetchCourses = () => api('/courses?page_size=100')

export function renderIcon(name, size) {
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

export function countOf(data) {
  return typeof data?.total === 'number' ? data.total : toList(data).length
}

export function initials(name) {
  const letters = String(name ?? '')
    .split(/\s+/)
    .filter((word) => /^[A-Za-z]/.test(word) && !/^(dr|prof|mr|mrs|ms)\.?$/i.test(word))
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('')
  return letters || '•'
}

export function trimNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? String(+number.toFixed(1)) : ''
}

export function courseTitle(course) {
  return `${course.course_code}: ${course.course_name}`
}

// A signed link comes back from the API; open it in a new tab.
export async function openSignedLink(path) {
  const data = await api(path)
  const link = document.createElement('a')
  link.href = data.url
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  if (data.file_name) link.download = data.file_name
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export function useDownloads() {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const start = async (key, path) => {
    setBusy(key)
    setError('')
    try {
      await openSignedLink(path)
    } catch (caught) {
      setError(caught?.message || 'The download could not be started. Please try again.')
    } finally {
      setBusy('')
    }
  }
  return { busy, error, start }
}

export function useClock() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [])
  return now
}

export function Skeleton({ height = 92, label }) {
  return <div className="slpc-card slpc-skeleton" style={{ minHeight: height }} aria-busy="true" aria-label={label} />
}

export function ErrorCard({ message, onRetry, children }) {
  return (
    <div className="slpc-card slpc-state" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="slpc-btn slpc-btn-soft" onClick={onRetry}>
          Try again
        </button>
      )}
      {children}
    </div>
  )
}

export function PhasePanel({ icon, title, phase, children }) {
  return (
    <section className="slpc-card slpc-phase" aria-label={title}>
      <span className="slpc-phase-icon">{renderIcon(icon, 28)}</span>
      <h2 className="slpc-h2">{title}</h2>
      <p className="slpc-muted">{children}</p>
      <span className="slpc-pill">Coming in {phase}</span>
    </section>
  )
}

export function StatCard({ label, icon, tone, children, foot }) {
  return (
    <div className="slpc-card slpc-stat">
      <div className="slpc-stat-top">
        <span className="slpc-stat-label">{label}</span>
        <span className={`slpc-stat-icon is-${tone}`}>{renderIcon(icon, 18)}</span>
      </div>
      <div className="slpc-stat-body">{children}</div>
      <div className="slpc-stat-foot">{foot}</div>
    </div>
  )
}


export const COURSE_STYLES = `
.slpc {
  --primary: #a03223;
  --on-primary: #ffffff;
  --primary-container: #c14a38;
  --on-primary-container: #fff5f3;
  --primary-fixed: #ffdad4;
  --on-primary-fixed: #400200;
  --secondary: #9e3e49;
  --secondary-container: #fd8892;
  --on-secondary-container: #76202c;
  --tertiary: #933f28;
  --tertiary-fixed: #ffdbd2;
  --on-tertiary-fixed: #3c0800;
  --error: #ba1a1a;
  --error-container: #ffdad6;
  --on-error-container: #93000a;
  --surface: #fef7ff;
  --surface-low: #faf0fe;
  --surface-mid: #f4ebf8;
  --surface-high: #eee5f2;
  --surface-highest: #e8dfec;
  --surface-lowest: #ffffff;
  --on-surface: #1e1a23;
  --on-surface-variant: #58413e;
  --outline: #8b716d;
  --outline-variant: #dfbfba;
  --ok: #047857;
  --ok-bg: rgba(16, 185, 129, 0.1);
  --info: #0369a1;
  --info-bg: rgba(14, 165, 233, 0.1);
  --warn: #b45309;
  --warn-bg: rgba(245, 158, 11, 0.12);
  font-family: 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: var(--on-surface);
  line-height: 1.5;
  text-align: left;
  -webkit-font-smoothing: antialiased;
  width: 100%;
}
.slpc *, .slpc *::before, .slpc *::after { box-sizing: border-box; }
/* :where() keeps the reset at low specificity so the class rules below can override it */
.slpc :where(h1, h2, h3, p, ul, ol) { margin: 0; padding: 0; }
.slpc :where(ul, ol) { list-style: none; }
.slpc a { color: inherit; text-decoration: none; }
.slpc button, .slpc input, .slpc select { font-family: inherit; }
.slpc .material-symbols-outlined {
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
.slpc a:focus-visible, .slpc button:focus-visible, .slpc input:focus-visible, .slpc select:focus-visible,
.slpc [tabindex]:focus-visible {
  outline: 3px solid var(--primary-container);
  outline-offset: 3px;
  border-radius: 8px;
}
.slpc-mono { font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; }
.slpc-muted { color: var(--on-surface-variant); font-size: 13px; line-height: 18px; }
.slpc-strong { font-weight: 600; color: var(--on-surface); }
.slpc-nowrap { white-space: nowrap; }
.slpc-right { text-align: right; }
.slpc-inline { display: inline-flex; align-items: center; gap: 0.5rem; }
.slpc-inline-tight { display: inline-flex; align-items: center; gap: 0.25rem; }
.slpc-accent { color: var(--primary); display: inline-flex; }
.slpc-accent-warm { color: var(--tertiary); display: inline-flex; }
.slpc-accent-ok { color: var(--ok); display: inline-flex; }
.slpc-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.slpc-stack { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
.slpc-gap-lg { gap: 1.5rem; }
.slpc-h1 { font-size: 32px; line-height: 40px; font-weight: 700; letter-spacing: -0.02em; }
.slpc-h2 { font-size: 20px; line-height: 28px; font-weight: 600; letter-spacing: -0.01em; }
.slpc-h3 { font-size: 18px; line-height: 26px; font-weight: 700; letter-spacing: -0.005em; }
.slpc-lead { font-size: 16px; line-height: 26px; color: var(--on-surface-variant); max-width: 48rem; }
.slpc-eyebrow { font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpc-card { border-radius: 12px; background: var(--surface-lowest); padding: 1rem; box-shadow: 0 1px 3px rgba(30, 26, 35, 0.08); }
.slpc-state { display: flex; flex-direction: column; align-items: flex-start; gap: 0.75rem; font-size: 14px; color: var(--on-surface-variant); }
.slpc-empty { padding: 0.75rem; border-radius: 12px; background: var(--surface-low); font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpc-alert { padding: 0.5rem 0.75rem; border-radius: 12px; background: var(--error-container); color: var(--on-error-container); font-size: 13px; line-height: 18px; font-weight: 600; }
.slpc-notice {
  display: flex; align-items: center; gap: 0.5rem; padding: 0.625rem 0.875rem; border-radius: 12px;
  background: var(--surface-low); font-size: 13px; line-height: 18px; font-weight: 600;
}
.slpc-notice .material-symbols-outlined:first-child { color: var(--primary); }
.slpc-notice span { flex: 1 1 auto; }
.slpc-skeleton { background: linear-gradient(90deg, var(--surface-mid), var(--surface-low), var(--surface-mid)); background-size: 200% 100%; animation: slpc-shimmer 1.4s linear infinite; }
.slpc-skeleton-sm { min-height: 64px; border-radius: 12px; }
@keyframes slpc-shimmer { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .slpc-skeleton { animation: none; } .slpc-card, .slpc-action, .slpc-tab { transition: none !important; } }

.slpc-pill {
  display: inline-flex; align-items: center; padding: 2px 10px; border-radius: 999px;
  background: var(--surface-high); color: var(--on-surface-variant);
  font-size: 11px; line-height: 16px; font-weight: 700; letter-spacing: 0.02em; white-space: nowrap;
}
.slpc-pill.is-primary { background: var(--primary-fixed); color: var(--on-primary-fixed); }
.slpc-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.375rem; border: 0; cursor: pointer;
  padding: 10px 16px; border-radius: 999px; font-size: 12px; line-height: 16px; font-weight: 600; letter-spacing: 0.02em;
  transition: background 0.2s; white-space: nowrap;
}
.slpc-btn:disabled { opacity: 0.6; cursor: progress; }
.slpc-btn-primary { background: var(--primary-container); color: var(--on-primary-container); box-shadow: 0 1px 3px rgba(30, 26, 35, 0.2); }
.slpc-btn-primary:hover:not(:disabled) { background: var(--primary); }
.slpc-btn-soft { background: var(--surface-low); color: var(--on-surface); box-shadow: inset 0 0 0 1px var(--surface-high); }
.slpc-btn-soft:hover:not(:disabled) { background: var(--surface-high); }
.slpc-link-btn { border: 0; background: none; padding: 0; cursor: pointer; font-size: 11px; line-height: 14px; font-weight: 700; color: var(--primary); }
.slpc-link-btn:hover { text-decoration: underline; }
.slpc-icon-btn {
  width: 32px; height: 32px; border: 0; border-radius: 999px; background: var(--surface-mid); color: var(--outline);
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer; flex: 0 0 auto;
}

/* Top bar: breadcrumb + view switch */
.slpc-topbar { display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1.5rem; }
.slpc-trail { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); min-width: 0; }
.slpc-trail-item { display: inline-flex; align-items: center; gap: 0.25rem; min-width: 0; }
.slpc-trail-link { display: inline-flex; align-items: center; gap: 0.25rem; font-weight: 500; }
.slpc-trail-link:hover { color: var(--primary); }
.slpc-trail-sep { color: var(--outline-variant); }
.slpc-trail-title { color: var(--on-surface); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
.slpc-trail-current { color: var(--primary); font-weight: 600; white-space: nowrap; }
.slpc-switch { display: inline-flex; align-self: flex-start; padding: 4px; border-radius: 999px; background: var(--surface-high); box-shadow: 0 1px 2px rgba(30, 26, 35, 0.06); flex-wrap: wrap; }
.slpc-switch-btn {
  display: inline-flex; align-items: center; gap: 0.375rem; padding: 6px 16px; border-radius: 999px;
  font-size: 12px; line-height: 16px; font-weight: 600; color: var(--on-surface-variant); transition: color 0.2s;
}
.slpc-switch-btn:hover { color: var(--on-surface); }
.slpc-switch-btn.is-active { background: var(--primary); color: var(--on-primary); box-shadow: 0 1px 2px rgba(30, 26, 35, 0.2); }
.slpc-count { min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; background: var(--surface-highest); color: var(--on-surface); font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }

/* Catalogue */
.slpc-filter { display: flex; flex-direction: column; gap: 1rem; }
.slpc-filter-controls { display: flex; flex-direction: column; gap: 0.5rem; width: 100%; }
.slpc-search {
  position: relative; display: flex; align-items: center; flex: 1 1 auto; min-width: 0; height: 36px; padding: 0 12px;
  border-radius: 8px; background: var(--surface-low); color: var(--on-surface-variant); gap: 0.5rem;
}
.slpc-search:focus-within { box-shadow: 0 0 0 2px var(--primary-container); }
.slpc-search input { flex: 1 1 auto; min-width: 0; border: 0; outline: 0; background: transparent; font-size: 13px; color: var(--on-surface); }
.slpc-search input::placeholder { color: var(--on-surface-variant); }
.slpc-select { height: 36px; padding: 0 12px; border: 0; border-radius: 8px; background: var(--surface-low); color: var(--on-surface); font-size: 12px; font-weight: 600; }
.slpc-grid-cards { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; }
.slpc-course {
  height: 100%; display: flex; flex-direction: column; justify-content: space-between; gap: 1rem; padding: 1.5rem;
  transition: box-shadow 0.2s, transform 0.2s;
}
.slpc-course:hover { box-shadow: 0 10px 24px rgba(30, 26, 35, 0.12); transform: translateY(-2px); }
.slpc-course.is-first { border-left: 4px solid var(--primary); }
.slpc-course-top { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.5rem; }
.slpc-course-top .slpc-muted { font-size: 12px; }
.slpc-course-title { font-size: 16px; line-height: 24px; font-weight: 600; margin-bottom: 4px; }
.slpc-course:hover .slpc-course-title { color: var(--primary); }
.slpc-clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpc-course-foot { display: flex; flex-direction: column; gap: 0.5rem; }
.slpc-person { display: inline-flex; align-items: center; gap: 0.5rem; font-size: 13px; line-height: 18px; font-weight: 500; }
.slpc-avatar-sm {
  width: 28px; height: 28px; border-radius: 999px; background: var(--surface-high); font-size: 11px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto;
}
.slpc-avatar-sm.is-primary { color: var(--primary); }
.slpc-avatar-sm.is-tertiary { color: var(--tertiary); }
.slpc-avatar-sm.is-secondary { color: var(--secondary); }
.slpc-course-meta { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding-top: 4px; font-size: 11px; line-height: 14px; font-weight: 600; color: var(--on-surface-variant); }
.slpc-open { display: inline-flex; align-items: center; gap: 2px; color: var(--primary); }

/* Detail: switcher, hero */
.slpc-switcher { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.5rem; overflow-x: auto; }
.slpc-switcher-list { display: flex; align-items: center; gap: 0.25rem; min-width: max-content; }
.slpc-switcher .slpc-eyebrow { padding: 0 0.25rem; }
.slpc-chip-course {
  display: inline-flex; align-items: center; gap: 0.375rem; padding: 6px 12px; border-radius: 8px;
  background: var(--surface-low); color: var(--on-surface); font-size: 12px; line-height: 16px; font-weight: 600; white-space: nowrap;
  transition: background 0.2s;
}
.slpc-chip-course:hover { background: var(--surface-high); }
.slpc-chip-course.is-active { background: var(--primary); color: var(--on-primary); box-shadow: 0 1px 2px rgba(30, 26, 35, 0.2); }
.slpc-live-dot { width: 8px; height: 8px; border-radius: 999px; background: #fff; }
.slpc-confirmed { display: none; align-items: center; gap: 0.25rem; padding-left: 1rem; font-size: 11px; line-height: 14px; font-weight: 600; color: var(--on-surface-variant); white-space: nowrap; }
.slpc-confirmed .material-symbols-outlined { color: var(--tertiary); }
.slpc-hero { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 1.5rem; padding: 1.5rem; border-radius: 16px; }
.slpc-hero-glow { position: absolute; right: -32px; top: -32px; width: 256px; height: 256px; border-radius: 999px; background: radial-gradient(circle at 30% 30%, rgba(255, 218, 212, 0.45), rgba(255, 219, 210, 0.15) 55%, transparent 75%); pointer-events: none; }
.slpc-hero-main { position: relative; flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 0.75rem; }
.slpc-hero-meta { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.slpc-lecturer { position: relative; width: 100%; border-radius: 12px; background: var(--surface-low); padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; align-self: flex-start; }
.slpc-lecturer-head { display: flex; align-items: center; gap: 0.5rem; }
.slpc-avatar { width: 48px; height: 48px; border-radius: 12px; background: var(--primary); color: var(--on-primary); font-size: 18px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; box-shadow: 0 1px 2px rgba(30, 26, 35, 0.2); }
.slpc-lecturer-name { display: flex; flex-direction: column; min-width: 0; }
.slpc-lecturer-title { font-size: 16px; line-height: 22px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slpc-lecturer-name .slpc-muted { font-size: 11px; line-height: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slpc-lecturer-rows { display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 1px solid var(--surface-highest); font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpc-row { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; min-width: 0; }
.slpc-row .slpc-inline-tight { white-space: nowrap; }
.slpc-row .material-symbols-outlined { font-size: 16px; }
.slpc-email { font-size: 12px; color: var(--primary); overflow-wrap: anywhere; text-align: right; }
.slpc-email:hover { text-decoration: underline; }

/* Tabs */
.slpc-tabs-card { padding: 6px; overflow-x: auto; }
.slpc-tabs { display: flex; align-items: center; gap: 4px; min-width: max-content; }
.slpc-tab {
  display: inline-flex; align-items: center; gap: 0.5rem; padding: 8px 16px; border: 0; border-radius: 8px; cursor: pointer;
  background: transparent; color: var(--on-surface-variant); font-size: 12px; line-height: 16px; font-weight: 600; transition: background 0.2s, color 0.2s;
}
.slpc-tab:hover { background: var(--surface-high); color: var(--on-surface); }
.slpc-tab.is-active { background: var(--primary); color: var(--on-primary); font-weight: 700; box-shadow: 0 1px 2px rgba(30, 26, 35, 0.2); }
.slpc-badge { padding: 1px 6px; border-radius: 999px; font-size: 11px; line-height: 16px; font-weight: 700; }
.slpc-badge.is-mid { background: var(--surface-highest); color: var(--on-surface); }
.slpc-badge.is-warm { background: var(--tertiary-fixed); color: var(--on-tertiary-fixed); }
.slpc-badge.is-fixed { background: var(--primary-fixed); color: var(--on-primary-fixed); }
.slpc-panel-wrap { outline: none; min-width: 0; }

/* Overview */
.slpc-stats { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; }
.slpc-stat { display: flex; flex-direction: column; justify-content: space-between; gap: 0.5rem; transition: box-shadow 0.2s; }
.slpc-stat:hover { box-shadow: 0 8px 20px rgba(30, 26, 35, 0.1); }
.slpc-stat-top { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.5rem; min-height: 32px; }
.slpc-stat-label { font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); }
.slpc-stat-icon { width: 32px; height: 32px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.slpc-stat-icon.is-mid { background: var(--surface-mid); color: var(--primary); }
.slpc-stat-icon.is-warm { background: rgba(255, 219, 210, 0.6); color: var(--tertiary); }
.slpc-stat-icon.is-ok { background: var(--ok-bg); color: var(--ok); }
.slpc-stat-icon.is-fixed { background: var(--primary-fixed); color: var(--on-primary-fixed); }
.slpc-stat-body { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0.25rem 0.5rem; min-height: 40px; }
.slpc-stat-value { font-size: 32px; line-height: 40px; font-weight: 700; letter-spacing: -0.02em; }
.slpc-stat-unit { font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpc-stat-foot { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-top: 0.5rem; padding-top: 0.5rem; font-size: 11px; line-height: 14px; font-weight: 600; color: var(--on-surface-variant); min-height: 36px; }
.slpc-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.slpc-chip { display: inline-flex; align-items: center; gap: 0.25rem; padding: 2px 6px; border-radius: 6px; font-size: 11px; line-height: 14px; font-weight: 700; background: var(--surface-mid); color: var(--on-surface-variant); }
.slpc-chip.is-ok { background: var(--ok-bg); color: var(--ok); }
.slpc-chip.is-info { background: var(--info-bg); color: var(--info); }
.slpc-chip.is-warn { background: var(--warn-bg); color: var(--warn); }
.slpc-chip.is-quiet { background: var(--surface-low); color: var(--outline); }
.slpc-chip .material-symbols-outlined { color: inherit; }
.slpc-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.slpc-panel { display: flex; flex-direction: column; gap: 1rem; padding: 1.5rem; }
.slpc-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; }
.slpc-stream { display: flex; flex-direction: column; gap: 1rem; }
.slpc-event { display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.5rem; border-radius: 8px; background: var(--surface-low); transition: background 0.2s; }
.slpc-event:hover { background: var(--surface-mid); }
.slpc-event-icon { width: 32px; height: 32px; margin-top: 2px; border-radius: 8px; color: #fff; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.slpc-event-icon.is-primary { background: var(--primary); }
.slpc-event-icon.is-tertiary { background: var(--tertiary); }
.slpc-event-icon.is-ok { background: #059669; }
.slpc-event-main { flex: 1 1 auto; min-width: 0; }
.slpc-event-head { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; }
.slpc-event-title { font-size: 15px; line-height: 22px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slpc-event-when { font-size: 11px; line-height: 14px; font-weight: 600; color: var(--on-surface-variant); flex: 0 0 auto; }
.slpc-event-when.is-urgent { color: var(--error); }
.slpc-event-text { margin-top: 2px; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpc-event-action { margin-top: 8px; display: inline-flex; align-items: center; gap: 0.25rem; border: 0; background: none; padding: 0; cursor: pointer; font-size: 11px; line-height: 14px; font-weight: 600; color: var(--primary); }
.slpc-event-action:hover { text-decoration: underline; }
.slpc-actions { display: flex; flex-direction: column; gap: 0.25rem; }
.slpc-action {
  width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 8px; border: 0; border-radius: 8px;
  background: var(--surface-low); cursor: pointer; text-align: left; font-size: 13px; line-height: 18px; font-weight: 600; color: var(--on-surface);
  transition: background 0.2s;
}
.slpc-action:hover { background: var(--surface-high); }
.slpc-action > .material-symbols-outlined { color: var(--on-surface-variant); }
.slpc-action .slpc-inline { min-width: 0; }
.slpc-action-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Materials, marks tables */
.slpc-pills { display: flex; flex-wrap: wrap; gap: 0.25rem; }
.slpc-filter-pill { padding: 4px 12px; border: 0; border-radius: 999px; cursor: pointer; background: var(--surface-high); color: var(--on-surface-variant); font-size: 11px; line-height: 16px; font-weight: 600; }
.slpc-filter-pill:hover { color: var(--on-surface); }
.slpc-filter-pill.is-active { background: var(--primary); color: var(--on-primary); }
.slpc-table-card { padding: 0; overflow: hidden; }
.slpc-table-scroll { overflow-x: auto; }
.slpc-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; line-height: 18px; }
.slpc-table th { padding: 12px 16px; background: var(--surface-mid); font-size: 11px; line-height: 14px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-surface-variant); white-space: nowrap; }
.slpc-table td { padding: 12px 16px; border-top: 1px solid var(--surface-mid); vertical-align: middle; }
.slpc-cell-title { display: block; font-weight: 600; color: var(--on-surface); }
.slpc-cell-sub { display: block; margin-top: 2px; font-size: 12px; line-height: 16px; color: var(--on-surface-variant); }
.slpc-cell-file { display: block; font-size: 12px; overflow-wrap: anywhere; }
.slpc-marks-summary { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; }
.slpc-marks-facts { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: var(--on-surface-variant); }
.slpc-marks-facts strong { color: var(--on-surface); }

/* Assignments */
.slpc-assignment { position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 1rem; padding: 1rem 1rem 1rem 1.5rem; }
.slpc-assignment::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 6px; background: var(--outline-variant); }
.slpc-assignment.is-urgent::before { background: var(--primary); }
.slpc-assignment.is-soon::before { background: var(--secondary-container); }
.slpc-assignment-main { display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1 1 auto; }
.slpc-task-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; font-size: 13px; line-height: 18px; }
.slpc-code { font-size: 11px; font-weight: 700; color: var(--primary); }
.slpc-due { padding: 2px 8px; border-radius: 999px; font-size: 11px; line-height: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; background: var(--surface-mid); color: var(--on-surface-variant); }
.slpc-due.is-urgent { background: var(--primary); color: var(--on-primary); }
.slpc-due.is-soon { background: var(--surface-high); color: var(--on-surface); }
.slpc-assignment-title { font-size: 16px; line-height: 24px; font-weight: 600; }
.slpc-facts { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 16px; font-size: 11px; line-height: 16px; color: var(--on-surface-variant); }
.slpc-facts .material-symbols-outlined { color: var(--tertiary); }
.slpc-facts .slpc-chip { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; }
.slpc-attach { display: inline-flex; align-items: center; gap: 0.25rem; border: 0; background: none; padding: 0; cursor: pointer; font-family: inherit; font-size: 11px; line-height: 16px; color: var(--primary); font-weight: 600; }
.slpc-attach:hover:not(:disabled) { text-decoration: underline; }
.slpc-score { font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpc-score strong { color: var(--on-surface); }
.slpc-assignment-action { display: flex; flex: 0 0 auto; align-items: center; }

@media (min-width: 640px) {
  .slpc-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .slpc-grid-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .slpc-confirmed { display: inline-flex; }
}
@media (min-width: 768px) {
  .slpc-topbar { flex-direction: row; align-items: center; justify-content: space-between; }
  .slpc-switch { align-self: auto; }
  .slpc-filter { flex-direction: row; align-items: center; justify-content: space-between; }
  .slpc-filter-controls { flex-direction: row; max-width: 36rem; }
  .slpc-select { flex: 0 0 auto; }
  .slpc-assignment { flex-direction: row; align-items: center; justify-content: space-between; }
  .slpc-trail-title { max-width: none; }
}
@media (min-width: 1024px) {
  .slpc-stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .slpc-split { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
}
@media (min-width: 1280px) {
  .slpc-grid-cards { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .slpc-hero { flex-direction: row; align-items: flex-start; justify-content: space-between; padding: 2rem; gap: 2rem; }
  .slpc-lecturer { width: 384px; flex: 0 0 384px; }
}
.slpc-phase { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 0.75rem; padding: 3rem 1.5rem; }
.slpc-phase-icon { width: 56px; height: 56px; border-radius: 16px; background: var(--primary-fixed); color: var(--primary); display: inline-flex; align-items: center; justify-content: center; }
.slpc-phase .slpc-muted { max-width: 32rem; }
`


// Loads the three fonts once per page, however many pages ask for them.
export function useCourseFonts() {
  useEffect(() => {
    FONT_LINKS.forEach(({ id, href }) => {
      if (document.getElementById(id)) return
      const link = document.createElement('link')
      link.id = id
      link.rel = 'stylesheet'
      link.href = href
      document.head.appendChild(link)
    })
  }, [])
}
