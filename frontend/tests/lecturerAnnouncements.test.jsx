import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('../src/services/apiClient.js', () => ({ api: apiMock }))

import LecturerAnnouncements from '../src/pages/lecturer/LecturerAnnouncements.jsx'

const DAY = 24 * 3_600_000
const at = (ms) => new Date(Date.now() + ms).toISOString()

const COURSES = {
  items: [
    { id: 'c1', course_code: 'CS401', course_name: 'Advanced Software Engineering', status: 'active' },
    { id: 'c2', course_code: 'CS402', course_name: 'Cloud Architecture', status: 'active' },
  ],
  total: 2,
}
const ENROLLED = { c1: 92, c2: 64 }

const note = (id, courseId, extra = {}) => ({
  id,
  course_id: courseId,
  title: `Notice ${id}`,
  body: `Body of ${id}`,
  published: true,
  published_at: at(-DAY),
  created_at: at(-DAY),
  ...extra,
})

let store

function seed() {
  store = {
    c1: [
      note('a1', 'c1', { title: 'Lab moved to Hall 4B', body: 'Practical lab 02 is now in Hall 4B.', published_at: at(-DAY) }),
      note('a2', 'c1', { title: 'Exam timetable draft', body: 'Pending approval.', published: false, published_at: null, created_at: at(-3 * DAY) }),
    ],
    c2: [note('a3', 'c2', { title: 'Guest lecture on Kubernetes', body: 'Joint seminar.', published_at: at(-2 * DAY) })],
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
    const detail = path.match(/^\/courses\/(c\d)$/)
    if (detail) return { ...COURSES.items.find((course) => course.id === detail[1]), enrolled_count: ENROLLED[detail[1]] }
    const list = path.match(/^\/courses\/(c\d)\/announcements\?page_size=100$/)
    if (list) return { items: store[list[1]], total: store[list[1]].length }
    const item = path.match(/^\/announcements\/(a\d+)$/)
    if (item && options.method === 'PATCH') {
      for (const rows of Object.values(store)) {
        const row = rows.find((entry) => entry.id === item[1])
        if (row) Object.assign(row, options.body, options.body.published ? { published_at: at(0) } : {})
      }
      return {}
    }
    if (path === '/courses/c1/announcements' && options.method === 'POST') {
      store.c1 = [note('a9', 'c1', { ...options.body, published_at: options.body.published ? at(0) : null }), ...store.c1]
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
          <Route path="/lecturer/announcements" element={<LecturerAnnouncements />} />
          <Route path="/lecturer/courses/:courseId/announcements" element={<LecturerAnnouncements />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const cardTitles = () => screen.queryAllByRole('heading', { level: 3 }).map((node) => node.textContent).filter((text) => text !== 'Broadcast composer')

beforeEach(() => {
  apiMock.mockReset()
  seed()
})

describe('feed', () => {
  test('lists announcements from every course with real counts', async () => {
    install()
    renderAt('/lecturer/announcements')
    expect(await screen.findByText('Lab moved to Hall 4B')).toBeInTheDocument()
    expect(screen.getByText('Exam timetable draft')).toBeInTheDocument()
    expect(screen.getByText('Guest lecture on Kubernetes')).toBeInTheDocument()
    const summary = screen.getByLabelText('Announcement summary')
    expect(within(summary).getByText('3')).toBeInTheDocument()
    expect(within(summary).getByText('156')).toBeInTheDocument()
    expect(screen.getByText('Draft, hidden from students')).toBeInTheDocument()
    expect(screen.queryByText(/SHA|Immutable|engagement|avg read/i)).not.toBeInTheDocument()
  })

  test('filters by scope, status tab and search, and sorts', async () => {
    install()
    renderAt('/lecturer/announcements')
    await screen.findByText('Lab moved to Hall 4B')

    fireEvent.click(screen.getByRole('button', { name: /CS402: Cloud Architecture/ }))
    expect(cardTitles()).toEqual(['Guest lecture on Kubernetes'])
    fireEvent.click(screen.getByRole('button', { name: /All assigned courses/ }))

    fireEvent.click(screen.getByRole('tab', { name: /Drafts/ }))
    expect(cardTitles()).toEqual(['Exam timetable draft'])
    fireEvent.click(screen.getByRole('tab', { name: /^Published/ }))
    expect(cardTitles()).toEqual(['Lab moved to Hall 4B', 'Guest lecture on Kubernetes'])
    fireEvent.click(screen.getByRole('tab', { name: /^All/ }))

    fireEvent.change(screen.getByLabelText('Search announcements'), { target: { value: 'kubernetes' } })
    expect(cardTitles()).toEqual(['Guest lecture on Kubernetes'])
    fireEvent.change(screen.getByLabelText('Search announcements'), { target: { value: 'zzz' } })
    expect(screen.getByText('No announcements match these filters.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search announcements'), { target: { value: '' } })

    fireEvent.click(screen.getByRole('button', { name: 'Sorted newest first' }))
    expect(cardTitles()[0]).toBe('Exam timetable draft')
  })

  test('the Drafts queue button jumps to the drafts tab', async () => {
    install()
    renderAt('/lecturer/announcements')
    await screen.findByText('Lab moved to Hall 4B')
    fireEvent.click(screen.getByRole('button', { name: /Drafts queue/ }))
    expect(screen.getByRole('tab', { name: /Drafts/ })).toHaveAttribute('aria-selected', 'true')
    expect(cardTitles()).toEqual(['Exam timetable draft'])
  })

  test('pages through long lists and expands long messages', async () => {
    store.c2 = Array.from({ length: 8 }, (_, index) => note(`b${index}`, 'c2', { title: `Bulk ${index}`, published_at: at(-index * 1000) }))
    store.c1[0].body = 'x'.repeat(400)
    install()
    renderAt('/lecturer/announcements')
    await screen.findByText('Page 1 of 2')
    expect(cardTitles()).toHaveLength(6)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Read more' }))
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
  })

  test('preselects the course from the route', async () => {
    install()
    renderAt('/lecturer/courses/c2/announcements')
    expect(await screen.findByText('Guest lecture on Kubernetes')).toBeInTheDocument()
    expect(screen.queryByText('Lab moved to Hall 4B')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Target course')).toHaveValue('c2')
  })

  test('says so plainly while the announcements service is not enabled', async () => {
    const missing = Object.assign(new Error('Not Found'), { status: 404 })
    install({ '/courses/c1/announcements?page_size=100': missing, '/courses/c2/announcements?page_size=100': missing })
    renderAt('/lecturer/announcements')
    expect(await screen.findByText('Announcements are not switched on yet')).toBeInTheDocument()
    expect(screen.getByText('Coming in Phase 7')).toBeInTheDocument()
    const summary = screen.getByLabelText('Announcement summary')
    expect(within(summary).getAllByText('—').length).toBeGreaterThanOrEqual(3)
  })

  test('shows empty, error and partial-failure states', async () => {
    store = { c1: [], c2: [] }
    install()
    const first = renderAt('/lecturer/announcements')
    expect(await screen.findByText(/No announcements yet/)).toBeInTheDocument()
    first.unmount()

    install({ '/courses?page_size=100': { items: [], total: 0 } })
    const second = renderAt('/lecturer/announcements')
    expect(await screen.findByText(/not assigned to any courses/)).toBeInTheDocument()
    second.unmount()

    install({ '/courses?page_size=100': new Error('down') })
    const third = renderAt('/lecturer/announcements')
    const retry = await screen.findByRole('button', { name: /try again/i })
    seed()
    install()
    fireEvent.click(retry)
    expect(await screen.findByText('Lab moved to Hall 4B')).toBeInTheDocument()
    third.unmount()

    install({ '/courses/c2/announcements?page_size=100': Object.assign(new Error('boom'), { status: 500 }) })
    renderAt('/lecturer/announcements')
    expect(await screen.findByText(/could not be loaded for CS402/)).toBeInTheDocument()
    expect(screen.getByText('Lab moved to Hall 4B')).toBeInTheDocument()
  })
})

describe('card actions', () => {
  test('publishes a draft and withholds a published post', async () => {
    install()
    renderAt('/lecturer/announcements')
    await screen.findByText('Exam timetable draft')
    fireEvent.click(screen.getByRole('button', { name: /Publish to cohort/ }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/announcements/a2', { method: 'PATCH', body: { published: true } }))
    await waitFor(() => expect(screen.queryByText('Draft, hidden from students')).not.toBeInTheDocument())

    fireEvent.click(screen.getAllByRole('button', { name: /Withhold/ })[0])
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(expect.stringMatching(/^\/announcements\/a\d$/), { method: 'PATCH', body: { published: false } }))
  })

  test('shows an error when the change fails', async () => {
    install()
    renderAt('/lecturer/announcements')
    await screen.findByText('Exam timetable draft')
    const original = apiMock.getMockImplementation()
    apiMock.mockImplementation(async (path, options) => {
      if (options?.method === 'PATCH') throw new Error('Forbidden')
      return original(path, options)
    })
    fireEvent.click(screen.getByRole('button', { name: /Publish to cohort/ }))
    expect(await screen.findByText('Forbidden')).toBeInTheDocument()
  })

  test('edits with validation and cancels cleanly', async () => {
    install()
    renderAt('/lecturer/announcements')
    await screen.findByText('Exam timetable draft')
    fireEvent.click(screen.getByRole('button', { name: /Edit draft/ }))
    const form = screen.getByRole('form', { name: 'Edit Exam timetable draft' })
    fireEvent.change(within(form).getByLabelText('Title'), { target: { value: 'x' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    expect(screen.getByText(/The title must be between 2 and 200 characters/)).toBeInTheDocument()

    fireEvent.change(within(form).getByLabelText('Title'), { target: { value: 'Exam timetable v2' } })
    fireEvent.change(within(form).getByLabelText('Message'), { target: { value: 'Approved by the Dean.' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/announcements/a2', { method: 'PATCH', body: { title: 'Exam timetable v2', body: 'Approved by the Dean.' } }))
    expect(await screen.findByText('Exam timetable v2')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: /Edit/ })).not.toBeInTheDocument()
  })
})

describe('composer', () => {
  test('validates before sending anything', async () => {
    install()
    renderAt('/lecturer/announcements')
    await screen.findByText('Lab moved to Hall 4B')
    fireEvent.click(screen.getByRole('button', { name: /Publish & notify students/ }))
    expect(screen.getByText('Choose a course.')).toBeInTheDocument()
    expect(screen.getByText(/The title must be between 2 and 200 characters/)).toBeInTheDocument()
    expect(screen.getByText('Write the message students should see.')).toBeInTheDocument()
    expect(apiMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  test('publishes and notifies, then refreshes the feed', async () => {
    install()
    renderAt('/lecturer/announcements')
    await screen.findByText('Lab moved to Hall 4B')
    fireEvent.change(screen.getByLabelText('Target course'), { target: { value: 'c1' } })
    fireEvent.change(screen.getByLabelText('Announcement title'), { target: { value: 'Quiz on Friday' } })
    fireEvent.change(screen.getByLabelText('Announcement content'), { target: { value: 'Chapters 1 to 3.' } })
    expect(screen.getByText(/Publishing notifies the 92 enrolled students/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Publish & notify students/ }))
    expect(await screen.findByText('Published. Enrolled students will be notified.')).toBeInTheDocument()
    expect(apiMock).toHaveBeenCalledWith('/courses/c1/announcements', { method: 'POST', body: { title: 'Quiz on Friday', body: 'Chapters 1 to 3.', published: true } })
    expect(await screen.findByText('Quiz on Friday')).toBeInTheDocument()
    expect(screen.getByLabelText('Announcement title')).toHaveValue('')
  })

  test('saves a draft and clears the form', async () => {
    install()
    renderAt('/lecturer/courses/c1/announcements')
    await screen.findByText('Lab moved to Hall 4B')
    fireEvent.change(screen.getByLabelText('Announcement title'), { target: { value: 'Reading list' } })
    fireEvent.change(screen.getByLabelText('Announcement content'), { target: { value: 'Draft text' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(await screen.findByText('Saved as a draft. Students cannot see it yet.')).toBeInTheDocument()
    expect(apiMock).toHaveBeenCalledWith('/courses/c1/announcements', { method: 'POST', body: { title: 'Reading list', body: 'Draft text', published: false } })

    fireEvent.change(screen.getByLabelText('Announcement title'), { target: { value: 'Something' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByLabelText('Announcement title')).toHaveValue('')
  })

  test('explains a rejected save, including the service not being enabled', async () => {
    install()
    renderAt('/lecturer/courses/c1/announcements')
    await screen.findByText('Lab moved to Hall 4B')
    const original = apiMock.getMockImplementation()
    apiMock.mockImplementation(async (path, options) => {
      if (options?.method === 'POST') throw Object.assign(new Error('Not Found'), { status: 404 })
      return original(path, options)
    })
    fireEvent.change(screen.getByLabelText('Announcement title'), { target: { value: 'Hello' } })
    fireEvent.change(screen.getByLabelText('Announcement content'), { target: { value: 'World' } })
    fireEvent.click(screen.getByRole('button', { name: /Publish & notify students/ }))
    expect(await screen.findByText(/not switched on in the backend yet/)).toBeInTheDocument()

    apiMock.mockImplementation(async (path, options) => {
      if (options?.method === 'POST') throw new Error('Title is too long')
      return original(path, options)
    })
    fireEvent.click(screen.getByRole('button', { name: /Publish & notify students/ }))
    expect(await screen.findByText('Title is too long')).toBeInTheDocument()
  })
})
