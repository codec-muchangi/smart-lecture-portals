import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('../src/services/apiClient.js', () => ({ api: apiMock }))

import LecturerNotifications from '../src/pages/lecturer/LecturerNotifications.jsx'

const at = (...parts) => new Date(...parts).toISOString()

// "Now" is Wednesday 14 Oct 2026, 10:45 local time.
const COURSES = {
  items: [
    { id: 'c1', course_code: 'CS401', course_name: 'Adv. Software Engineering' },
    { id: 'c2', course_code: 'CS402', course_name: 'Distributed Systems' },
  ],
  total: 2,
}
const ASSIGNMENTS = {
  c1: [
    { id: 'a1', title: 'CAT 1', state: 'open', due_at: at(2026, 9, 14, 23, 59) },
    { id: 'a2', title: 'Architecture Spec', state: 'closed', due_at: at(2026, 9, 10, 23, 59) },
    { id: 'a3', title: 'Draft brief', state: 'draft', due_at: at(2026, 9, 30, 23, 59) },
  ],
  c2: [{ id: 'a4', title: 'Raft Lab', state: 'open', due_at: at(2026, 9, 25, 23, 59) }],
}
const COUNTS = {
  a1: { submitted: 3, late: 0, graded: 1, returned: 0 },
  a2: { submitted: 2, late: 2, graded: 5, returned: 0 },
  a4: { submitted: 0, late: 0, graded: 0, returned: 0 },
}
const ITEMS = () => [
  { id: 'n1', type: 'announcement', title: 'Registry update', message: 'Marks window opens.', link: '/lecturer/announcements', is_read: false, created_at: at(2026, 9, 14, 9, 0), read_at: null },
  { id: 'n2', type: 'general', title: 'Phish', message: 'x', link: 'https://evil.example/x', is_read: false, created_at: at(2026, 9, 13, 9, 0), read_at: null },
  { id: 'n3', type: 'material_added', title: 'Old notice', message: 'done', link: null, is_read: true, created_at: at(2026, 9, 10, 9, 0), read_at: at(2026, 9, 10, 10, 0) },
]

let items
function install({ feedError, assignmentError } = {}) {
  apiMock.mockImplementation(async (path, options = {}) => {
    if (path === '/notifications' && !options.method) {
      if (feedError) throw feedError
      return { items, total: items.length }
    }
    let m = path.match(/^\/notifications\/(\w+)\/read$/)
    if (m && options.method === 'PATCH') return { id: m[1], is_read: true }
    if (path === '/notifications/read-all' && options.method === 'POST') return null
    if (path === '/courses?page_size=100') return COURSES
    m = path.match(/^\/courses\/(c\d)\/assignments\?page_size=100$/)
    if (m) {
      if (assignmentError && m[1] === 'c2') throw assignmentError
      return { items: ASSIGNMENTS[m[1]], total: ASSIGNMENTS[m[1]].length }
    }
    m = path.match(/^\/assignments\/(a\d)$/)
    if (m) return { id: m[1], submission_counts: COUNTS[m[1]] }
    throw new Error(`unexpected request: ${path}`)
  })
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/lecturer/notifications']}>
        <LecturerNotifications />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiMock.mockReset()
  items = ITEMS()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 14, 10, 45))
})
afterEach(() => vi.useRealTimers())

const stat = (label) => screen.getByText(label).closest('.slpo-stat')
const cardsShown = () => within(screen.getByRole('list', { name: 'Alerts' })).getAllByRole('article')

describe('LecturerNotifications', () => {
  it('counts unread alerts, the grading queue and urgent cutoffs from real data', async () => {
    install()
    renderPage()
    await waitFor(() => expect(within(stat('Review pipeline')).getByText('7')).toBeInTheDocument())
    expect(within(stat('Unread dispatches')).getByText('2')).toBeInTheDocument()
    expect(within(stat('Review pipeline')).getByText('Awaiting grading in CS401')).toBeInTheDocument()
    expect(within(stat('Urgent countdown')).getByText('1')).toBeInTheDocument()
    expect(within(stat('Urgent countdown')).getByText(/CS401 CAT 1 closes in 13h 14m/)).toBeInTheDocument()
  })

  it('lists live signals first, then alerts, and never lists drafts', async () => {
    install()
    renderPage()
    await screen.findByText('Registry update')
    const titles = cardsShown().map((card) => within(card).getByRole('heading', { level: 3 }).textContent)
    expect(titles).toEqual(['CAT 1 closes today', 'Architecture Spec: 4 submissions to grade', 'CAT 1: 3 submissions to grade', 'Registry update', 'Phish', 'Old notice'])
    expect(screen.queryByText(/Draft brief/)).not.toBeInTheDocument()
  })

  it('shows signal details in the inspector and links to submissions', async () => {
    install()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Architecture Spec: 4 submissions to grade' }))
    const inspector = screen.getByRole('region', { name: 'Alert inspector' })
    expect(within(inspector).getByText('Awaiting grading')).toBeInTheDocument()
    expect(within(inspector).getByRole('link', { name: /Grade submissions/ })).toHaveAttribute('href', '/lecturer/assignments/a2/submissions')
  })

  it('marks one alert read and updates the unread count', async () => {
    install()
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Mark as read: Registry update' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/notifications/n1/read', { method: 'PATCH' }))
    await waitFor(() => expect(within(stat('Unread dispatches')).getByText('1')).toBeInTheDocument())
  })

  it('marks everything read', async () => {
    install()
    renderPage()
    await screen.findByText('Registry update')
    fireEvent.click(screen.getByRole('button', { name: /Mark All as Read/ }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/notifications/read-all', { method: 'POST' }))
    await waitFor(() => expect(within(stat('Unread dispatches')).getByText('0')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Mark All as Read/ })).toBeDisabled()
  })

  it('only offers portal links, never outside addresses', async () => {
    install()
    renderPage()
    await screen.findByText('Phish')
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'))
    expect(hrefs).toContain('/lecturer/announcements')
    expect(hrefs.some((href) => href?.includes('evil.example'))).toBe(false)
  })

  it('filters by pill, course and search', async () => {
    install()
    renderPage()
    await screen.findByText('Registry update')
    fireEvent.click(screen.getByRole('button', { name: /Closing soon \(1\)/ }))
    expect(cardsShown()).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /^All \(/ }))
    fireEvent.change(screen.getByLabelText('Filter by course'), { target: { value: 'c2' } })
    expect(screen.getByText('No alerts match these filters.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Filter by course'), { target: { value: 'all' } })
    fireEvent.change(screen.getByLabelText('Search alerts'), { target: { value: 'registry' } })
    expect(cardsShown()).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /Unread \(2\)/ }))
    expect(within(screen.getByRole('list', { name: 'Alerts' })).queryByText('Old notice')).not.toBeInTheDocument()
  })

  it('exports the listed alerts as CSV', async () => {
    install()
    const createUrl = vi.fn(() => 'blob:x')
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = createUrl
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderPage()
    await screen.findByText('Registry update')
    fireEvent.click(screen.getByRole('button', { name: /Export Alerts/ }))
    expect(createUrl).toHaveBeenCalledTimes(1)
    const blob = createUrl.mock.calls[0][0]
    const text = await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.readAsText(blob)
    })
    expect(text).toContain('Registry update')
    expect(text).toContain('CAT 1 closes today')
    click.mockRestore()
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  })

  it('says notifications are not switched on but keeps the live signals', async () => {
    install({ feedError: Object.assign(new Error('missing'), { status: 404 }) })
    renderPage()
    expect(await screen.findByText('Notifications are not switched on yet')).toBeInTheDocument()
    expect((await screen.findAllByText('CAT 1 closes today')).length).toBeGreaterThan(0)
    expect(within(stat('Unread dispatches')).getByText('—')).toBeInTheDocument()
  })

  it('shows a dash and a warning when one course cannot be counted', async () => {
    install({ assignmentError: Object.assign(new Error('boom'), { status: 500 }) })
    renderPage()
    expect(await screen.findByText(/Some assignment data for CS402 could not be loaded/)).toBeInTheDocument()
    expect(within(stat('Review pipeline')).getByText('—')).toBeInTheDocument()
    expect(within(stat('Review pipeline')).getByText('Some courses could not be counted')).toBeInTheDocument()
  })

  it('shows an empty state when there is nothing at all', async () => {
    items = []
    apiMock.mockImplementation(async (path) => {
      if (path === '/notifications') return { items: [], total: 0 }
      if (path === '/courses?page_size=100') return { items: [], total: 0 }
      throw new Error(`unexpected request: ${path}`)
    })
    renderPage()
    expect(await screen.findByText(/No alerts yet/)).toBeInTheDocument()
  })
})
