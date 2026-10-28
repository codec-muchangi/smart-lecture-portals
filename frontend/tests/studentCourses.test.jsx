import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('../src/services/apiClient.js', () => ({ api: apiMock }))

import StudentCourses from '../src/pages/student/StudentCourses.jsx'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const at = (ms) => new Date(Date.now() + ms).toISOString()

const COURSES = {
  items: [
    { id: 'c1', course_code: 'CS401', course_name: 'Advanced Software Engineering', description: 'Architecture and delivery.', credit_hours: 4, semester: 'Semester 1', academic_year: '2026/2027', status: 'active' },
    { id: 'c2', course_code: 'CS308', course_name: 'Database Engineering', description: '', credit_hours: 3, semester: 'Semester 2', academic_year: '2026/2027', status: 'active' },
  ],
  total: 2,
}
const LECTURER = { full_name: 'Elena Rostova', email: 'e.rostova@uni.edu', title: 'Dr.', department: 'Computer Science' }

function routes(overrides = {}) {
  const table = {
    '/courses?page_size=100': COURSES,
    '/courses/c1': { ...COURSES.items[0], lecturers: [LECTURER] },
    '/courses/c2': { ...COURSES.items[1], lecturers: [] },
    '/courses/c1/materials?page_size=100': {
      items: [
        { id: 'm1', title: 'Lecture 8 Slides', description: 'Microservices', category: 'slides', file_name: 'l8.pdf', file_size: 2_400_000, uploader_name: 'Dr. Rostova', created_at: at(-14 * 60000) },
        { id: 'm2', title: 'Lab 3 Worksheet', description: '', category: 'lab', file_name: 'lab3.docx', file_size: 52_000, uploader_name: 'Dr. Rostova', created_at: at(-3 * DAY) },
      ],
      total: 2,
    },
    '/courses/c1/assignments?page_size=100': {
      items: [
        { id: 'a1', title: 'Assignment 03: Architecture Review', state: 'open', due_at: at(18 * HOUR + 30_000), max_marks: 100, submissions_open: true, has_attachment: true, attachment_name: 'brief.pdf', my_submission: null },
        { id: 'a2', title: 'Lab 02: Patterns', state: 'open', due_at: at(5 * DAY), max_marks: 50, submissions_open: true, has_attachment: false, my_submission: { id: 's1', status: 'submitted', file_name: 'lab2.zip', file_size: 1000, submitted_at: at(-HOUR) } },
        { id: 'a3', title: 'Old Quiz', state: 'closed', due_at: at(-9 * DAY), max_marks: 10, submissions_open: false, has_attachment: false, my_submission: { id: 's2', status: 'graded', file_name: 'q.pdf', file_size: 10, submitted_at: at(-10 * DAY), grade_released: true, mark: 8, feedback: 'Good' } },
      ],
    },
    '/courses/c1/marks/me': {
      items: [
        { assessment_id: 'x1', name: 'Quiz 1', type: 'quiz', max_marks: 10, weight: 10, mark: 8, percentage: 80, feedback: 'Solid work' },
        { assessment_id: 'x2', name: 'Midterm', type: 'exam', max_marks: 100, weight: 30, mark: null, percentage: null, feedback: null },
      ],
      totals: { weighted_percent: 80, weight_graded: 10, weight_published: 40, marks_total: 8, max_total: 10 },
    },
    ...overrides,
  }
  apiMock.mockImplementation(async (path) => {
    if (!(path in table)) throw new Error(`unexpected request: ${path}`)
    const value = table[path]
    if (value instanceof Error) throw value
    return value
  })
}

function renderAt(url) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/student" element={<p>dashboard</p>} />
          <Route path="/student/courses" element={<StudentCourses />} />
          <Route path="/student/courses/:courseId" element={<StudentCourses />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiMock.mockReset()
})

describe('catalogue', () => {
  test('lists enrolled courses with their lecturers', async () => {
    routes()
    renderAt('/student/courses')
    expect(await screen.findByText('CS401: Advanced Software Engineering')).toBeInTheDocument()
    expect(screen.getByText('CS308: Database Engineering')).toBeInTheDocument()
    expect(await screen.findByText('Dr. Elena Rostova')).toBeInTheDocument()
    expect(screen.getByText('4 Credits')).toBeInTheDocument()
    expect(screen.getByText('Showing 2 of 2 active courses')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /CS401/ })).toHaveAttribute('href', '/student/courses/c1')
  })

  test('filters by text and sorts by credits', async () => {
    routes()
    renderAt('/student/courses')
    await screen.findByText('CS401: Advanced Software Engineering')
    fireEvent.change(screen.getByLabelText('Filter courses by code or title'), { target: { value: 'database' } })
    expect(screen.queryByText('CS401: Advanced Software Engineering')).not.toBeInTheDocument()
    expect(screen.getByText('CS308: Database Engineering')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Filter courses by code or title'), { target: { value: 'zzz' } })
    expect(screen.getByText('No courses match your search.')).toBeInTheDocument()
  })

  test('shows empty and error states with a working retry', async () => {
    routes({ '/courses?page_size=100': { items: [], total: 0 } })
    const first = renderAt('/student/courses')
    expect(await screen.findByText('You are not enrolled in any courses yet.')).toBeInTheDocument()
    first.unmount()

    routes({ '/courses?page_size=100': new Error('down') })
    renderAt('/student/courses')
    const retry = await screen.findByRole('button', { name: /try again/i })
    routes()
    fireEvent.click(retry)
    expect(await screen.findByText('CS401: Advanced Software Engineering')).toBeInTheDocument()
  })
})

describe('course detail', () => {
  test('shows the hero, lecturer card and real overview figures', async () => {
    routes()
    renderAt('/student/courses/c1')
    expect(await screen.findByRole('heading', { level: 1, name: 'CS401: Advanced Software Engineering' })).toBeInTheDocument()
    expect(screen.getByText('e.rostova@uni.edu')).toHaveAttribute('href', 'mailto:e.rostova@uni.edu')
    expect(screen.getByText('Dr. Elena Rostova')).toBeInTheDocument()
    expect(await screen.findByText('Curated Files')).toBeInTheDocument()
    expect(await screen.findByText('Items Active')).toBeInTheDocument()
    expect(await screen.findByText('80%', { selector: '.slpc-stat-value' })).toBeInTheDocument()
    expect(screen.getByText(/New Material: Lecture 8 Slides/)).toBeInTheDocument()
    expect(screen.getByText(/Approaching Deadline: Assignment 03/)).toBeInTheDocument()
    expect(screen.getByText(/Marks Released: Quiz 1/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true')
  })

  test('switches to another course from the pill bar', async () => {
    routes()
    renderAt('/student/courses/c1')
    const link = await screen.findByRole('link', { name: 'CS308: Database Engineering' })
    expect(link).toHaveAttribute('href', '/student/courses/c2')
  })

  test('reads the tab from the URL and moves with the arrow keys', async () => {
    routes()
    renderAt('/student/courses/c1?tab=materials')
    expect(await screen.findByText('Lecture 8 Slides')).toBeInTheDocument()
    const tab = screen.getByRole('tab', { name: /Materials/ })
    expect(tab).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(tab, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: /Assignments/ })).toHaveAttribute('aria-selected', 'true')
  })

  test('falls back to Overview for an unknown tab', async () => {
    routes()
    renderAt('/student/courses/c1?tab=nonsense')
    expect(await screen.findByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true')
  })

  test('filters materials and downloads through a signed link', async () => {
    routes()
    renderAt('/student/courses/c1?tab=materials')
    await screen.findByText('Lab 3 Worksheet')
    fireEvent.click(screen.getByRole('button', { name: /Lab Worksheets \(1\)/ }))
    expect(screen.queryByText('Lecture 8 Slides')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^All \(2\)/ }))
    fireEvent.change(screen.getByLabelText('Search materials by title'), { target: { value: 'slides' } })
    expect(screen.queryByText('Lab 3 Worksheet')).not.toBeInTheDocument()

    const original = apiMock.getMockImplementation()
    apiMock.mockImplementation(async (path) => (path === '/materials/m1/download' ? { url: 'https://files.test/l8.pdf', file_name: 'l8.pdf' } : original(path)))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: 'Download Lecture 8 Slides' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    click.mockRestore()
  })

  test('shows a download failure without leaving the page', async () => {
    routes()
    renderAt('/student/courses/c1?tab=materials')
    await screen.findByText('Lecture 8 Slides')
    const original = apiMock.getMockImplementation()
    apiMock.mockImplementation(async (path) => {
      if (path === '/materials/m1/download') throw new Error('File not found')
      return original(path)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Download Lecture 8 Slides' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('File not found')
  })

  test('lists assignments with status and uploads through the shared dialog', async () => {
    routes()
    renderAt('/student/courses/c1?tab=assignments')
    expect(await screen.findByText('Assignment 03: Architecture Review')).toBeInTheDocument()
    expect(screen.getByText('brief.pdf')).toBeInTheDocument()
    expect(screen.getByText('Not Submitted')).toBeInTheDocument()
    expect(screen.getByText('Closed')).toBeInTheDocument()
    expect(screen.getByText(/Faculty remarks: "Good"/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /replace submission/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /upload submission/i }))
    const dialog = screen.getByRole('dialog')
    const file = new File(['x'], 'review.pdf', { type: 'application/pdf' })
    fireEvent.change(within(dialog).getByLabelText('Choose a file to submit'), { target: { files: [file] } })
    fireEvent.click(within(dialog).getByLabelText(/my own original work/i))

    const original = apiMock.getMockImplementation()
    apiMock.mockImplementation(async (path, options) => (path === '/assignments/a1/submissions' ? { id: 's9', status: 'submitted' } : original(path, options)))
    fireEvent.click(within(dialog).getByRole('button', { name: /confirm & submit/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText(/submission received/i)).toBeInTheDocument()
    expect(apiMock.mock.calls.find(([path]) => path === '/assignments/a1/submissions')[1].method).toBe('POST')
  })

  test('shows released marks and the weighted result', async () => {
    routes()
    renderAt('/student/courses/c1?tab=marks')
    expect(await screen.findByText('Quiz 1')).toBeInTheDocument()
    expect(screen.getByText('Solid work')).toBeInTheDocument()
    expect(screen.getByText('Not marked yet')).toBeInTheDocument()
    expect(screen.getByText(/Weight marked/)).toBeInTheDocument()
  })

  test.each([
    ['announcements', /Coming in Phase 7/],
    ['timetable', /Coming in Phase 8/],
  ])('%s tab says plainly it is not live yet', async (tab, text) => {
    routes()
    renderAt(`/student/courses/c1?tab=${tab}`)
    expect(await screen.findByText(text)).toBeInTheDocument()
  })

  test('shows empty states for a course with nothing published', async () => {
    routes({
      '/courses/c1/materials?page_size=100': { items: [], total: 0 },
      '/courses/c1/assignments?page_size=100': { items: [] },
      '/courses/c1/marks/me': { items: [], totals: {} },
    })
    renderAt('/student/courses/c1?tab=materials')
    expect(await screen.findByText(/No materials have been published/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Assignments/ }))
    expect(await screen.findByText(/No assignments have been published/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Marks/ }))
    expect(await screen.findByText(/No assessments have been released/)).toBeInTheDocument()
  })

  test('shows unknown rather than wrong numbers when a data source fails', async () => {
    routes({ '/courses/c1/materials?page_size=100': new Error('boom') })
    renderAt('/student/courses/c1')
    expect(await screen.findByText('Curated Files')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  test('attendance tab shows an empty state before any session is marked', async () => {
  routes({
    '/courses/c1/attendance/me': {
      course_id: 'c1',
      items: [],
      summary: {
        present: 0, absent: 0, late: 0, excused: 0,
        attended: 0, counted_sessions: 0, attendance_pct: null,
      },
    },
  })
  renderAt('/student/courses/c1?tab=attendance')
  expect(await screen.findByText(/No attendance has been recorded/)).toBeInTheDocument()
})

test('attendance tab shows the percentage and tallies from the server', async () => {
  routes({
    '/courses/c1/attendance/me': {
      course_id: 'c1',
      items: [],
      summary: {
        present: 1, absent: 0, late: 0, excused: 0,
        attended: 1, counted_sessions: 1, attendance_pct: 100,
      },
    },
  })
  renderAt('/student/courses/c1?tab=attendance')
  expect(await screen.findByText(/100% attended across 1 counted sessions/)).toBeInTheDocument()
  expect(screen.getByText('Present: 1')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /View full attendance/ })).toBeInTheDocument()
})

test('attendance tab offers a retry when the server fails', async () => {
  routes({ '/courses/c1/attendance/me': new Error('boom') })
  renderAt('/student/courses/c1?tab=attendance')
  expect(await screen.findByText(/could not load your attendance/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument()
})

  test('explains a course that is not found', async () => {
    routes({ '/courses/c9': Object.assign(new Error('Not found'), { status: 404 }) })
    renderAt('/student/courses/c9')
    expect(await screen.findByText(/could not find this course/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to My Courses' })).toHaveAttribute('href', '/student/courses')
  })
})
