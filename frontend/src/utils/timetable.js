/* Shared timetable helpers (student and lecturer timetable pages). */

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export const pad = (value) => String(value).padStart(2, '0')
export const isoOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
export const addDays = (date, amount) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount)
export const mondayOf = (date) => addDays(date, -((date.getDay() + 6) % 7))
export const parseDay = (text) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(text ?? ''))
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
}
export const parseMinutes = (text) => {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(text ?? '').trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours > 23 || minutes > 59 ? null : hours * 60 + minutes
}
export const clock = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
export const shortDate = (date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
export const longDate = (date) => date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
export const hoursText = (minutes) => `${(Math.round((minutes / 60) * 10) / 10).toFixed(1)} hrs`

export function normalise(raw, weekDays, courseById) {
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

export const byTime = (a, b) => a.dayIndex - b.dayIndex || a.start - b.start || a.end - b.end

export function findClashes(entries) {
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

export const csvCell = (value) => {
  let text = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function buildCsv(entries) {
  const lines = [['Date', 'Day', 'Start', 'End', 'Course', 'Course name', 'Room', 'Notes'].map(csvCell).join(',')]
  entries.forEach((entry) => {
    lines.push([isoOf(entry.date), DAYS[entry.dayIndex], clock(entry.start), clock(entry.end), entry.courseCode, entry.courseName, entry.room, entry.notes].map(csvCell).join(','))
  })
  return lines.join('\n')
}

export const icsText = (value) => String(value ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
export const icsStamp = (date, minutes) => `${isoOf(date).replace(/-/g, '')}T${pad(Math.floor(minutes / 60))}${pad(minutes % 60)}00`

export function buildIcs(entries) {
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

export function downloadText(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
