import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('../src/services/apiClient.js', () => ({ api: apiMock }))

import StudentNotifications from '../src/pages/student/StudentNotifications.jsx'

const at = (...parts) => new Date(...parts).toISOString()

// "Now" is Wednesday 14 Oct 2026, 10:45 local time.
const ITEMS = () => [
  { id: 'n1', type: 'assignment_published', title: 'Milestone 1 released', message: 'The brief is live in Materials Hub.', link: '/student/assignments/a1', is_read: false, created_at: at(2026, 9, 14, 8, 30), read_at: null },
  { id: 'n2', type: 'marks_released', title: 'Lab Practical 2 marked', message: 'Your mark has been recorded.', link: '/student/marks', is_read: false, created_at: at(2026, 9, 13, 16, 45), read_at: null },
  { id: 'n3', type: 'announcement', title: 'Room change for Wednesday workshop', message: 'Moving to Lovelace Wing.', link: 'https://evil.example/phish', is_read: false, created_at: at(2026, 9, 13, 14, 20), read_at: null },
  { id: 'n4', type: 'material_added', title: 'Packet capture files uploaded', message: 'Download before Thursday.', link: '//evil.example/x', is_read: false, created_at: at(2026, 9, 10, 11, 30), read_at: null },
  { id: 'n5', type: 'announcement', title: 'Advisory hours schedule', message: 'Advisors are available.', link: '/student/announcements', is_read: true, created_at: at(2026, 9, 11, 9, 0), read_at: at(2026, 9, 12, 11, 4) },
  { id: 'n6', type: 'grade_released', title: 'Quiz 1 results', message: 'Quiz results are in.', link: null, is_read: true, created_at: at(2026, 9, 8, 16, 30), read_at: at(2026, 9, 8, 17, 0) },
]

let items
function install(overrides = {}) {
  apiMock.mockImplementation(async (path, options = {}) => {
    if (path in overrides) {
      const value = overrides[path]
      if (value instanceof Error) throw value
      return value
    }
    if (path === '/notifications' && !options.method) return { items, total: items.length }
    const m = path.match(/^\/notifications\/(\w+)\/read$/)
    if (m && options.method === 'PATCH') return { id: m[1], is_read: true }
    if (path === '/notifications/read-all' && options.method === 'POST') return null
    throw new Error(`unexpected request: ${path}`)
  })
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/student/notifications']}>
        <StudentNotifications />
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

const stat = (label) => screen.getByText(label).closest('.slpc-stat')
const feedItems = () => within(screen.getByRole('list', { name: 'Notifications' })).getAllByRole('article')

describe('student notifications', () => {
  test('lists real alerts newest first with readable times', async () => {
    install()
    renderPage()
    expect(await screen.findByText('Milestone 1 released')).toBeInTheDocument()
    expect(apiMock).toHaveBeenCalledWith('/notifications')
    const titles = feedItems().map((card) => within(card).getByRole('heading').textContent)
    expect(titles).toEqual(['Milestone 1 released', 'Lab Practical 2 marked', 'Room change for Wednesday workshop', 'Advisory hours schedule', 'Packet capture files uploaded', 'Quiz 1 results'])
    expect(screen.getByText('Today at 08:30 (2 hours ago)')).toBeInTheDocument()
    expect(screen.getByText('Yesterday at 16:45')).toBeInTheDocument()
    expect(screen.getByText('Read Oct 12, 2026 at 11:04')).toBeInTheDocument()
    expect(screen.getByText('4 Pending')).toBeInTheDocument()
    expect(screen.queryByText(/FERPA|92 \/ 100|Prof\. M\. Sterling|Term Retention|5 working days/)).not.toBeInTheDocument()
  })

  test('the summary cards are counted from the alerts received', async () => {
    install()
    renderPage()
    await screen.findByText('Milestone 1 released')
    const unread = stat('Priority action')
    expect(within(unread).getByText('4')).toBeInTheDocument()
    const broadcasts = stat('Faculty broadcasts')
    expect(within(broadcasts).getByText('1')).toBeInTheDocument()
    expect(within(broadcasts).getByText('Room change for Wednesday workshop')).toBeInTheDocument()
    const ledger = stat('Ledger updates')
    expect(within(ledger).getByText('1')).toBeInTheDocument()
    expect(within(ledger).getByText('Lab Practical 2 marked')).toBeInTheDocument()
    const week = stat('Last 7 days')
    expect(within(week).getByText('6')).toBeInTheDocument()
    expect(within(week).getByText('Latest 2 hours ago')).toBeInTheDocument()
  })

  test('type pills show counts and filter the feed', async () => {
    install()
    renderPage()
    await screen.findByText('Milestone 1 released')
    expect(screen.getByRole('button', { name: 'All (6)' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Unread (4)' }))
    expect(feedItems()).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: 'Marks & Results (2)' }))
    expect(feedItems().map((card) => within(card).getByRole('heading').textContent)).toEqual(['Lab Practical 2 marked', 'Quiz 1 results'])
    fireEvent.click(screen.getByRole('button', { name: 'Assignments (1)' }))
    expect(feedItems()).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Materials (1)' }))
    expect(screen.getByText('Packet capture files uploaded')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Announcements (2)' }))
    expect(feedItems()).toHaveLength(2)
  })

  test('search and sort work on the loaded alerts', async () => {
    install()
    renderPage()
    await screen.findByText('Milestone 1 released')
    fireEvent.change(screen.getByLabelText('Search alerts'), { target: { value: 'lovelace' } })
    expect(feedItems()).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('Search alerts'), { target: { value: 'nothing like this' } })
    expect(screen.getByText('No alerts match these filters.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search alerts'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Sort alerts'), { target: { value: 'oldest' } })
    expect(within(feedItems()[0]).getByRole('heading')).toHaveTextContent('Quiz 1 results')
    fireEvent.change(screen.getByLabelText('Sort alerts'), { target: { value: 'unread' } })
    expect(within(feedItems()[4]).getByRole('heading')).toHaveTextContent('Advisory hours schedule')
    fireEvent.change(screen.getByLabelText('Sort alerts'), { target: { value: 'type' } })
    expect(within(feedItems()[0]).getByRole('heading')).toHaveTextContent('Room change for Wednesday workshop')
  })

  test('only links inside the portal become buttons', async () => {
    install()
    renderPage()
    await screen.findByText('Milestone 1 released')
    expect(screen.getByRole('link', { name: /View assignment/ })).toHaveAttribute('href', '/student/assignments/a1')
    expect(screen.getByRole('link', { name: /Inspect grade & feedback/ })).toHaveAttribute('href', '/student/marks')
    expect(document.querySelector('a[href*="evil.example"]')).toBeNull()
    expect(screen.getByRole('link', { name: /Preferences/ })).toHaveAttribute('href', '/student/settings')
  })

  test('marking one alert read calls the server and updates the page', async () => {
    install()
    renderPage()
    await screen.findByText('Milestone 1 released')
    fireEvent.click(screen.getByRole('button', { name: 'Mark as read: Milestone 1 released' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/notifications/n1/read', { method: 'PATCH' }))
    await waitFor(() => expect(screen.getByText('3 Pending')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Mark as read: Milestone 1 released' })).not.toBeInTheDocument()
    expect(within(stat('Priority action')).getByText('3')).toBeInTheDocument()
  })

  test('mark all as read clears every unread alert', async () => {
    install()
    renderPage()
    await screen.findByText('Milestone 1 released')
    fireEvent.click(screen.getByRole('button', { name: /Mark All as Read/ }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/notifications/read-all', { method: 'POST' }))
    expect(await screen.findByRole('button', { name: /All Cleared/ })).toBeDisabled()
    expect(screen.queryByText(/Pending/)).not.toBeInTheDocument()
    expect(screen.getByText('You are all caught up')).toBeInTheDocument()
  })

  test('a failed update shows the error and leaves the alert unread', async () => {
    install()
    apiMock.mockImplementation(async (path, options = {}) => {
      if (path === '/notifications' && !options.method) return { items, total: items.length }
      throw Object.assign(new Error('Could not reach the server'), { status: 500 })
    })
    renderPage()
    await screen.findByText('Milestone 1 released')
    fireEvent.click(screen.getByRole('button', { name: 'Mark as read: Milestone 1 released' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server')
    expect(screen.getByText('4 Pending')).toBeInTheDocument()
  })

  test('refresh asks the server again', async () => {
    install()
    renderPage()
    await screen.findByText('Milestone 1 released')
    const before = apiMock.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Refresh feed' }))
    await waitFor(() => expect(apiMock.mock.calls.length).toBeGreaterThan(before))
  })

  test('shows a plain not-ready panel and no figures while notifications are off', async () => {
    install({ '/notifications': Object.assign(new Error('Not found'), { status: 404 }) })
    renderPage()
    expect(await screen.findByText('Notifications are not switched on yet')).toBeInTheDocument()
    expect(within(stat('Priority action')).getByText('—')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Mark All as Read/ })).toBeDisabled()
    expect(screen.queryByText(/Pending/)).not.toBeInTheDocument()
  })

  test('a server failure offers a retry', async () => {
    install({ '/notifications': Object.assign(new Error('Server exploded'), { status: 500 }) })
    renderPage()
    expect(await screen.findByText('Server exploded')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(apiMock.mock.calls.filter(([path]) => path === '/notifications').length).toBeGreaterThan(1))
  })

  test('says so when there is nothing yet, and accepts a bare array response', async () => {
    install({ '/notifications': [] })
    const first = renderPage()
    expect(await screen.findByText(/You have no notifications yet/)).toBeInTheDocument()
    first.unmount()

    install({ '/notifications': [{ id: 'x1', type: 'surprise', title: 'Something new', message: '', is_read: false, created_at: at(2026, 9, 14, 10, 0) }] })
    renderPage()
    const card = await screen.findByRole('article')
    expect(within(card).getByText('Notice')).toBeInTheDocument()
    expect(within(card).getByText('Something new')).toBeInTheDocument()
    expect(screen.getByText('Showing 1 of 1 alert.')).toBeInTheDocument()
  })
})
