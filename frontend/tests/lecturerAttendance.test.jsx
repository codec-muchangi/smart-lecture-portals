import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('../src/services/apiClient.js', () => ({ api: apiMock }))

import LecturerAttendance from '../src/pages/lecturer/LecturerAttendance.jsx'

const COURSES = {
  items: [
    { id: 'c1', course_code: 'CS401', course_name: 'Adv. Software Engineering' },
    { id: 'c2', course_code: 'CS402', course_name: 'Cloud Architecture' },
  ],
  total: 2,
}
const ENROLLED = { c1: 4, c2: 3 }

const student = (id, name, reg, status, note = '') => ({ student_id: id, full_name: name, registration_number: reg, status, note })

let sessions
let rosters
let report
let posts

function seed() {
  posts = []
  sessions = {
    c1: [
      { id: 'ses0', course_id: 'c1', session_date: '2026-02-06', start_time: '09:00:00', end_time: '11:00:00', topic: 'Container Orchestration', present: 0, absent: 0, late: 0, excused: 0 },
      { id: 'ses1', course_id: 'c1', session_date: '2026-02-13', start_time: '09:00:00', end_time: '11:00:00', topic: 'gRPC Contracts', counts: { present: 3, absent: 1, late: 0, excused: 0 } },
      { id: 'ses2', course_id: 'c1', session_date: '2026-02-20', start_time: '09:00:00', end_time: '11:00:00', topic: 'Microservices Architecture' },
      { id: 'ses3', course_id: 'c1', session_date: '2026-02-24', start_time: '09:00:00', end_time: '11:00:00', topic: 'Fault Tolerance' },
    ],
    c2: [],
  }
  rosters = {
    ses2: [student('s1', 'Elena Rostova', 'REG-0842', 'present', 'On time'), student('s2', 'Tariq Al-Mansoor', 'REG-0914', 'present'), student('s3', 'Marcus Vance', 'REG-0621', 'absent'), student('s4', 'Chloe Bennett', 'REG-0775', null)],
    ses3: [student('s1', 'Elena Rostova', 'REG-0842', null), student('s2', 'Tariq Al-Mansoor', 'REG-0914', null)],
    ses9: [student('s1', 'Elena Rostova', 'REG-0842', null)],
  }
  // 12 attended of 16 counted = 75%; Marcus is below the minimum; one excused mark
  report = {
    students: [
      { student_id: 's1', full_name: 'Elena Rostova', registration_number: 'REG-0842', present: 4, late: 0, absent: 0, excused: 0 },
      { student_id: 's2', full_name: 'Tariq Al-Mansoor', registration_number: 'REG-0914', present: 3, late: 0, absent: 1, excused: 0 },
      { student_id: 's3', full_name: 'Marcus Vance', registration_number: 'REG-0621', present: 2, late: 0, absent: 2, excused: 1 },
      { student_id: 's4', full_name: 'Chloe Bennett', registration_number: 'REG-0775', present: 2, late: 1, absent: 1, excused: 0 },
    ],
  }
}

function install(overrides = {}) {
  apiMock.mockImplementation(async (path, options = {}) => {
    if (path in overrides) {
      const value = overrides[path]
      if (value instanceof Error) throw value
      return typeof value === 'function' ? value(options) : value
    }
    if (path === '/courses?page_size=100') return COURSES
    let m = path.match(/^\/courses\/(c\d)$/)
    if (m) return { ...COURSES.items.find((c) => c.id === m[1]), enrolled_count: ENROLLED[m[1]] }
    m = path.match(/^\/courses\/(c\d)\/attendance\/sessions\?page_size=100$/)
    if (m) return { items: sessions[m[1]], total: sessions[m[1]].length }
    m = path.match(/^\/courses\/(c\d)\/attendance\/sessions$/)
    if (m && options.method === 'POST') {
      posts.push({ path, body: options.body })
      const created = { id: 'ses9', course_id: m[1], ...options.body }
      sessions[m[1]] = [...sessions[m[1]], created]
      return created
    }
    m = path.match(/^\/courses\/(c\d)\/reports\/attendance$/)
    if (m) return m[1] === 'c1' ? report : { students: [] }
    m = path.match(/^\/attendance\/sessions\/(ses\d)$/)
    if (m) return { id: m[1], roster: rosters[m[1]] ?? [] }
    m = path.match(/^\/attendance\/sessions\/(ses\d)\/records$/)
    if (m && options.method === 'POST') {
      posts.push({ path, body: options.body })
      options.body.records.forEach((record) => {
        const target = rosters[m[1]].find((entry) => entry.student_id === record.student_id)
        target.status = record.status
        target.note = record.note ?? ''
      })
      return { saved: options.body.records.length }
    }
    throw new Error(`unexpected request: ${path}`)
  })
}

const httpError = (status, message) => Object.assign(new Error(message ?? `HTTP ${status}`), { status })

function renderPage(path = '/lecturer/attendance') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/lecturer/attendance" element={<LecturerAttendance />} />
          <Route path="/lecturer/courses/:courseId/attendance" element={<LecturerAttendance />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const summary = () => screen.getByLabelText('Attendance summary')
const sessionList = () => screen.getByLabelText('Session list')
const rollCall = () => screen.getByLabelText('Roll-call')
const sessionTitles = () => within(sessionList()).getAllByRole('heading', { level: 3 }).map((node) => node.textContent)
const rowOf = (name) => screen.getByRole('heading', { level: 3, name: new RegExp(name) }).closest('li')
const saveButton = () => screen.getByRole('button', { name: /^Save roll-call/ })

beforeEach(() => {
  apiMock.mockReset()
  seed()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-02-21T10:00:00'))
})

afterEach(() => {
  vi.useRealTimers()
})

test('shows figures worked out from the attendance report, never invented ones', async () => {
  install()
  renderPage()
  await waitFor(() => expect(within(summary()).getByLabelText('Overall attendance')).toHaveTextContent('75%'))
  const cards = within(summary())
  expect(cards.getByLabelText('Sessions logged')).toHaveTextContent('4')
  expect(cards.getByText('Latest: 24 Feb 2026')).toBeInTheDocument()
  expect(cards.getByLabelText('At-risk students')).toHaveTextContent('1')
  expect(cards.getByLabelText('Excused records')).toHaveTextContent('1')
  expect(cards.getByText('4 sessions conducted')).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: /CS401: Adv. Software Engineering/ })).toHaveTextContent('4 Enrolled')
  expect(screen.getByRole('button', { name: /CS402: Cloud Architecture/ })).toHaveTextContent('3 Enrolled')
})

test('lists sessions newest first and uses counts from the list or the open roster', async () => {
  install()
  renderPage()
  await screen.findByLabelText('Session list')
  expect(sessionTitles()).toEqual(['Fault Tolerance', 'Microservices Architecture', 'gRPC Contracts', 'Container Orchestration'])
  expect(within(rowOf('gRPC Contracts')).getByText(/3 Present • 1 Absent • 0 Late • 0 Excused/)).toBeInTheDocument()
  expect(within(rowOf('Fault Tolerance')).getByText('Open this session to see who has been marked.')).toBeInTheDocument()
  // the session being marked shows live counts from its roster: 2 present, 1 absent
  const active = rowOf('Microservices Architecture')
  await waitFor(() => expect(within(active).getByText('Marking now')).toBeInTheDocument())
  expect(within(active).getByLabelText('2 of 3 present')).toBeInTheDocument()
  expect(within(active).getByText('Absent').nextElementSibling).toHaveTextContent('1')
})

test('shows the next scheduled session and opens it for marking', async () => {
  install()
  renderPage()
  const upcoming = await screen.findByLabelText('Upcoming session')
  expect(upcoming).toHaveTextContent('24 Feb 2026')
  expect(upcoming).toHaveTextContent('Fault Tolerance')
  fireEvent.click(within(upcoming).getByRole('button', { name: 'Open session' }))
  await waitFor(() => expect(screen.getByLabelText('Live session marking')).toHaveTextContent('Fault Tolerance'))
  expect(await screen.findByLabelText('Students logged')).toHaveTextContent('0 / 2 Logged')
})

test('the roll-call shows each student with standing from the report and the saved status', async () => {
  install()
  renderPage()
  const list = await screen.findByLabelText('Roll-call')
  expect(await screen.findByLabelText('Students logged')).toHaveTextContent('3 / 4 Logged')
  const elena = within(list).getByRole('heading', { name: 'Elena Rostova' }).closest('li')
  expect(elena).toHaveTextContent('#REG-0842')
  expect(elena).toHaveTextContent('4/4 (100%)')
  expect(elena).toHaveTextContent('Compliance OK')
  expect(within(elena).getByRole('button', { name: 'Present' })).toHaveAttribute('aria-pressed', 'true')
  expect(within(elena).getByLabelText('Note for Elena Rostova')).toHaveValue('On time')
  const marcus = within(list).getByRole('heading', { name: /Marcus Vance/ }).closest('li')
  expect(marcus).toHaveTextContent('2/4 (50%)')
  expect(marcus).toHaveTextContent('<75% minimum')
  expect(within(marcus).getByRole('button', { name: 'Absent' })).toHaveAttribute('aria-pressed', 'true')
  const chloe = within(list).getByRole('heading', { name: 'Chloe Bennett' }).closest('li')
  expect(within(chloe).getAllByRole('button').every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true)
})

test('only the marks you changed are saved, in one request', async () => {
  install()
  renderPage()
  await screen.findByLabelText('Roll-call')
  expect(saveButton()).toBeDisabled()
  const chloe = within(rollCall()).getByRole('heading', { name: 'Chloe Bennett' }).closest('li')
  fireEvent.click(within(chloe).getByRole('button', { name: 'Late' }))
  fireEvent.change(within(chloe).getByLabelText('Note for Chloe Bennett'), { target: { value: ' Transit delay ' } })
  expect(screen.getByLabelText('Students logged')).toHaveTextContent('4 / 4 Logged')
  expect(saveButton()).toHaveTextContent('Save roll-call (1)')
  fireEvent.click(saveButton())
  expect(await screen.findByText('Saved 1 record.')).toBeInTheDocument()
  expect(posts).toEqual([{ path: '/attendance/sessions/ses2/records', body: { records: [{ student_id: 's4', status: 'late', note: 'Transit delay' }] } }])
  await waitFor(() => expect(saveButton()).toBeDisabled())
  expect(within(rollCall()).getByLabelText('Note for Chloe Bennett')).toHaveValue('Transit delay')
})

test('a note change on a marked student is saved with their existing status', async () => {
  install()
  renderPage()
  await screen.findByLabelText('Roll-call')
  fireEvent.change(screen.getByLabelText('Note for Elena Rostova'), { target: { value: 'Left early' } })
  fireEvent.click(saveButton())
  await screen.findByText('Saved 1 record.')
  expect(posts[0].body.records).toEqual([{ student_id: 's1', status: 'present', note: 'Left early' }])
})

test('Mark all present and Reset work on the draft without touching the server', async () => {
  install()
  renderPage()
  await screen.findByLabelText('Roll-call')
  expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: /Mark all present/ }))
  expect(screen.getByLabelText('Students logged')).toHaveTextContent('4 / 4 Logged')
  expect(saveButton()).toHaveTextContent('Save roll-call (2)')
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
  expect(screen.getByLabelText('Students logged')).toHaveTextContent('3 / 4 Logged')
  expect(saveButton()).toBeDisabled()
  expect(posts).toHaveLength(0)
})

test('a refused save shows the server message and keeps your changes', async () => {
  install({ '/attendance/sessions/ses2/records': () => { throw httpError(400, 'Only enrolled students can be marked.') } })
  renderPage()
  await screen.findByLabelText('Roll-call')
  const chloe = within(rollCall()).getByRole('heading', { name: 'Chloe Bennett' }).closest('li')
  fireEvent.click(within(chloe).getByRole('button', { name: 'Excused' }))
  fireEvent.click(saveButton())
  expect(await screen.findByText('Only enrolled students can be marked.')).toBeInTheDocument()
  expect(within(chloe).getByRole('button', { name: 'Excused' })).toHaveAttribute('aria-pressed', 'true')
  expect(saveButton()).toBeEnabled()
})

test('searches students by name or registration number', async () => {
  install()
  renderPage()
  await screen.findByLabelText('Roll-call')
  fireEvent.change(screen.getByLabelText('Search students'), { target: { value: 'reg-0914' } })
  expect(within(rollCall()).getAllByRole('heading', { level: 3 }).map((n) => n.textContent)).toEqual(['Tariq Al-Mansoor'])
  fireEvent.change(screen.getByLabelText('Search students'), { target: { value: 'zzz' } })
  expect(screen.getByText('No student matches your search.')).toBeInTheDocument()
})

test('filters sessions by keyword, date range and attendance state', async () => {
  install()
  renderPage()
  await screen.findByLabelText('Roll-call')
  fireEvent.change(screen.getByLabelText('Search sessions'), { target: { value: 'grpc' } })
  expect(sessionTitles()).toEqual(['gRPC Contracts'])
  fireEvent.change(screen.getByLabelText('Search sessions'), { target: { value: '' } })

  fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-02-14' } })
  expect(sessionTitles()).toEqual(['Fault Tolerance', 'Microservices Architecture'])
  fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-02-20' } })
  expect(sessionTitles()).toEqual(['Microservices Architecture'])
  fireEvent.change(screen.getByLabelText('From date'), { target: { value: '' } })
  fireEvent.change(screen.getByLabelText('To date'), { target: { value: '' } })

  fireEvent.change(screen.getByLabelText('Filter sessions'), { target: { value: 'absences' } })
  expect(sessionTitles()).toEqual(['Microservices Architecture', 'gRPC Contracts'])
  fireEvent.change(screen.getByLabelText('Filter sessions'), { target: { value: 'unmarked' } })
  expect(sessionTitles()).toEqual(['Container Orchestration'])
  fireEvent.change(screen.getByLabelText('Search sessions'), { target: { value: 'nothing like this' } })
  expect(screen.getByText('No sessions match these filters.')).toBeInTheDocument()
})

test('long session lists are paged', async () => {
  sessions.c1 = Array.from({ length: 7 }, (_, index) => ({ id: `ses${index}`, course_id: 'c1', session_date: `2026-01-${String(index + 1).padStart(2, '0')}`, start_time: '09:00', end_time: '11:00', topic: `Topic ${index + 1}` }))
  install()
  renderPage()
  await screen.findByLabelText('Session list')
  expect(screen.getByText('Showing 1–5 of 7 sessions')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByText('Showing 6–7 of 7 sessions')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
})

test('switching course loads that course and shows an honest empty state', async () => {
  install()
  renderPage()
  await screen.findByLabelText('Session list')
  fireEvent.click(screen.getByRole('button', { name: /CS402/ }))
  expect(await screen.findByText(/No attendance sessions yet/)).toBeInTheDocument()
  expect(screen.getByText('There is no session to mark yet.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /CS402/ })).toHaveAttribute('aria-pressed', 'true')
  expect(apiMock).toHaveBeenCalledWith('/courses/c2/attendance/sessions?page_size=100')
})

test('a course in the route is preselected', async () => {
  install()
  renderPage('/lecturer/courses/c2/attendance')
  expect(await screen.findByText(/No attendance sessions yet/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /CS402/ })).toHaveAttribute('aria-pressed', 'true')
})

test('creating a session posts the form, selects it and closes the drawer', async () => {
  install()
  renderPage()
  await screen.findByLabelText('Session list')
  fireEvent.click(screen.getByRole('button', { name: /Create attendance session/ }))
  const dialog = screen.getByRole('dialog', { name: 'New attendance session' })
  expect(within(dialog).getByLabelText(/Lecture session topic/)).toHaveFocus()
  expect(within(dialog).getByLabelText('Session date')).toHaveValue('2026-02-21')

  fireEvent.change(within(dialog).getByLabelText('Ends'), { target: { value: '08:00' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Publish session' }))
  expect(within(dialog).getByRole('alert')).toHaveTextContent('The end time must be after the start time.')
  expect(posts).toHaveLength(0)

  fireEvent.change(within(dialog).getByLabelText('Ends'), { target: { value: '11:00' } })
  fireEvent.change(within(dialog).getByLabelText('Session date'), { target: { value: '2026-02-27' } })
  fireEvent.change(within(dialog).getByLabelText(/Lecture session topic/), { target: { value: ' Circuit breakers ' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Publish session' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(posts).toEqual([{ path: '/courses/c1/attendance/sessions', body: { session_date: '2026-02-27', start_time: '09:00', end_time: '11:00', topic: 'Circuit breakers' } }])
  await waitFor(() => expect(screen.getByLabelText('Live session marking')).toHaveTextContent('Circuit breakers'))
  expect(sessionTitles()).toContain('Circuit breakers')
})

test('a duplicate session is refused with a clear message and the topic is optional', async () => {
  install({ '/courses/c1/attendance/sessions': () => { throw httpError(409, 'Conflict') } })
  renderPage()
  await screen.findByLabelText('Session list')
  fireEvent.click(screen.getByRole('button', { name: /Create attendance session/ }))
  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Publish session' }))
  expect(await within(dialog).findByText('A session already exists for that date and time.')).toBeInTheDocument()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  fireEvent.keyDown(dialog, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('says so plainly when the attendance backend is not switched on, and shows no figures', async () => {
  install({
    '/courses/c1/attendance/sessions?page_size=100': httpError(501),
    '/courses/c1/reports/attendance': httpError(501),
  })
  renderPage()
  expect(await screen.findByText('Attendance tracking is not switched on yet')).toBeInTheDocument()
  expect(screen.getByText('Coming in Phase 6')).toBeInTheDocument()
  expect(screen.queryByLabelText('Attendance summary')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Create attendance session/ })).toBeDisabled()
  expect(screen.getByRole('button', { name: /Download report/ })).toBeDisabled()
})

test('a failing report hides the figures but keeps marking available, and Try again reloads it', async () => {
  install({ '/courses/c1/reports/attendance': httpError(500) })
  renderPage()
  expect(await screen.findByText(/attendance report could not be loaded/)).toBeInTheDocument()
  expect(within(summary()).getByLabelText('Overall attendance')).toHaveTextContent('—')
  expect(within(summary()).getByLabelText('At-risk students')).toHaveTextContent('—')
  expect(await screen.findByLabelText('Roll-call')).toBeInTheDocument()
  expect(within(rollCall()).getAllByText('—').length).toBeGreaterThan(0)

  install()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(within(summary()).getByLabelText('Overall attendance')).toHaveTextContent('75%'))
})

test('a failing session list shows an error with a retry', async () => {
  install({ '/courses/c1/attendance/sessions?page_size=100': httpError(500) })
  renderPage()
  expect(await screen.findByText('Sessions could not be loaded.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
})

test('Download report builds a CSV from the attendance report', async () => {
  install()
  const created = vi.fn(() => 'blob:report')
  const revoked = vi.fn()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked }))
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: /Download report/ })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: /Download report/ }))
  expect(click).toHaveBeenCalledTimes(1)
  expect(revoked).toHaveBeenCalledWith('blob:report')
  const text = await new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.readAsText(created.mock.calls[0][0])
  })
  const lines = text.split('\n')
  expect(lines[0]).toBe('Student,Registration no.,Present,Late,Excused,Absent,Attended,Counted,Attendance %')
  expect(lines).toHaveLength(5)
  expect(lines[3]).toBe('Marcus Vance,REG-0621,2,0,1,2,2,4,50')
  click.mockRestore()
  vi.unstubAllGlobals()
})

test('a failing course list shows an error, and a lecturer with no courses sees an empty message', async () => {
  install({ '/courses?page_size=100': httpError(500) })
  const first = renderPage()
  expect(await screen.findByText('Your courses could not be loaded.')).toBeInTheDocument()
  first.unmount()

  install({ '/courses?page_size=100': { items: [], total: 0 } })
  renderPage()
  expect(await screen.findByText(/not assigned to any course yet/)).toBeInTheDocument()
})

test('Refresh from server asks for fresh data', async () => {
  install()
  renderPage()
  await screen.findByLabelText('Roll-call')
  const before = apiMock.mock.calls.filter(([path]) => path === '/courses/c1/reports/attendance').length
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Refresh from server/ }))
  })
  await waitFor(() => expect(apiMock.mock.calls.filter(([path]) => path === '/courses/c1/reports/attendance').length).toBeGreaterThan(before))
})
