import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('../src/services/apiClient.js', () => ({ api: apiMock }))

import StudentAnnouncements from '../src/pages/student/StudentAnnouncements.jsx'

const COURSES = {
  items: [
    { id: 'c1', course_code: 'CS401', course_name: 'Adv. Software Engineering', credit_hours: 4, semester: '2' },
    { id: 'c2', course_code: 'CS402', course_name: 'Distributed Systems', credit_hours: 4, semester: '2' },
  ],
  total: 2,
}
const DETAILS = {
  c1: { lecturers: [{ title: 'Dr.', full_name: 'Sarah Jenkins' }] },
  c2: { lecturers: [{ title: 'Prof.', full_name: 'David Thorne' }] },
}
const hoursAgo = (hours) => new Date(Date.now() - hours * 3600000).toISOString()
const ANNOUNCEMENTS = () => ({
  c1: {
    items: [
      { id: 'n1', title: 'Midterm venue changed', body: 'Moved to Hall B.\nBring your ID.', published: true, published_at: hoursAgo(3) },
      { id: 'n2', title: 'Draft only', body: 'Hidden', published: false, published_at: null },
      { id: 'n3', title: 'Reading list posted', body: 'Chapters 4 to 6.', published: true, published_at: hoursAgo(24 * 5) },
    ],
  },
  c2: {
    items: [{ id: 'n4', title: 'Lab 3 extended', body: 'New deadline Friday.', published: true, published_at: hoursAgo(24 * 20), author_name: 'Prof. Thorne' }],
  },
})

let data
function install(listError) {
  apiMock.mockImplementation(async (path) => {
    if (path === '/courses?page_size=100') return COURSES
    let m = path.match(/^\/courses\/(c\d)$/)
    if (m) return { ...COURSES.items.find((c) => c.id === m[1]), ...DETAILS[m[1]] }
    m = path.match(/^\/courses\/(c\d)\/announcements\?page_size=100$/)
    if (m) {
      if (listError) throw listError
      return data[m[1]]
    }
    throw new Error(`unexpected request: ${path}`)
  })
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <StudentAnnouncements />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiMock.mockReset()
  data = ANNOUNCEMENTS()
})

describe('StudentAnnouncements', () => {
  it('lists published announcements only and counts them', async () => {
    install()
    renderPage()
    expect(await screen.findByRole('button', { name: /Midterm venue changed/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reading list posted/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Lab 3 extended/ })).toBeInTheDocument()
    expect(screen.queryByText('Draft only')).not.toBeInTheDocument()
    expect(screen.getByText('3 notices')).toBeInTheDocument()
  })

  it('shows the newest notice in the inspector with its lecturer and marks it New', async () => {
    install()
    renderPage()
    const inspector = await screen.findByRole('region', { name: 'Announcement details' })
    await waitFor(() => expect(within(inspector).getByText('Midterm venue changed')).toBeInTheDocument())
    expect(within(inspector).getByText('New notice')).toBeInTheDocument()
    expect(within(inspector).getByText(/Moved to Hall B\./)).toBeInTheDocument()
    expect(screen.getAllByText('New')).toHaveLength(1)
  })

  it('opens another announcement when selected', async () => {
    install()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Lab 3 extended/ }))
    const inspector = screen.getByRole('region', { name: 'Announcement details' })
    expect(within(inspector).getByText('Lab 3 extended')).toBeInTheDocument()
    expect(within(inspector).getByText('Published notice')).toBeInTheDocument()
    expect(within(inspector).getByRole('link', { name: /Open CS402 course materials/ })).toHaveAttribute('href', '/student/courses/c2/materials')
  })

  it('filters by module, search text and date range', async () => {
    install()
    renderPage()
    await screen.findByRole('button', { name: /Midterm venue changed/ })
    fireEvent.click(screen.getByRole('button', { name: /CS402: Distributed Systems/ }))
    expect(screen.queryByRole('button', { name: /Midterm venue changed/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Lab 3 extended/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /All enrolled/ }))
    fireEvent.change(screen.getByLabelText('Search announcements'), { target: { value: 'chapters' } })
    expect(screen.getByRole('button', { name: /Reading list posted/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Lab 3 extended/ })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search announcements'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: '7d' } })
    expect(screen.queryByRole('button', { name: /Lab 3 extended/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reading list posted/ })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search announcements'), { target: { value: 'zzzz' } })
    expect(screen.getByText('No announcements match these filters.')).toBeInTheDocument()
  })

  it('sorts oldest first', async () => {
    install()
    renderPage()
    await screen.findByRole('button', { name: /Midterm venue changed/ })
    fireEvent.change(screen.getByLabelText('Sort announcements'), { target: { value: 'oldest' } })
    const feed = screen.getByRole('list', { name: 'Announcements' })
    const titles = within(feed).getAllByRole('heading', { level: 2 }).map((node) => node.textContent)
    expect(titles).toEqual(['Lab 3 extended', 'Reading list posted', 'Midterm venue changed'])
  })

  it('paginates five at a time', async () => {
    data.c1.items = Array.from({ length: 7 }, (_, index) => ({ id: `p${index}`, title: `Notice ${index}`, body: 'x', published: true, published_at: hoursAgo(index + 1) }))
    install()
    renderPage()
    await screen.findByRole('button', { name: /Notice 0/ })
    expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Notice 5/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(await screen.findByRole('button', { name: /Notice 5/ })).toBeInTheDocument()
    expect(screen.getByText(/Page 2 of 2/)).toBeInTheDocument()
  })

  it('says announcements are not switched on when the server has no endpoint', async () => {
    install(Object.assign(new Error('missing'), { status: 404 }))
    renderPage()
    expect(await screen.findByText('Announcements are not switched on yet')).toBeInTheDocument()
    expect(screen.getByText('Coming in Phase 7')).toBeInTheDocument()
  })

  it('warns when one course fails and retries', async () => {
    apiMock.mockImplementation(async (path) => {
      if (path === '/courses?page_size=100') return COURSES
      let m = path.match(/^\/courses\/(c\d)$/)
      if (m) return { ...COURSES.items.find((c) => c.id === m[1]), ...DETAILS[m[1]] }
      if (path.startsWith('/courses/c2/announcements')) throw Object.assign(new Error('boom'), { status: 500 })
      return data.c1
    })
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('CS402')
    expect(screen.getByRole('button', { name: /Midterm venue changed/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('shows an empty state when nothing is published', async () => {
    data = { c1: { items: [] }, c2: { items: [] } }
    install()
    renderPage()
    expect(await screen.findByText(/have not published any announcements yet/)).toBeInTheDocument()
  })
})
