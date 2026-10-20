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

import StudentSettings from '../src/pages/student/StudentSettings.jsx'
import { applyDisplay, DISPLAY_DEFAULTS, DISPLAY_KEY } from '../src/utils/display.js'

const ME = {
  id: 'u1',
  role: 'student',
  full_name: 'Alex Chen',
  email: 'alex.chen@campus.edu',
  phone: '+1 (555) 382-9014',
  avatar_url: null,
  created_at: '2023-09-01T08:00:00Z',
  updated_at: '2026-02-20T14:22:00Z',
  details: { registration_number: 'STU-2023-8821', program: 'BSc Computer Science', year_of_study: 3, status: 'active' },
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
        <StudentSettings />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const name = () => screen.getByLabelText(/^Full name/)
const phone = () => screen.getByLabelText(/^Mobile phone/)
const photo = () => screen.getByLabelText(/^Profile photo link/)
const saveProfile = () => screen.getByRole('button', { name: /Save profile changes/ })
const saveAll = () => screen.getByRole('button', { name: 'Save changes' })
const discardAll = () => screen.getByRole('button', { name: 'Discard changes' })
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
  await waitFor(() => expect(name()).toHaveValue('Alex Chen'))
  expect(phone()).toHaveValue('+1 (555) 382-9014')
  const email = screen.getByLabelText(/^Institutional email/)
  expect(email).toHaveValue('alex.chen@campus.edu')
  expect(email).toHaveAttribute('readonly')
  expect(screen.getByLabelText(/^Registration number/)).toHaveValue('STU-2023-8821')
  expect(screen.getByLabelText(/^Registration number/)).toHaveAttribute('readonly')
  expect(screen.getByLabelText(/^Programme/)).toHaveValue('BSc Computer Science')
  expect(screen.getByLabelText(/^Year of study/)).toHaveValue('3')
  const registry = screen.getByLabelText('Registry record')
  expect(within(registry).getByText('Status: Active')).toBeInTheDocument()
  expect(within(registry).getByText('STU-2023-8821')).toBeInTheDocument()
  expect(saveProfile()).toBeDisabled()
  expect(saveAll()).toBeDisabled()
  expect(discardAll()).toBeDisabled()
})

test('saves only what changed, from the header button, and refreshes the signed-in user', async () => {
  install()
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Alex Chen'))
  fireEvent.change(phone(), { target: { value: '' } })
  expect(screen.getByText('You have unsaved changes')).toBeInTheDocument()
  fireEvent.click(saveAll())
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Profile saved.'))
  expect(patches()).toHaveLength(1)
  expect(patches()[0].body).toEqual({ phone: null })
  expect(auth.refresh).toHaveBeenCalled()
  await waitFor(() => expect(saveAll()).toBeDisabled())
})

test('the profile form button saves too, and discard puts the saved values back', async () => {
  install()
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Alex Chen'))
  fireEvent.change(name(), { target: { value: 'Someone Else' } })
  fireEvent.click(discardAll())
  expect(name()).toHaveValue('Alex Chen')
  expect(patches()).toHaveLength(0)
  fireEvent.change(name(), { target: { value: 'Alex C. Chen' } })
  fireEvent.click(saveProfile())
  await waitFor(() => expect(patches()).toHaveLength(1))
  expect(patches()[0].body).toEqual({ full_name: 'Alex C. Chen' })
})

test('checks name, phone and photo link before sending anything', async () => {
  install()
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Alex Chen'))
  fireEvent.change(name(), { target: { value: 'A' } })
  expect(screen.getByText('Enter your full name (2 to 120 characters).')).toBeInTheDocument()
  expect(saveAll()).toBeDisabled()
  fireEvent.change(name(), { target: { value: 'Alex' } })
  fireEvent.change(phone(), { target: { value: 'call me' } })
  expect(screen.getByText('Use 7 to 20 characters: digits, spaces, + - ( ).')).toBeInTheDocument()
  fireEvent.change(phone(), { target: { value: '+254 700 000 000' } })
  fireEvent.change(photo(), { target: { value: 'http://example.com/me.png' } })
  expect(screen.getByText('Use a full https:// link, or leave it empty.')).toBeInTheDocument()
  expect(saveAll()).toBeDisabled()
  fireEvent.change(photo(), { target: { value: 'https://example.com/me.png' } })
  fireEvent.click(saveAll())
  await waitFor(() => expect(patches()).toHaveLength(1))
  expect(patches()[0].body).toEqual({ full_name: 'Alex', phone: '+254 700 000 000', avatar_url: 'https://example.com/me.png' })
})

test('falls back to initials when the photo link does not load', async () => {
  me = { ...ME, avatar_url: 'https://example.com/missing.png' }
  install()
  const { container } = renderPage()
  await waitFor(() => expect(container.querySelector('.slpz-avatar img')).not.toBeNull())
  fireEvent.error(container.querySelector('.slpz-avatar img'))
  expect(container.querySelector('.slpz-avatar img')).toBeNull()
  expect(container.querySelector('.slpz-avatar')).toHaveTextContent('AC')
})

test('shows the photo from the link and can remove it', async () => {
  me = { ...ME, avatar_url: 'https://example.com/alex.png' }
  install()
  const { container } = renderPage()
  await waitFor(() => expect(photo()).toHaveValue('https://example.com/alex.png'))
  expect(container.querySelector('.slpz-avatar img')).toHaveAttribute('src', 'https://example.com/alex.png')
  fireEvent.click(screen.getByRole('button', { name: /Remove photo/ }))
  expect(photo()).toHaveValue('')
  expect(container.querySelector('.slpz-avatar img')).toBeNull()
  expect(screen.getByRole('button', { name: /Remove photo/ })).toBeDisabled()
  fireEvent.click(saveAll())
  await waitFor(() => expect(patches()).toHaveLength(1))
  expect(patches()[0].body).toEqual({ avatar_url: null })
})

test('shows field messages the server sends back', async () => {
  install({ 'PATCH /me': httpError(400, { phone: 'Phone number is already in use' }) })
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Alex Chen'))
  fireEvent.change(phone(), { target: { value: '+254 700 000 000' } })
  fireEvent.click(saveAll())
  await waitFor(() => expect(screen.getByText('Phone number is already in use')).toBeInTheDocument())
  expect(screen.getByText('Some fields need fixing.')).toBeInTheDocument()
  fireEvent.change(phone(), { target: { value: '+254 700 000 001' } })
  expect(screen.queryByText('Phone number is already in use')).not.toBeInTheDocument()
})

test('password rules update as you type and the button waits for all of them', async () => {
  install()
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Alex Chen'))
  const update = screen.getByRole('button', { name: /Update password/ })
  expect(update).toBeDisabled()
  const rules = screen.getByLabelText('Password rules')
  expect(screen.getByText('0 of 5')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'OldPass123' } })
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'OldPass123' } })
  expect(within(rules).getByText(/Different from the current password/).closest('li')).not.toHaveClass('is-met')
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPass456' } })
  expect(within(rules).getByText(/At least 8 characters/).closest('li')).toHaveClass('is-met')
  expect(screen.getByText('4 of 5')).toBeInTheDocument()
  expect(update).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'NewPass456' } })
  expect(screen.getByText('5 of 5')).toBeInTheDocument()
  expect(update).toBeEnabled()
})

test('changes the password and clears the fields', async () => {
  install()
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Alex Chen'))
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'OldPass123' } })
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPass456' } })
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'NewPass456' } })
  fireEvent.click(screen.getByRole('button', { name: /Update password/ }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Password updated.'))
  expect(calls.find((entry) => entry.key === 'POST /auth/password/change').body).toEqual({ current_password: 'OldPass123', new_password: 'NewPass456' })
  expect(screen.getByLabelText('Current password')).toHaveValue('')
  expect(screen.getByLabelText('New password')).toHaveValue('')
})

test('shows the server reason when the current password is wrong', async () => {
  install({ 'POST /auth/password/change': httpError(400, { current_password: 'Current password is incorrect' }) })
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Alex Chen'))
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
  await waitFor(() => expect(name()).toHaveValue('Alex Chen'))
  const field = screen.getByLabelText('New password')
  expect(field).toHaveAttribute('type', 'password')
  fireEvent.click(screen.getByRole('button', { name: 'Show new password' }))
  expect(field).toHaveAttribute('type', 'text')
  fireEvent.click(screen.getByRole('button', { name: 'Hide new password' }))
  expect(field).toHaveAttribute('type', 'password')
})

test('"Forgot password?" requests a reset email, and explains a rate limit', async () => {
  install()
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Alex Chen'))
  fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('a reset link is on its way'))
  expect(calls.find((entry) => entry.key === 'POST /auth/password/reset').body).toEqual({ email: 'alex.chen@campus.edu' })
  install({ 'POST /auth/password/reset': httpError(429) })
  fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Too many requests'))
})

test('notification preferences say plainly they are not available yet', async () => {
  install()
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Alex Chen'))
  expect(screen.getByText('Notification preferences are not switched on yet')).toBeInTheDocument()
  expect(screen.getByText('Coming in Phase 7')).toBeInTheDocument()
  const notifications = screen.getByLabelText('Notification preferences', { selector: 'section' })
  expect(within(notifications).queryByRole('switch')).not.toBeInTheDocument()
})

test('display choices apply to the page and are remembered on this device', async () => {
  install()
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Alex Chen'))
  fireEvent.click(screen.getByRole('radio', { name: /Large \(125%\)/ }))
  expect(document.documentElement.style.zoom).toBe('1.25')
  fireEvent.click(screen.getByRole('switch', { name: 'High contrast' }))
  fireEvent.click(screen.getByRole('switch', { name: 'Reduced motion' }))
  expect(document.documentElement.getAttribute('data-contrast')).toBe('high')
  expect(document.documentElement.getAttribute('data-reduce-motion')).toBe('true')
  expect(JSON.parse(window.localStorage.getItem(DISPLAY_KEY))).toEqual({ size: 125, reduceMotion: true, highContrast: true })
  fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))
  expect(document.documentElement.style.zoom).toBe('')
  expect(screen.getByRole('radio', { name: /Standard \(100%\)/ })).toBeChecked()
})

test('section pills jump to their section and mark the current one', async () => {
  install()
  const scrollTo = vi.fn()
  window.HTMLElement.prototype.scrollIntoView = scrollTo
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Alex Chen'))
  const pill = screen.getByRole('button', { name: /Display & accessibility/ })
  expect(screen.getByRole('button', { name: /Profile information/ })).toHaveAttribute('aria-current', 'true')
  fireEvent.click(pill)
  expect(pill).toHaveAttribute('aria-current', 'true')
  expect(screen.getByRole('button', { name: /Profile information/ })).not.toHaveAttribute('aria-current')
  expect(scrollTo).toHaveBeenCalled()
  delete window.HTMLElement.prototype.scrollIntoView
})

test('logs out this device only, and signs out everywhere only after confirmation', async () => {
  install()
  signOutMock.mockResolvedValue({ error: null })
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Alex Chen'))
  fireEvent.click(screen.getByRole('button', { name: /Log out current session/ }))
  await waitFor(() => expect(signOutMock).toHaveBeenCalledWith({ scope: 'local' }))
  signOutMock.mockClear()
  fireEvent.click(screen.getByRole('button', { name: /Log out of all devices/ }))
  expect(signOutMock).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Keep me signed in' }))
  expect(signOutMock).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /Log out of all devices/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Yes, sign out everywhere' }))
  await waitFor(() => expect(signOutMock).toHaveBeenCalledWith({ scope: 'global' }))
})

test('reports sign-out failures', async () => {
  install()
  signOutMock.mockResolvedValue({ error: new Error('boom') })
  renderPage()
  await waitFor(() => expect(name()).toHaveValue('Alex Chen'))
  fireEvent.click(screen.getByRole('button', { name: /Log out current session/ }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('You could not be signed out'))
  fireEvent.click(screen.getByRole('button', { name: /Log out of all devices/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Yes, sign out everywhere' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not be signed out'))
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
  await waitFor(() => expect(name()).toHaveValue('Alex Chen'))
})
