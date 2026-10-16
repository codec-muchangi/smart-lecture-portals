import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('../src/services/apiClient.js', () => ({ api: apiMock }))

import LecturerMarks from '../src/pages/lecturer/LecturerMarks.jsx'

const COURSES = {
  items: [
    { id: 'c1', course_code: 'CS401', course_name: 'Advanced Software Engineering', status: 'active' },
    { id: 'c2', course_code: 'CS402', course_name: 'Cloud Architecture', status: 'active' },
  ],
  total: 2,
}
const ENROLLED = { c1: 4, c2: 64 }
const STUDENTS = {
  s1: { student_id: 's1', full_name: 'Elena Rostova', registration_number: 'REG-0842', email: 'e@uni.edu' },
  s2: { student_id: 's2', full_name: 'Tariq Al-Mansoor', registration_number: 'REG-0914', email: 't@uni.edu' },
  s3: { student_id: 's3', full_name: 'Chloe Bennett', registration_number: 'REG-0775', email: 'c@uni.edu' },
  s4: { student_id: 's4', full_name: 'Marcus Vance', registration_number: 'REG-0621', email: 'm@uni.edu' },
}
const row = (id, mark, feedback = null) => ({ ...STUDENTS[id], mark, feedback, updated_at: mark === null ? null : '2026-10-01T10:00:00Z' })

let assessments
let rosters

function seed() {
  assessments = {
    c1: [
      { id: 'x1', course_id: 'c1', name: 'CAT 1: Distributed Systems', type: 'cat', max_marks: 30, weight: 15, published: true, marks_entered: 4 },
      { id: 'x2', course_id: 'c1', name: 'Assignment #02: OpenTelemetry', type: 'assignment', max_marks: 100, weight: 20, published: true, marks_entered: 4 },
      { id: 'x3', course_id: 'c1', name: 'Practical Lab #02', type: 'practical', max_marks: 50, weight: 20, published: false, marks_entered: 3 },
    ],
    c2: [],
  }
  rosters = {
    x1: [row('s3', 27), row('s1', 28), row('s4', 20), row('s2', 24)],
    x2: [row('s3', 85), row('s1', 95), row('s4', 60), row('s2', 80)],
    x3: [row('s3', 48.5), row('s1', 46, 'Great work'), row('s4', null), row('s2', 42)],
  }
}

function install(overrides = {}) {
  apiMock.mockImplementation(async (path, options = {}) => {
    if (path in overrides) {
      const value = overrides[path]
      if (value instanceof Error) throw value
      return value
    }
    if (path === '/courses?page_size=100') return COURSES
    let m = path.match(/^\/courses\/(c\d)$/)
    if (m) return { ...COURSES.items.find((c) => c.id === m[1]), enrolled_count: ENROLLED[m[1]] }
    m = path.match(/^\/courses\/(c\d)\/assessments\?page_size=100$/)
    if (m) return { items: assessments[m[1]], total: assessments[m[1]].length }
    m = path.match(/^\/courses\/(c\d)\/assessments$/)
    if (m && options.method === 'POST') {
      assessments[m[1]] = [...assessments[m[1]], { id: 'x9', course_id: m[1], published: false, marks_entered: 0, weight: null, ...options.body }]
      rosters.x9 = []
      return {}
    }
    m = path.match(/^\/assessments\/(x\d)\/marks\?page_size=200$/)
    if (m) return { items: rosters[m[1]] ?? [], total: (rosters[m[1]] ?? []).length }
    m = path.match(/^\/assessments\/(x\d)\/marks$/)
    if (m && options.method === 'PUT') {
      let created = 0
      let updated = 0
      options.body.marks.forEach((entry) => {
        const found = rosters[m[1]].find((r) => r.student_id === entry.student_id)
        if (found.mark === null) created += 1
        else updated += 1
        found.mark = entry.mark
        found.feedback = entry.feedback || null
      })
      return { created, updated, unchanged: 0, total: options.body.marks.length }
    }
    m = path.match(/^\/assessments\/(x\d)$/)
    if (m && options.method === 'PATCH') {
      const target = Object.values(assessments).flat().find((item) => item.id === m[1])
      Object.assign(target, options.body)
      return {}
    }
    throw new Error(`unexpected request: ${path}`)
  })
}

function renderAt(url) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/lecturer/marks" element={<LecturerMarks />} />
          <Route path="/lecturer/courses/:courseId/marks" element={<LecturerMarks />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const sheet = () => screen.getByRole('region', { name: /Marks sheet for/ })
const componentTitles = () => screen.queryAllByRole('heading', { level: 3 }).map((node) => node.textContent).filter((text) => !/Assessment components/.test(text))

beforeEach(() => {
  apiMock.mockReset()
  seed()
})

describe('overview', () => {
  test('shows the course, summary figures and the first marks sheet from real data', async () => {
    install()
    renderAt('/lecturer/marks')
    expect(await screen.findByText('Marks sheet for CAT 1: Distributed Systems', { selector: 'h2' }).catch(() => null)).toBeNull()
    expect(await screen.findByRole('region', { name: 'Marks sheet for CAT 1: Distributed Systems' })).toBeInTheDocument()
    const summary = screen.getByLabelText('Assessment summary')
    expect(within(summary).getByText('3')).toBeInTheDocument()
    expect(within(summary).getByText('55% weight')).toBeInTheDocument()
    expect(within(summary).getByText('4 / 4')).toBeInTheDocument()
    expect(within(summary).getByText('2 Pub • 1 Draft')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /CS401: Advanced Software Engineering/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('4 Enrolled')).toBeInTheDocument()
    expect(screen.queryByText(/SHA-256|Cryptographic|FR-MARK/i)).not.toBeInTheDocument()
  })

  test('calculates mean, spread, pass rate and the distribution for the open sheet', async () => {
    install()
    renderAt('/lecturer/marks')
    await screen.findByRole('region', { name: /Marks sheet for CAT 1/ })
    fireEvent.click(screen.getAllByRole('button', { name: /^Marks sheet$/ })[1])
    const open = await screen.findByRole('region', { name: 'Marks sheet for Practical Lab #02' })
    expect(open).toBeInTheDocument()
    const summary = screen.getByLabelText('Assessment summary')
    expect(within(summary).getByText('91.0%')).toBeInTheDocument()
    expect(within(summary).getByText('StdDev ±5.4')).toBeInTheDocument()
    expect(within(summary).getByText('High 97.0% • Low 84.0%')).toBeInTheDocument()
    expect(within(summary).getByText('100.0% passing')).toBeInTheDocument()
    expect(within(summary).getByText('1 pending in Practical Lab #02')).toBeInTheDocument()
    const chart = screen.getByRole('img', { name: /80%\+: 3/ })
    expect(chart).toBeInTheDocument()
  })

  test('preselects the course from the route and switches course', async () => {
    install()
    renderAt('/lecturer/courses/c2/marks')
    expect(await screen.findByText(/No assessments yet for this course/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /CS401: Advanced Software Engineering/ }))
    expect(await screen.findByRole('region', { name: /Marks sheet for CAT 1/ })).toBeInTheDocument()
  })

  test('filters by type, drafts and search, and sorts', async () => {
    install()
    renderAt('/lecturer/marks')
    await screen.findByRole('region', { name: /Marks sheet for CAT 1/ })
    expect(componentTitles()).toEqual(['CAT 1: Distributed Systems', 'Assignment #02: OpenTelemetry', 'Practical Lab #02'])

    fireEvent.click(screen.getByRole('tab', { name: /Drafts pending release \(1\)/ }))
    expect(componentTitles()).toEqual(['Practical Lab #02'])
    fireEvent.click(screen.getByRole('tab', { name: /^Assignments/ }))
    expect(componentTitles()).toEqual(['Assignment #02: OpenTelemetry'])
    fireEvent.click(screen.getByRole('tab', { name: /^All components/ }))

    fireEvent.change(screen.getByLabelText('Search assessments'), { target: { value: 'zzz' } })
    expect(screen.getByText('No assessments match these filters.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search assessments'), { target: { value: 'cat' } })
    expect(componentTitles()).toEqual(['CAT 1: Distributed Systems'])
    fireEvent.change(screen.getByLabelText('Search assessments'), { target: { value: '' } })

    fireEvent.change(screen.getByLabelText('Sort assessments'), { target: { value: 'weight' } })
    expect(componentTitles()[0]).not.toBe('CAT 1: Distributed Systems')
    fireEvent.change(screen.getByLabelText('Sort assessments'), { target: { value: 'completion' } })
    expect(componentTitles()[0]).toBe('Practical Lab #02')
  })

  test('shows courses error with retry, no-courses and assessment error states', async () => {
    install({ '/courses?page_size=100': { items: [], total: 0 } })
    const first = renderAt('/lecturer/marks')
    expect(await screen.findByText(/not assigned to any courses/)).toBeInTheDocument()
    first.unmount()

    install({ '/courses?page_size=100': new Error('down') })
    const second = renderAt('/lecturer/marks')
    const retry = await screen.findByRole('button', { name: /try again/i })
    install()
    fireEvent.click(retry)
    expect(await screen.findByRole('region', { name: /Marks sheet for CAT 1/ })).toBeInTheDocument()
    second.unmount()

    install({ '/courses/c1/assessments?page_size=100': new Error('boom') })
    renderAt('/lecturer/marks')
    expect(await screen.findByText('The assessments for this course could not be loaded.')).toBeInTheDocument()
  })
})

describe('marks sheet', () => {
  const open = async () => {
    install()
    renderAt('/lecturer/marks')
    await screen.findByRole('region', { name: /Marks sheet for CAT 1/ })
    fireEvent.click(screen.getAllByRole('button', { name: /^Marks sheet$/ })[1])
    await screen.findByRole('region', { name: 'Marks sheet for Practical Lab #02' })
  }

  test('validates before sending anything', async () => {
    await open()
    const mark = (name) => within(sheet()).getByLabelText(`Mark for ${name}`)
    fireEvent.change(mark('Marcus Vance'), { target: { value: '51' } })
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Save marks' }))
    expect(within(sheet()).getByText('Enter a mark from 0 to 50.')).toBeInTheDocument()

    fireEvent.change(mark('Marcus Vance'), { target: { value: '' } })
    fireEvent.change(within(sheet()).getByLabelText('Feedback for Marcus Vance'), { target: { value: 'Viva pending' } })
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Save marks' }))
    expect(within(sheet()).getByText('Enter a mark before adding feedback.')).toBeInTheDocument()

    fireEvent.change(mark('Elena Rostova'), { target: { value: '' } })
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Save marks' }))
    expect(within(sheet()).getByText('A saved mark cannot be removed. Enter the correct mark instead.')).toBeInTheDocument()

    fireEvent.change(mark('Elena Rostova'), { target: { value: '46.123' } })
    fireEvent.change(within(sheet()).getByLabelText('Feedback for Marcus Vance'), { target: { value: '' } })
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Save marks' }))
    expect(within(sheet()).getByText('Use at most 2 decimal places.')).toBeInTheDocument()
    expect(apiMock.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false)
  })

  test('saves only the changed rows, then shows the result and refreshes', async () => {
    await open()
    fireEvent.change(within(sheet()).getByLabelText('Mark for Marcus Vance'), { target: { value: '38' } })
    fireEvent.change(within(sheet()).getByLabelText('Feedback for Marcus Vance'), { target: { value: 'Late viva' } })
    fireEvent.change(within(sheet()).getByLabelText('Mark for Elena Rostova'), { target: { value: '47.5' } })
    expect(within(sheet()).getAllByText('Unsaved')).toHaveLength(2)
    expect(within(sheet()).getByText('2 rows changed.', { exact: false })).toBeInTheDocument()
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Save marks' }))

    expect(await within(sheet()).findByText('Saved: 1 new, 1 updated, 0 unchanged.')).toBeInTheDocument()
    const call = apiMock.mock.calls.find(([path, options]) => path === '/assessments/x3/marks' && options?.method === 'PUT')
    expect(call[1].body.marks).toEqual([
      { student_id: 's1', mark: 47.5, feedback: 'Great work' },
      { student_id: 's4', mark: 38, feedback: 'Late viva' },
    ])
    await waitFor(() => expect(within(sheet()).queryAllByText('Not marked')).toHaveLength(0))
    expect(within(sheet()).getByText('4 / 4 (100.0%)')).toBeInTheDocument()
  })

  test('discards unsaved changes', async () => {
    await open()
    fireEvent.change(within(sheet()).getByLabelText('Mark for Marcus Vance'), { target: { value: '38' } })
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Discard changes' }))
    expect(within(sheet()).getByLabelText('Mark for Marcus Vance')).toHaveValue(null)
    expect(within(sheet()).getByRole('button', { name: 'Save marks' })).toBeDisabled()
  })

  test('maps server row errors back onto the rows', async () => {
    await open()
    fireEvent.change(within(sheet()).getByLabelText('Mark for Marcus Vance'), { target: { value: '38' } })
    const original = apiMock.getMockImplementation()
    apiMock.mockImplementation(async (path, options) => {
      if (options?.method === 'PUT') throw Object.assign(new Error('Some marks were rejected'), { details: { rows: [{ index: 0, student_id: 's4', message: 'Student is not actively enrolled' }] } })
      return original(path, options)
    })
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Save marks' }))
    expect(await within(sheet()).findByText('Student is not actively enrolled')).toBeInTheDocument()
    expect(within(sheet()).getByText('Some marks were rejected')).toBeInTheDocument()
  })
})

describe('assessments', () => {
  test('creates a draft assessment with validation', async () => {
    install()
    renderAt('/lecturer/marks')
    await screen.findByRole('region', { name: /Marks sheet for CAT 1/ })
    fireEvent.click(screen.getByRole('button', { name: /New assessment/ }))
    const form = screen.getByRole('form', { name: 'New assessment' })
    fireEvent.click(within(form).getByRole('button', { name: 'Create assessment' }))
    expect(within(form).getByText(/The name must be between 2 and 100 characters/)).toBeInTheDocument()
    expect(within(form).getByText(/Maximum marks must be above 0/)).toBeInTheDocument()

    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'CAT 2' } })
    fireEvent.change(within(form).getByLabelText('Maximum marks'), { target: { value: '40' } })
    fireEvent.change(within(form).getByLabelText('Weight % (optional)'), { target: { value: '60' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Create assessment' }))
    expect(within(form).getByText('Only 45% of the weight is still free.')).toBeInTheDocument()

    fireEvent.change(within(form).getByLabelText('Weight % (optional)'), { target: { value: '25' } })
    fireEvent.change(within(form).getByLabelText('Type'), { target: { value: 'exam' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Create assessment' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/courses/c1/assessments', { method: 'POST', body: { name: 'CAT 2', type: 'exam', max_marks: 40, weight: 25 } }))
    expect(await screen.findByText('Assessment created as a draft. Release it when you are ready.')).toBeInTheDocument()
    expect(await screen.findByRole('article', { name: 'CAT 2' })).toBeInTheDocument()
  })

  test('shows the server message when creation is refused', async () => {
    install()
    renderAt('/lecturer/marks')
    await screen.findByRole('region', { name: /Marks sheet for CAT 1/ })
    fireEvent.click(screen.getByRole('button', { name: /New assessment/ }))
    const form = screen.getByRole('form', { name: 'New assessment' })
    const original = apiMock.getMockImplementation()
    apiMock.mockImplementation(async (path, options) => {
      if (options?.method === 'POST') throw new Error('Weights would exceed 100')
      return original(path, options)
    })
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'CAT 2' } })
    fireEvent.change(within(form).getByLabelText('Maximum marks'), { target: { value: '40' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Create assessment' }))
    expect(await within(form).findByText('Weights would exceed 100')).toBeInTheDocument()
  })

  test('edits an assessment', async () => {
    install()
    renderAt('/lecturer/marks')
    await screen.findByRole('region', { name: /Marks sheet for CAT 1/ })
    const card = screen.getByRole('article', { name: 'Practical Lab #02' })
    fireEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    const form = screen.getByRole('form', { name: 'Edit Practical Lab #02' })
    fireEvent.change(within(form).getByLabelText('Maximum marks'), { target: { value: '0' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    expect(within(form).getByText(/Maximum marks must be above 0/)).toBeInTheDocument()

    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Practical Lab #02 (v2)' } })
    fireEvent.change(within(form).getByLabelText('Maximum marks'), { target: { value: '60' } })
    fireEvent.change(within(form).getByLabelText('Weight %'), { target: { value: '' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/assessments/x3', { method: 'PATCH', body: { name: 'Practical Lab #02 (v2)', type: 'practical', max_marks: 60, weight: null } }))
    expect(await screen.findByRole('article', { name: 'Practical Lab #02 (v2)' })).toBeInTheDocument()
  })

  test('releases and withholds a single assessment, and reports failures', async () => {
    install()
    renderAt('/lecturer/marks')
    await screen.findByRole('region', { name: /Marks sheet for CAT 1/ })
    const draft = screen.getByRole('article', { name: 'Practical Lab #02' })
    fireEvent.click(within(draft).getByRole('button', { name: 'Release' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/assessments/x3', { method: 'PATCH', body: { published: true } }))
    expect(await screen.findByText('3 Pub • 0 Draft')).toBeInTheDocument()

    const original = apiMock.getMockImplementation()
    apiMock.mockImplementation(async (path, options) => {
      if (options?.method === 'PATCH') throw new Error('Forbidden')
      return original(path, options)
    })
    fireEvent.click(within(screen.getByRole('article', { name: 'CAT 1: Distributed Systems' })).getByRole('button', { name: 'Withhold' }))
    expect(await screen.findByText('Forbidden')).toBeInTheDocument()
  })

  test('releases all drafts only after confirmation', async () => {
    install()
    renderAt('/lecturer/marks')
    await screen.findByRole('region', { name: /Marks sheet for CAT 1/ })
    fireEvent.click(screen.getByRole('button', { name: /Release marks/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Not yet' }))
    expect(apiMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: /Release marks/ }))
    expect(screen.getByText(/Release 1 draft assessment to students/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, release' }))
    expect(await screen.findByText('Released 1 assessment to students.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Release marks/ })).toBeDisabled()
  })
})

describe('inspector and export', () => {
  test('shows each student weighted result', async () => {
    install()
    renderAt('/lecturer/marks')
    await screen.findByRole('region', { name: /Marks sheet for CAT 1/ })
    const inspector = await screen.findByRole('region', { name: 'Student quick inspector' })
    expect(within(inspector).getByLabelText('Student')).toHaveValue('s3')
    expect(within(inspector).getByText('90.7%')).toBeInTheDocument()

    fireEvent.change(within(inspector).getByLabelText('Student'), { target: { value: 's1' } })
    expect(within(inspector).getByText('93.5%')).toBeInTheDocument()
    expect(within(inspector).getByText('28 / 30 (14.0%)')).toBeInTheDocument()
    expect(within(inspector).getByText('51.4 / 55.0')).toBeInTheDocument()

    fireEvent.change(within(inspector).getByLabelText('Student'), { target: { value: 's4' } })
    expect(within(inspector).getByText('not marked')).toBeInTheDocument()
  })

  test('exports every mark as a safe CSV file', async () => {
    Object.values(rosters).forEach((list) => list.forEach((r) => { if (r.student_id === 's3') r.full_name = '=HYPERLINK("evil")' }))
    install()
    renderAt('/lecturer/marks')
    await screen.findByRole('region', { name: /Marks sheet for CAT 1/ })
    const button = screen.getByRole('button', { name: /Export marks/ })
    await waitFor(() => expect(button).toBeEnabled())
    let blob
    const create = vi.fn((value) => {
      blob = value
      return 'blob:marks'
    })
    const revoke = vi.fn()
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
    URL.createObjectURL = create
    URL.revokeObjectURL = revoke
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    fireEvent.click(button)
    expect(click).toHaveBeenCalled()
    expect(revoke).toHaveBeenCalledWith('blob:marks')
    const text = await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(blob)
    })
    const lines = text.split('\n')
    expect(lines[0]).toBe('Student,Registration number,CAT 1: Distributed Systems (max 30),Assignment #02: OpenTelemetry (max 100),Practical Lab #02 (max 50)')
    expect(lines.find((line) => line.startsWith('Elena'))).toBe('Elena Rostova,REG-0842,28,95,46')
    expect(lines.find((line) => line.startsWith('Marcus'))).toBe('Marcus Vance,REG-0621,20,60,')
    expect(text).toContain("\"'=HYPERLINK(\"\"evil\"\")\"")
    click.mockRestore()
    URL.createObjectURL = original.create
    URL.revokeObjectURL = original.revoke
  })
})
