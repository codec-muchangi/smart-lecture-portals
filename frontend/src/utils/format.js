/*
 * Small display helpers shared by the student pages and the submission dialog.
 * Pure functions only (no React, no network), so they are easy to test.
 */

// The API may return a bare array or a paginated { items, total } object; accept both.
export function toList(data) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.items)) return data.items
  return []
}

// The database already stores "Semester 1"; only add the word when it is missing.
export function formatSemester(value) {
  const text = String(value ?? '').trim()
  if (!text) return ''
  return /^semester/i.test(text) ? text : `Semester ${text}`
}

export function sentenceCase(value) {
  const text = String(value ?? '')
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : ''
}

export function formatSize(bytes) {
  const size = Number(bytes)
  if (!Number.isFinite(size) || size < 0) return ''
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

// "Feb 18, 2026"
export function formatDate(value) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

// "14 mins ago", "1 hour ago", "Yesterday", then a plain date.
export function timeAgo(value, now = Date.now()) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return ''
  const minutes = Math.floor((now - date.getTime()) / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'min' : 'mins'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  if (hours < 48) return 'Yesterday'
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

function clock(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// "Tomorrow, 23:59", "Today, 09:00" or "Feb 27, 23:59".
export function formatDue(value, now = Date.now()) {
  const due = new Date(value)
  if (!value || Number.isNaN(due.getTime())) return ''
  const today = new Date(now)
  const tomorrow = new Date(now)
  tomorrow.setDate(today.getDate() + 1)
  let day = due.toLocaleDateString([], { month: 'short', day: 'numeric' })
  if (sameDay(due, today)) day = 'Today'
  else if (sameDay(due, tomorrow)) day = 'Tomorrow'
  return `${day}, ${clock(due)}`
}

// Urgency drives the label, the pill colour and the card's accent bar.
export function dueInfo(value, now = Date.now()) {
  const due = new Date(value)
  if (!value || Number.isNaN(due.getTime())) return { label: '', tone: 'later' }
  const diff = due.getTime() - now
  if (diff < 0) return { label: 'Overdue', tone: 'urgent' }
  const minutes = Math.max(1, Math.ceil(diff / 60000))
  if (minutes < 60) return { label: `Due in ${minutes} ${minutes === 1 ? 'min' : 'mins'}`, tone: 'urgent' }
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return { label: `Due in ${hours} ${hours === 1 ? 'hour' : 'hours'}`, tone: 'urgent' }
  const days = Math.floor(diff / 86400000)
  if (days < 7) return { label: `Due in ${days} days`, tone: 'soon' }
  if (days < 14) return { label: 'Due Next Week', tone: 'later' }
  return { label: `Due ${due.toLocaleDateString([], { month: 'short', day: 'numeric' })}`, tone: 'later' }
}
