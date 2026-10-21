import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('../src/services/apiClient.js', () => ({ api: apiMock }))

import StudentMarks from '../src/pages/student/StudentMarks.jsx'

const COURSES = {
  items: [
    { id: 'c1', course_code: 'CS401', course_name: 'Adv. Software Engineering', credit_hours: 4, semester: '2' },
    { id: 'c2', course_code: 'CS402', course_name: 'Distributed Systems', credit_hours: 4, semester: '2' },
    { id: 'c3', course_code: 'CS350', course_name: 'Networks & Security', credit_hours: 3, semester: '2' },
  ],
  total: 3,
}
const DETAILS = {
  c1: { lecturers: [{ title: 'Dr.', full_name: 'Sarah Jenkins' }] },
  c2: { lecturers: [{ title: 'Prof.', full_name: 'David Thorne' }] },
  c3: { lecturers: [] },
}
const MARKS = () => ({
  c1: {
    items: [
      { assessment_id: 'a1', name: 'CAT 1 (CQRS)', type: 'cat', max_marks: 50, weight: 20, mark: 44.5, percentage: 89, feedback: 'Strong aggregate boundaries.' },
      { assessment_id: 'a2', name: 'Architecture Spec', type: 'assignment', max_marks: 50, weight: 20, mark: 43, percentage: 86, feedback: null },
      { assessment_id: 'a3', name: 'Final Exam', type: 'exam', max_marks: 100, weight: 60, mark: null, percentage: null, feedback: null },
    ],
    totals: { weighted_total: 35, weight_graded: 40, weight_published: 100, weighted_percent: 87.5, marks_total: 87.5, max_total: 100 },
  },
  c2: {
    items: [{ assessment_id: 'b1', name: 'Raft Consensus Lab', type: 'practical', max_marks: 100, weight: 25, mark: 92, percentage: 92, feedback: 'Excellent Raft log compaction.' }],
    totals: { weighted_total: 23, weight_graded: 25, weight_published: 25, weighted_percent: 92, marks_total: 92, max_total: 100 },
  },
  c3: {
    items: [{ assessment_id: 'c1', name: 'Quiz 1', type: 'assignment', max_marks: 20, weight: 15, mark: 20, percentage: 100, feedback: '' }],
    totals: { weighted_total: 15, weight_graded: 15, weight_published: 15, weighted_percent: 100, marks_total: 20, max_total: 20 },
  },
})

let marks
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
    m = path.match(/^\/courses\/(c\d)\/marks\/me$/)
    if (m) return marks[m[1]]
    throw new Error(`unexpected request: ${path}`)
  })
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/student/marks']}>
        <StudentMarks />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiMock.mockReset()
  marks = MARKS()
})

const stat = (label) => screen.getByText(label).closest('.slpc-stat')
const items = () => within(screen.getByRole('list', { name: 'Assessments' })).getAllByRole('button')
const itemTitles = () => items().map((button) => within(button).getByText(/^(CAT 1|Architecture|Final|Raft|Quiz)/).textContent)

describe('student marks', () => {
  test('lists every published assessment with real marks, no invented grades', async () => {
    install()
    renderPage()
    expect(await screen.findByRole('button', { name: /CS401 CAT 1 \(CQRS\), 44\.5 out of 50/ })).toBeInTheDocument()
    expect(apiMock).toHaveBeenCalledWith('/courses/c2/marks/me')
    expect(itemTitles()).toEqual(['CAT 1 (CQRS)', 'Architecture Spec', 'Final Exam', 'Raft Consensus Lab', 'Quiz 1'])
    expect(screen.getByRole('button', { name: /CS401 Final Exam, not marked yet/ })).toBeInTheDocument()
    expect(screen.queryByText(/GPA|Honours|Rank|Senate|Cohort|Grade A|SHA256|14-day/)).not.toBeInTheDocument()
  })

  test('summary cards are computed from the responses', async () => {
    install()
    renderPage()
    await screen.findByRole('button', { name: /CS401 CAT 1/ })
    const average = stat('Overall average')
    expect(within(average).getByText('93.2%')).toBeInTheDocument()
    expect(within(average).getByText('Average of 3 courses with marks')).toBeInTheDocument()
    const top = stat('Strongest course')
    expect(within(top).getByText('100.0%')).toBeInTheDocument()
    expect(within(top).getByText('CS350')).toBeInTheDocument()
    const status = stat('Assessment status')
    expect(within(status).getByText('4')).toBeInTheDocument()
    expect(within(status).getByText('1 published, awaiting a mark')).toBeInTheDocument()
    const credits = stat('Enrolled credits')
    expect(within(credits).getByText('11')).toBeInTheDocument()
    expect(within(credits).getByText('3 courses • Semester 2')).toBeInTheDocument()
  })

  test('course cards show the server totals and released counts', async () => {
    install()
    renderPage()
    await screen.findByRole('button', { name: /CS401 CAT 1/ })
    const card = screen.getByRole('button', { name: 'CS401 Adv. Software Engineering' })
    expect(within(card).getByText('87.5%')).toBeInTheDocument()
    expect(within(card).getByText('Released: 2 / 3')).toBeInTheDocument()
    expect(within(card).getByText('1 awaiting')).toBeInTheDocument()
    expect(within(card).getByText('Dr. Sarah Jenkins')).toBeInTheDocument()
    expect(within(card).getByText('4 Credits')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: 'CS402 Distributed Systems' })).getByText('All marked')).toBeInTheDocument()
  })

  test('selecting an assessment fills the inspector with its contribution and feedback', async () => {
    install()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /CS402 Raft Consensus Lab/ }))
    const inspector = screen.getByRole('region', { name: 'Assessment details' })
    expect(within(inspector).getByText('Raft Consensus Lab')).toBeInTheDocument()
    expect(within(inspector).getByText('92.0')).toBeInTheDocument()
    expect(within(inspector).getByText('23.0% / 25.0% max')).toBeInTheDocument()
    expect(within(inspector).getByText('Prof. David Thorne')).toBeInTheDocument()
    expect(within(inspector).getByText('“Excellent Raft log compaction.”'.slice(1, -1))).toBeInTheDocument()
    expect(within(inspector).getByRole('link', { name: /Open CS402 course page/ })).toHaveAttribute('href', '/student/courses/c2')

    fireEvent.click(screen.getByRole('button', { name: /CS401 Final Exam/ }))
    expect(within(inspector).getByText('Not marked yet')).toBeInTheDocument()
    expect(within(inspector).getByText(/Feedback appears here once your lecturer has marked/)).toBeInTheDocument()
    expect(within(inspector).getByText('87.5%')).toBeInTheDocument()
    expect(within(inspector).getByText('40.0% of 100.0%')).toBeInTheDocument()
  })

  test('filters by course, type and search, and sorts', async () => {
    install()
    renderPage()
    await screen.findByRole('button', { name: /CS401 CAT 1/ })
    fireEvent.click(within(screen.getByRole('group', { name: 'Course filter' })).getByRole('button', { name: 'CS401' }))
    expect(itemTitles()).toEqual(['CAT 1 (CQRS)', 'Architecture Spec', 'Final Exam'])
    fireEvent.click(within(screen.getByRole('group', { name: 'Assessment type' })).getByRole('button', { name: 'Exams' }))
    expect(itemTitles()).toEqual(['Final Exam'])
    fireEvent.click(within(screen.getByRole('group', { name: 'Assessment type' })).getByRole('button', { name: 'All' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Course filter' })).getByRole('button', { name: /All Modules/ }))

    fireEvent.change(screen.getByLabelText('Search assessments'), { target: { value: 'thorne' } })
    expect(itemTitles()).toEqual(['Raft Consensus Lab'])
    fireEvent.change(screen.getByLabelText('Search assessments'), { target: { value: 'zzz' } })
    expect(screen.getByText('No assessments match these filters.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search assessments'), { target: { value: '' } })

    fireEvent.change(screen.getByLabelText('Sort assessments'), { target: { value: 'highest' } })
    expect(itemTitles()[0]).toBe('Quiz 1')
    fireEvent.change(screen.getByLabelText('Sort assessments'), { target: { value: 'weight' } })
    expect(itemTitles()[0]).toBe('Final Exam')
    fireEvent.change(screen.getByLabelText('Sort assessments'), { target: { value: 'waiting' } })
    expect(itemTitles()[0]).toBe('Final Exam')
  })

  test('clicking a course card filters the list and clicking again clears it', async () => {
    install()
    renderPage()
    await screen.findByRole('button', { name: /CS401 CAT 1/ })
    fireEvent.click(screen.getByRole('button', { name: 'CS350 Networks & Security' }))
    expect(itemTitles()).toEqual(['Quiz 1'])
    fireEvent.click(screen.getByRole('button', { name: 'CS350 Networks & Security' }))
    expect(items()).toHaveLength(5)
  })

  test('one course failing does not hide the others and can be retried', async () => {
    install()
    let fail = true
    apiMock.mockImplementation(async (path) => {
      if (path === '/courses?page_size=100') return COURSES
      let m = path.match(/^\/courses\/(c\d)$/)
      if (m) return { ...COURSES.items.find((c) => c.id === m[1]), ...DETAILS[m[1]] }
      m = path.match(/^\/courses\/(c\d)\/marks\/me$/)
      if (m && m[1] === 'c3' && fail) throw Object.assign(new Error('Boom'), { status: 500 })
      return marks[m[1]]
    })
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('Marks for CS350 could not be loaded.')
    expect(items()).toHaveLength(4)
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(items()).toHaveLength(5))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('says so when there are no courses or nothing is published', async () => {
    install({ '/courses?page_size=100': { items: [], total: 0 } })
    const first = renderPage()
    expect(await screen.findByText(/not enrolled in any courses yet/)).toBeInTheDocument()
    first.unmount()

    marks = { c1: { items: [], totals: {} }, c2: { items: [], totals: {} }, c3: { items: [], totals: {} } }
    install()
    renderPage()
    expect(await screen.findByText(/have not published any assessments yet/)).toBeInTheDocument()
    expect(within(stat('Overall average')).getByText('—')).toBeInTheDocument()
    expect(within(stat('Overall average')).getByText('No marks have been released yet')).toBeInTheDocument()
  })

  test('a courses failure offers a retry', async () => {
    install({ '/courses?page_size=100': Object.assign(new Error('Server exploded'), { status: 500 }) })
    renderPage()
    expect(await screen.findByText('Server exploded')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(apiMock.mock.calls.filter(([path]) => path === '/courses?page_size=100').length).toBeGreaterThan(1))
  })

  test('exports the rows on screen as CSV', async () => {
    install()
    const blobs = []
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
    URL.createObjectURL = vi.fn((blob) => {
      blobs.push(blob)
      return 'blob:x'
    })
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      renderPage()
      await screen.findByRole('button', { name: /CS401 CAT 1/ })
      fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }))
      const text = await new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.readAsText(blobs[0])
      })
      const lines = text.split('\n')
      expect(lines).toHaveLength(6)
      expect(lines[0]).toBe('Course,Course name,Assessment,Type,Mark,Out of,Percent,Weight %,Contribution %,Feedback')
      expect(lines[1]).toContain('CS401,Adv. Software Engineering,CAT 1 (CQRS),CAT,44.5,50.0,89.0,20.0,17.8,Strong aggregate boundaries.')
      expect(text).toContain('Final Exam,Exam,Not marked yet,100.0')
    } finally {
      URL.createObjectURL = original.create
      URL.revokeObjectURL = original.revoke
      click.mockRestore()
    }
  })
})
