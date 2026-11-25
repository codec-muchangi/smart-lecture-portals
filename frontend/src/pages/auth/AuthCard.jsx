import { useEffect } from 'react'
import { Link } from 'react-router-dom'

const FONT_ID = 'slp-font-jakarta'
const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap'

// Shared frame for the public password-reset pages. They can be opened straight from
// an email, so they bring their own scoped styles and font (same look as sign-in).
export default function AuthCard({ title, lead, children }) {
  useEffect(() => {
    if (document.getElementById(FONT_ID)) return
    const link = document.createElement('link')
    link.id = FONT_ID
    link.rel = 'stylesheet'
    link.href = FONT_HREF
    document.head.appendChild(link)
  }, [])

  return (
    <div className="slpa">
      <style>{STYLES}</style>
      <header className="slpa-header">
        <Link to="/" className="slpa-brand">
          Smart Lecture Portal
        </Link>
        <Link to="/login" className="slpa-back">
          Back to sign in
        </Link>
      </header>
      <main className="slpa-main">
        <section className="slpa-card" aria-labelledby="slpa-title">
          <h1 id="slpa-title" className="slpa-title">
            {title}
          </h1>
          {lead ? <p className="slpa-lead">{lead}</p> : null}
          {children}
        </section>
      </main>
      <footer className="slpa-footer">
        <p>Smart Lecture Portal</p>
      </footer>
    </div>
  )
}

const STYLES = `
.slpa {
  --primary: #a03223; --primary-container: #c14a38; --on-primary: #ffffff;
  --error: #ba1a1a; --error-container: #ffdad6; --on-error-container: #93000a;
  --surface: #fef7ff; --surface-low: #faf0fe; --surface-lowest: #ffffff;
  --on-surface: #1e1a23; --on-surface-variant: #58413e;
  --outline: #8b716d; --outline-variant: #dfbfba;
  font-family: 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  background: var(--surface); color: var(--on-surface); line-height: 1.5;
  min-height: 100vh; display: flex; flex-direction: column; text-align: left;
}
.slpa *, .slpa *::before, .slpa *::after { box-sizing: border-box; }
.slpa h1, .slpa p { margin: 0; padding: 0; }
.slpa a { color: inherit; text-decoration: none; }
.slpa button, .slpa input { font-family: inherit; }
.slpa a:focus-visible, .slpa button:focus-visible, .slpa input:focus-visible {
  outline: 3px solid var(--primary-container); outline-offset: 3px; border-radius: 8px;
}
.slpa-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem 1.5rem; background: rgba(254, 247, 255, 0.85); box-shadow: 0 1px 8px rgba(0, 0, 0, 0.05); }
.slpa-brand { font-size: 16px; font-weight: 700; }
.slpa-back { font-size: 12px; font-weight: 600; color: var(--on-surface-variant); padding: 0.45rem 0.9rem; border-radius: 999px; }
.slpa-back:hover { background: var(--surface-low); }
.slpa-main { flex: 1; display: flex; align-items: center; justify-content: center; padding: 1.5rem 1rem; }
.slpa-card { width: 100%; max-width: 480px; padding: 1.5rem; border-radius: 24px; background: var(--surface-lowest); box-shadow: 0 2px 10px rgba(30, 26, 35, 0.08); display: flex; flex-direction: column; gap: 1rem; }
.slpa-title { font-size: 28px; line-height: 36px; font-weight: 800; letter-spacing: -0.02em; text-align: center; }
.slpa-lead { font-size: 14px; line-height: 22px; color: var(--on-surface-variant); text-align: center; }
.slpa-form { display: flex; flex-direction: column; gap: 1rem; }
.slpa-field { display: flex; flex-direction: column; gap: 0.375rem; }
.slpa-label { font-size: 12px; font-weight: 600; letter-spacing: 0.02em; }
.slpa-input { width: 100%; height: 48px; padding: 0 1rem; border-radius: 999px; border: 1px solid var(--outline-variant); background: var(--surface-lowest); color: var(--on-surface); font-size: 14px; outline: none; }
.slpa-input:hover { border-color: var(--outline); }
.slpa-input:focus { border-color: var(--on-surface); box-shadow: 0 0 0 1px var(--on-surface); }
.slpa-input:disabled { background: var(--surface-low); cursor: not-allowed; }
.slpa-submit { width: 100%; height: 48px; border: 0; border-radius: 999px; background: var(--primary); color: var(--on-primary); font-size: 16px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(160, 50, 35, 0.25); }
.slpa-submit:hover:not(:disabled) { background: var(--primary-container); }
.slpa-submit:disabled { opacity: 0.75; cursor: not-allowed; }
.slpa-error { padding: 0.75rem 1rem; border-radius: 16px; background: var(--error-container); color: var(--on-error-container); font-size: 13px; line-height: 18px; font-weight: 500; }
.slpa-ok { padding: 0.75rem 1rem; border-radius: 16px; background: #e6f4ea; color: #14532d; font-size: 13px; line-height: 18px; font-weight: 500; }
.slpa-note { font-size: 13px; color: var(--on-surface-variant); text-align: center; }
.slpa-rules { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.25rem; font-size: 12px; color: var(--on-surface-variant); }
.slpa-rules li { display: flex; align-items: center; gap: 0.5rem; }
.slpa-rules li::before { content: ''; width: 8px; height: 8px; border-radius: 50%; border: 1px solid var(--outline); }
.slpa-rules li.is-met { color: #14532d; font-weight: 600; }
.slpa-rules li.is-met::before { background: #1e8e3e; border-color: #1e8e3e; }
.slpa-check { display: flex; align-items: center; gap: 0.5rem; font-size: 13px; cursor: pointer; }
.slpa-footer { background: var(--surface-low); padding: 1.25rem 1rem; text-align: center; font-size: 12px; font-weight: 600; color: var(--on-surface-variant); }
`