import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'

vi.mock('../src/app/AuthContext.jsx', () => ({
  useAuth: () => ({ login: vi.fn(), user: null, loading: false }),
}))

import Login from '../src/pages/auth/Login.jsx'

const renderAt = (url) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Login />
    </MemoryRouter>,
  )

test('the sign-in page links to the forgot-password page', () => {
  renderAt('/login')
  expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password')
  expect(screen.queryByText(/Your password was changed/)).toBeNull()
})

test('shows the success banner after a password reset', () => {
  renderAt('/login?reset=1')
  expect(screen.getByRole('status')).toHaveTextContent('Your password was changed')
})