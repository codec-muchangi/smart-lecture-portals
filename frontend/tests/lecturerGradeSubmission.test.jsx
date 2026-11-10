import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { configure } from '@testing-library/react'
import { vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('../src/services/apiClient.js', () => ({ api: apiMock }))

import LecturerGradeSubmission from '../src/pages/lecturer/LecturerGradeSubmission.jsx'

// Slow machines load this page cold on the first test, so allow generous waits.
configure({ asyncUtilTimeout: 5000 })
vi.setConfig({ testTimeout: 15000 })

const at = (...parts) => new Date(...parts).toISOString()

const ASSIGNMENT = {
  id: 'a1',
  course_id: 'c1',
  title: 'Milestone 1: Raft',
  description: 'Short description',
  instructions: 'Implement log compaction.',
  due_at: at(2026, 9, 3, 0, 0),
  max_marks: '100.00',
  state: 'open',
  submission_counts: { submitted: 1, late: 1, graded: 1, returned: 1, total: 4 },
}
const COURSES = { items: [{ id: 'c1', course_code: 'CS402', course_name: 'Distributed Systems' }], total: 1 }
const base = { assignment_id: 'a1', mime_type: 'application/zip', file_size: 14900000, mark: null, feedback: null, grade_released: false }
const SUBMISSIONS = () => [
  { ...base, id: 's1', student_id: 'u1', student_name: 'Alex Chen', registration_number: 'STU-8821', email: 'alex@uni.test', file_name: 'alex.zip', status: 'submitted', submitted_at: at(2026, 9, 2, 14, 19) },
  { ...base, id: 's2', student_id: 'u2', student_name: 'Bea Otieno', registration_number: 'STU-8822', email: 'bea@uni.test', file_name: 'bea.zip', status: 'late', submitted_at: at(2026, 9, 3, 2, 5) },
  { ...base, id: 's3', student_id: 'u3', student_name: 'Cy Mwangi', registration_number: 'STU-8823', email: 'cy@uni.test', file_name: 'cy.zip', status: 'graded', mark: 80, feedback: 'Solid work', grade_released: true, submitted_at: at(2026, 9, 1, 9, 0) },
  { ...base, id: 's4', student_id: 'u4', student_name: 'Dee Kamau', registration_number: 'STU-8824', email: 'dee@uni.test', file_name: 'dee.zip', status: 'returned', feedback: 'Redo part 2', submitted_at: at(2026, 9, 4, 9, 0) },
]

let rows
function install({ items, assignmentError, patchError, bulkUpdated = 2 } = {}) {
  rows = items ?? SUBMISSIONS()
  apiMock.mockImplementation(async (path, options = {}) => {
    const method = options.method ?? 'GET'
    if (path === '/courses?page_size=100') return COURSES
    if (path === '/assignments/a1' && method === 'GET') {
      if (assignmentError) throw assignmentError
      return ASSIGNMENT
    }
    if (path === '/assignments/a1/submissions?page=1&page_size=100') return { items: rows, total: rows.length }
    let m = path.match(/^\/submissions\/(s\d)\/grade$/)
    if (m && method === 'PATCH') {
      if (patchError) throw patchError
      const body = options.body
      if (body.return_for_revision) return { id: m[1], status: 'returned', mark: null, feedback: body.feedback, grade_released: false }
      return { id: m[1], status: 'graded', mark: body.mark, feedback: body.feedback || null, grade_released: body.release }
    }
    m = path.match(/^\/submissions\/(s\d)\/download$/)
    if (m) return { url: 'https://files.example/x.zip', file_name: 'x.zip' }
    if (path === '/assignments/a1/grades/release' && method === 'POST') return { updated: bulkUpdated }
    throw new Error(`unexpected request: ${method} ${path}`)
  })
}

function renderPage(entry = '/lecturer/assignments/a1/submissions') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/lecturer/assignments/:assignmentId/submissions" element={<LecturerGradeSubmission />} />
          <Route path="/lecturer/assignments" element={<p>assignments list</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiMock.mockReset()
})

const ready = async (name = 'Alex Chen') => screen.findByText(name)
const calls = (method, pattern) => apiMock.mock.calls.filter(([path, options]) => (options?.method ?? 'GET') === method && pattern.test(path))
const identity = () => within(screen.getByLabelText('Student identity'))
const markInput = () => screen.getByRole('spinbutton', { name: 'Awarded mark' })

describe('LecturerGradeSubmission', () => {
  it('opens the first ungraded candidate with real details', async () => {
    install()
    renderPage()
    await ready()
    expect(screen.getByRole('heading', { level: 1, name: 'Milestone 1: Raft' })).toBeInTheDocument()
    expect(await screen.findByText('CS402')).toBeInTheDocument()
    expect(screen.getByText(/Candidate 2 of 4/)).toBeInTheDocument()
    expect(screen.getByText('(Ungraded)')).toBeInTheDocument()
    expect(screen.getByText('STU-8821')).toBeInTheDocument()
    expect(screen.getByText('alex@uni.test')).toBeInTheDocument()
    expect(screen.getByText('9h 41m before the deadline')).toBeInTheDocument()
    expect(identity().getByText('Pending Evaluation')).toBeInTheDocument()
    expect(screen.getByText('100 pts')).toBeInTheDocument()
    expect(screen.getByText('Implement log compaction.')).toBeInTheDocument()
    expect(screen.getByText('alex.zip')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Download Submission/ })).toBeInTheDocument()
  })

  it('marks a late hand-in with how long after the deadline it arrived', async () => {
    install()
    renderPage('/lecturer/assignments/a1/submissions?submission=s2')
    await ready('Bea Otieno')
    expect(identity().getByText('Late · Pending')).toBeInTheDocument()
    expect(screen.getByText('2h 5m after the deadline')).toBeInTheDocument()
  })

  it('moves between candidates with the arrows, the picker and Next to grade', async () => {
    install()
    renderPage()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Next candidate' }))
    expect(await screen.findByText('Bea Otieno')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Previous candidate' }))
    expect(await screen.findByText('STU-8821')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Jump to a student'), { target: { value: 's3' } })
    expect(await screen.findByText('Cy Mwangi')).toBeInTheDocument()
    expect(screen.getByText(/Candidate 1 of 4/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous candidate' })).toBeDisabled()
    expect(markInput()).toHaveValue(80)
    fireEvent.click(screen.getByRole('button', { name: /Next to grade/ }))
    expect(await screen.findByText('STU-8821')).toBeInTheDocument()
  })

  it('saves a draft grade without releasing it', async () => {
    install()
    renderPage()
    await ready()
    fireEvent.change(markInput(), { target: { value: '88' } })
    fireEvent.change(screen.getByLabelText('Feedback for the student'), { target: { value: ' Good work ' } })
    expect(screen.getByRole('img', { name: '88 percent of the marks' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save Grade as Draft' }))
    expect(await screen.findByText(/Draft grade saved for Alex Chen/)).toBeInTheDocument()
    const [, options] = calls('PATCH', /grade$/)[0]
    expect(options.body).toEqual({ mark: 88, feedback: 'Good work', release: false })
    expect(await identity().findByText('Graded')).toBeInTheDocument()
    expect(screen.getByText('Grade hidden')).toBeInTheDocument()
  })

  it('releases a grade straight to the student', async () => {
    install()
    renderPage()
    await ready()
    fireEvent.change(markInput(), { target: { value: '72.5' } })
    fireEvent.click(screen.getByRole('radio', { name: /Save & Release Immediately/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save & Release to Student' }))
    expect(await screen.findByText(/Grade released to Alex Chen/)).toBeInTheDocument()
    expect(calls('PATCH', /grade$/)[0][1].body).toEqual({ mark: 72.5, feedback: '', release: true })
    expect(await screen.findByText('Grade released')).toBeInTheDocument()
  })

  it('rejects marks outside the range or with too many decimals before calling the server', async () => {
    install()
    renderPage()
    await ready()
    fireEvent.change(markInput(), { target: { value: '120' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Grade as Draft' }))
    expect(await screen.findByText('A mark must be between 0 and 100.')).toBeInTheDocument()
    fireEvent.change(markInput(), { target: { value: '55.555' } })
    expect(screen.getByText('Use at most 2 decimal places.')).toBeInTheDocument()
    fireEvent.change(markInput(), { target: { value: '' } })
    expect(screen.getByText('Enter a mark between 0 and 100.')).toBeInTheDocument()
    expect(calls('PATCH', /grade$/)).toHaveLength(0)
  })

  it('shows the server message when saving fails', async () => {
    install({ patchError: Object.assign(new Error('This course is archived.'), { status: 409 }) })
    renderPage()
    await ready()
    fireEvent.change(markInput(), { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Grade as Draft' }))
    expect(await screen.findByText('This course is archived.')).toBeInTheDocument()
    expect(screen.queryByText(/Draft grade saved/)).not.toBeInTheDocument()
  })

  it('disables saving a graded submission until something changes', async () => {
    install()
    renderPage('/lecturer/assignments/a1/submissions?submission=s3')
    await ready('Cy Mwangi')
    const save = screen.getByRole('button', { name: 'Save & Release to Student' })
    expect(save).toBeDisabled()
    expect(screen.getByText('No changes to save.')).toBeInTheDocument()
    fireEvent.change(markInput(), { target: { value: '85' } })
    expect(save).toBeEnabled()
  })

  it('returns work for revision only with written instructions', async () => {
    install()
    renderPage()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /Return Deliverable for Revision/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Return for Revision' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm & Return' }))
    expect(within(dialog).getByText(/Tell the student what to change/)).toBeInTheDocument()
    expect(calls('PATCH', /grade$/)).toHaveLength(0)
    fireEvent.change(within(dialog).getByLabelText('Revision instructions'), { target: { value: 'Add tests for snapshots' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm & Return' }))
    expect(await screen.findByText(/Work returned to Alex Chen/)).toBeInTheDocument()
    expect(calls('PATCH', /grade$/)[0][1].body).toEqual({ return_for_revision: true, feedback: 'Add tests for snapshots' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await identity().findByText('Returned for Revision')).toBeInTheDocument()
  })

  it('closes the revision dialog with Escape', async () => {
    install()
    renderPage()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /Return Deliverable for Revision/ }))
    await screen.findByRole('dialog')
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('downloads the student file through a signed link', async () => {
    install()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderPage()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: /Download Submission/ }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(calls('GET', /^\/submissions\/s1\/download$/)).toHaveLength(1)
    click.mockRestore()
  })

  it('releases every graded submission after a confirmation, and reports a no-op', async () => {
    install()
    renderPage()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Release all graded' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: release all graded' }))
    expect(await screen.findByText('2 graded submissions are now visible to students.')).toBeInTheDocument()
    expect(calls('POST', /grades\/release$/)[0][1].body).toEqual({ released: true })
  })

  it('says so when nothing needed changing', async () => {
    install({ bulkUpdated: 0 })
    renderPage()
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Hide all graded' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: hide all graded' }))
    expect(await screen.findByText(/Nothing to change: every graded submission is already hidden/)).toBeInTheDocument()
    expect(calls('POST', /grades\/release$/)[0][1].body).toEqual({ released: false })
  })

  it('keeps bulk release off until something is graded', async () => {
    install({ items: SUBMISSIONS().slice(0, 2) })
    renderPage()
    await ready()
    expect(screen.getByRole('button', { name: 'Release all graded' })).toBeDisabled()
  })

  it('shows an empty state when nobody has submitted', async () => {
    install({ items: [] })
    renderPage()
    expect(await screen.findByText('No submissions yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next candidate' })).not.toBeInTheDocument()
  })

  it('explains a missing assignment and offers a way back', async () => {
    install({ assignmentError: Object.assign(new Error('Not found'), { status: 404 }) })
    renderPage()
    expect(await screen.findByText(/This assignment could not be found/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to assignments' })).toHaveAttribute('href', '/lecturer/assignments')
  })
})
