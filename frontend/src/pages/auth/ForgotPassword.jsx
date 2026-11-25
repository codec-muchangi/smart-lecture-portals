import { useEffect, useState } from 'react'
import { api } from '../../services/apiClient.js'
import AuthCard from './AuthCard.jsx'

// Public page: asks for an email and calls POST /auth/password/reset. The server answers
// the same way for known and unknown addresses (so nobody can probe which accounts
// exist), and so does this page. The server also rate-limits (5 per 15 min per IP).

const COOLDOWN_SECONDS = 60
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sentTo, setSentTo] = useState('')
  const [error, setError] = useState('')
  const [wait, setWait] = useState(0)

  useEffect(() => {
    if (wait <= 0) return undefined
    const timer = setTimeout(() => setWait((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [wait])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (submitting || wait > 0) return
    const address = email.trim()
    if (!EMAIL_PATTERN.test(address)) {
      setError('Enter a valid email address.')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      await api('/auth/password/reset', { method: 'POST', body: { email: address } })
      setSentTo(address)
      setWait(COOLDOWN_SECONDS)
    } catch (err) {
      setSentTo('')
      if (err?.status === 429) {
        setError('Too many requests. Please wait a few minutes and try again.')
        setWait(COOLDOWN_SECONDS)
      } else {
        setError('The reset email could not be requested. Please try again shortly.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  let label = 'Send reset link'
  if (submitting) label = 'Sending...'
  else if (wait > 0) label = `Resend in ${wait}s`
  else if (sentTo) label = 'Send again'

  return (
    <AuthCard
      title="Forgot your password?"
      lead="Enter the email address of your account and we will send you a link to choose a new password."
    >
      <form className="slpa-form" onSubmit={handleSubmit} noValidate>
        {error && (
          <div className="slpa-error" role="alert">
            {error}
          </div>
        )}
        {sentTo && !error && (
          <div className="slpa-ok" role="status">
            {`If an account exists for ${sentTo}, a reset link is on its way. Check your inbox and spam folder. The link can be used once and expires after a short time.`}
          </div>
        )}
        <div className="slpa-field">
          <label className="slpa-label" htmlFor="slpa-email">
            Email address
          </label>
          <input
            id="slpa-email"
            className="slpa-input"
            type="email"
            autoComplete="email"
            placeholder="name@university.edu"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={submitting}
            required
          />
        </div>
        <button type="submit" className="slpa-submit" disabled={submitting || wait > 0}>
          {label}
        </button>
      </form>
    </AuthCard>
  )
}