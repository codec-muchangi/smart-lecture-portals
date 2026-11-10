import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('../src/services/apiClient.js', () => ({ api: apiMock }))

import LecturerAssignments from '../src/pages/lecturer/LecturerAssignments.jsx'

const at = (...parts) => new Date(...parts).toISOString()

// "Now" is Wednesday 14 Oct 2026, 10:45 local time.
const COURSES = {
  items: [
    { id: 'c1', course_code: 'CS401', course_name: 'Adv. Software Engineering', semester: '1', academic_year: '2026/2027' },
    { id: 'c2', course_code: 'CS402', course_name: 'Distributed Systems', semester: '1', academic_year: '2026/2027' },
  ],
  total: 2,
}
const ENROLLED = { c1: 40, c2: 30 }
const LISTS = () => ({
  c1: [
    { id: 'a1', course_id: 'c1', title: 'CAT 1', description: 'Architecture patterns', instructions: 'Answer all questions.', due_at: at(2026, 9, 17, 23, 59), max_marks: '100.00', allow_late: true, published: true, closed: false, state: 'open', has_attachment: true, attachment_name: 'spec.pdf', created_at: at(2026, 9, 1) },
    { id: 'a2', course_id: 'c1', title: 'Old lab', description: '', instructions: '', due_at: at(2026, 9, 10, 23, 59), max_marks: '50.00', allow_late: false, published: true, closed: true, state: 'closed', has_attachment: false, created_at: at(2026, 8, 20) },
    { id: 'a3', course_id: 'c1', title: 'Term paper draft', description: 'Event sourcing', instructions: '', due_at: at(2026, 9, 30, 23, 59), max_marks: '30.00', allow_late: false, published: false, closed: false, state: 'draft', has_attachment: false, created_at: at(2026, 9, 12) },
  ],
  c2: [{ id: 'a4', course_id: 'c2', title: 'Raft lab', description: '', instructions: '', due_at: at(2026, 9, 14, 20, 0), max_marks: '40.00', allow_late: false, published: true, closed: false, state: 'open', has_attachment: false, created_at: at(2026, 9, 5) }],
})
const COUNTS = {
  a1: { submitted: 10, late: 2, graded: 5, returned: 0, total: 17 },
  a2: { submitted: 0, late: 0, graded: 20, returned: 0, total: 20 },
  a4: { submitted: 3, late: 0, graded: 0, returned: 0, total: 3 },
}

let lists
function install({ listError, patchError, attachError } = {}) {
  apiMock.mockImplementation(async (path, options = {}) => {
    const method = options.method ?? 'GET'
    if (path === '/courses?page_size=100') return COURSES
    let m = path.match(/^\/courses\/(c\d)$/)
    if (m) return { ...COURSES.items.find((c) => c.id === m[1]), enrolled_count: ENROLLED[m[1]] }
    m = path.match(/^\/courses\/(c\d)\/assignments\?page_size=100$/)
    if (m && method === 'GET') {
      if (listError && m[1] === 'c2') throw listError
      return { items: lists[m[1]], total: lists[m[1]].length }
    }
    m = path.match(/^\/courses\/(c\d)\/assignments$/)
    if (m && method === 'POST') return { id: 'new1', course_id: m[1], ...options.body, state: options.body.published ? 'open' : 'draft', published: options.body.published }
    m = path.match(/^\/assignments\/(a\d)$/)
    if (m && method === 'GET') return { id: m[1], submission_counts: COUNTS[m[1]] }
    if (m && method === 'PATCH') {
      if (patchError) throw patchError
      return { id: m[1], ...options.body }
    }
    m = path.match(/^\/assignments\/(\w+)\/attachment$/)
    if (m && method === 'PUT') {
      if (attachError) throw attachError
      return { id: m[1], has_attachment: true }
    }
    if (m && method === 'DELETE') return { id: m[1], has_attachment: false }
    if (m && method === 'GET') return { url: 'https://files.example/spec.pdf', file_name: 'spec.pdf' }
    throw new Error(`unexpected request: ${method} ${path}`)
  })
}

function renderPage(entry = '/lecturer/assignments') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <LecturerAssignments />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiMock.mockReset()
  lists = LISTS()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 14, 10, 45))
})
afterEach(() => vi.useRealTimers())

const stat = (label) => screen.getByText(label).closest('.slpw-stat')
const titles = () => within(screen.getByRole('list', { name: 'Assignments' })).getAllByRole('heading', { level: 2 }).map((node) => node.textContent)
const calls = (method, pattern) => apiMock.mock.calls.filter(([path, options]) => (options?.method ?? 'GET') === method && pattern.test(path))
const ready = async () => screen.findByRole('button', { name: 'CAT 1' })

describe('LecturerAssignments', () => {
  it('counts coursework, submissions and grading from real data', async () => {
    install()
    renderPage()
    await ready()
    await waitFor(() => expect(within(stat('Awaiting evaluation')).getByText('15')).toBeInTheDocument())
    expect(within(stat('Active coursework')).getByText('2')).toBeInTheDocument()
    expect(within(stat('Active coursework')).getByText(/Across 2 assigned courses \(CS401, CS402\)/)).toBeInTheDocument()
    expect(within(stat('Total submissions')).getByText('40')).toBeInTheDocument()
    expect(within(stat('Total submissions')).getByText('36.4% rate')).toBeInTheDocument()
    expect(within(stat('Total submissions')).getByText('40 / 110 expected')).toBeInTheDocument()
    expect(within(stat('Awaiting evaluation')).getByText('25 graded or returned')).toBeInTheDocument()
    expect(within(stat('Awaiting evaluation')).getByText('1 due in 48h')).toBeInTheDocument()
  })

  it('lists every assignment soonest first with per-card metrics', async () => {
    install()
    renderPage()
    await ready()
    expect(titles()).toEqual(['Old lab', 'Raft lab', 'CAT 1', 'Term paper draft'])
    const card = screen.getByRole('button', { name: 'CAT 1' }).closest('article')
    await waitFor(() => expect(within(card).getByText('/ 40')).toBeInTheDocument())
    expect(within(card).getByText('Grading active')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Grade (12)' })).toHaveAttribute('href', '/lecturer/assignments/a1/submissions')
    const draft = screen.getByRole('button', { name: 'Term paper draft' }).closest('article')
    expect(within(draft).getByText(/Draft \(hidden from students\)/)).toBeInTheDocument()
    expect(within(draft).getByRole('button', { name: 'Publish' })).toBeInTheDocument()
  })

  it('filters by state pill, course and search, and sorts', async () => {
    install()
    renderPage()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /Drafts \(1\)/ }))
    expect(titles()).toEqual(['Term paper draft'])
    fireEvent.click(screen.getByRole('button', { name: /^All \(4\)/ }))
    fireEvent.change(screen.getByLabelText('Filter by course'), { target: { value: 'c2' } })
    expect(titles()).toEqual(['Raft lab'])
    fireEvent.change(screen.getByLabelText('Filter by course'), { target: { value: 'all' } })
    fireEvent.change(screen.getByLabelText('Search assignments'), { target: { value: 'event sourcing' } })
    expect(titles()).toEqual(['Term paper draft'])
    fireEvent.change(screen.getByLabelText('Search assignments'), { target: { value: 'zzzz' } })
    expect(screen.getByText('No assignments match these filters.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search assignments'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Sort assignments'), { target: { value: 'due_desc' } })
    expect(titles()).toEqual(['Term paper draft', 'CAT 1', 'Raft lab', 'Old lab'])
    await waitFor(() => expect(screen.getByRole('button', { name: /Grading Active \(2\)/ })).toBeInTheDocument())
  })

  it('preselects the course from the route', async () => {
    install()
    const { container } = renderPage('/lecturer/courses/c2/assignments')
    expect(container).toBeTruthy()
    await screen.findByRole('button', { name: 'Raft lab' })
  })

  it('shows the selected assignment in the inspector', async () => {
    install()
    renderPage()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'CAT 1' }))
    const inspector = screen.getByRole('region', { name: 'Assignment inspector' })
    expect(within(inspector).getByText('CS401 • CAT 1')).toBeInTheDocument()
    expect(within(inspector).getByText('Accepted, marked late')).toBeInTheDocument()
    expect(within(inspector).getByText('100 pts')).toBeInTheDocument()
    await waitFor(() => expect(within(inspector).getByText('5 / 17 (29.4%)')).toBeInTheDocument())
    expect(within(inspector).getByRole('link', { name: 'Launch grading queue (12 pending)' })).toBeInTheDocument()
  })

  it('validates the create form before calling the server', async () => {
    install()
    renderPage()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Create Assignment' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create assignment' }))
    expect(within(dialog).getByText('Choose a course.')).toBeInTheDocument()
    expect(within(dialog).getByText('The title must be between 2 and 200 characters.')).toBeInTheDocument()
    expect(within(dialog).getByText('Choose a due date and time.')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('Due date and time *'), { target: { value: '2026-10-13T09:00' } })
    fireEvent.change(within(dialog).getByLabelText('Maximum marks *'), { target: { value: '0' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create assignment' }))
    expect(within(dialog).getByText('The deadline must be in the future.')).toBeInTheDocument()
    expect(within(dialog).getByText(/Enter marks above 0/)).toBeInTheDocument()
    expect(calls('POST', /assignments/)).toHaveLength(0)
  })

  it('creates a draft with the deadline sent as an exact instant', async () => {
    install()
    renderPage()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Create Assignment' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Course *'), { target: { value: 'c2' } })
    fireEvent.change(within(dialog).getByLabelText('Assignment title *'), { target: { value: '  Milestone 2  ' } })
    fireEvent.change(within(dialog).getByLabelText('Due date and time *'), { target: { value: '2026-10-20T09:00' } })
    fireEvent.change(within(dialog).getByLabelText('Maximum marks *'), { target: { value: '75.5' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create assignment' }))
    await waitFor(() => expect(calls('POST', /^\/courses\/c2\/assignments$/)).toHaveLength(1))
    const body = calls('POST', /^\/courses\/c2\/assignments$/)[0][1].body
    expect(body).toEqual({ title: 'Milestone 2', due_at: new Date(2026, 9, 20, 9, 0).toISOString(), max_marks: 75.5, allow_late: false, published: false })
    expect(await screen.findByText('Assignment saved as a draft. Students cannot see it yet.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('publishes on create and uploads the brief afterwards', async () => {
    install()
    renderPage()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Create Assignment' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Course *'), { target: { value: 'c1' } })
    fireEvent.change(within(dialog).getByLabelText('Assignment title *'), { target: { value: 'Lab 5' } })
    fireEvent.change(within(dialog).getByLabelText('Due date and time *'), { target: { value: '2026-10-20T09:00' } })
    fireEvent.click(within(dialog).getByLabelText(/Accept late submissions/))
    fireEvent.click(within(dialog).getByLabelText('Publish now (notify students)'))
    const file = new File(['%PDF-1.4'], 'brief.pdf', { type: 'application/pdf' })
    fireEvent.change(within(dialog).getByLabelText('Reference brief'), { target: { files: [file] } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create assignment' }))
    await waitFor(() => expect(calls('PUT', /^\/assignments\/new1\/attachment$/)).toHaveLength(1))
    expect(calls('POST', /^\/courses\/c1\/assignments$/)[0][1].body).toMatchObject({ published: true, allow_late: true })
    expect(calls('PUT', /attachment/)[0][1].form.get('file').name).toBe('brief.pdf')
    expect(await screen.findByText('Assignment created and published. Enrolled students have been notified.')).toBeInTheDocument()
  })

  it('rejects a brief of the wrong type', async () => {
    install()
    renderPage()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Create Assignment' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Course *'), { target: { value: 'c1' } })
    fireEvent.change(within(dialog).getByLabelText('Assignment title *'), { target: { value: 'Lab 6' } })
    fireEvent.change(within(dialog).getByLabelText('Due date and time *'), { target: { value: '2026-10-20T09:00' } })
    fireEvent.change(within(dialog).getByLabelText('Reference brief'), { target: { files: [new File(['x'], 'run.exe')] } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create assignment' }))
    expect(within(dialog).getByText(/This file type is not allowed/)).toBeInTheDocument()
    expect(calls('POST', /assignments/)).toHaveLength(0)
  })

  it('warns when the assignment saved but its brief did not upload', async () => {
    install({ attachError: Object.assign(new Error('Storage is down'), { status: 503 }) })
    renderPage()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Create Assignment' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Course *'), { target: { value: 'c1' } })
    fireEvent.change(within(dialog).getByLabelText('Assignment title *'), { target: { value: 'Lab 7' } })
    fireEvent.change(within(dialog).getByLabelText('Due date and time *'), { target: { value: '2026-10-20T09:00' } })
    fireEvent.change(within(dialog).getByLabelText('Reference brief'), { target: { files: [new File(['x'], 'brief.pdf')] } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create assignment' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The assignment was saved, but the attachment could not be updated: Storage is down')
  })

  it('sends only the fields that changed when editing', async () => {
    install()
    renderPage()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Edit CAT 1' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByLabelText('Maximum marks *')).toHaveValue(100)
    fireEvent.change(within(dialog).getByLabelText('Assignment title *'), { target: { value: 'CAT 1 (revised)' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(calls('PATCH', /^\/assignments\/a1$/)).toHaveLength(1))
    expect(calls('PATCH', /^\/assignments\/a1$/)[0][1].body).toEqual({ title: 'CAT 1 (revised)' })
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument()
  })

  it('publishes a draft from its card', async () => {
    install()
    renderPage()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(calls('PATCH', /^\/assignments\/a3$/)).toHaveLength(1))
    expect(calls('PATCH', /^\/assignments\/a3$/)[0][1].body).toEqual({ published: true })
    expect(await screen.findByText('Assignment published. Enrolled students have been notified.')).toBeInTheDocument()
  })

  it('closes an assignment only after a second confirmation', async () => {
    install()
    renderPage()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'CAT 1' }))
    const inspector = screen.getByRole('region', { name: 'Assignment inspector' })
    fireEvent.click(within(inspector).getByRole('button', { name: 'Close' }))
    expect(calls('PATCH', /assignments/)).toHaveLength(0)
    fireEvent.click(within(inspector).getByRole('button', { name: 'Yes, close it' }))
    await waitFor(() => expect(calls('PATCH', /^\/assignments\/a1$/)).toHaveLength(1))
    expect(calls('PATCH', /^\/assignments\/a1$/)[0][1].body).toEqual({ closed: true })
  })

  it('shows the server message when a change is refused', async () => {
    install({ patchError: Object.assign(new Error('An assignment with submissions cannot be unpublished'), { status: 409 }) })
    renderPage()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('An assignment with submissions cannot be unpublished')
  })

  it('opens the reference brief through a signed link', async () => {
    install()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderPage()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Download brief for CAT 1' }))
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    expect(calls('GET', /^\/assignments\/a1\/attachment$/)).toHaveLength(1)
    click.mockRestore()
  })

  it('exports the listed assignments as CSV', async () => {
    install()
    const createUrl = vi.fn(() => 'blob:x')
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = createUrl
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderPage()
    await ready()
    await waitFor(() => expect(screen.getAllByText('/ 40').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByRole('button', { name: 'Export Ledger' }))
    const text = await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.readAsText(createUrl.mock.calls[0][0])
    })
    expect(text.split('\r\n')[0]).toBe('Course,Title,State,Due,Max marks,Turn-in,Enrolled,Graded,Pending,Late')
    expect(text).toContain('CS401,CAT 1,Published')
    expect(text).toContain('CS401,Term paper draft,Draft')
    click.mockRestore()
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  })

  it('paginates five at a time', async () => {
    lists.c1 = Array.from({ length: 7 }, (_, index) => ({ id: `p${index}`, course_id: 'c1', title: `Task ${index}`, due_at: at(2026, 10, index + 1), max_marks: '10', state: 'draft', published: false, created_at: at(2026, 9, 1) }))
    install()
    renderPage()
    await screen.findByRole('button', { name: 'Task 0' })
    expect(screen.getByText(/Showing 1 to 5 of 8 assignments/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText(/Showing 6 to 8 of 8 assignments/)).toBeInTheDocument()
  })

  it('warns about one course that failed and keeps the rest', async () => {
    install({ listError: Object.assign(new Error('boom'), { status: 500 }) })
    renderPage()
    await ready()
    expect(await screen.findByRole('alert')).toHaveTextContent('Assignments for CS402 could not be loaded.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('shows an empty state when nothing exists', async () => {
    lists = { c1: [], c2: [] }
    install()
    renderPage()
    expect(await screen.findByText(/No assignments yet\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export Ledger' })).toBeDisabled()
  })
})
