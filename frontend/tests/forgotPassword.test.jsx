import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('../src/services/apiClient.js', () => ({ api: apiMock }))

import ForgotPassword from '../src/pages/auth/ForgotPassword.jsx'

const httpError = (status) => Object.assign(new Error('HTTP ' + status), { status })
const email = () => screen.getByLabelText('Email address')
const send = () => screen.getByRole('button', { name: /send reset link|resend in|send again/i })

function renderPage() {
  return render(
    <MemoryRouter>
      <ForgotPassword />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  apiMock.mockReset()
})

test('links back to the sign-in page', () => {
  renderPage()
  expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login')
})

test('asks for a valid email before calling the server', () => {
  renderPage()
  fireEvent.change(email(), { target: { value: 'not-an-email' } })
  fireEvent.click(send())
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email address.')
  expect(apiMock).not.toHaveBeenCalled()
})

test('sends the trimmed email, gives the neutral answer and starts a resend cooldown', async () => {
  apiMock.mockResolvedValue({ status: 'accepted' })
  renderPage()
  fireEvent.change(email(), { target: { value: '  Alex@Campus.edu ' } })
  fireEvent.click(send())
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('a reset link is on its way'))
  expect(apiMock).toHaveBeenCalledWith('/auth/password/reset', {
    method: 'POST',
    body: { email: 'Alex@Campus.edu' },
  })
  expect(screen.getByRole('button', { name: /resend in/i })).toBeDisabled()
})

test('explains a rate limit', async () => {
  apiMock.mockRejectedValue(httpError(429))
  renderPage()
  fireEvent.change(email(), { target: { value: 'alex@campus.edu' } })
  fireEvent.click(send())
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Too many requests'))
})

test('shows a calm message when the request fails', async () => {
  apiMock.mockRejectedValue(httpError(500))
  renderPage()
  fireEvent.change(email(), { target: { value: 'alex@campus.edu' } })
  fireEvent.click(send())
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not be requested'))
})