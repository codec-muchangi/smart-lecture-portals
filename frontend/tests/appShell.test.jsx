import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('../src/services/apiClient.js', () => ({ api: apiMock }))

const auth = { user: null, logout: vi.fn() }
vi.mock('../src/app/AuthContext.jsx', () => ({ useAuth: () => auth }))

import AppShell from '../src/layouts/AppShell.jsx'

const LECTURER = {
  full_name: 'Demo Lecturer',
  role: 'lecturer',
  details: { title: 'Dr.', department: 'Computer Science', staff_number: 'LEC001' },
}
const STUDENT = {
  full_name: 'Demo Student',
  role: 'student',
  details: { registration_number: 'STU001', program: 'BSc Computer Science' },
}

function mockApi({ notifications }) {
  apiMock.mockImplementation(async (path) => {
    if (path === '/courses?page_size=100') {
      return { items: [{ id: 'c1', semester: 'Semester 1', academic_year: '2026/2027' }], total: 1 }
    }
    if (path === '/notifications') {
      if (notifications instanceof Error) throw notifications
      return { items: notifications }
    }
    throw new Error(`unexpected request: ${path}`)
  })
}

function renderShell(role, path) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={`/${role}`} element={<AppShell role={role} />}>
            <Route index element={<p>page body</p>} />
            <Route path="courses" element={<p>courses body</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  apiMock.mockReset()
})

test('lecturer shell shows the sidebar, breadcrumb, identity and term chip', async () => {
  auth.user = LECTURER
  mockApi({ notifications: [] })
  renderShell('lecturer', '/lecturer')
  const nav = screen.getByRole('navigation', { name: 'Main' })
  expect(nav).toHaveTextContent('Dashboard')
  expect(nav).toHaveTextContent('Materials Management')
  expect(screen.getByRole('link', { name: 'Materials Management' })).toHaveAttribute('href', '/lecturer/materials')
  expect(nav).toHaveTextContent('Academic Reports')
  expect(screen.getByText('page body')).toBeInTheDocument()
  expect(screen.getByText('Dr. Demo Lecturer')).toBeInTheDocument()
  expect(screen.getByText('Dept. of Computer Science #LEC001')).toBeInTheDocument()
  expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Computer Science')
  expect(await screen.findByText('Semester 1')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /new material/i })).toBeInTheDocument()
})

test('marks the current page in the sidebar', () => {
  auth.user = LECTURER
  mockApi({ notifications: [] })
  renderShell('lecturer', '/lecturer/courses')
  expect(screen.getByRole('link', { name: 'My Courses' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
})

test('bell shows the unread count from notifications', async () => {
  auth.user = LECTURER
  mockApi({ notifications: [{ id: '1', is_read: false }, { id: '2', is_read: false }, { id: '3', is_read: true }] })
  renderShell('lecturer', '/lecturer')
  expect(await screen.findByRole('link', { name: 'Notifications, 2 unread' })).toBeInTheDocument()
})

test('bell has no badge while notifications are not available yet', async () => {
  auth.user = LECTURER
  mockApi({ notifications: Object.assign(new Error('Not found'), { status: 404 }) })
  renderShell('lecturer', '/lecturer')
  await screen.findByText('Semester 1')
  expect(screen.getByRole('link', { name: 'Notifications' })).toBeInTheDocument()
})

test('student shell has student navigation and no New Material button', async () => {
  auth.user = STUDENT
  mockApi({ notifications: [] })
  renderShell('student', '/student')
  const nav = screen.getByRole('navigation', { name: 'Main' })
  expect(nav).toHaveTextContent('My Enrolled Courses')
  expect(nav).toHaveTextContent('Materials Hub')
  expect(nav).toHaveTextContent('Assignments & Submissions')
  expect(nav).toHaveTextContent('Marks & Results')
  expect(screen.getByRole('link', { name: /Assignments & Submissions/ })).toHaveAttribute('href', '/student/assignments')
  expect(screen.getByRole('link', { name: /Attendance Tracker/ })).toHaveAttribute('href', '/student/attendance')
  expect(screen.getByPlaceholderText('Search modules, lectures, exams...')).toBeInTheDocument()
  expect(nav).not.toHaveTextContent('Materials Management')
  expect(screen.queryByRole('link', { name: /new material/i })).not.toBeInTheDocument()
  expect(screen.getByText('BSc Computer Science #STU001')).toBeInTheDocument()
})
