import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  listener: null,
  getSession: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('../src/services/supabase.js', () => ({
  supabase: {
    auth: {
      getSession: h.getSession,
      updateUser: h.updateUser,
      signOut: h.signOut,
      onAuthStateChange: (callback) => {
        h.listener = callback
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
    },
  },
}))

import ResetPassword from '../src/pages/auth/ResetPassword.jsx'

function SignInProbe() {
  const location = useLocation()
  return <p>sign-in page {location.search}</p>
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/reset-password']}>
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/login" element={<SignInProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

// Simulates arriving from the emailed link: Supabase reports a recovery session.
async function openFromEmailLink() {
  h.getSession.mockResolvedValue({ data: { session: { user: {} } } })
  renderPage()
  await act(async () => {})
  act(() => h.listener('PASSWORD_RECOVERY', { user: {} }))
  await screen.findByLabelText('New password')
}

const fill = (first, second) => {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: first } })
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: second } })
  fireEvent.click(screen.getByRole('button', { name: 'Save new password' }))
}

beforeEach(() => {
  h.listener = null
  h.getSession.mockReset()
  h.updateUser.mockReset()
  h.signOut.mockReset()
  h.signOut.mockResolvedValue({ error: null })
})

test('an unknown or expired link says so and offers a new one', async () => {
  h.getSession.mockResolvedValue({ data: { session: null } })
  renderPage()
  expect(await screen.findByText(/invalid or has expired/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute('href', '/forgot-password')
})

test('a signed-in visitor without an email link cannot skip their current password', async () => {
  h.getSession.mockResolvedValue({ data: { session: { user: {} } } })
  renderPage()
  expect(await screen.findByText(/open Settings/)).toBeInTheDocument()
  expect(screen.queryByLabelText('New password')).toBeNull()
})

test('rejects a weak password without calling Supabase', async () => {
  await openFromEmailLink()
  fill('short', 'short')
  expect(screen.getByRole('alert')).toHaveTextContent('Use at least 8 characters with letters and digits.')
  expect(h.updateUser).not.toHaveBeenCalled()
})

test('rejects two different passwords', async () => {
  await openFromEmailLink()
  fill('Secret123', 'Secret124')
  expect(screen.getByRole('alert')).toHaveTextContent('The two passwords do not match.')
  expect(h.updateUser).not.toHaveBeenCalled()
})

test('saves the password, signs out and goes to sign-in with the success flag', async () => {
  h.updateUser.mockResolvedValue({ error: null })
  await openFromEmailLink()
  fill('Secret123', 'Secret123')
  expect(await screen.findByText(/sign-in page \?reset=1/)).toBeInTheDocument()
  expect(h.updateUser).toHaveBeenCalledWith({ password: 'Secret123' })
  expect(h.signOut).toHaveBeenCalled()
})

test('tells the person when the new password equals the old one', async () => {
  h.updateUser.mockResolvedValue({ error: { message: 'New password should be different from the old password.' } })
  await openFromEmailLink()
  fill('Secret123', 'Secret123')
  expect(await screen.findByText('Choose a password different from your current one.')).toBeInTheDocument()
  expect(h.signOut).not.toHaveBeenCalled()
})

test('a lost recovery session turns into the expired-link message', async () => {
  h.updateUser.mockResolvedValue({ error: { message: 'Auth session missing!' } })
  await openFromEmailLink()
  fill('Secret123', 'Secret123')
  expect(await screen.findByText(/invalid or has expired/)).toBeInTheDocument()
})