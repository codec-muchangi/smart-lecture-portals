import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('../src/services/apiClient.js', () => ({ api: apiMock }))

import StudentAttendance from '../src/pages/student/StudentAttendance.jsx'

const COURSES = {
  items: [
    { id: 'c1', course_code: 'CS401', course_name: 'Adv. Software Engineering' },
    { id: 'c2', course_code: 'CS402', course_name: 'Distributed Systems' },
    { id: 'c3', course_code: 'CS350', course_name: 'Networks & Security' },
  ],
  total: 3,
}

const row = (id, status, date, topic, extra = {}) => ({ id, status, session_date: date, start_time: '09:00:00', end_time: '11:00:00', topic, ...extra })

let data
function seed() {
  data = {
    // 2 attended of 3 counted = 66.7% (below the 75% minimum)
    c1: [
      row('s1', 'present', '2026-02-20', 'Microservices CQRS Pattern', { room: 'Room 304', note: 'Scanned in on time.' }),
      row('s2', 'present', '2026-02-13', 'Event Sourcing Basics'),
      row('s3', 'absent', '2026-02-06', 'Kafka Streams'),
    ],
    // 2 of 2 = 100%
    c2: [row('s4', 'present', '2026-02-19', 'Raft Leader Election'), row('s5', 'late', '2026-02-12', 'Heartbeat Timing')],
    // 1 of 1 = 100%, excused not counted
    c3: [row('s6', 'present', '2026-02-17', 'TLS 1.3 Handshake'), row('s7', 'excused', '2026-02-10', 'Symposium Day')],
  }
}

function install(overrides = {}) {
  apiMock.mockImplementation(async (path) => {
    if (path in overrides) {
      const value = overrides[path]
      if (value instanceof Error) throw value
      return value
    }
    if (path === '/courses?page_size=100') return COURSES
    const match = path.match(/^\/courses\/(c\d)\/attendance\/me\?page_size=100$/)
    if (match) return { attendance_pct: 12.3, history: data[match[1]] }
    throw new Error(`unexpected request: ${path}`)
  })
}

const attendancePath = (id) => `/courses/${id}/attendance/me?page_size=100`
const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status })

function renderPage(path = '/student/attendance') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/student/attendance" element={<StudentAttendance />} />
          <Route path="/student/courses/:courseId/attendance" element={<StudentAttendance />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const summary = () => screen.getByLabelText('Attendance summary')
const history = () => screen.getByLabelText('Session history')

beforeEach(() => {
  apiMock.mockReset()
  seed()
})

test('shows the cumulative ratio, tallies and per-course compliance worked out from the rows', async () => {
  install()
  renderPage()
  expect(await screen.findByText('Good standing')).toBeInTheDocument()
  const cards = within(summary())
  expect(cards.getByRole('img', { name: '83.3 percent attendance' })).toBeInTheDocument()
  expect(cards.getByText('5 / 6 sessions')).toBeInTheDocument()
  expect(cards.getByLabelText('Present sessions')).toHaveTextContent('04')
  expect(cards.getByLabelText('Late sessions')).toHaveTextContent('01')
  expect(cards.getByLabelText('Excused sessions')).toHaveTextContent('01')
  expect(cards.getByLabelText('Absent sessions')).toHaveTextContent('01')
  expect(cards.getByText('5/6 = 83.3%')).toBeInTheDocument()
  expect(cards.getByText('2 / 3 PASS')).toBeInTheDocument()
  expect(cards.getByText('66.7% (2/3)')).toBeInTheDocument()
  expect(cards.getByText('100% (2/2)')).toBeInTheDocument()
  expect(cards.getByText('100% (1/1)')).toBeInTheDocument()
  expect(cards.getByText('1 course is below the 75% minimum')).toBeInTheDocument()
  // the server's own attendance_pct (12.3) is ignored so the figures always reconcile with the rows
  expect(screen.queryByText(/12\.3/)).not.toBeInTheDocument()
  expect(screen.getByText('All enrolled courses').closest('button')).toHaveTextContent('3 courses • 7 sessions')
})

test('lists sessions newest first with date, times, room and status', async () => {
  install()
  renderPage()
  const list = await screen.findByLabelText('Session history')
  const titles = within(list).getAllByRole('heading', { level: 3 }).map((node) => node.textContent)
  expect(titles).toEqual(['Microservices CQRS Pattern', 'Raft Leader Election', 'TLS 1.3 Handshake', 'Event Sourcing Basics', 'Heartbeat Timing', 'Symposium Day', 'Kafka Streams'])
  const first = within(list).getAllByRole('listitem')[0]
  expect(first).toHaveTextContent('CS401')
  expect(first).toHaveTextContent('20 Feb 2026')
  expect(first).toHaveTextContent('09:00 - 11:00')
  expect(first).toHaveTextContent('Room 304')
  expect(first).toHaveTextContent('Present')
})

test('status filters, search, sort and course scope narrow the list and keep counts honest', async () => {
  install()
  renderPage()
  await screen.findByLabelText('Session history')
  const filters = screen.getByRole('group', { name: 'Attendance status' })
  expect(within(filters).getByRole('button', { name: /All sessions/ })).toHaveTextContent('7')

  fireEvent.click(within(filters).getByRole('button', { name: /Absent/ }))
  expect(within(history()).getAllByRole('heading', { level: 3 }).map((n) => n.textContent)).toEqual(['Kafka Streams'])

  fireEvent.click(within(filters).getByRole('button', { name: /All sessions/ }))
  fireEvent.change(screen.getByLabelText('Search sessions'), { target: { value: 'raft' } })
  expect(within(history()).getAllByRole('heading', { level: 3 })).toHaveLength(1)
  fireEvent.change(screen.getByLabelText('Search sessions'), { target: { value: 'nothing like this' } })
  expect(screen.getByText('No sessions match these filters.')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Search sessions'), { target: { value: '' } })

  fireEvent.change(screen.getByLabelText('Sort sessions'), { target: { value: 'oldest' } })
  expect(within(history()).getAllByRole('heading', { level: 3 })[0]).toHaveTextContent('Kafka Streams')
  fireEvent.change(screen.getByLabelText('Sort sessions'), { target: { value: 'course' } })
  expect(within(history()).getAllByRole('heading', { level: 3 })[0]).toHaveTextContent('TLS 1.3 Handshake')

  fireEvent.click(screen.getByRole('button', { name: /CS402/ }))
  expect(within(history()).getAllByRole('heading', { level: 3 })).toHaveLength(2)
  const cards = within(summary())
  expect(cards.getByRole('img', { name: '100 percent attendance' })).toBeInTheDocument()
  expect(cards.getByLabelText('Late sessions')).toHaveTextContent('01')
})

test('a course in the route is preselected', async () => {
  install()
  renderPage('/student/courses/c3/attendance')
  await screen.findByLabelText('Session history')
  expect(screen.getByRole('button', { name: /CS350/ })).toHaveAttribute('aria-pressed', 'true')
  expect(within(history()).getAllByRole('heading', { level: 3 })).toHaveLength(2)
})

test('the inspector follows the selected session and only shows facts the API sent', async () => {
  install()
  renderPage()
  const panel = await screen.findByLabelText('Session details')
  await waitFor(() => expect(panel).toHaveTextContent('Microservices CQRS Pattern'))
  expect(panel).toHaveTextContent('Room 304')
  expect(panel).toHaveTextContent('Scanned in on time.')

  fireEvent.click(screen.getByRole('button', { name: 'View details: Heartbeat Timing' }))
  expect(panel).toHaveTextContent('Heartbeat Timing')
  expect(panel).toHaveTextContent('Distributed Systems')
  expect(panel).not.toHaveTextContent('Room')
  expect(panel).not.toHaveTextContent('Lecturer note')
})

test('long histories are paged', async () => {
  data.c1 = Array.from({ length: 12 }, (_, index) => row(`p${index}`, 'present', `2026-01-${String(index + 1).padStart(2, '0')}`, `Topic ${index + 1}`))
  install()
  renderPage()
  await screen.findByLabelText('Session history')
  expect(screen.getByText('Showing 1–8 of 16')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByText('Showing 9–16 of 16')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
  expect(screen.getByText('Showing 1–8 of 16')).toBeInTheDocument()
})

test('says so plainly when the attendance backend is not switched on, and shows no figures', async () => {
  install({ [attendancePath('c1')]: httpError(501), [attendancePath('c2')]: httpError(501), [attendancePath('c3')]: httpError(404) })
  renderPage()
  expect(await screen.findByText('Attendance tracking is not switched on yet')).toBeInTheDocument()
  expect(screen.getByText('Coming in Phase 6')).toBeInTheDocument()
  expect(screen.queryByLabelText('Attendance summary')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Session history')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Download my record/ })).toBeDisabled()
})

test('a failing course hides the figures instead of showing wrong ones, and Try again reloads', async () => {
  install({ [attendancePath('c2')]: httpError(500) })
  renderPage()
  expect(await screen.findByText(/Attendance could not be loaded for CS402/)).toBeInTheDocument()
  const cards = within(summary())
  expect(cards.getByLabelText('Present sessions')).toHaveTextContent('—')
  expect(cards.getByRole('img', { name: 'Attendance ratio not available' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Download my record/ })).toBeDisabled()

  install()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Good standing')).toBeInTheDocument()
})

test('shows a below-requirement standing and an empty history without inventing numbers', async () => {
  data = { c1: [row('a', 'absent', '2026-02-01', 'Missed'), row('b', 'present', '2026-02-02', 'Attended')], c2: [], c3: [] }
  install()
  renderPage()
  expect(await screen.findByText('Below requirement')).toBeInTheDocument()
  expect(within(summary()).getByRole('img', { name: '50 percent attendance' })).toBeInTheDocument()

  data = { c1: [], c2: [], c3: [] }
  install()
  const again = renderPage()
  expect(await screen.findAllByText('No sessions have been recorded for you yet.')).not.toHaveLength(0)
  expect(screen.getAllByText('No sessions yet').length).toBeGreaterThan(0)
  again.unmount()
})

test('accepts nested session fields and skips rows with an unknown status', async () => {
  data = {
    c1: [
      { id: 'n1', status: 'LATE', session: { session_date: '2026-03-02', start_time: '14:00', end_time: '16:00', topic: 'Nested session' } },
      { id: 'n2', status: 'bogus', session_date: '2026-03-03', topic: 'Should not appear' },
    ],
    c2: [],
    c3: [],
  }
  install()
  renderPage()
  const list = await screen.findByLabelText('Session history')
  expect(within(list).getAllByRole('heading', { level: 3 })).toHaveLength(1)
  expect(list).toHaveTextContent('Nested session')
  expect(list).toHaveTextContent('2 Mar 2026')
  expect(list).toHaveTextContent('14:00 - 16:00')
  expect(screen.queryByText('Should not appear')).not.toBeInTheDocument()
})

test('Refresh ledger asks the server again', async () => {
  install()
  renderPage()
  await screen.findByText('Good standing')
  const before = apiMock.mock.calls.filter(([path]) => path === attendancePath('c1')).length
  fireEvent.click(screen.getByRole('button', { name: /Refresh ledger/ }))
  await waitFor(() => expect(apiMock.mock.calls.filter(([path]) => path === attendancePath('c1')).length).toBeGreaterThan(before))
  await waitFor(() => expect(screen.getByRole('button', { name: /Refresh ledger/ })).toBeEnabled())
})

test('Download my record builds a CSV from the listed sessions', async () => {
  install()
  const created = vi.fn(() => 'blob:attendance')
  const revoked = vi.fn()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked }))
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  renderPage()
  await screen.findByText('Good standing')
  fireEvent.click(screen.getByRole('button', { name: /Absent/ }))
  fireEvent.click(screen.getByRole('button', { name: /Download my record/ }))
  expect(click).toHaveBeenCalledTimes(1)
  expect(revoked).toHaveBeenCalledWith('blob:attendance')
  const blob = created.mock.calls[0][0]
  const text = await new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.readAsText(blob)
  })
  const lines = text.split('\n')
  expect(lines[0]).toBe('Date,Start,End,Course,Course name,Topic,Room,Status,Note')
  expect(lines).toHaveLength(2)
  expect(lines[1]).toBe('2026-02-06,09:00,11:00,CS401,Adv. Software Engineering,Kafka Streams,,Absent,')
  click.mockRestore()
  vi.unstubAllGlobals()
})

test('a failing course list shows an error with a retry', async () => {
  install({ '/courses?page_size=100': httpError(500) })
  renderPage()
  expect(await screen.findByText('Your courses could not be loaded.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
})

test('a student with no courses sees an empty message', async () => {
  install({ '/courses?page_size=100': { items: [], total: 0 } })
  renderPage()
  expect(await screen.findByText(/not enrolled in any course yet/)).toBeInTheDocument()
})
