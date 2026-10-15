import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('../src/services/apiClient.js', () => ({ api: apiMock }))

import LecturerCourses from '../src/pages/lecturer/LecturerCourses.jsx'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const at = (ms) => new Date(Date.now() + ms).toISOString()

const COURSES = {
  items: [
    { id: 'c1', course_code: 'CS401', course_name: 'Advanced Software Engineering', description: 'Microservices and CI/CD.', credit_hours: 3, semester: 'Semester 1', academic_year: '2026/2027', status: 'active' },
    { id: 'c2', course_code: 'CS402', course_name: 'Cloud Architecture', description: '', credit_hours: 3, semester: 'Semester 1', academic_year: '2026/2027', status: 'active' },
  ],
  total: 2,
}
const LECTURER = { id: 'l1', full_name: 'M. Sterling', email: 'm.sterling@uni.edu', title: 'Prof.', department: 'Computer Science' }

const SUBMISSIONS = {
  items: [
    { id: 's1', assignment_id: 'a1', student_id: 'u1', student_name: 'Elena Rostova', registration_number: 'REG-2023-CS-0842', email: 'e@uni.edu', file_name: 'elena_auth.zip', mime_type: 'application/zip', file_size: 14_200_000, status: 'submitted', submitted_at: at(-2 * HOUR), mark: null, feedback: null, grade_released: false },
    { id: 's2', assignment_id: 'a1', student_id: 'u2', student_name: 'Tariq Al-Mansoor', registration_number: 'REG-2023-CS-0914', email: 't@uni.edu', file_name: 'tariq.zip', mime_type: 'application/zip', file_size: 11_800_000, status: 'submitted', submitted_at: at(-3 * HOUR), mark: null, feedback: null, grade_released: false },
    { id: 's3', assignment_id: 'a1', student_id: 'u3', student_name: 'Chloe Bennett', registration_number: 'REG-2023-CS-0775', email: 'c@uni.edu', file_name: 'chloe.zip', mime_type: 'application/zip', file_size: 18_600_000, status: 'late', submitted_at: at(-5 * HOUR), mark: null, feedback: null, grade_released: false },
    { id: 's4', assignment_id: 'a1', student_id: 'u4', student_name: 'Done Student', registration_number: 'REG-2023-CS-0001', email: 'd@uni.edu', file_name: 'done.zip', mime_type: 'application/zip', file_size: 1000, status: 'graded', submitted_at: at(-DAY), mark: 70, feedback: null, grade_released: false },
  ],
  total: 4,
}

function routes(overrides = {}) {
  const table = {
    '/courses?page_size=100': COURSES,
    '/courses/c1': { ...COURSES.items[0], lecturers: [LECTURER], enrolled_count: 92 },
    '/courses/c2': { ...COURSES.items[1], lecturers: [LECTURER], enrolled_count: 76 },
    '/courses/c1/students?page_size=100': {
      items: [
        { student_id: 'u1', full_name: 'Elena Rostova', email: 'e@uni.edu', registration_number: 'REG-2023-CS-0842', program: 'BSc Computer Science', year_of_study: 3, enrollment_status: 'active', enrolled_at: at(-90 * DAY) },
        { student_id: 'u2', full_name: 'Tariq Al-Mansoor', email: 't@uni.edu', registration_number: 'REG-2023-CS-0914', program: null, year_of_study: null, enrollment_status: 'active', enrolled_at: at(-90 * DAY) },
      ],
      total: 92,
    },
    '/courses/c1/materials?page_size=100': {
      items: [
        { id: 'm1', title: 'Zero Trust Security', description: '', category: 'slides', file_name: 'Wk08-ZeroTrust.pdf', mime_type: 'application/pdf', file_size: 4_800_000, published: true, uploader_name: 'Prof. Sterling', created_at: at(-2 * DAY) },
        { id: 'm2', title: 'Docker Lab', description: 'Compose scaffolding', category: 'lab', file_name: 'docker-lab.zip', mime_type: 'application/zip', file_size: 12_400_000, published: false, uploader_name: 'Prof. Sterling', created_at: at(-5 * DAY) },
      ],
      total: 2,
    },
    '/courses/c1/assignments?page_size=100': {
      items: [
        { id: 'a1', course_id: 'c1', title: 'Assignment 02: OpenTelemetry Spec', description: 'Trace the auth service.', due_at: at(DAY), max_marks: 100, state: 'open', published: true, closed: false, submissions_open: true, has_attachment: false, created_at: at(-7 * DAY) },
        { id: 'a2', course_id: 'c1', title: 'Lab 01', description: '', due_at: at(-9 * DAY), max_marks: 20, state: 'closed', published: true, closed: true, submissions_open: false, has_attachment: false, created_at: at(-20 * DAY) },
      ],
      total: 2,
    },
    '/assignments/a1': { id: 'a1', submission_counts: { submitted: 2, late: 1, graded: 1, returned: 0, total: 4 } },
    '/assignments/a2': { id: 'a2', submission_counts: { submitted: 0, late: 0, graded: 5, returned: 0, total: 5 } },
    '/assignments/a1/submissions?page_size=100': SUBMISSIONS,
    '/assignments/a2/submissions?page_size=100': { items: [], total: 0 },
    '/courses/c1/assessments?page_size=100': {
      items: [
        { id: 'x1', course_id: 'c1', name: 'CAT 1: System Design', type: 'cat', max_marks: 30, weight: 15, published: true, marks_entered: 92 },
        { id: 'x2', course_id: 'c1', name: 'Midterm Examination', type: 'exam', max_marks: 100, weight: 25, published: false, marks_entered: 90 },
      ],
      total: 2,
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
          <Route path="/lecturer/courses" element={<LecturerCourses />} />
          <Route path="/lecturer/courses/:courseId" element={<LecturerCourses />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiMock.mockReset()
})

describe('catalogue', () => {
  test('lists the courses you teach with enrolment counts', async () => {
    routes()
    renderAt('/lecturer/courses')
    expect(await screen.findByText('CS401: Advanced Software Engineering')).toBeInTheDocument()
    expect(screen.getByText('CS402: Cloud Architecture')).toBeInTheDocument()
    expect(await screen.findByText('92 enrolled')).toBeInTheDocument()
    expect(screen.getByText('Showing 2 of 2 assigned courses')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /CS401/ })).toHaveAttribute('href', '/lecturer/courses/c1')
  })

  test('filters, and shows empty and error states with a working retry', async () => {
    routes()
    const first = renderAt('/lecturer/courses')
    await screen.findByText('CS401: Advanced Software Engineering')
    fireEvent.change(screen.getByLabelText('Filter courses by code or title'), { target: { value: 'cloud' } })
    expect(screen.queryByText('CS401: Advanced Software Engineering')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Filter courses by code or title'), { target: { value: 'zzz' } })
    expect(screen.getByText('No courses match your search.')).toBeInTheDocument()
    first.unmount()

    routes({ '/courses?page_size=100': { items: [], total: 0 } })
    const second = renderAt('/lecturer/courses')
    expect(await screen.findByText('You are not assigned to any courses yet.')).toBeInTheDocument()
    second.unmount()

    routes({ '/courses?page_size=100': new Error('down') })
    renderAt('/lecturer/courses')
    const retry = await screen.findByRole('button', { name: /try again/i })
    routes()
    fireEvent.click(retry)
    expect(await screen.findByText('CS401: Advanced Software Engineering')).toBeInTheDocument()
  })
})

describe('course workspace: overview', () => {
  test('shows the hero, the switcher and real figures', async () => {
    routes()
    renderAt('/lecturer/courses/c1')
    expect(await screen.findByRole('heading', { level: 1, name: 'CS401: Advanced Software Engineering' })).toBeInTheDocument()
    expect(screen.getByText('3 Credit Hours')).toBeInTheDocument()
    expect(await screen.findByText('3 submissions are')).toBeInTheDocument()
    expect(await screen.findByText('3 Action Required')).toBeInTheDocument()
    expect(screen.getByText('1/2')).toBeInTheDocument() // assessments released
    expect(screen.getByText('2 Assignments Published')).toBeInTheDocument()
    expect(screen.getByText('Current')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /CS402: Cloud Architecture/ })).toHaveAttribute('href', '/lecturer/courses/c2')
    expect(screen.getByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Submissions/ })).toHaveTextContent('3 Pending')
  })

  test('lists the grading queue with late flags and links to review', async () => {
    routes()
    renderAt('/lecturer/courses/c1')
    expect(await screen.findByText('Elena Rostova')).toBeInTheDocument()
    expect(screen.getByText('Tariq Al-Mansoor')).toBeInTheDocument()
    expect(screen.getByText('Chloe Bennett')).toBeInTheDocument()
    expect(screen.getByText('Late')).toBeInTheDocument()
    expect(screen.getAllByText('On Time')).toHaveLength(2)
    expect(screen.queryByText('Done Student')).not.toBeInTheDocument()
    const grade = screen.getAllByRole('link', { name: /Grade \(0-100\)/ })
    expect(grade).toHaveLength(3)
    expect(grade[0]).toHaveAttribute('href', '/lecturer/assignments/a1/submissions')
  })

  test('summarises materials and the grade release pipeline', async () => {
    routes()
    renderAt('/lecturer/courses/c1')
    expect(await screen.findByText('Wk08-ZeroTrust.pdf')).toBeInTheDocument()
    expect(screen.getByText('docker-lab.zip')).toBeInTheDocument()
    expect(screen.getByText('Published')).toBeInTheDocument()
    expect(screen.getByText('Draft')).toBeInTheDocument()
    expect(await screen.findByText('RELEASED')).toBeInTheDocument()
    expect(screen.getByText('DRAFT LOCK')).toBeInTheDocument()
    expect(screen.getByText('92 of 92 marked')).toBeInTheDocument()
    expect(screen.getByText('90 of 92 marked')).toBeInTheDocument()
  })

  test('offers shortcuts to the right places', async () => {
    routes()
    renderAt('/lecturer/courses/c1')
    expect(await screen.findByRole('link', { name: /Create Assignment/ })).toHaveAttribute('href', '/lecturer/courses/c1/assignments')
    expect(screen.getByRole('link', { name: /Upload Material/ })).toHaveAttribute('href', '/lecturer/courses/c1/materials')
    expect(screen.getByRole('link', { name: /Log Attendance/ })).toHaveAttribute('href', '/lecturer/courses/c1/attendance')
    expect(screen.getByRole('link', { name: /Enter Marks/ })).toHaveAttribute('href', '/lecturer/courses/c1/marks')
    expect(screen.getByRole('link', { name: /Broadcast Cohort Announcement/ })).toHaveAttribute('href', '/lecturer/courses/c1/announcements')
    expect(await screen.findByText('Mark 92 students')).toBeInTheDocument()
    expect(screen.getByText('Reach all 92 students')).toBeInTheDocument()
  })

  test('says plainly when attendance is not live yet', async () => {
    routes()
    renderAt('/lecturer/courses/c1')
    expect(await screen.findByText(/once attendance \(Phase 6\) goes live/i)).toBeInTheDocument()
  })

  test('shows unknown rather than a wrong number when submission counts fail', async () => {
    routes({ '/assignments/a1': new Error('boom') })
    renderAt('/lecturer/courses/c1')
    expect(await screen.findByText('We could not check for submissions waiting to be graded.')).toBeInTheDocument()
    expect(screen.queryByText(/Action Required/)).not.toBeInTheDocument()
  })

  test('says so when nothing is waiting to be graded', async () => {
    routes({
      '/assignments/a1': { id: 'a1', submission_counts: { submitted: 0, late: 0, graded: 4, returned: 0, total: 4 } },
    })
    renderAt('/lecturer/courses/c1')
    expect(await screen.findByText('No submissions are waiting to be graded.')).toBeInTheDocument()
    expect(screen.getByText(/You are all caught up/)).toBeInTheDocument()
  })
})

describe('course workspace: tabs', () => {
  test('reads the tab from the URL and moves with the arrow keys', async () => {
    routes()
    renderAt('/lecturer/courses/c1?tab=students')
    expect(await screen.findByText('REG-2023-CS-0842')).toBeInTheDocument()
    const tab = screen.getByRole('tab', { name: /Students/ })
    expect(tab).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(tab, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: /Materials/ })).toHaveAttribute('aria-selected', 'true')
  })

  test('falls back to Overview for an unknown tab', async () => {
    routes()
    renderAt('/lecturer/courses/c1?tab=nonsense')
    expect(await screen.findByRole('tab', { name: /Overview/ })).toHaveAttribute('aria-selected', 'true')
  })

  test('searches the roster', async () => {
    routes()
    renderAt('/lecturer/courses/c1?tab=students')
    await screen.findByText('REG-2023-CS-0842')
    expect(screen.getByText('Showing 2 of 92 enrolled students')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search students'), { target: { value: 'tariq' } })
    expect(screen.queryByText('REG-2023-CS-0842')).not.toBeInTheDocument()
    expect(screen.getByText('REG-2023-CS-0914')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search students'), { target: { value: 'zzz' } })
    expect(screen.getByText('No students match your search.')).toBeInTheDocument()
  })

  test('downloads a material through a signed link and reports a failure', async () => {
    routes()
    renderAt('/lecturer/courses/c1?tab=materials')
    await screen.findByText('Docker Lab')
    const original = apiMock.getMockImplementation()
    apiMock.mockImplementation(async (path) => (path === '/materials/m1/download' ? { url: 'https://files.test/zt.pdf', file_name: 'zt.pdf' } : original(path)))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: 'Download Zero Trust Security' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    click.mockRestore()

    apiMock.mockImplementation(async (path) => {
      if (path === '/materials/m2/download') throw new Error('File not found')
      return original(path)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Download Docker Lab' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('File not found')
  })

  test('shows submission counts per assignment', async () => {
    routes()
    renderAt('/lecturer/courses/c1?tab=assignments')
    expect(await screen.findByText('Assignment 02: OpenTelemetry Spec')).toBeInTheDocument()
    expect(await screen.findByText('3 to grade')).toBeInTheDocument()
    expect(screen.getByText('0 to grade')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Review Submissions/ })[0]).toHaveAttribute('href', '/lecturer/assignments/a1/submissions')
  })

  test('filters submissions by status', async () => {
    routes()
    renderAt('/lecturer/courses/c1?tab=submissions')
    expect(await screen.findByText('Elena Rostova')).toBeInTheDocument()
    expect(screen.queryByText('Done Student')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Filter submissions'), { target: { value: 'all' } })
    expect(screen.getByText('Done Student')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Choose assignment'), { target: { value: 'a2' } })
    expect(await screen.findByText('No submissions match this filter.')).toBeInTheDocument()
  })

  test('publishes marks only after a confirmation', async () => {
    routes()
    renderAt('/lecturer/courses/c1?tab=marks')
    await screen.findByText('Midterm Examination')
    fireEvent.click(screen.getByRole('button', { name: /Publish to Cohort/ }))
    expect(apiMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false)
    const group = screen.getByRole('group', { name: /Confirm publishing Midterm Examination/ })
    fireEvent.click(within(group).getByRole('button', { name: 'Yes, publish' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/assessments/x2', { method: 'PATCH', body: { published: true } }))
  })

  test('lets you cancel and shows a publish failure', async () => {
    routes()
    renderAt('/lecturer/courses/c1?tab=marks')
    await screen.findByText('Midterm Examination')
    fireEvent.click(screen.getByRole('button', { name: /Publish to Cohort/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: /Publish to Cohort/ })).toBeInTheDocument()

    const original = apiMock.getMockImplementation()
    apiMock.mockImplementation(async (path, options) => {
      if (options?.method === 'PATCH') throw new Error('Weights must total 100')
      return original(path, options)
    })
    fireEvent.click(screen.getByRole('button', { name: /Publish to Cohort/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, publish' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Weights must total 100')
  })

  test.each([
    ['attendance', /Coming in Phase 6/],
    ['announcements', /Coming in Phase 7/],
    ['analytics', /Coming in Phase 8/],
    ['timetable', /Coming in Phase 8/],
  ])('%s tab says plainly it is not live yet', async (tab, text) => {
    routes()
    renderAt(`/lecturer/courses/c1?tab=${tab}`)
    expect(await screen.findByText(text)).toBeInTheDocument()
  })

  test('shows empty states for a course with nothing in it', async () => {
    routes({
      '/courses/c1/students?page_size=100': { items: [], total: 0 },
      '/courses/c1/materials?page_size=100': { items: [], total: 0 },
      '/courses/c1/assignments?page_size=100': { items: [], total: 0 },
      '/courses/c1/assessments?page_size=100': { items: [], total: 0 },
    })
    renderAt('/lecturer/courses/c1?tab=students')
    expect(await screen.findByText('No students are enrolled in this course yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Materials/ }))
    expect(await screen.findByText(/No materials have been uploaded/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Assignments/ }))
    expect(await screen.findByText(/No assignments have been created/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Marks/ }))
    expect(await screen.findByText(/No assessments have been set up/)).toBeInTheDocument()
  })

  test('explains a course that is not found', async () => {
    routes({ '/courses/c9': Object.assign(new Error('Not found'), { status: 404 }) })
    renderAt('/lecturer/courses/c9')
    expect(await screen.findByText(/could not find this course/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to My Courses' })).toHaveAttribute('href', '/lecturer/courses')
  })
})
