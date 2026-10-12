import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('../src/services/apiClient.js', () => ({ api: apiMock }))

const auth = {
  user: {
    full_name: 'Demo Lecturer',
    details: { title: 'Dr.', department: 'Computer Science', staff_number: 'LEC001' },
  },
}
vi.mock('../src/app/AuthContext.jsx', () => ({ useAuth: () => auth }))

import LecturerDashboard from '../src/pages/lecturer/LecturerDashboard.jsx'

const COURSES = {
  items: [
    { id: 'c1', course_code: 'CIT 3253', course_name: 'Network Administration', credit_hours: 3, semester: 'Semester 1', academic_year: '2026/2027', status: 'active' },
    { id: 'c2', course_code: 'CIT 3254', course_name: 'Database Systems', credit_hours: 4, semester: 'Semester 1', academic_year: '2026/2027', status: 'active' },
  ],
  total: 2,
}
const future = new Date(Date.now() + 5 * 86_400_000).toISOString()

function routes(overrides = {}) {
  const table = {
    '/courses?page_size=100': COURSES,
    '/courses/c1/students?page_size=1': { items: [{}], total: 40 },
    '/courses/c2/students?page_size=1': { items: [{}], total: 1 },
    '/courses/c1/assignments?page_size=100': {
      items: [
        { id: 'a1', title: 'Assignment 1', state: 'open', due_at: future },
        { id: 'a2', title: 'Draft only', state: 'draft', due_at: future },
      ],
    },
    '/courses/c2/assignments?page_size=100': { items: [] },
    '/assignments/a1': { id: 'a1', submission_counts: { submitted: 3, late: 2, graded: 1, returned: 1, total: 7 } },
    '/notifications': Object.assign(new Error('Not found'), { status: 404 }),
    ...overrides,
  }
  apiMock.mockImplementation(async (path) => {
    if (!(path in table)) throw new Error(`unexpected request: ${path}`)
    const value = table[path]
    if (value instanceof Error) throw value
    return value
  })
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LecturerDashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiMock.mockReset()
})

test('greets the lecturer using the nested profile details', async () => {
  routes()
  renderPage()
  expect(await screen.findByText('Welcome back, Dr. Demo Lecturer')).toBeInTheDocument()
  expect(screen.getByText('Department of Computer Science • Staff ID: #LEC001')).toBeInTheDocument()
})

test('shows real enrollment, grading backlog and deadline figures', async () => {
  routes()
  renderPage()
  expect(await screen.findByText('Network Administration')).toBeInTheDocument()
  expect(await screen.findByText('41')).toBeInTheDocument() // 40 + 1 enrolled students
  expect(await screen.findByText('5')).toBeInTheDocument() // 3 on time + 2 late are ungraded
  expect(screen.getByText('3 On time')).toBeInTheDocument()
  expect(screen.getByText('2 Late')).toBeInTheDocument()
  expect(screen.getByText('1 Revisions')).toBeInTheDocument()
  expect(screen.getByText('1')).toBeInTheDocument() // one open assignment (the draft is ignored)
  expect(screen.getByText('Total: 7 Credit Units')).toBeInTheDocument()
})

test('never fetches draft assignments and never repeats the word Semester', async () => {
  routes()
  renderPage()
  await screen.findByText('Network Administration')
  expect(apiMock).not.toHaveBeenCalledWith('/assignments/a2')
  expect(screen.getAllByText('Semester 1 • 2026/2027').length).toBe(2)
  expect(screen.queryByText(/Semester Semester/)).not.toBeInTheDocument()
})

test('explains that the activity feed is not live yet instead of failing', async () => {
  routes()
  renderPage()
  expect(await screen.findByText(/once notifications go live/i)).toBeInTheDocument()
  expect(screen.getByText('Network Administration')).toBeInTheDocument()
})

test('lists notifications when the endpoint exists', async () => {
  routes({
    '/notifications': { items: [{ id: 'n1', title: 'New submission', message: 'Assignment 1', is_read: false, created_at: new Date(Date.now() - 14 * 60000).toISOString() }] },
  })
  renderPage()
  expect(await screen.findByText('New submission')).toBeInTheDocument()
  expect(screen.getByText('14 mins ago')).toBeInTheDocument()
})

test('shows an unknown backlog instead of a wrong number when one request fails', async () => {
  routes({ '/assignments/a1': new Error('boom') })
  renderPage()
  expect(await screen.findByText('Could not load')).toBeInTheDocument()
  expect(screen.getByText('Network Administration')).toBeInTheDocument()
})

test('offers a retry when the courses cannot be loaded', async () => {
  routes({ '/courses?page_size=100': new Error('down') })
  renderPage()
  const retry = await screen.findByRole('button', { name: /try again/i })
  routes()
  fireEvent.click(retry)
  expect(await screen.findByText('Database Systems')).toBeInTheDocument()
})

test('shows an empty state when no courses are assigned', async () => {
  routes({ '/courses?page_size=100': { items: [], total: 0 } })
  renderPage()
  expect(await screen.findByText('No courses assigned yet.')).toBeInTheDocument()
})
