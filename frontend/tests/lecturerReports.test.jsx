import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('../src/services/apiClient.js', () => ({ api: apiMock }))

import LecturerReports from '../src/pages/lecturer/LecturerReports.jsx'

const COURSES = {
  items: [
    { id: 'c1', course_code: 'CS401', course_name: 'Adv. Software Engineering' },
    { id: 'c2', course_code: 'CS402', course_name: 'Cloud Architecture' },
  ],
  total: 2,
}
const DETAIL = {
  c1: { id: 'c1', course_code: 'CS401', course_name: 'Adv. Software Engineering', enrolled_count: 4, credit_hours: 4, status: 'active', academic_year: '2025/2026', semester: 'Semester 2' },
  c2: { id: 'c2', course_code: 'CS402', course_name: 'Cloud Architecture', enrolled_count: 0, status: 'active' },
}

// attended / counted: 4/4, 3/4, 2/4, 3/4 -> 12/16 = 75%; only Marcus is under 75%
const ATTENDANCE = {
  students: [
    { student_id: 's1', full_name: 'Elena Rostova', registration_number: 'REG-0842', present: 4, late: 0, absent: 0, excused: 0 },
    { student_id: 's2', full_name: 'Tariq Al-Mansoor', registration_number: 'REG-0914', present: 3, late: 0, absent: 1, excused: 0 },
    { student_id: 's3', full_name: 'Marcus Vance', registration_number: 'REG-0621', present: 2, late: 0, absent: 2, excused: 1 },
    { student_id: 's4', full_name: 'Chloe Bennett', registration_number: 'REG-0775', present: 2, late: 1, absent: 1, excused: 0 },
  ],
  sessions: [
    { id: 'a', session_date: '2026-02-13', topic: 'gRPC', present: 3, late: 0, absent: 1, excused: 0 },
    { id: 'b', session_date: '2026-02-06', topic: 'Containers', present: 4, late: 0, absent: 0, excused: 0 },
  ],
}
// weighted results on 50 marked weight: 90%, 70%, 40%, 60% -> mean 65%
const PERFORMANCE = {
  students: [
    { student_id: 's1', full_name: 'Elena Rostova', registration_number: 'REG-0842', weighted_total: 45, weight_covered: 50 },
    { student_id: 's2', full_name: 'Tariq Al-Mansoor', registration_number: 'REG-0914', weighted_total: 35, weight_covered: 50 },
    { student_id: 's3', full_name: 'Marcus Vance', registration_number: 'REG-0621', weighted_total: 20, weight_covered: 50 },
    { student_id: 's4', full_name: 'Chloe Bennett', registration_number: 'REG-0775', weighted_total: 30, weight_covered: 50 },
  ],
  assessments: [{ id: 'x1', name: 'Midterm', type: 'exam', max_marks: 50, weight: 50, marks_entered: 4, mean: 31.5, min: 20, max: 45 }],
}
// received = enrolled (4) minus missing: 3/4 and 4/4 -> 7/8
const SUBMISSIONS = {
  assignments: [
    { id: 'g1', title: 'Design Doc', due_at: '2026-02-20T10:00:00Z', max_marks: 20, submitted: 3, late: 1, graded: 2, missing: 1 },
    { id: 'g2', title: 'Lab 2', due_at: '2026-03-01T10:00:00Z', max_marks: 10, submitted: 4, late: 0, graded: 4, missing: 0 },
  ],
}

const httpError = (status) => Object.assign(new Error(`HTTP ${status}`), { status })

function install(overrides = {}) {
  apiMock.mockImplementation(async (path) => {
    if (path in overrides) {
      const value = overrides[path]
      if (value instanceof Error) throw value
      return value
    }
    if (path === '/courses?page_size=100') return COURSES
    let m = path.match(/^\/courses\/(c\d)$/)
    if (m) return DETAIL[m[1]]
    m = path.match(/^\/courses\/(c\d)\/reports\/(attendance|performance|submissions)$/)
    if (m) {
      if (m[1] === 'c2') return m[2] === 'submissions' ? { assignments: [] } : { students: [] }
      return { attendance: ATTENDANCE, performance: PERFORMANCE, submissions: SUBMISSIONS }[m[2]]
    }
    throw new Error(`unexpected request: ${path}`)
  })
}

function renderPage(path = '/lecturer/reports') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/lecturer/reports" element={<LecturerReports />} />
          <Route path="/lecturer/courses/:courseId/reports" element={<LecturerReports />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const summary = () => screen.getByLabelText('Report summary')
const roster = () => screen.getByLabelText('Student roster', { selector: 'section' })
const dossier = () => screen.getByLabelText('Student dossier inspector')
const tab = (name) => screen.getByRole('button', { name })
const rowNames = () => within(roster()).getAllByRole('row').slice(1).map((row) => row.textContent)

beforeEach(() => {
  apiMock.mockReset()
})

test('works every figure out from the report rows so totals reconcile', async () => {
  install()
  renderPage()
  await waitFor(() => expect(within(summary()).getByLabelText('Cohort attendance')).toHaveTextContent('75%'))
  const cards = within(summary())
  expect(cards.getByLabelText('Submission rate')).toHaveTextContent('87.5%')
  expect(cards.getByLabelText('Weighted assessment mean')).toHaveTextContent('65%')
  expect(cards.getByLabelText('Students needing attention')).toHaveTextContent('1')
  expect(screen.getByText('1 < 75% limit')).toBeInTheDocument()
  expect(screen.getByText('75% at or above 50%')).toBeInTheDocument()
  expect(screen.getByText('1 late • 1 missing')).toBeInTheDocument()
  expect(screen.getByText('Active course')).toBeInTheDocument()
  expect(screen.getByText('2025/2026 • Semester 2')).toBeInTheDocument()
  expect(screen.getByText('4 Credit Hours')).toBeInTheDocument()
})

test('buckets students into the grade bands and flags those below the pass mark', async () => {
  install()
  renderPage()
  await waitFor(() => expect(screen.getByLabelText('80% – 100%: 1 students')).toBeInTheDocument())
  expect(screen.getByLabelText('70% – 79%: 1 students')).toBeInTheDocument()
  expect(screen.getByLabelText('60% – 69%: 1 students')).toBeInTheDocument()
  expect(screen.getByLabelText('50% – 59%: 0 students')).toBeInTheDocument()
  expect(screen.getByLabelText('Below 50%: 1 students')).toBeInTheDocument()
  expect(screen.getByText(/1 student is below 50% of the weight marked so far/)).toBeInTheDocument()
})

test('roster combines attendance and marks and sets the standing', async () => {
  install()
  renderPage()
  await waitFor(() => expect(rowNames()).toHaveLength(4))
  const rows = within(roster()).getAllByRole('row')
  const marcus = rows.find((row) => row.textContent.includes('Marcus Vance'))
  expect(marcus).toHaveTextContent('2/4 • 50%')
  expect(marcus).toHaveTextContent('20 / 50 • 40%')
  expect(marcus).toHaveTextContent('Needs attention')
  const elena = rows.find((row) => row.textContent.includes('Elena Rostova'))
  expect(elena).toHaveTextContent('Good standing')
  expect(elena).toHaveTextContent('4/4 • 100%')
})

test('filters by search and standing, sorts, and clears', async () => {
  install()
  renderPage()
  await waitFor(() => expect(rowNames()).toHaveLength(4))
  fireEvent.change(screen.getByLabelText('Search students'), { target: { value: 'reg-0914' } })
  expect(rowNames()).toHaveLength(1)
  expect(rowNames()[0]).toContain('Tariq')
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  fireEvent.change(screen.getByLabelText('Standing'), { target: { value: 'risk' } })
  expect(rowNames()).toHaveLength(1)
  expect(rowNames()[0]).toContain('Marcus')
  fireEvent.change(screen.getByLabelText('Standing'), { target: { value: 'all' } })
  fireEvent.change(screen.getByLabelText('Sort students'), { target: { value: 'result' } })
  expect(rowNames()[0]).toContain('Elena')
  fireEvent.change(screen.getByLabelText('Sort students'), { target: { value: 'attendance' } })
  expect(rowNames()[0]).toContain('Marcus')
  fireEvent.change(screen.getByLabelText('Search students'), { target: { value: 'nobody' } })
  expect(screen.getByText('No students match these filters.')).toBeInTheDocument()
})

test('"Show these students" jumps to the flagged ones', async () => {
  install()
  renderPage()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Show these students' })).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Show these students' }))
  expect(rowNames()).toHaveLength(1)
})

test('the dossier follows the selected student and shows rank and counts', async () => {
  install()
  renderPage()
  await waitFor(() => expect(within(dossier()).getByRole('heading', { level: 3 })).toHaveTextContent('Chloe Bennett'))
  expect(within(dossier()).getByText('Rank 3 / 4')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Inspect Marcus Vance' }))
  const panel = dossier()
  expect(within(panel).getByRole('heading', { level: 3 })).toHaveTextContent('Marcus Vance')
  expect(within(panel).getByText('Rank 4 / 4')).toBeInTheDocument()
  expect(within(panel).getByLabelText('40 percent weighted result')).toBeInTheDocument()
  expect(within(panel).getByText('2 • 1')).toBeInTheDocument()
  expect(within(panel).getByText(/Attendance is under 75% and marks are under 50%/)).toBeInTheDocument()
})

test('attendance tab lists sessions oldest first and student rates', async () => {
  install()
  renderPage()
  await waitFor(() => expect(rowNames()).toHaveLength(4))
  fireEvent.click(tab(/Attendance summary/))
  const list = screen.getByLabelText('Sessions')
  const items = within(list).getAllByRole('listitem')
  expect(items[0]).toHaveTextContent('6 Feb')
  expect(items[0]).toHaveTextContent('4 / 4')
  expect(items[1]).toHaveTextContent('13 Feb')
  expect(items[1]).toHaveTextContent('3 / 4')
  expect(items[1]).toHaveTextContent('75% present')
  const table = screen.getByRole('table', { name: 'Attendance by student' })
  expect(within(table).getByText('Marcus Vance').closest('tr')).toHaveTextContent('2/4 • 50%')
})

test('submissions tab reconciles received, late and missing', async () => {
  install()
  renderPage()
  await waitFor(() => expect(rowNames()).toHaveLength(4))
  fireEvent.click(tab(/Assignment submissions/))
  const table = screen.getByRole('table', { name: 'Assignment submissions' })
  const doc = within(table).getByText('Design Doc').closest('tr')
  expect(doc).toHaveTextContent('3/4')
  expect(doc).toHaveTextContent('75%')
  expect(within(table).getByText('Lab 2').closest('tr')).toHaveTextContent('100%')
})

test('marks tab shows per-assessment statistics', async () => {
  install()
  renderPage()
  await waitFor(() => expect(rowNames()).toHaveLength(4))
  fireEvent.click(tab(/Assessment & marks/))
  const row = within(screen.getByRole('table', { name: 'Assessment results' })).getByText('Midterm').closest('tr')
  expect(row).toHaveTextContent('50%')
  expect(row).toHaveTextContent('31.5')
  expect(row).toHaveTextContent('20')
  expect(row).toHaveTextContent('45')
})

test('Export CSV builds the table on screen and neutralises formula cells', async () => {
  const bad = { ...PERFORMANCE, assessments: [{ ...PERFORMANCE.assessments[0], name: '=HYPERLINK("x")' }] }
  install({ '/courses/c1/reports/performance': bad })
  let blob
  const create = vi.fn((value) => {
    blob = value
    return 'blob:x'
  })
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }))
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  renderPage()
  await waitFor(() => expect(rowNames()).toHaveLength(4))
  fireEvent.click(tab(/Assessment & marks/))
  fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }))
  expect(click).toHaveBeenCalled()
  const text = await new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.readAsText(blob)
  })
  expect(text.split('\n')[0]).toBe('Assessment,Type,Max marks,Weight %,Marks entered,Mean,Lowest,Highest')
  expect(text).toContain(`"'=HYPERLINK(""x"")"`)
  click.mockRestore()
})

test('says reports are not switched on yet and shows no figures', async () => {
  install({
    '/courses/c1/reports/attendance': httpError(404),
    '/courses/c1/reports/performance': httpError(404),
    '/courses/c1/reports/submissions': httpError(501),
  })
  renderPage()
  await waitFor(() => expect(screen.getByText('Reports are not switched on yet')).toBeInTheDocument())
  expect(screen.getByText('Coming in Phase 8')).toBeInTheDocument()
  expect(screen.queryByLabelText('Report summary')).not.toBeInTheDocument()
  expect(screen.queryByRole('table')).not.toBeInTheDocument()
})

test('a failed report is flagged and retried while the rest still shows', async () => {
  let fail = true
  apiMock.mockImplementation(async (path) => {
    if (path === '/courses?page_size=100') return COURSES
    if (path === '/courses/c1') return DETAIL.c1
    if (path === '/courses/c1/reports/attendance') return ATTENDANCE
    if (path === '/courses/c1/reports/performance') return PERFORMANCE
    if (path === '/courses/c1/reports/submissions') {
      if (fail) throw httpError(500)
      return SUBMISSIONS
    }
    throw new Error(`unexpected request: ${path}`)
  })
  renderPage()
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('submissions report could not be loaded'))
  expect(within(summary()).getByLabelText('Submission rate')).toHaveTextContent('—')
  expect(within(summary()).getByLabelText('Cohort attendance')).toHaveTextContent('75%')
  fail = false
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(within(summary()).getByLabelText('Submission rate')).toHaveTextContent('87.5%'))
})

test('a course with no records shows honest empty states', async () => {
  install()
  renderPage('/lecturer/courses/c2/reports')
  await waitFor(() => expect(screen.getByText('No marks have been entered yet, so there is no distribution to show.')).toBeInTheDocument())
  expect(screen.getByText('No student records yet.')).toBeInTheDocument()
  expect(within(summary()).getByLabelText('Cohort attendance')).toHaveTextContent('—')
  expect(screen.getByRole('button', { name: /Export CSV/ })).toBeDisabled()
})

test('switching course loads that course and the route course is honoured', async () => {
  install()
  renderPage('/lecturer/courses/c2/reports')
  await waitFor(() => expect(screen.getByRole('button', { name: /CS402/ })).toHaveAttribute('aria-pressed', 'true'))
  fireEvent.click(screen.getByRole('button', { name: /CS401/ }))
  await waitFor(() => expect(rowNames()).toHaveLength(4))
  expect(apiMock).toHaveBeenCalledWith('/courses/c1/reports/attendance')
})

test('shows a clear message when the courses cannot load or none are assigned', async () => {
  install({ '/courses?page_size=100': { items: [], total: 0 } })
  const view = renderPage()
  await waitFor(() => expect(screen.getByText(/not assigned to any course/)).toBeInTheDocument())
  view.unmount()
  install({ '/courses?page_size=100': httpError(500) })
  renderPage()
  await waitFor(() => expect(screen.getByText('Your courses could not be loaded.')).toBeInTheDocument())
})
