import { dueInfo, formatSize, formatSemester, timeAgo, toList } from '../src/utils/format.js'

const NOW = Date.UTC(2026, 0, 10, 12, 0, 0)

test('toList accepts arrays, paged objects and nothing', () => {
  expect(toList([1])).toEqual([1])
  expect(toList({ items: [2] })).toEqual([2])
  expect(toList(null)).toEqual([])
})

test('formatSize is human readable', () => {
  expect(formatSize(2_400_000)).toMatch(/MB/)
})

test('formatSemester does not double the word', () => {
  expect(formatSemester('Semester 1')).toBe('Semester 1')
})

test('timeAgo describes recent times', () => {
  expect(timeAgo(new Date(NOW - 14 * 60000).toISOString(), NOW)).toBe('14 mins ago')
})

test('dueInfo grades urgency', () => {
  expect(dueInfo(new Date(NOW + 18 * 3_600_000).toISOString(), NOW)).toEqual({ label: 'Due in 18 hours', tone: 'urgent' })
  expect(dueInfo(new Date(NOW + 4 * 86_400_000).toISOString(), NOW).tone).toBe('soon')
  expect(dueInfo(new Date(NOW - 1000).toISOString(), NOW).tone).toBe('urgent')
})
