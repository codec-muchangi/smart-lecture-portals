import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'

const { apiMock, auth, signOutMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  auth: { user: { id: 'u1' }, logout: vi.fn(), refresh: vi.fn() },
  signOutMock: vi.fn(),
}))
vi.mock('../src/services/apiClient.js', () => ({ api: apiMock }))
vi.mock('../src/app/AuthContext.jsx', () => ({ useAuth: () => auth }))
vi.mock('../src/services/supabase.js', () => ({ supabase: { auth: { signOut: signOutMock } } }))

import LecturerSettings from '../src/pages/lecturer/LecturerSettings.jsx'
import { applyDisplay, DISPLAY_DEFAULTS, DISPLAY_KEY } from '../src/utils/display.js'

const ME = {
  id: 'u1',
  role: 'lecturer',
  full_name: 'Marcus Sterling',
  email: 'm.sterling@computing.edu',
  phone: '+1 555 234 8901',
  avatar_url: null,
  created_at: '2021-09-12T08:00:00Z',
  updated_at: '2026-02-20T14:22:00Z',
  details: { staff_number: 'LEC-8492', department: 'Computer Science', title: 'Senior Lecturer', status: 'active' },
}

const httpError = (status, details, message) => Object.assign(new Error(message ?? `HTTP ${status}`), { status, details })
let calls
let me

function install(overrides = {}) {
  apiMock.mockImplementation(async (path, options = {}) => {
    const key = `${options.method ?? 'GET'} ${path}`
    calls.push({ key, body: options.body })
    if (key in overrides) {
      const value = overrides[key]
      if (value instanceof Error) throw value
      return typeof value === 'function' ? value(options) : value
    }
    if (key === 'GET /me') return me
    if (key === 'PATCH /me') {
      me = { ...me, ...options.body, updated_at: '2026-10-20T08:00:00Z' }
      return me
    }
    if (key === 'POST /auth/password/change') return undefined
    if (key === 'POST /auth/password/reset') return { status: 'accepted' }
    throw new Error(`unexpected request: ${key}`)
  })
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LecturerSettings />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const name = () => screen.getByLabelText(/^Full name/)
const phone = () => screen.getByLabelText(/^Direct contact phone/)
const save = () => screen.getByRole('button', { name: /Save profile changes/ })
const openTab = (label) => fireEvent.click(screen.getByRole('tab', { name: label }))
const patches = () => calls.filter((call) => call.key === 'PATCH /me')

beforeEach(() => {
  apiMock.mockReset()
  signOutMock.mockReset()
  auth.logout.mockReset()
  auth.refresh.mockReset()
  calls = []
  me = { ...ME }
  window.localStorage.clear()
})

afterEach(() => {
  applyDisplay(DISPLAY_DEFAULTS)
})

test('shows the profile from the server with registry fields read-only', async () => {
  install()
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Marcus Sterling'))
  expect(phone()).toHaveValue('+1 555 234 8901')
  const email = screen.getByLabelText(/^Institutional email/)
  expect(email).toHaveValue('m.sterling@computing.edu')
  expect(email).toHaveAttribute('readonly')
  expect(screen.getByLabelText(/^Department/)).toHaveValue('Computer Science')
  expect(screen.getByLabelText(/^Department/)).toHaveAttribute('readonly')
  expect(screen.getByLabelText(/^Staff number/)).toHaveValue('LEC-8492')
  const summary = screen.getByLabelText('Account summary')
  expect(within(summary).getByRole('heading', { name: 'Marcus Sterling' })).toBeInTheDocument()
  expect(within(summary).getByText('#LEC-8492')).toBeInTheDocument()
  expect(within(summary).getByText('Active')).toBeInTheDocument()
  expect(within(screen.getByLabelText('Audit record')).getByText('Sep 12, 2021')).toBeInTheDocument()
  expect(save()).toBeDisabled()
})

test('saves only what changed and refreshes the signed-in user', async () => {
  install()
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Marcus Sterling'))
  fireEvent.change(phone(), { target: { value: '' } })
  expect(screen.getByText('You have unsaved changes')).toBeInTheDocument()
  fireEvent.click(save())
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Profile saved.'))
  expect(patches()).toHaveLength(1)
  expect(patches()[0].body).toEqual({ phone: null })
  expect(auth.refresh).toHaveBeenCalled()
  await waitFor(() => expect(save()).toBeDisabled())
})

test('cancel puts the saved values back', async () => {
  install()
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Marcus Sterling'))
  fireEvent.change(name(), { target: { value: 'Someone Else' } })
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(name()).toHaveValue('Marcus Sterling')
  expect(patches()).toHaveLength(0)
})

test('checks name, phone and photo link before sending anything', async () => {
  install()
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Marcus Sterling'))
  fireEvent.change(name(), { target: { value: 'A' } })
  expect(screen.getByText('Enter your full name (2 to 120 characters).')).toBeInTheDocument()
  expect(save()).toBeDisabled()
  fireEvent.change(name(), { target: { value: 'Marcus S' } })
  fireEvent.change(phone(), { target: { value: 'call me' } })
  expect(screen.getByText('Use 7 to 20 characters: digits, spaces, + - ( ).')).toBeInTheDocument()
  fireEvent.change(phone(), { target: { value: '+254 700 000 000' } })
  fireEvent.change(screen.getByLabelText(/^Profile photo link/), { target: { value: 'http://example.com/me.png' } })
  expect(screen.getByText('Use a full https:// link, or leave it empty.')).toBeInTheDocument()
  expect(save()).toBeDisabled()
  fireEvent.change(screen.getByLabelText(/^Profile photo link/), { target: { value: 'https://example.com/me.png' } })
  expect(save()).toBeEnabled()
  fireEvent.click(save())
  await waitFor(() => expect(patches()).toHaveLength(1))
  expect(patches()[0].body).toEqual({ full_name: 'Marcus S', phone: '+254 700 000 000', avatar_url: 'https://example.com/me.png' })
})

test('shows field messages the server sends back', async () => {
  install({ 'PATCH /me': httpError(400, { phone: 'Phone number is already in use' }) })
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Marcus Sterling'))
  fireEvent.change(phone(), { target: { value: '+254 700 000 000' } })
  fireEvent.click(save())
  await waitFor(() => expect(screen.getByText('Phone number is already in use')).toBeInTheDocument())
  expect(screen.getByText('Some fields need fixing.')).toBeInTheDocument()
})

test('password rules update as you type and the button waits for all of them', async () => {
  install()
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Marcus Sterling'))
  openTab(/Account & security/)
  const update = screen.getByRole('button', { name: /Update password/ })
  expect(update).toBeDisabled()
  const rules = screen.getByLabelText('Password rules')
  expect(within(rules).getByText(/At least 8 characters/).closest('li')).not.toHaveClass('is-met')
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'OldPass123' } })
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'OldPass123' } })
  expect(within(rules).getByText(/Different from the current password/).closest('li')).not.toHaveClass('is-met')
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPass456' } })
  expect(within(rules).getByText(/At least 8 characters/).closest('li')).toHaveClass('is-met')
  expect(within(rules).getByText(/Contains a digit/).closest('li')).toHaveClass('is-met')
  expect(update).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'NewPass456' } })
  expect(update).toBeEnabled()
})

test('changes the password and clears the fields', async () => {
  install()
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Marcus Sterling'))
  openTab(/Account & security/)
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'OldPass123' } })
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPass456' } })
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'NewPass456' } })
  fireEvent.click(screen.getByRole('button', { name: /Update password/ }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Password updated.'))
  const call = calls.find((entry) => entry.key === 'POST /auth/password/change')
  expect(call.body).toEqual({ current_password: 'OldPass123', new_password: 'NewPass456' })
  expect(screen.getByLabelText('Current password')).toHaveValue('')
  expect(screen.getByLabelText('New password')).toHaveValue('')
})

test('shows the server reason when the current password is wrong', async () => {
  install({ 'POST /auth/password/change': httpError(400, { current_password: 'Current password is incorrect' }) })
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Marcus Sterling'))
  openTab(/Account & security/)
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'wrong' } })
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPass456' } })
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'NewPass456' } })
  fireEvent.click(screen.getByRole('button', { name: /Update password/ }))
  await waitFor(() => expect(screen.getByText('Current password is incorrect')).toBeInTheDocument())
  expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByLabelText('Current password')).toHaveValue('wrong')
})

test('password fields can be shown and hidden', async () => {
  install()
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Marcus Sterling'))
  openTab(/Account & security/)
  const field = screen.getByLabelText('New password')
  expect(field).toHaveAttribute('type', 'password')
  fireEvent.click(screen.getByRole('button', { name: 'Show new password' }))
  expect(field).toHaveAttribute('type', 'text')
  fireEvent.click(screen.getByRole('button', { name: 'Hide new password' }))
  expect(field).toHaveAttribute('type', 'password')
})

test('requests a reset email, and explains a rate limit', async () => {
  install()
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Marcus Sterling'))
  openTab(/Account & security/)
  fireEvent.click(screen.getByRole('button', { name: 'Email me a reset link' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('a reset link is on its way'))
  expect(calls.find((entry) => entry.key === 'POST /auth/password/reset').body).toEqual({ email: 'm.sterling@computing.edu' })
  install({ 'POST /auth/password/reset': httpError(429) })
  fireEvent.click(screen.getByRole('button', { name: 'Email me a reset link' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Too many requests'))
  expect(screen.getByText('Two-factor authentication is not offered by the portal yet.')).toBeInTheDocument()
})

test('notification preferences say plainly they are not available yet', async () => {
  install()
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Marcus Sterling'))
  openTab(/Notification preferences/)
  expect(screen.getByText('Notification preferences are not switched on yet')).toBeInTheDocument()
  expect(screen.getByText('Coming in Phase 7')).toBeInTheDocument()
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
})

test('display choices apply to the page and are remembered on this device', async () => {
  install()
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Marcus Sterling'))
  openTab(/Display & accessibility/)
  fireEvent.click(screen.getByRole('radio', { name: /Large \(125%\)/ }))
  expect(document.documentElement.style.zoom).toBe('1.25')
  fireEvent.click(screen.getByRole('switch', { name: 'High contrast' }))
  fireEvent.click(screen.getByRole('switch', { name: 'Reduced motion' }))
  expect(document.documentElement.getAttribute('data-contrast')).toBe('high')
  expect(document.documentElement.getAttribute('data-reduce-motion')).toBe('true')
  expect(JSON.parse(window.localStorage.getItem(DISPLAY_KEY))).toEqual({ size: 125, reduceMotion: true, highContrast: true })
  fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))
  expect(document.documentElement.style.zoom).toBe('')
  expect(document.documentElement.hasAttribute('data-contrast')).toBe(false)
  expect(screen.getByRole('radio', { name: /Standard \(100%\)/ })).toBeChecked()
})

test('signs out other devices only after confirmation', async () => {
  install()
  signOutMock.mockResolvedValue({ error: null })
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Marcus Sterling'))
  openTab('Sessions')
  fireEvent.click(screen.getByRole('button', { name: 'Sign out other devices' }))
  expect(signOutMock).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Keep them' }))
  expect(signOutMock).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Sign out other devices' }))
  fireEvent.click(screen.getByRole('button', { name: 'Yes, sign them out' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('All other devices have been signed out'))
  expect(signOutMock).toHaveBeenCalledWith({ scope: 'others' })
})

test('reports a failed sign-out of other devices and can log this device out', async () => {
  install()
  signOutMock.mockResolvedValue({ error: new Error('boom') })
  auth.logout.mockResolvedValue(undefined)
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Marcus Sterling'))
  openTab('Sessions')
  fireEvent.click(screen.getByRole('button', { name: 'Sign out other devices' }))
  fireEvent.click(screen.getByRole('button', { name: 'Yes, sign them out' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not be signed out'))
  fireEvent.click(screen.getByRole('button', { name: /Log out/ }))
  await waitFor(() => expect(auth.logout).toHaveBeenCalled())
})

test('offers a retry when the profile cannot load', async () => {
  let fail = true
  apiMock.mockImplementation(async () => {
    if (fail) throw httpError(500)
    return me
  })
  renderPage()
  await waitFor(() => expect(screen.getByText('Your profile could not be loaded.')).toBeInTheDocument())
  fail = false
  fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }))
  await waitFor(() => expect(name()).toHaveValue('Marcus Sterling'))
})
