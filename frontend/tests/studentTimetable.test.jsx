import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('../src/services/apiClient.js', () => ({ api: apiMock }))

import StudentTimetable from '../src/pages/student/StudentTimetable.jsx'

const COURSES = {
  items: [
    { id: 'c1', course_code: 'CS401', course_name: 'Adv. Software Engineering' },
    { id: 'c2', course_code: 'CS402', course_name: 'Distributed Systems' },
    { id: 'c3', course_code: 'CS350', course_name: 'Networks & Security' },
  ],
  total: 3,
}
const DETAILS = {
  c1: { lecturers: [{ full_name: 'Sarah Jenkins', title: 'Dr.', department: 'Computing' }] },
  c2: { lecturers: [] },
  c3: {},
}

// Wednesday 14 Oct 2026, 10:45 local time; the week shown is Mon 12 Oct - Sun 18 Oct.
const ENTRIES = [
  { id: 't1', course_id: 'c1', day_of_week: 1, start_time: '09:00:00', end_time: '11:00:00', room: 'Hall 4B', notes: 'Bring a laptop' },
  { id: 't2', course_id: 'c1', day_of_week: 3, start_time: '09:00', end_time: '12:00', room: 'Lab Alpha', notes: null },
  { id: 't3', course_id: 'c2', day_of_week: 2, start_time: '10:00', end_time: '12:00', room: 'Hall 2A', notes: null },
  { id: 't4', course_id: 'c2', specific_date: '2026-10-15', start_time: '11:00', end_time: '13:00', room: 'Hall 2A', notes: 'Case study' },
  { id: 't5', course_id: 'c2', day_of_week: 3, start_time: '14:00', end_time: '15:00', room: 'Hall 2A', notes: null },
  { id: 'x1', course_id: 'other', day_of_week: 4, start_time: '09:00', end_time: '10:00', room: 'Hall 9' },
  { id: 'x2', course_id: 'c1', day_of_week: 5, start_time: '12:00', end_time: '11:00', room: 'Bad' },
]

let entries
function install(overrides = {}) {
  apiMock.mockImplementation(async (path) => {
    if (path in overrides) {
      const value = overrides[path]
      if (value instanceof Error) throw value
      return value
    }
    if (path === '/courses?page_size=100') return COURSES
    let m = path.match(/^\/courses\/(c\d)$/)
    if (m) return { ...COURSES.items.find((c) => c.id === m[1]), ...DETAILS[m[1]] }
    m = path.match(/^\/timetable\?from=(\S+)&to=(\S+)$/)
    if (m) return { items: entries, total: entries.length }
    throw new Error(`unexpected request: ${path}`)
  })
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/student/timetable']}>
        <StudentTimetable />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiMock.mockReset()
  entries = ENTRIES
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 14, 10, 45))
})
afterEach(() => vi.useRealTimers())

const session = (text) => screen.getByRole('button', { name: new RegExp(text) })
const stat = (label) => screen.getByText(label).closest('.slpc-stat')

describe('student timetable', () => {
  test('asks the server for the week and shows only valid sessions for enrolled courses', async () => {
    install()
    renderPage()
    expect(await screen.findByRole('button', { name: /CS401 Adv. Software Engineering, Monday 09:00 to 11:00, Hall 4B/ })).toBeInTheDocument()
    expect(apiMock).toHaveBeenCalledWith('/timetable?from=2026-10-12&to=2026-10-18')
    expect(session('CS402 Distributed Systems, Tuesday 10:00 to 12:00')).toBeInTheDocument()
    expect(session('Thursday 11:00 to 13:00')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Hall 9/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Bad/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Week of 12 Oct/)).toBeInTheDocument()
    expect(screen.queryByText(/FR-TIME|FR-ATT|0x8821|Reconciled|Geonav|Jenkins, Ph\.D/)).not.toBeInTheDocument()
  })

  test('the summary cards are computed from the real entries', async () => {
    install()
    renderPage()
    await screen.findByRole('button', { name: /Monday 09:00 to 11:00/ })
    const hours = stat('Weekly contact hours')
    expect(within(hours).getByText('10.0')).toBeInTheDocument()
    expect(within(hours).getByText(/5\.0h CS401/)).toBeInTheDocument()
    expect(within(hours).getByText(/5\.0h CS402/)).toBeInTheDocument()
    const today = stat("Today's schedule")
    expect(within(today).getByText('2 Sessions')).toBeInTheDocument()
    expect(within(today).getByText('CS402')).toBeInTheDocument()
    expect(within(today).getByText(/at 14:00 \(Hall 2A\)/)).toBeInTheDocument()
    expect(within(stat('Campus venues')).getByText('3')).toBeInTheDocument()
    expect(within(stat('Campus venues')).getByText('Hall 2A, Hall 4B, Lab Alpha')).toBeInTheDocument()
    const modules = stat('Modules scheduled')
    expect(within(modules).getByText('2 of 3')).toBeInTheDocument()
    expect(within(modules).getByText('No overlapping sessions')).toBeInTheDocument()
  })

  test('counts overlapping sessions as clashes', async () => {
    entries = [...ENTRIES, { id: 'c9', course_id: 'c2', day_of_week: 1, start_time: '10:00', end_time: '11:30', room: 'Hall 1' }]
    install()
    renderPage()
    await screen.findByRole('button', { name: /Monday 09:00 to 11:00/ })
    expect(within(stat('Modules scheduled')).getByText('1 clash this week')).toBeInTheDocument()
  })

  test('selecting a session fills the inspector, including the lecturer', async () => {
    install()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Wednesday 09:00 to 12:00/ }))
    const inspector = screen.getByRole('region', { name: 'Session inspector' })
    expect(within(inspector).getByText('Adv. Software Engineering')).toBeInTheDocument()
    expect(within(inspector).getByText('Lab Alpha')).toBeInTheDocument()
    expect(within(inspector).getByText('Every Wednesday')).toBeInTheDocument()
    expect(within(inspector).getByText('No notes were added for this session.')).toBeInTheDocument()
    await waitFor(() => expect(within(inspector).getByText('Dr. Sarah Jenkins')).toBeInTheDocument())
    expect(within(inspector).getByRole('link', { name: /View lecture materials/ })).toHaveAttribute('href', '/student/courses/c1/materials')
    expect(within(inspector).getByRole('link', { name: /Open course page/ })).toHaveAttribute('href', '/student/courses/c1')

    fireEvent.click(session('Thursday 11:00 to 13:00'))
    expect(within(inspector).getByText('One-off session')).toBeInTheDocument()
    expect(within(inspector).getByText('Case study')).toBeInTheDocument()
  })

  test('filters by module and by venue', async () => {
    install()
    renderPage()
    await screen.findByRole('button', { name: /Monday 09:00 to 11:00/ })
    fireEvent.click(screen.getByRole('button', { name: /CS402: Distributed Systems/ }))
    expect(screen.queryByRole('button', { name: /CS401 Adv/ })).not.toBeInTheDocument()
    expect(session('Tuesday 10:00 to 12:00')).toBeInTheDocument()
    expect(within(stat('Weekly contact hours')).getByText('5.0')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Filter by venue'), { target: { value: 'Hall 2A' } })
    expect(screen.getAllByRole('button', { name: /Hall 2A/ })).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: /All modules/ }))
    expect(screen.getByLabelText('Filter by venue')).toHaveValue('')
  })

  test('days without sessions say so, and weekends only show when needed', async () => {
    install()
    renderPage()
    await screen.findByRole('button', { name: /Monday 09:00 to 11:00/ })
    const friday = screen.getByRole('region', { name: 'Friday sessions' })
    expect(within(friday).getByText('Nothing scheduled: self-directed study time')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Saturday sessions' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Wednesday sessions' })).getByText('Today')).toBeInTheDocument()
  })

  test('switches between the matrix, daily agenda and list views', async () => {
    install()
    renderPage()
    await screen.findByRole('button', { name: /Monday 09:00 to 11:00/ })
    fireEvent.click(screen.getByRole('tab', { name: /Daily Agenda/ }))
    const agenda = screen.getByRole('region', { name: 'Daily agenda' })
    expect(within(agenda).getByRole('button', { name: /CS401: Adv. Software Engineering/ })).toBeInTheDocument()
    fireEvent.click(within(agenda).getByRole('tab', { name: /Fri/ }))
    expect(within(agenda).getByText(/No sessions on Friday/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /List View/ }))
    const list = screen.getByRole('region', { name: 'Session list' })
    expect(within(list).getAllByRole('button')).toHaveLength(5)
  })

  test('week navigation asks for the neighbouring weeks', async () => {
    install()
    renderPage()
    await screen.findByRole('button', { name: /Monday 09:00 to 11:00/ })
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/timetable?from=2026-10-19&to=2026-10-25'))
    expect(screen.getByText(/Week of 19 Oct/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/timetable?from=2026-10-05&to=2026-10-11'))
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(screen.getByText(/Week of 12 Oct/)).toBeInTheDocument()
  })

  test('shows a plain not-ready panel and no figures while the timetable service is off', async () => {
    install({ '/timetable?from=2026-10-12&to=2026-10-18': Object.assign(new Error('Not found'), { status: 404 }) })
    renderPage()
    expect(await screen.findByText('The timetable is not switched on yet')).toBeInTheDocument()
    expect(within(stat('Weekly contact hours')).getByText('—')).toBeInTheDocument()
    expect(within(stat('Modules scheduled')).getByText('—')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Export iCal/ })).toBeDisabled()
  })

  test('a server failure offers a retry', async () => {
    install({ '/timetable?from=2026-10-12&to=2026-10-18': Object.assign(new Error('Server exploded'), { status: 500 }) })
    renderPage()
    expect(await screen.findByText('Server exploded')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Try again|Retry/i }))
    await waitFor(() => expect(apiMock.mock.calls.filter(([path]) => path.startsWith('/timetable')).length).toBeGreaterThan(1))
  })

  test('says so when there are no courses or no sessions this week', async () => {
    install({ '/courses?page_size=100': { items: [], total: 0 } })
    const first = renderPage()
    expect(await screen.findByText(/not enrolled in any courses yet/)).toBeInTheDocument()
    first.unmount()

    entries = []
    install()
    renderPage()
    expect(await screen.findByText(/No sessions are scheduled for 12 Oct – 18 Oct/)).toBeInTheDocument()
  })

  test('exports the sessions on screen as iCal and CSV', async () => {
    install()
    const blobs = []
    const createUrl = vi.fn((blob) => {
      blobs.push(blob)
      return 'blob:x'
    })
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
    URL.createObjectURL = createUrl
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      renderPage()
      await screen.findByRole('button', { name: /Monday 09:00 to 11:00/ })
      fireEvent.click(screen.getByRole('button', { name: /Export iCal/ }))
      fireEvent.click(screen.getByRole('button', { name: 'CSV' }))
      expect(createUrl).toHaveBeenCalledTimes(2)
      const read = (blob) =>
        new Promise((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.readAsText(blob)
        })
      const ics = await read(blobs[0])
      expect(ics).toContain('BEGIN:VCALENDAR')
      expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(5)
      expect(ics).toContain('SUMMARY:CS401: Adv. Software Engineering')
      const csv = await read(blobs[1])
      expect(csv.split('\n')).toHaveLength(6)
      expect(csv).toContain('2026-10-12,Monday,09:00,11:00,CS401')
    } finally {
      URL.createObjectURL = original.create
      URL.revokeObjectURL = original.revoke
      click.mockRestore()
    }
  })
})
