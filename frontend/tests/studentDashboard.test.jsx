import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('../src/services/apiClient.js', () => ({ api: apiMock }))

const auth = {
  user: {
    full_name: 'Alex Chen',
    details: { registration_number: 'STU-2023-8821', program: 'BSc Computer Science' },
  },
}
vi.mock('../src/app/AuthContext.jsx', () => ({ useAuth: () => auth }))

import StudentDashboard from '../src/pages/student/StudentDashboard.jsx'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const inFuture = (ms) => new Date(Date.now() + ms).toISOString()

const COURSES = {
  items: [
    { id: 'c1', course_code: 'CS402', course_name: 'Distributed Systems', credit_hours: 3, semester: 'Semester 1', academic_year: '2026/2027', status: 'active' },
    { id: 'c2', course_code: 'CS308', course_name: 'Database Engineering', credit_hours: 4, semester: 'Semester 1', academic_year: '2026/2027', status: 'active' },
  ],
  total: 2,
}

function routes(overrides = {}) {
  const table = {
    '/courses?page_size=100': COURSES,
    '/courses/c1/assignments?page_size=100': {
      items: [
        { id: 'a1', title: 'Assignment 03: Raft Simulator', state: 'open', due_at: inFuture(18 * HOUR + 30_000), max_marks: 100, submissions_open: true, has_attachment: false, my_submission: null },
        { id: 'a2', title: 'Lab 04: Two-Phase Commit', state: 'open', due_at: inFuture(3 * DAY + HOUR), max_marks: 50, submissions_open: true, has_attachment: true, attachment_name: 'brief.pdf', my_submission: { id: 's1', status: 'submitted' } },
        { id: 'a9', title: 'Old closed coursework', state: 'closed', due_at: inFuture(-DAY), max_marks: 10, submissions_open: false, my_submission: null },
      ],
    },
    '/courses/c2/assignments?page_size=100': {
      items: [
        { id: 'a4', title: 'Lab 05: Query Optimisation', state: 'open', due_at: inFuture(4 * DAY + HOUR), max_marks: 20, submissions_open: true, has_attachment: false, my_submission: null },
        { id: 'a3', title: 'Network Protocol Security Audit', state: 'open', due_at: inFuture(10 * DAY), max_marks: 100, submissions_open: true, has_attachment: false, my_submission: null },
      ],
    },
    '/courses/c1/marks/me': { items: [], totals: { weighted_percent: 90 } },
    '/courses/c2/marks/me': { items: [], totals: { weighted_percent: 80 } },
    '/notifications': Object.assign(new Error('Not found'), { status: 404 }),
    '/timetable': { date_from: '2026-10-30', date_to: '2026-11-05', items: [] },
    '/dashboard': { attendance_summary: [] },
    ...overrides,
  }
  apiMock.mockImplementation(async (path) => {
    if (!(path in table)) throw new Error(`unexpected request: ${path}`)
    const value = table[path]
    if (value instanceof Error) throw value
    return value
  })
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StudentDashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiMock.mockReset()
})

test('greets the student by first name', async () => {
  routes()
  renderPage()
  expect(await screen.findByText('Welcome back, Alex!')).toBeInTheDocument()
  expect(await screen.findByText('You have 3 pending submissions.')).toBeInTheDocument()
})

test('shows real enrollment, pending and average-mark figures', async () => {
  routes()
  renderPage()
  expect(await screen.findByText('2 Active')).toBeInTheDocument()
  expect(screen.getByText('7 Credits')).toBeInTheDocument()
  expect(await screen.findByText('3 Due Soon')).toBeInTheDocument()
  expect(screen.getByText('1 Later This Week')).toBeInTheDocument()
  expect(screen.getByText('85.0')).toBeInTheDocument() // mean of 90 and 80
  expect(screen.getByText('2 Courses')).toBeInTheDocument()
  expect(screen.getAllByText('Semester 1').length).toBeGreaterThan(0)
  expect(screen.queryByText(/Semester Semester/)).not.toBeInTheDocument()
})

test('lists open assignments by deadline with the right urgency and actions', async () => {
  routes()
  renderPage()
  expect(await screen.findByText('Assignment 03: Raft Simulator')).toBeInTheDocument()
  expect(screen.getAllByText('Due in 18 hours')).toHaveLength(2) // summary card pill + the assignment card
  expect(screen.getByText('Due in 3 days')).toBeInTheDocument() // already submitted, still shows its deadline
  expect(screen.getByText('Due in 4 days')).toBeInTheDocument()
  expect(screen.getByText('Due Next Week')).toBeInTheDocument()
  expect(screen.getByText('brief.pdf')).toBeInTheDocument()
  expect(screen.getByText('Submitted')).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: /upload submission/i })).toHaveLength(3)
  expect(screen.getByRole('button', { name: /replace submission/i })).toBeInTheDocument()
  expect(screen.queryByText('Old closed coursework')).not.toBeInTheDocument()
})

test('says plainly that announcements and notifications are not live yet', async () => {
  routes()
  renderPage()
  expect(await screen.findByText(/once notifications go live \(Phase 7\)/i)).toBeInTheDocument()
  expect(screen.getByText(/once they go live \(Phase 7\)/i)).toBeInTheDocument()
})

test('shows only todays classes from the timetable', async () => {
  const d = new Date()
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  routes({
    '/timetable': {
      date_from: today,
      date_to: today,
      items: [
        { entry_id: 't1', course_id: 'c1', course_code: 'CS402', course_name: 'Distributed Systems', date: today, day_of_week: 1, start_time: '10:00:00', end_time: '12:00:00', room: 'Lab 3', notes: null, recurring: true },
        { entry_id: 't2', course_id: 'c2', course_code: 'CS308', course_name: 'Database Engineering', date: '2000-01-01', day_of_week: 6, start_time: '08:00:00', end_time: '09:00:00', room: 'Hall 9', notes: null, recurring: true },
      ],
    },
  })
  renderPage()
  expect(await screen.findByText(/Lab 3/)).toBeInTheDocument()
  expect(screen.getByText(/10:00/)).toBeInTheDocument()
  expect(screen.queryByText(/Hall 9/)).not.toBeInTheDocument()
})

test('says there are no classes today when the timetable is empty', async () => {
  routes()
  renderPage()
  expect(await screen.findByText(/No classes are scheduled for today/)).toBeInTheDocument()
})

test('says classes could not be loaded when the timetable fails', async () => {
  routes({ '/timetable': new Error('boom') })
  renderPage()
  expect(await screen.findByText(/could not load classes for today/)).toBeInTheDocument()
})

test('attendance gauge shows the pooled percentage and each course', async () => {
  routes({
    '/dashboard': {
      attendance_summary: [
        { course_id: 'c1', course_code: 'CS402', present: 3, absent: 1, late: 0, excused: 0, attended: 3, counted_sessions: 4, attendance_pct: 75 },
        { course_id: 'c2', course_code: 'CS308', present: 0, absent: 0, late: 0, excused: 0, attended: 0, counted_sessions: 0, attendance_pct: null },
      ],
    },
  })
  renderPage()
  expect(await screen.findByText(/3 of 4 counted sessions attended/)).toBeInTheDocument()
  expect(screen.getByText('Good standing')).toBeInTheDocument()
  expect(screen.getAllByText('75%').length).toBeGreaterThan(0)
})

test('attendance gauge warns when below the 75% minimum', async () => {
  routes({
    '/dashboard': {
      attendance_summary: [
        { course_id: 'c1', course_code: 'CS402', present: 1, absent: 3, late: 0, excused: 0, attended: 1, counted_sessions: 4, attendance_pct: 25 },
      ],
    },
  })
  renderPage()
  expect(await screen.findByText('Below the 75% minimum')).toBeInTheDocument()
})

test('attendance gauge never shows 0% when nothing is recorded', async () => {
  routes()
  renderPage()
  expect(await screen.findByText('No sessions recorded yet')).toBeInTheDocument()
  expect(screen.queryByText('0%')).not.toBeInTheDocument()
})

test('attendance gauge says unavailable when the dashboard fails', async () => {
  routes({ '/dashboard': new Error('boom') })
  renderPage()
  expect(await screen.findByText('Attendance unavailable')).toBeInTheDocument()
})

test('lists notifications when the endpoint exists', async () => {
  routes({
    '/notifications': { items: [{ id: 'n1', title: 'Lecture 8 Slides added', message: 'CS402', is_read: false, created_at: new Date(Date.now() - 35 * 60000).toISOString() }] },
  })
  renderPage()
  expect(await screen.findByText('Lecture 8 Slides added')).toBeInTheDocument()
  expect(screen.getByText('35 mins ago')).toBeInTheDocument()
})

test('uploads a submission after the file is chosen and the pledge is ticked', async () => {
  routes()
  renderPage()
  fireEvent.click((await screen.findAllByRole('button', { name: /upload submission/i }))[0])

  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByText('Assignment 03: Raft Simulator')).toBeInTheDocument()
  const confirm = within(dialog).getByRole('button', { name: /confirm & submit/i })
  expect(confirm).toBeDisabled()

  const file = new File(['zip-bytes'], 'raft.zip', { type: 'application/zip' })
  fireEvent.change(within(dialog).getByLabelText('Choose a file to submit'), { target: { files: [file] } })
  expect(within(dialog).getByTestId('chosen-file')).toHaveTextContent('raft.zip')
  expect(confirm).toBeDisabled() // pledge still missing

  fireEvent.click(within(dialog).getByLabelText(/my own original work/i))
  expect(confirm).toBeEnabled()

  const original = apiMock.getMockImplementation()
  apiMock.mockImplementation(async (path, options) => {
    if (path === '/assignments/a1/submissions') return { id: 's9', status: 'submitted' }
    return original(path, options)
  })
  fireEvent.click(confirm)

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  const call = apiMock.mock.calls.find(([path]) => path === '/assignments/a1/submissions')
  expect(call[1].method).toBe('POST')
  expect(call[1].form.get('file')).toBe(file)
  expect(await screen.findByText(/submission received/i)).toBeInTheDocument()
})

test('rejects an unsupported file type before anything is sent', async () => {
  routes()
  renderPage()
  fireEvent.click((await screen.findAllByRole('button', { name: /upload submission/i }))[0])
  const dialog = screen.getByRole('dialog')

  const file = new File(['MZ'], 'virus.exe', { type: 'application/octet-stream' })
  fireEvent.change(within(dialog).getByLabelText('Choose a file to submit'), { target: { files: [file] } })

  expect(within(dialog).getByRole('alert')).toHaveTextContent(/unsupported file type/i)
  expect(within(dialog).queryByTestId('chosen-file')).not.toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: /confirm & submit/i })).toBeDisabled()
  expect(apiMock.mock.calls.some(([path]) => path.endsWith('/submissions'))).toBe(false)
})

test('shows the server message when the upload fails and keeps the dialog open', async () => {
  routes()
  renderPage()
  fireEvent.click((await screen.findAllByRole('button', { name: /upload submission/i }))[0])
  const dialog = screen.getByRole('dialog')

  const file = new File(['x'], 'report.pdf', { type: 'application/pdf' })
  fireEvent.change(within(dialog).getByLabelText('Choose a file to submit'), { target: { files: [file] } })
  fireEvent.click(within(dialog).getByLabelText(/my own original work/i))

  const original = apiMock.getMockImplementation()
  apiMock.mockImplementation(async (path, options) => {
    if (path === '/assignments/a1/submissions') throw new Error('The submission deadline has passed')
    return original(path, options)
  })
  fireEvent.click(within(dialog).getByRole('button', { name: /confirm & submit/i }))

  expect(await within(dialog).findByText('The submission deadline has passed')).toBeInTheDocument()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

test('closes the dialog with Escape', async () => {
  routes()
  renderPage()
  fireEvent.click((await screen.findAllByRole('button', { name: /upload submission/i }))[0])
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  fireEvent.keyDown(document, { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

test('shows an unknown pending count instead of a wrong number when assignments fail', async () => {
  routes({ '/courses/c2/assignments?page_size=100': new Error('boom') })
  renderPage()
  expect(await screen.findByText('Could not load')).toBeInTheDocument()
  expect(screen.getByText('Some of your assignments could not be loaded.')).toBeInTheDocument()
  expect(screen.getByText('2 Active')).toBeInTheDocument()
})

test('offers a retry when the courses cannot be loaded', async () => {
  routes({ '/courses?page_size=100': new Error('down') })
  renderPage()
  const retry = await screen.findByRole('button', { name: /try again/i })
  routes()
  fireEvent.click(retry)
  expect(await screen.findByText('Assignment 03: Raft Simulator')).toBeInTheDocument()
})

test('shows an empty state when the student has no courses', async () => {
  routes({ '/courses?page_size=100': { items: [], total: 0 } })
  renderPage()
  expect(await screen.findByText('You are not enrolled in any courses yet.')).toBeInTheDocument()
})

test('shows a calm message when there are no open assignments', async () => {
  routes({
    '/courses/c1/assignments?page_size=100': { items: [] },
    '/courses/c2/assignments?page_size=100': { items: [] },
  })
  renderPage()
  expect(await screen.findByText(/no open assignments right now/i)).toBeInTheDocument()
  expect(screen.getByText('All caught up')).toBeInTheDocument()
  expect(screen.getByText('Your scholarly workspace is up to date.')).toBeInTheDocument()
})
