import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('../src/services/apiClient.js', () => ({ api: apiMock }))

import StudentAssignments from '../src/pages/student/StudentAssignments.jsx'

const COURSES = {
  items: [
    { id: 'c1', course_code: 'CS401', course_name: 'Adv. Software Engineering' },
    { id: 'c2', course_code: 'CS402', course_name: 'Distributed Systems' },
    { id: 'c3', course_code: 'CS350', course_name: 'Networks & Security' },
  ],
  total: 3,
}

const base = { description: null, instructions: null, allow_late: false, published: true, closed: false, has_attachment: false, attachment_name: null, my_submission: null }
let data

function seed() {
  data = {
    c1: [
      { ...base, id: 'a1', course_id: 'c1', title: 'Project Milestone 2', description: 'Submit a runnable repository ZIP.', instructions: 'Include a Docker Compose file.', due_at: '2026-02-26T23:59:00Z', max_marks: 100, allow_late: true, state: 'open', submissions_open: true, has_attachment: true, attachment_name: 'brief.pdf' },
      {
        ...base,
        id: 'a4',
        course_id: 'c1',
        title: 'Assignment 1 Backprop',
        due_at: '2026-02-15T10:00:00Z',
        max_marks: 50,
        state: 'closed',
        closed: true,
        submissions_open: false,
        my_submission: { id: 's4', assignment_id: 'a4', status: 'graded', file_name: 'backprop.zip', file_size: 2048000, submitted_at: '2026-02-10T09:00:00Z', mark: 46.5, feedback: 'Excellent vectorized Jacobian.', grade_released: true },
      },
    ],
    c2: [
      { ...base, id: 'a2', course_id: 'c2', title: 'Raft Simulation', description: 'Leader election under partitions.', due_at: '2026-03-04T18:00:00Z', max_marks: 50, state: 'open', submissions_open: true },
      { ...base, id: 'a5', course_id: 'c2', title: 'Consensus Notes', due_at: '2026-03-12T18:00:00Z', max_marks: 20, state: 'open', submissions_open: true, my_submission: { id: 's5', assignment_id: 'a5', status: 'returned', file_name: 'notes.pdf', file_size: 1024, submitted_at: '2026-02-20T09:00:00Z', mark: null, feedback: null, grade_released: false } },
    ],
    c3: [
      { ...base, id: 'a3', course_id: 'c3', title: 'Lab 03 TLS Handshake', due_at: '2026-03-10T18:00:00Z', max_marks: 30, state: 'open', submissions_open: true, my_submission: { id: 's3', assignment_id: 'a3', status: 'submitted', file_name: 'lab3.pdf', file_size: 4404019, submitted_at: '2026-02-22T09:00:00Z', mark: null, feedback: null, grade_released: false } },
      { ...base, id: 'a6', course_id: 'c3', title: 'Missed Quiz', due_at: '2026-02-01T10:00:00Z', max_marks: 10, state: 'closed', closed: true, submissions_open: false },
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
    let m = path.match(/^\/courses\/(c\d)\/assignments\?page_size=100$/)
    if (m) return { items: data[m[1]], total: data[m[1]].length }
    m = path.match(/^\/assignments\/(a\d)\/attachment$/)
    if (m) return { url: 'https://files.example/brief.pdf', file_name: 'brief.pdf' }
    m = path.match(/^\/submissions\/(s\d)\/download$/)
    if (m) return { url: 'https://files.example/mine.pdf', file_name: 'mine.pdf' }
    m = path.match(/^\/assignments\/(a\d)\/submissions$/)
    if (m && options.method === 'POST') return { id: 'new', status: 'submitted' }
    throw new Error(`unexpected request: ${path}`)
  })
}

function renderAt(url = '/student/assignments') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/student/assignments" element={<StudentAssignments />} />
          <Route path="/student/assignments/:assignmentId" element={<StudentAssignments />} />
          <Route path="/student/courses/:courseId/assignments" element={<StudentAssignments />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiMock.mockReset()
  seed()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-02-23T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const desk = () => screen.getByRole('region', { name: 'Submission workspace' })
const titles = () => screen.queryAllByRole('heading', { level: 2 }).map((node) => node.textContent)

describe('overview', () => {
  test('shows every assignment and figures worked out from the real data', async () => {
    install()
    renderAt()
    expect(await screen.findByRole('article', { name: 'Project Milestone 2' })).toBeInTheDocument()
    expect(titles()).toEqual(['Project Milestone 2', 'Raft Simulation', 'Lab 03 TLS Handshake', 'Consensus Notes', 'Assignment 1 Backprop'])
    const summary = screen.getByLabelText('Assignment summary')
    expect(within(summary).getByText('to submit').previousSibling).toHaveTextContent('3')
    expect(within(summary).getByText(/Nearest cutoff in 3 days \(CS401: Project Milestone 2\)/)).toBeInTheDocument()
    expect(within(summary).getByText('100% on time')).toBeInTheDocument()
    expect(within(summary).getByText('93% avg')).toBeInTheDocument()
    expect(within(summary).getByText('1 returned for revision • 1 closed without a submission')).toBeInTheDocument()
    expect(screen.queryByText(/SHA-256|Encrypted|Session Key|Vault|FR-ASG/i)).not.toBeInTheDocument()
  })

  test('filters by course scope, status tab and search, and sorts', async () => {
    install()
    renderAt()
    await screen.findByRole('article', { name: 'Project Milestone 2' })
    fireEvent.click(screen.getByRole('button', { name: /CS402: Distributed Systems/ }))
    expect(titles()).toEqual(['Raft Simulation', 'Consensus Notes'])
    fireEvent.click(screen.getByRole('button', { name: /All enrolled courses/ }))

    fireEvent.click(screen.getByRole('tab', { name: /To do \/ pending/ }))
    expect(titles()).toEqual(['Project Milestone 2', 'Raft Simulation', 'Consensus Notes'])
    fireEvent.click(screen.getByRole('tab', { name: /^Submitted/ }))
    expect(titles()).toEqual(['Lab 03 TLS Handshake'])
    fireEvent.click(screen.getByRole('tab', { name: /Graded & feedback/ }))
    expect(titles()).toEqual(['Assignment 1 Backprop'])
    fireEvent.click(screen.getByRole('tab', { name: /All assignments/ }))

    fireEvent.change(screen.getByLabelText('Search assignments'), { target: { value: 'zzz' } })
    expect(screen.getByText('No assignments match these filters.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search assignments'), { target: { value: 'raft' } })
    expect(titles()).toEqual(['Raft Simulation'])
    fireEvent.change(screen.getByLabelText('Search assignments'), { target: { value: '' } })

    fireEvent.change(screen.getByLabelText('Sort assignments'), { target: { value: 'title' } })
    expect(titles()[0]).toBe('Assignment 1 Backprop')
    fireEvent.change(screen.getByLabelText('Sort assignments'), { target: { value: 'latest' } })
    expect(titles()[0]).toBe('Consensus Notes')
  })

  test('pages the list and switches the layout', async () => {
    install()
    renderAt()
    await screen.findByRole('article', { name: 'Project Milestone 2' })
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(titles()).toEqual(['Missed Quiz'])
    fireEvent.click(screen.getByRole('button', { name: 'Grid view' }))
    expect(screen.getByRole('button', { name: 'Grid view' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Assignments')).toHaveClass('is-grid')
  })

  test('preselects the course or assignment from the route', async () => {
    install()
    const first = renderAt('/student/courses/c2/assignments')
    await screen.findByRole('article', { name: 'Raft Simulation' })
    expect(titles()).toEqual(['Raft Simulation', 'Consensus Notes'])
    first.unmount()

    install()
    renderAt('/student/assignments/a2')
    await screen.findByRole('article', { name: 'Project Milestone 2' })
    expect(within(desk()).getByText('Raft Simulation')).toBeInTheDocument()
  })

  test('shows loading failures, empty states and a working refresh', async () => {
    install({ '/courses?page_size=100': { items: [], total: 0 } })
    const first = renderAt()
    expect(await screen.findByText(/not enrolled in any courses/)).toBeInTheDocument()
    first.unmount()

    install({ '/courses?page_size=100': new Error('down') })
    const second = renderAt()
    const retry = await screen.findByRole('button', { name: /try again/i })
    install()
    fireEvent.click(retry)
    expect(await screen.findByRole('article', { name: 'Project Milestone 2' })).toBeInTheDocument()
    second.unmount()

    install({ '/courses/c3/assignments?page_size=100': new Error('boom') })
    renderAt()
    expect(await screen.findByText(/Assignments could not be loaded for CS350/)).toBeInTheDocument()
    const summary = screen.getByLabelText('Assignment summary')
    expect(within(summary).getAllByText('—').length).toBeGreaterThanOrEqual(4)
    const before = apiMock.mock.calls.length
    install()
    fireEvent.click(screen.getByRole('button', { name: /Refresh status/ }))
    await waitFor(() => expect(apiMock.mock.calls.length).toBeGreaterThan(before))
    await waitFor(() => expect(screen.queryByText(/could not be loaded for CS350/)).not.toBeInTheDocument())
  })
})

describe('cards', () => {
  test('shows released marks and feedback, and hides unreleased ones', async () => {
    install()
    const first = renderAt()
    const graded = await screen.findByRole('article', { name: 'Assignment 1 Backprop' })
    expect(within(graded).getByText('46.5')).toBeInTheDocument()
    expect(within(graded).getByText('93%')).toBeInTheDocument()
    expect(within(graded).getByText('Excellent vectorized Jacobian.')).toBeInTheDocument()
    first.unmount()

    seed()
    data.c1[1].my_submission = { ...data.c1[1].my_submission, mark: null, feedback: null, grade_released: false }
    install()
    renderAt()
    const hidden = await screen.findByRole('article', { name: 'Assignment 1 Backprop' })
    expect(within(hidden).queryByText('46.5')).not.toBeInTheDocument()
    expect(within(hidden).getByText(/has not released the result yet/)).toBeInTheDocument()
  })

  test('shows status chips, instructions and returned notices', async () => {
    install()
    renderAt()
    const open = await screen.findByRole('article', { name: 'Project Milestone 2' })
    expect(within(open).getByText('Not submitted')).toBeInTheDocument()
    expect(within(open).getByText('Late submissions allowed')).toBeInTheDocument()
    fireEvent.click(within(open).getByRole('button', { name: 'Instructions & specs' }))
    expect(within(open).getByText('Include a Docker Compose file.')).toBeInTheDocument()
    fireEvent.click(within(open).getByRole('button', { name: 'Hide instructions' }))
    expect(within(open).queryByText('Include a Docker Compose file.')).not.toBeInTheDocument()

    const returned = screen.getByRole('article', { name: 'Consensus Notes' })
    expect(within(returned).getByText('Returned for revision', { selector: '.slpc-chip' })).toBeInTheDocument()
    expect(within(returned).getByText(/returned this for revision/)).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'Raft Simulation' })).getByText('No late submissions')).toBeInTheDocument()
  })

  test('downloads the brief and my own file through signed links', async () => {
    install()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderAt()
    const open = await screen.findByRole('article', { name: 'Project Milestone 2' })
    fireEvent.click(within(open).getByRole('button', { name: /Download brief/ }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/assignments/a1/attachment'))
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    fireEvent.click(within(screen.getByRole('article', { name: 'Lab 03 TLS Handshake' })).getByRole('button', { name: /Download my file/ }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/submissions/s3/download'))
    click.mockRestore()
  })
})

describe('submission workspace', () => {
  const pick = (name = 'work.zip', size = 4) => {
    const file = new File(['x'.repeat(size)], name, { type: 'application/octet-stream' })
    fireEvent.change(within(desk()).getByLabelText('Choose a file to submit'), { target: { files: [file] } })
    return file
  }

  test('opens the soonest open assignment and lets another one be chosen', async () => {
    install()
    renderAt()
    await screen.findByRole('article', { name: 'Project Milestone 2' })
    expect(within(desk()).getByText('Project Milestone 2')).toBeInTheDocument()
    expect(within(desk()).getByText(/Allowed formats: \.PDF, \.DOCX/)).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('article', { name: 'Raft Simulation' })).getByRole('button', { name: 'Open submission desk' }))
    expect(within(desk()).getByText('Raft Simulation')).toBeInTheDocument()
  })

  test('validates the file and the pledge before enabling submit', async () => {
    install()
    renderAt()
    await screen.findByRole('article', { name: 'Project Milestone 2' })
    const submit = within(desk()).getByRole('button', { name: 'Confirm & submit' })
    expect(submit).toBeDisabled()
    pick('virus.exe')
    expect(within(desk()).getByText(/Unsupported file type/)).toBeInTheDocument()
    pick('empty.zip', 0)
    expect(within(desk()).getByText('That file is empty.')).toBeInTheDocument()
    pick('work.zip')
    expect(within(desk()).getByTestId('chosen-file')).toHaveTextContent('work.zip')
    expect(submit).toBeDisabled()
    fireEvent.click(within(desk()).getByLabelText(/my own original work/))
    expect(submit).toBeEnabled()
  })

  test('uploads the file as multipart form data and reports the result', async () => {
    install()
    renderAt()
    await screen.findByRole('article', { name: 'Project Milestone 2' })
    const file = pick('work.zip')
    fireEvent.click(within(desk()).getByLabelText(/my own original work/))
    fireEvent.click(within(desk()).getByRole('button', { name: 'Confirm & submit' }))
    expect(await within(desk()).findByText('Submitted. Your work was recorded on time.')).toBeInTheDocument()
    const call = apiMock.mock.calls.find(([path, options]) => path === '/assignments/a1/submissions' && options?.method === 'POST')
    expect(call[1].form).toBeInstanceOf(FormData)
    expect(call[1].form.get('file')).toBe(file)
    expect(within(desk()).queryByTestId('chosen-file')).not.toBeInTheDocument()
  })

  test('warns when the deadline has passed and reports a late result', async () => {
    data.c1[0].due_at = '2026-02-22T10:00:00Z'
    install({ '/assignments/a1/submissions': () => ({ id: 'new', status: 'late' }) })
    renderAt()
    await screen.findByRole('article', { name: 'Project Milestone 2' })
    expect(within(desk()).getByText(/deadline has passed/)).toBeInTheDocument()
    pick()
    fireEvent.click(within(desk()).getByLabelText(/my own original work/))
    fireEvent.click(within(desk()).getByRole('button', { name: 'Confirm & submit' }))
    expect(await within(desk()).findByText('Submitted. Your work was recorded as late.')).toBeInTheDocument()
  })

  test('shows the server message when the upload is refused', async () => {
    install()
    renderAt()
    await screen.findByRole('article', { name: 'Project Milestone 2' })
    const original = apiMock.getMockImplementation()
    apiMock.mockImplementation(async (path, options) => {
      if (options?.method === 'POST') throw Object.assign(new Error('The deadline for this assignment has passed.'), { status: 400, code: 'DEADLINE_PASSED' })
      return original(path, options)
    })
    pick()
    fireEvent.click(within(desk()).getByLabelText(/my own original work/))
    fireEvent.click(within(desk()).getByRole('button', { name: 'Confirm & submit' }))
    expect(await within(desk()).findByText('The deadline for this assignment has passed.')).toBeInTheDocument()
    expect(within(desk()).getByRole('button', { name: 'Confirm & submit' })).toBeEnabled()
  })

  test('replaces a submission that is not graded yet, but blocks graded and closed work', async () => {
    install()
    renderAt()
    await screen.findByRole('article', { name: 'Project Milestone 2' })
    fireEvent.click(within(screen.getByRole('article', { name: 'Lab 03 TLS Handshake' })).getByRole('button', { name: 'Replace submission' }))
    expect(within(desk()).getByText('lab3.pdf')).toBeInTheDocument()
    expect(within(desk()).getByRole('button', { name: 'Confirm & replace submission' })).toBeDisabled()

    fireEvent.click(within(screen.getByRole('article', { name: 'Assignment 1 Backprop' })).getByRole('button', { name: 'View in workspace' }))
    expect(within(desk()).getByText('This work has been graded, so it can no longer be replaced.')).toBeInTheDocument()
    expect(within(desk()).queryByLabelText('Choose a file to submit')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(within(screen.getByRole('article', { name: 'Missed Quiz' })).getByRole('button', { name: 'View in workspace' }))
    expect(within(desk()).getByText('Submissions are closed for this assignment.')).toBeInTheDocument()
  })

  test('blocks replacing work that is already graded even while the assignment is open', async () => {
    data.c1[1] = { ...data.c1[1], state: 'open', closed: false, submissions_open: true }
    install()
    renderAt()
    await screen.findByRole('article', { name: 'Assignment 1 Backprop' })
    fireEvent.click(within(screen.getByRole('article', { name: 'Assignment 1 Backprop' })).getByRole('button', { name: 'View in workspace' }))
    expect(within(desk()).getByText('This work has been graded, so it can no longer be replaced.')).toBeInTheDocument()
  })
})
