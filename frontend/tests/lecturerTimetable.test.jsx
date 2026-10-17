import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('../src/services/apiClient.js', () => ({ api: apiMock }))

import LecturerTimetable from '../src/pages/lecturer/LecturerTimetable.jsx'

const COURSES = {
  items: [
    { id: 'c1', course_code: 'CS401', course_name: 'Advanced Software Engineering' },
    { id: 'c2', course_code: 'CS402', course_name: 'Cloud Architecture' },
  ],
  total: 2,
}
const ENROLLED = { c1: 92, c2: 64 }

// Wednesday 14 Oct 2026, 10:45 local time; the week shown is Mon 12 Oct - Sun 18 Oct.
const ENTRIES = [
  { id: 't1', course_id: 'c1', day_of_week: 1, start_time: '09:00:00', end_time: '11:00:00', room: 'Hall 4B', notes: 'Domain driven design' },
  { id: 't2', course_id: 'c1', day_of_week: 3, start_time: '09:00', end_time: '12:00', room: 'Lab Alpha', notes: 'Bring Docker' },
  { id: 't3', course_id: 'c2', day_of_week: 2, start_time: '10:00', end_time: '12:00', room: 'Hall 2A', notes: null },
  { id: 't4', course_id: 'c2', specific_date: '2026-10-15', start_time: '11:00', end_time: '13:00', room: 'Hall 2A', notes: 'Case study' },
  { id: 'x1', course_id: 'other', day_of_week: 4, start_time: '09:00', end_time: '10:00', room: 'Hall 9' },
  { id: 'x2', course_id: 'c1', day_of_week: 5, start_time: '12:00', end_time: '11:00', room: 'Bad' },
]

function install(overrides = {}) {
  apiMock.mockImplementation(async (path) => {
    if (path in overrides) {
      const value = overrides[path]
      if (value instanceof Error) throw value
      return value
    }
    if (path === '/courses?page_size=100') return COURSES
    let m = path.match(/^\/courses\/(c\d)$/)
    if (m) return { ...COURSES.items.find((c) => c.id === m[1]), enrolled_count: ENROLLED[m[1]] }
    m = path.match(/^\/timetable\?from=(\S+)&to=(\S+)$/)
    if (m) return { items: ENTRIES, total: ENTRIES.length }
    throw new Error(`unexpected request: ${path}`)
  })
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/lecturer/timetable']}>
        <LecturerTimetable />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiMock.mockReset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 14, 10, 45))
})
afterEach(() => vi.useRealTimers())

const sessionButton = (text) => screen.getByRole('button', { name: new RegExp(text) })

describe('timetable', () => {
  test('asks the server for the week and shows only valid sessions for assigned courses', async () => {
    install()
    renderPage()
    expect(await screen.findByRole('button', { name: /CS401 Advanced Software Engineering, Monday 09:00 to 11:00, Hall 4B/ })).toBeInTheDocument()
    expect(apiMock).toHaveBeenCalledWith('/timetable?from=2026-10-12&to=2026-10-18')
    expect(sessionButton('Tuesday 10:00 to 12:00')).toBeInTheDocument()
    expect(sessionButton('Thursday 11:00 to 13:00')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Hall 9/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Bad/ })).not.toBeInTheDocument()
    expect(screen.getByText('12 Oct – 18 Oct, 2026')).toBeInTheDocument()
    expect(screen.queryByText(/FR-TIME|SP-8492|Conflict Free|Tenured/)).not.toBeInTheDocument()
  })

  test('summary is computed from the real entries', async () => {
    install()
    renderPage()
    await screen.findByRole('button', { name: /Monday 09:00/ })
    const summary = screen.getByLabelText('Week summary')
    expect(within(summary).getByText('9.0')).toBeInTheDocument()
    expect(within(summary).getByText('4')).toBeInTheDocument()
    expect(within(summary).getByText('3')).toBeInTheDocument()
    expect(within(summary).getByText('Hall 2A, Hall 4B, Lab Alpha')).toBeInTheDocument()
    expect(within(summary).getByText('Across 2 courses')).toBeInTheDocument()
    expect(within(summary).getByText('No clashes')).toBeInTheDocument()
  })

  test('counts overlapping sessions as clashes', async () => {
    const clashing = [
      { id: 'a', course_id: 'c1', day_of_week: 1, start_time: '09:00', end_time: '11:00', room: 'Hall 4B' },
      { id: 'b', course_id: 'c2', day_of_week: 1, start_time: '10:00', end_time: '12:00', room: 'Hall 2A' },
      { id: 'c', course_id: 'c2', day_of_week: 1, start_time: '12:00', end_time: '13:00', room: 'Hall 2A' },
    ]
    install({ '/timetable?from=2026-10-12&to=2026-10-18': { items: clashing, total: 3 } })
    renderPage()
    await screen.findByRole('button', { name: /Monday 09:00/ })
    expect(within(screen.getByLabelText('Week summary')).getByText('1 clash')).toBeInTheDocument()
  })

  test('inspector shows the selected session with the real enrolment', async () => {
    install()
    renderPage()
    await screen.findByRole('button', { name: /Monday 09:00/ })
    const inspector = screen.getByLabelText('Session inspector')
    await waitFor(() => expect(within(inspector).getByText('92 enrolled students')).toBeInTheDocument())
    expect(within(inspector).getByText('Domain driven design')).toBeInTheDocument()
    fireEvent.click(sessionButton('Thursday 11:00 to 13:00'))
    expect(within(inspector).getByText('Cloud Architecture')).toBeInTheDocument()
    expect(within(inspector).getByText('One-off session')).toBeInTheDocument()
    expect(within(inspector).getByText('Case study')).toBeInTheDocument()
    fireEvent.click(sessionButton('Tuesday 10:00 to 12:00'))
    expect(within(inspector).getByText('Repeats every week')).toBeInTheDocument()
    expect(within(inspector).getByText('No notes were added for this session.')).toBeInTheDocument()
    expect(within(inspector).getByRole('link', { name: /Open attendance tracker/ })).toHaveAttribute('href', '/lecturer/courses/c2/attendance')
    expect(within(inspector).getByRole('link', { name: /View course materials \(CS402\)/ })).toHaveAttribute('href', '/lecturer/courses/c2/materials')
  })

  test('filters by course, room and search, and resets', async () => {
    install()
    renderPage()
    await screen.findByRole('button', { name: /Monday 09:00/ })
    fireEvent.click(screen.getByRole('button', { name: /CS402: Cloud Architecture/ }))
    expect(screen.queryByRole('button', { name: /Monday 09:00/ })).not.toBeInTheDocument()
    expect(sessionButton('Tuesday 10:00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }))
    expect(sessionButton('Monday 09:00')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Filter by room'), { target: { value: 'Lab Alpha' } })
    expect(screen.queryByRole('button', { name: /Monday 09:00/ })).not.toBeInTheDocument()
    expect(sessionButton('Wednesday 09:00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }))

    fireEvent.change(screen.getByLabelText('Search sessions'), { target: { value: 'zzz' } })
    expect(screen.getByText('No sessions match these filters.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search sessions'), { target: { value: 'docker' } })
    expect(sessionButton('Wednesday 09:00')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Monday 09:00/ })).not.toBeInTheDocument()
  })

  test('moves between weeks and back to today', async () => {
    install()
    renderPage()
    await screen.findByRole('button', { name: /Monday 09:00/ })
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/timetable?from=2026-10-19&to=2026-10-25'))
    expect(screen.getByText('19 Oct – 25 Oct, 2026')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Monday 09:00/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Thursday 11:00/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(screen.getByText('12 Oct – 18 Oct, 2026')).toBeInTheDocument()
  })

  test('switches to the daily and compact list views', async () => {
    install()
    renderPage()
    await screen.findByRole('button', { name: /Monday 09:00/ })
    fireEvent.click(screen.getByRole('tab', { name: 'Compact list' }))
    expect(screen.getByText('Wednesday 14 Oct')).toBeInTheDocument()
    expect(screen.getByText('09:00 - 12:00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Daily' }))
    fireEvent.click(screen.getByRole('tab', { name: /Mon/ }))
    expect(screen.getByText('09:00 - 11:00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Fri/ }))
    expect(screen.getByText(/No sessions on/)).toBeInTheDocument()
  })

  test('exports the week as iCal and CSV', async () => {
    install()
    renderPage()
    await screen.findByRole('button', { name: /Monday 09:00/ })
    const blobs = []
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
    URL.createObjectURL = vi.fn((blob) => {
      blobs.push(blob)
      return 'blob:x'
    })
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const read = (blob) =>
      new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.readAsText(blob)
      })
    fireEvent.click(screen.getByRole('button', { name: /Export iCal/ }))
    fireEvent.click(screen.getByRole('button', { name: /CSV/ }))
    expect(click).toHaveBeenCalledTimes(2)
    const ics = await read(blobs[0])
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('DTSTART:20261012T090000')
    expect(ics).toContain('DTEND:20261012T110000')
    expect(ics).toContain('LOCATION:Hall 4B')
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(4)
    const csv = await read(blobs[1])
    expect(csv.split('\n')[0]).toBe('Date,Day,Start,End,Course,Course name,Room,Notes')
    expect(csv).toContain('2026-10-12,Monday,09:00,11:00,CS401,Advanced Software Engineering,Hall 4B,Domain driven design')
    click.mockRestore()
    URL.createObjectURL = original.create
    URL.revokeObjectURL = original.revoke
  })

  test('shows the empty week, no-courses, error and not-switched-on states', async () => {
    install({ '/timetable?from=2026-10-12&to=2026-10-18': { items: [], total: 0 } })
    const first = renderPage()
    expect(await screen.findByText(/No teaching sessions are scheduled for/)).toBeInTheDocument()
    expect(within(screen.getByLabelText('Week summary')).getByText('Teaching time in this week')).toBeInTheDocument()
    first.unmount()

    install({ '/courses?page_size=100': { items: [], total: 0 } })
    const second = renderPage()
    expect(await screen.findByText(/not assigned to any courses/)).toBeInTheDocument()
    second.unmount()

    install({ '/timetable?from=2026-10-12&to=2026-10-18': Object.assign(new Error('down'), { status: 500 }) })
    const third = renderPage()
    const retry = await screen.findByRole('button', { name: /try again/i })
    install()
    fireEvent.click(retry)
    expect(await screen.findByRole('button', { name: /Monday 09:00/ })).toBeInTheDocument()
    third.unmount()

    install({ '/timetable?from=2026-10-12&to=2026-10-18': Object.assign(new Error('nope'), { status: 404 }) })
    renderPage()
    expect(await screen.findByText('The timetable is not switched on yet')).toBeInTheDocument()
    const summary = screen.getByLabelText('Week summary')
    expect(within(summary).getAllByText('—').length).toBeGreaterThanOrEqual(4)
    expect(screen.queryByText(/No clashes/)).not.toBeInTheDocument()
  })
})
