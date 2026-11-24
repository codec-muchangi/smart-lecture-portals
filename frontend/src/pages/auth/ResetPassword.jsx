import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase.js'
import AuthCard from './AuthCard.jsx'

// Public page that the emailed link opens. Supabase turns the link into a temporary
// "recovery" session; we use it ONLY to set a new password, then sign out everywhere
// and send the person to the sign-in page.
//
// Read once when the app loads: Supabase removes the token from the address bar a moment
// later, so this is our only chance to know the visitor arrived from a reset email.
// Without it, a signed-in person typing /reset-password could skip their current password.
const CAME_FROM_EMAIL_LINK =
  typeof window !== 'undefined' &&
  /(type=recovery|[?&]code=)/.test(`${window.location.hash}${window.location.search}`)

const TITLES = {
  checking: 'Checking your link',
  ready: 'Choose a new password',
  invalid: 'This link cannot be used',
  signedin: 'You are already signed in',
}

const rulesOf = (value) => [
  { id: 'length', text: 'At least 8 characters', met: value.length >= 8 },
  { id: 'letter', text: 'Contains a letter', met: /[A-Za-z]/.test(value) },
  { id: 'digit', text: 'Contains a digit', met: /\d/.test(value) },
]

export default function ResetPassword() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (active && event === 'PASSWORD_RECOVERY') setPhase('ready')
    })
    supabase.auth
      .getSession()
      .then(({ data: current }) => {
        if (!active) return
        setPhase((now) => {
          if (now === 'ready') return now
          if (!current.session) return 'invalid'
          return CAME_FROM_EMAIL_LINK ? 'ready' : 'signedin'
        })
      })
      .catch(() => {
        if (active) setPhase('invalid')
      })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  const rules = rulesOf(password)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving) return
    if (!rules.every((rule) => rule.met)) {
      setError('Use at least 8 characters with letters and digits.')
      return
    }
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    setError('')
    setSaving(true)
    let failure = null
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      failure = updateError
    } catch (err) {
      failure = err || new Error('failed')
    }
    if (failure) {
      setSaving(false)
      const text = failure.message || ''
      if (/session/i.test(text)) setPhase('invalid')
      else if (/different from the old/i.test(text)) {
        setError('Choose a password different from your current one.')
      } else setError('The password could not be changed. Please try again.')
      return
    }
    try {
      await supabase.auth.signOut()
    } catch {
      // The password is already changed; a failed sign-out must not block the redirect.
    }
    navigate('/login?reset=1', { replace: true })
  }

  return (
    <AuthCard
      title={TITLES[phase]}
      lead={phase === 'ready' ? 'Pick a new password for your account. You will sign in with it straight after.' : ''}
    >
      {phase === 'checking' && (
        <p className="slpa-note" role="status">
          Checking your reset link...
        </p>
      )}

      {phase === 'invalid' && (
        <>
          <div className="slpa-error" role="alert">
            This reset link is invalid or has expired. Links can be used once and expire after a short time.
          </div>
          <Link className="slpa-submit" to="/forgot-password">
            Request a new link
          </Link>
        </>
      )}

      {phase === 'signedin' && (
        <>
          <p className="slpa-note">To change your password while signed in, open Settings in the portal.</p>
          <Link className="slpa-submit" to="/">
            Back to the portal
          </Link>
        </>
      )}

      {phase === 'ready' && (
        <form className="slpa-form" onSubmit={handleSubmit} noValidate>
          {error && (
            <div className="slpa-error" role="alert">
              {error}
            </div>
          )}
          <div className="slpa-field">
            <label className="slpa-label" htmlFor="slpa-new">
              New password
            </label>
            <input
              id="slpa-new"
              className="slpa-input"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={saving}
              required
            />
          </div>
          <ul className="slpa-rules" aria-label="Password rules">
            {rules.map((rule) => (
              <li key={rule.id} className={rule.met ? 'is-met' : ''}>
                {rule.text}
              </li>
            ))}
          </ul>
          <div className="slpa-field">
            <label className="slpa-label" htmlFor="slpa-confirm">
              Confirm new password
            </label>
            <input
              id="slpa-confirm"
              className="slpa-input"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              disabled={saving}
              required
            />
          </div>
          <label className="slpa-check">
            <input type="checkbox" checked={show} onChange={(event) => setShow(event.target.checked)} />
            Show passwords
          </label>
          <button type="submit" className="slpa-submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save new password'}
          </button>
        </form>
      )}
    </AuthCard>
  )
}