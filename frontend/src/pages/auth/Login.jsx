import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../../app/AuthContext.jsx'

/*
 * Smart Lecture Portal: Login page
 * Place at: src/pages/Login.jsx
 *
 * - Self-contained: styles are scoped under `.slpl` and injected by this
 *   component, so no Tailwind or extra CSS file is needed.
 * - Fonts (Plus Jakarta Sans) and Material Symbols icons load automatically.
 * - Uses `login(email, password)`, `user` and `loading` from useAuth() in
 *   ../../app/AuthContext.jsx. Once `user` is set, the page sends them to "/", where
 *   the Home route redirects them to their own dashboard (/student or /lecturer).
 */

const FONT_LINKS = [
  {
    id: 'slp-font-jakarta',
    href: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap',
  },
  {
    id: 'slp-font-symbols',
    href: 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap',
  },
]

const ERROR_MESSAGE = "We couldn't sign you in. Check your details and try again."
const PROFILE_MESSAGE =
  "You signed in, but we couldn't load your profile. Please contact your institution's support team."

function renderIcon(name, size) {
  return (
    <span
      className="material-symbols-outlined"
      aria-hidden="true"
      style={size ? { fontSize: size } : undefined}
    >
      {name}
    </span>
  )
}

function Login() {
  const { login, user, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    FONT_LINKS.forEach(({ id, href }) => {
      if (document.getElementById(id)) return
      const link = document.createElement('link')
      link.id = id
      link.rel = 'stylesheet'
      link.href = href
      document.head.appendChild(link)
    })
  }, [])

  // Wait for the saved session check so a signed-in user never sees the form.
  if (loading) return null

  // Already signed in: Home sends each role to its own dashboard.
  if (user) return <Navigate to="/" replace />

  // Sign-in worked but no profile came back, so there is nowhere to send them.
  const message = error || (signedIn ? PROFILE_MESSAGE : '')

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (submitting) return
    const trimmedEmail = email.trim()
    if (!trimmedEmail || !password) {
      setError('Enter your email address and password.')
      return
    }
    setError('')
    setSignedIn(false)
    setSubmitting(true)
    try {
      await login(trimmedEmail, password)
      setSignedIn(true)
    } catch {
      setError(ERROR_MESSAGE)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="slpl">
      <style>{STYLES}</style>

      <header className="slpl-header">
        <div className="slpl-header-inner">
          <Link to="/" className="slpl-brand">
            <span className="slpl-brand-mark">{renderIcon('school', 20)}</span>
            <span className="slpl-brand-text">
              <span className="slpl-brand-name">Smart Lecture Portal</span>
              <span className="slpl-brand-sub">Academic Management Platform</span>
            </span>
          </Link>
          <Link to="/" className="slpl-back">
            {renderIcon('arrow_back', 18)}
            <span>Back to home</span>
          </Link>
        </div>
      </header>

      <main className="slpl-main">
        <section className="slpl-card" aria-labelledby="slpl-title">
          <div className="slpl-intro">
            <h1 id="slpl-title" className="slpl-title">
              Welcome back!
            </h1>
            <p className="slpl-lead">
              Sign in to reach your courses, assignments, attendance, and marks.
            </p>
          </div>

          <form className="slpl-form" onSubmit={handleSubmit} noValidate>
            {message && (
              <div className="slpl-error" role="alert">
                {renderIcon('error', 20)}
                <span>{message}</span>
              </div>
            )}

            <div className="slpl-field">
              <label className="slpl-label" htmlFor="slpl-email">
                Email address
              </label>
              <div className="slpl-control">
                <span className="slpl-icon slpl-icon-left">{renderIcon('mail', 20)}</span>
                <input
                  id="slpl-email"
                  className="slpl-input"
                  type="email"
                  autoComplete="username"
                  placeholder="name@university.edu"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={submitting}
                  required
                />
              </div>
            </div>

            <div className="slpl-field">
              <label className="slpl-label" htmlFor="slpl-password">
                Password
              </label>
              <div className="slpl-control">
                <span className="slpl-icon slpl-icon-left">{renderIcon('lock', 20)}</span>
                <input
                  id="slpl-password"
                  className="slpl-input slpl-input-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={submitting}
                  required
                />
                <button
                  type="button"
                  className="slpl-toggle"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {renderIcon(showPassword ? 'visibility_off' : 'visibility', 20)}
                </button>
              </div>
            </div>

            <button type="submit" className="slpl-submit" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="slpl-spin">{renderIcon('progress_activity', 20)}</span>
                  <span>Signing in...</span>
                </>
              ) : (
                <>
                  <span>Sign in to portal</span>
                  {renderIcon('arrow_forward', 18)}
                </>
              )}
            </button>
          </form>

          <p className="slpl-note">
            {renderIcon('info', 16)}
            <span>
              Accounts are set up by your institution. If you cannot sign in, contact your course
              lecturer or your institution&apos;s support team.
            </span>
          </p>
        </section>
      </main>

      <footer className="slpl-footer">
        <p>© 2026 Smart Lecture Portal · Final Year Computer Science Project</p>
      </footer>
    </div>
  )
}

export default Login

const STYLES = `
.slpl {
  --primary: #a03223;
  --on-primary: #ffffff;
  --primary-container: #c14a38;
  --error: #ba1a1a;
  --error-container: #ffdad6;
  --on-error-container: #93000a;
  --surface: #fef7ff;
  --surface-low: #faf0fe;
  --surface-mid: #f4ebf8;
  --surface-lowest: #ffffff;
  --on-surface: #1e1a23;
  --on-surface-variant: #58413e;
  --outline: #8b716d;
  --outline-variant: #dfbfba;
  --header-h: 64px;
  font-family: 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  background: var(--surface);
  color: var(--on-surface);
  line-height: 1.5;
  text-align: left;
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.slpl *, .slpl *::before, .slpl *::after { box-sizing: border-box; }
.slpl h1, .slpl p { margin: 0; padding: 0; }
.slpl a { color: inherit; text-decoration: none; }
.slpl button, .slpl input { font-family: inherit; }
.slpl .material-symbols-outlined {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  font-size: 24px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  flex-shrink: 0;
  -webkit-font-feature-settings: 'liga';
  font-feature-settings: 'liga';
  -webkit-font-smoothing: antialiased;
}
.slpl a:focus-visible, .slpl button:focus-visible {
  outline: 3px solid var(--primary-container);
  outline-offset: 3px;
  border-radius: 8px;
}

/* Header */
.slpl-header {
  position: fixed; top: 0; left: 0; right: 0; z-index: 50;
  background: rgba(254, 247, 255, 0.85);
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
  box-shadow: 0 1px 8px rgba(0, 0, 0, 0.05);
}
.slpl-header-inner {
  height: var(--header-h); max-width: 1440px; margin: 0 auto; padding: 0 1rem;
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
}
.slpl-brand { display: inline-flex; align-items: center; gap: 0.6rem; border-radius: 8px; }
.slpl-brand-mark {
  width: 36px; height: 36px; border-radius: 12px; background: var(--primary); color: var(--on-primary);
  display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}
.slpl-brand-text { display: flex; flex-direction: column; }
.slpl-brand-name { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.25; }
.slpl-brand-sub { display: none; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; color: var(--on-surface-variant); }
.slpl-back {
  display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.45rem 0.9rem; border-radius: 999px;
  font-size: 12px; font-weight: 600; letter-spacing: 0.02em; color: var(--on-surface-variant);
  transition: background 0.2s, color 0.2s;
}
.slpl-back:hover { background: var(--surface-mid); color: var(--on-surface); }

/* Main + card */
.slpl-main {
  flex: 1; display: flex; align-items: center; justify-content: center;
  padding: calc(var(--header-h) + 1.5rem) 1rem 1.5rem;
}
.slpl-card {
  width: 100%; max-width: 512px; padding: 1.5rem; border-radius: 24px;
  background: var(--surface-lowest); box-shadow: 0 2px 10px rgba(30, 26, 35, 0.08);
}
.slpl-intro { text-align: center; margin-bottom: 1.75rem; }
.slpl-title { font-size: 32px; line-height: 40px; font-weight: 800; letter-spacing: -0.02em; }
.slpl-lead { margin: 0.75rem auto 0; max-width: 28rem; font-size: 14px; line-height: 22px; color: var(--on-surface-variant); }

/* Form */
.slpl-form { display: flex; flex-direction: column; gap: 1rem; }
.slpl-field { display: flex; flex-direction: column; gap: 0.375rem; }
.slpl-label { font-size: 12px; font-weight: 600; letter-spacing: 0.02em; color: var(--on-surface); }
.slpl-control { position: relative; display: flex; align-items: center; }
.slpl-icon {
  position: absolute; top: 0; bottom: 0; width: 44px; display: flex; align-items: center; justify-content: center;
  color: var(--outline); pointer-events: none; transition: color 0.2s;
}
.slpl-icon-left { left: 0; }
.slpl-control:focus-within .slpl-icon { color: var(--primary); }
.slpl-input {
  width: 100%; height: 48px; padding: 0 1rem 0 44px; border-radius: 999px;
  border: 1px solid var(--outline-variant); background: var(--surface-lowest); color: var(--on-surface);
  font-size: 14px; line-height: 22px; outline: none; transition: border-color 0.2s, box-shadow 0.2s;
}
.slpl-input-password { padding-right: 48px; }
.slpl-input::placeholder { color: rgba(139, 113, 109, 0.75); }
.slpl-input:hover { border-color: var(--outline); }
.slpl-input:focus { border-color: var(--on-surface); box-shadow: 0 0 0 1px var(--on-surface); }
.slpl-input:disabled { background: var(--surface-low); cursor: not-allowed; }
.slpl-toggle {
  position: absolute; top: 0; bottom: 0; right: 0; width: 48px; padding: 0; border: 0; background: transparent;
  display: flex; align-items: center; justify-content: center; color: var(--outline); cursor: pointer;
  border-radius: 999px; transition: color 0.2s;
}
.slpl-toggle:hover { color: var(--on-surface); }
.slpl-submit {
  margin-top: 0.5rem; width: 100%; height: 48px; border: 0; border-radius: 999px; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
  background: var(--primary); color: var(--on-primary); font-size: 16px; font-weight: 600;
  box-shadow: 0 2px 6px rgba(160, 50, 35, 0.25); transition: background 0.2s, box-shadow 0.2s, transform 0.1s;
}
.slpl-submit:hover:not(:disabled) { background: var(--primary-container); box-shadow: 0 6px 14px rgba(160, 50, 35, 0.25); }
.slpl-submit:active:not(:disabled) { transform: scale(0.99); }
.slpl-submit:disabled { opacity: 0.75; cursor: progress; }
.slpl-spin { display: inline-flex; animation: slpl-rotate 1s linear infinite; }
@keyframes slpl-rotate { to { transform: rotate(360deg); } }
.slpl-error {
  display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.75rem 1rem; border-radius: 16px;
  background: var(--error-container); color: var(--on-error-container); font-size: 13px; line-height: 18px; font-weight: 500;
}
.slpl-error .material-symbols-outlined { color: var(--error); margin-top: 1px; }
.slpl-note {
  margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid rgba(223, 191, 186, 0.6);
  display: flex; align-items: flex-start; gap: 0.5rem; font-size: 13px; line-height: 18px; color: var(--on-surface-variant);
}
.slpl-note .material-symbols-outlined { color: var(--outline); margin-top: 1px; }

/* Footer */
.slpl-footer {
  background: var(--surface-low); padding: 1.25rem 1rem; text-align: center;
  box-shadow: 0 -1px 6px rgba(0, 0, 0, 0.03); font-size: 12px; font-weight: 600; letter-spacing: 0.02em; color: var(--on-surface-variant);
}

@media (min-width: 640px) {
  .slpl-card { padding: 2.25rem; }
  .slpl-brand-sub { display: block; }
  .slpl-header-inner { padding: 0 2rem; }
}
@media (min-width: 1024px) {
  .slpl-title { font-size: 40px; line-height: 48px; }
}
@media (prefers-reduced-motion: reduce) {
  .slpl-spin { animation: none; }
  .slpl * { transition: none !important; }
}
`
