import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

/*
 * Smart Lecture Portal: Landing page
 * Place at: src/pages/Landing.jsx
 *
 * - Fully self-contained: styles are scoped under `.slp` and injected by this
 *   component, so no Tailwind or extra CSS file is needed.
 * - Fonts (Plus Jakarta Sans) and Material Symbols icons are loaded
 *   automatically the first time the page mounts.
 * - Requires `react-router-dom`. Route used: /login.
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

const NAV_LINKS = [
  { label: 'Home', href: '#home' },
  { label: 'Features', href: '#features' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'For Students', href: '#students' },
  { label: 'For Lecturers', href: '#lecturers' },
]

const TRUST_CHIPS = [
  { icon: 'verified_user', label: 'Role-based access' },
  { icon: 'cloud_sync', label: 'Private file storage' },
  { icon: 'notifications_active', label: 'Real-time alerts' },
  { icon: 'history_edu', label: 'Audit-tracked marks' },
]

const COMPARISONS = [
  {
    legacyIcon: 'sms_failed',
    legacy: 'Notes scattered across WhatsApp group chats',
    icon: 'folder_special',
    solution: 'One organized course materials library',
  },
  {
    legacyIcon: 'mark_email_unread',
    legacy: 'Assignments handed in through messy email threads',
    icon: 'task',
    solution: 'Deadline-aware online submission',
  },
  {
    legacyIcon: 'receipt_long',
    legacy: 'Attendance taken on paper sign-in sheets',
    icon: 'fact_check',
    solution: 'Digital sessions with instant attendance percentages',
  },
  {
    legacyIcon: 'table_rows',
    legacy: 'Marks kept in offline, error-prone spreadsheets',
    icon: 'shield_with_heart',
    solution: 'Validated, auditable, release-controlled results',
  },
  {
    legacyIcon: 'notification_important',
    legacy: 'Missed venue updates and timetable changes',
    icon: 'broadcast_on_home',
    solution: 'One notice board with instant in-app alerts',
  },
]

const FEATURES = [
  {
    icon: 'local_library',
    title: 'Learning Library',
    text: 'Upload, organize, and share lecture notes and resources with the right class only.',
    tag: 'PDF, DOCX, PPTX',
  },
  {
    icon: 'assignment_turned_in',
    title: 'Smart Assignments',
    text: 'Create, publish, and collect coursework with clear, deadline-aware submission.',
    tag: 'Deadline-aware',
  },
  {
    icon: 'rate_review',
    title: 'Grade & Feedback',
    text: 'Mark submissions, add comments, and release results when you are ready.',
    tag: 'Release-controlled',
  },
  {
    icon: 'co_present',
    title: 'Attendance Tracker',
    text: 'Mark registers in seconds and let attendance percentages calculate themselves.',
    tag: 'Auto percentages',
  },
  {
    icon: 'calculate',
    title: 'Marks Centre',
    text: 'Manage CATs, practicals, and exams with weighted totals and publish controls.',
    tag: 'Weighted totals',
  },
  {
    icon: 'campaign',
    title: 'Course Notices',
    text: 'Broadcast announcements to every enrolled student instantly.',
    tag: 'Enrolled students',
  },
  {
    icon: 'notifications',
    title: 'Never-Miss Alerts',
    text: 'Get in-app alerts for new materials, upcoming deadlines, and released marks.',
    tag: 'In-app alerts',
  },
  {
    icon: 'calendar_view_week',
    title: 'Class Schedule',
    text: 'Your teaching or learning week, organized at a glance.',
    tag: 'Room and time',
  },
  {
    icon: 'insights',
    title: 'Insight Reports',
    text: 'See attendance, submission, and performance summaries without spreadsheet formulas.',
    tag: 'Course-level',
  },
  {
    icon: 'dashboard',
    title: 'Personal Dashboard',
    text: 'Everything that needs your attention today, right on your home screen.',
    tag: 'Role-based',
  },
]

const STUDENT_POINTS = [
  'See every course, deadline, and announcement in one dashboard',
  'Download course materials any time',
  'Submit assignments online with instant confirmation',
  'Track your attendance percentage before it becomes a problem',
  'View released marks and lecturer feedback',
  'Get notified about what is new',
]

const LECTURER_POINTS = [
  'Manage your assigned courses from one workspace',
  'Publish materials and assignments in minutes',
  'Review and grade submissions with feedback',
  'Take attendance and enter marks with built-in validation',
  'Control exactly when results become visible',
  'Spot trends with course-level reports',
]

const STEPS = [
  {
    title: 'Sign In',
    text: 'Your role takes you straight to your own dashboard, with your courses already in place.',
  },
  {
    title: 'Engage',
    text: 'Lecturers publish materials, take attendance, and set assignments. Students learn, submit, and track their progress.',
  },
  {
    title: 'Stay Informed',
    text: 'Marks, attendance, and updates reach the right people automatically, with changes recorded for accountability.',
  },
]

const SECURITY_ITEMS = [
  {
    icon: 'admin_panel_settings',
    title: 'Role-based access',
    text: 'You see only what belongs to your role and your courses.',
  },
  {
    icon: 'inventory_2',
    title: 'Private storage',
    text: 'Submissions and course materials are kept in private storage.',
  },
  {
    icon: 'history',
    title: 'Audit-logged changes',
    text: 'Mark updates and attendance corrections are recorded with a timestamp.',
  },
  {
    icon: 'key',
    title: 'Secure authentication',
    text: 'Managed sign-in and password protection.',
  },
  {
    icon: 'privacy_tip',
    title: 'Built to respect student privacy',
    text: 'Students see only their own released marks.',
    wide: true,
  },
]

const FOOTER_COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'Features', href: '#features' },
      { label: 'How it works', href: '#how-it-works' },
    ],
  },
  {
    title: 'Access',
    links: [
      { label: 'Student login', to: '/login' },
      { label: 'Lecturer login', to: '/login' },
    ],
  },
  {
    title: 'Support',
    links: [
      { label: 'Help', href: '#how-it-works' },
      { label: 'Privacy', href: '#security' },
      { label: 'Back to top', href: '#top' },
    ],
  },
]

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

function Logo() {
  return (
    <span className="slp-logo">
      <span className="slp-logo-mark">
        {renderIcon('school', 20)}
      </span>
      <span className="slp-logo-text">Smart Lecture Portal</span>
    </span>
  )
}

function Landing() {
  const [menuOpen, setMenuOpen] = useState(false)

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

  const closeMenu = () => setMenuOpen(false)

  return (
    <div className="slp" id="top">
      <style>{STYLES}</style>

      {/* Header */}
      <header className="slp-header">
        <div className="slp-header-inner">
          <a href="#top" className="slp-brand" aria-label="Smart Lecture Portal home">
            <Logo />
          </a>

          <nav className="slp-nav" aria-label="Primary">
            {NAV_LINKS.map((item) => (
              <a key={item.label} href={item.href}>
                {item.label}
              </a>
            ))}
          </nav>

          <div className="slp-header-actions">
            <Link to="/login" className="slp-btn slp-btn-outline slp-btn-sm">
              Log in
            </Link>
            <button
              type="button"
              className="slp-menu-toggle"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              aria-controls="slp-mobile-menu"
              onClick={() => setMenuOpen((open) => !open)}
            >
              {renderIcon(menuOpen ? 'close' : 'menu', 24)}
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav id="slp-mobile-menu" className="slp-mobile-menu" aria-label="Mobile">
            {NAV_LINKS.map((item) => (
              <a key={item.label} href={item.href} onClick={closeMenu}>
                {item.label}
              </a>
            ))}
          </nav>
        )}
      </header>

      <main className="slp-main">
        {/* Hero */}
        <div className="slp-hero-bg">
          <section className="slp-container slp-hero" id="home">
            <div className="slp-hero-copy">
              <div className="slp-pill">
                <span className="slp-pill-dot" />
                <span>Academic Management Platform</span>
              </div>

              <h1 className="slp-h1">
                Your Entire Course, <br className="slp-br" />
                <span className="slp-h1-accent">in One Connected Place.</span>
              </h1>

              <p className="slp-lead">
                Smart Lecture Portal brings materials, assignments, attendance, marks, and
                announcements together in one secure platform, so lecturers spend less time on
                admin and students never miss a beat.
              </p>

              <div className="slp-hero-actions">
                <Link to="/login" className="slp-btn slp-btn-primary slp-btn-lg">
                  Sign in to your portal
                </Link>
                <a href="#how-it-works" className="slp-btn slp-btn-light slp-btn-lg">
                  {renderIcon('play_circle', 20)}
                  See how it works
                </a>
              </div>

              <p className="slp-caption">
                Built for lecturers and students. Secure, responsive, and ready on any device.
              </p>

              <ul className="slp-chips">
                {TRUST_CHIPS.map((chip) => (
                  <li key={chip.label}>
                    {renderIcon(chip.icon, 18)}
                    <span>{chip.label}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Dashboard collage (no photos) */}
            <div className="slp-hero-visual" aria-hidden="true">
              <div className="slp-stage">
                <div className="slp-stage-bg" />
                <div className="slp-stage-glow" />

                <div className="slp-stage-content">
                  <div className="slp-toast">
                    <div className="slp-toast-icon">
                      {renderIcon('check_circle', 18)}
                    </div>
                    <div>
                      <div className="slp-toast-title">Marks released</div>
                      <div className="slp-toast-text">Your lecturer graded CAT 1</div>
                    </div>
                  </div>

                  <div className="slp-dash">
                    <div className="slp-dash-head">
                      <div className="slp-dash-who">
                        <div className="slp-dash-badge">CS</div>
                        <div>
                          <div className="slp-dash-title">Welcome, Demo Lecturer</div>
                          <div className="slp-dash-sub">CIT 3253 · Network Administration</div>
                        </div>
                      </div>
                      <span className="slp-tag">Week 7 · Active</span>
                    </div>

                    <div className="slp-dash-grid">
                      <div className="slp-mini slp-mini-row">
                        <svg className="slp-ring" viewBox="0 0 36 36" focusable="false">
                          <path
                            className="slp-ring-track"
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            fill="none"
                            strokeWidth="3.5"
                          />
                          <path
                            className="slp-ring-value"
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                            fill="none"
                            strokeDasharray="92, 100"
                            strokeLinecap="round"
                            strokeWidth="3.5"
                          />
                        </svg>
                        <div>
                          <div className="slp-stat">92%</div>
                          <div className="slp-stat-label">Class attendance</div>
                        </div>
                      </div>

                      <div className="slp-mini">
                        <div className="slp-mini-top">
                          <span className="slp-stat-label">CAT 1 average</span>
                          <span className="slp-tag slp-tag-sm">Released</span>
                        </div>
                        <div className="slp-score">
                          <span className="slp-stat slp-stat-primary">42</span>
                          <span className="slp-dash-sub">/ 50</span>
                        </div>
                      </div>
                    </div>

                    <div className="slp-strip">
                      <div className="slp-strip-info">
                        {renderIcon('assignment', 20)}
                        <div>
                          <div className="slp-strip-title">Assignment 1: Introduction</div>
                          <div className="slp-dash-sub">Due Friday · 48 of 52 submitted</div>
                        </div>
                      </div>
                      <span className="slp-strip-btn">Review</span>
                    </div>
                  </div>

                  <div className="slp-float-row">
                    <div className="slp-note">
                      <div className="slp-note-icon">
                        {renderIcon('campaign', 18)}
                      </div>
                      <div className="slp-note-copy">
                        <div className="slp-note-title">New lecture notes uploaded</div>
                        <div className="slp-dash-sub">Chapter 4: Byzantine Faults</div>
                      </div>
                    </div>
                    <div className="slp-quick">
                      {renderIcon('fact_check', 16)}
                      <span>Take attendance</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Problem to solution */}
        <section className="slp-band">
          <div className="slp-container">
            <div className="slp-head">
              <div className="slp-eyebrow">Operational clarity</div>
              <h2 className="slp-h2">Academic life shouldn&apos;t live in five different places.</h2>
              <p className="slp-body">
                Replace scattered chat groups, buried email attachments, and manual calculations
                with a single source of truth for your course.
              </p>
            </div>

            <div className="slp-rows">
              {COMPARISONS.map((row) => (
                <div className="slp-row" key={row.legacy}>
                  <div className="slp-row-before">
                    <span className="slp-row-icon slp-muted">
                      {renderIcon(row.legacyIcon, 22)}
                    </span>
                    <div>
                      <div className="slp-micro slp-muted">Before</div>
                      <div>{row.legacy}</div>
                    </div>
                  </div>
                  <div className="slp-row-arrow">
                    {renderIcon('east')}
                  </div>
                  <div className="slp-row-after">
                    <span className="slp-row-icon slp-accent">
                      {renderIcon(row.icon, 22)}
                    </span>
                    <div>
                      <div className="slp-micro slp-accent">Smart Lecture Portal</div>
                      <div className="slp-row-solution">{row.solution}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="slp-container slp-section" id="features">
          <div className="slp-head">
            <div className="slp-eyebrow">Platform capabilities</div>
            <h2 className="slp-h2">Built for the way university courses actually run</h2>
            <p className="slp-body">
              Every tool is designed to cut administrative work and keep academic records accurate.
            </p>
          </div>

          <div className="slp-features">
            {FEATURES.map((feature) => (
              <article className="slp-feature" key={feature.title}>
                <div>
                  <div className="slp-feature-icon">
                    {renderIcon(feature.icon, 24)}
                  </div>
                  <h3 className="slp-h3">{feature.title}</h3>
                  <p className="slp-small">{feature.text}</p>
                </div>
                <div className="slp-feature-tag">{feature.tag}</div>
              </article>
            ))}
          </div>
        </section>

        {/* Role panels */}
        <section className="slp-container slp-section slp-section-tight">
          <div className="slp-roles">
            <article className="slp-role" id="students">
              <div className="slp-role-icon">
                {renderIcon('school', 26)}
              </div>
              <h2 className="slp-h2">Know where you stand, always.</h2>
              <p className="slp-body">For students</p>
              <ul className="slp-checks">
                {STUDENT_POINTS.map((point) => (
                  <li key={point}>
                    {renderIcon('check_circle', 20)}
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
              <Link to="/login" className="slp-btn slp-btn-primary slp-btn-lg">
                Student login
              </Link>
            </article>

            <article className="slp-role slp-role-alt" id="lecturers">
              <div className="slp-role-icon">
                {renderIcon('co_present', 26)}
              </div>
              <h2 className="slp-h2">Less admin. More teaching.</h2>
              <p className="slp-body">For lecturers</p>
              <ul className="slp-checks">
                {LECTURER_POINTS.map((point) => (
                  <li key={point}>
                    {renderIcon('check_circle', 20)}
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
              <Link to="/login" className="slp-btn slp-btn-outline slp-btn-lg">
                Lecturer login
              </Link>
            </article>
          </div>
        </section>

        {/* How it works */}
        <section className="slp-container slp-section" id="how-it-works">
          <div className="slp-head slp-head-center">
            <div className="slp-eyebrow">Streamlined workflow</div>
            <h2 className="slp-h2">How Smart Lecture Portal works</h2>
            <p className="slp-body">
              No complicated setup. Sign in once and your courses are waiting for you.
            </p>
          </div>

          <ol className="slp-steps">
            {STEPS.map((step, index) => (
              <li className="slp-step" key={step.title}>
                <div className="slp-step-num">{index + 1}</div>
                <h3 className="slp-h3 slp-h3-lg">{step.title}</h3>
                <p className="slp-body">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Security */}
        <section className="slp-band" id="security">
          <div className="slp-container">
            <div className="slp-security">
              <div className="slp-security-intro">
                <div className="slp-role-icon">
                  {renderIcon('lock', 26)}
                </div>
                <div className="slp-eyebrow">Data protection</div>
                <h2 className="slp-h2">Your academic records, protected.</h2>
                <p className="slp-body">
                  Built with accountability in mind. Every mark change and attendance correction is
                  traceable.
                </p>
              </div>

              <div className="slp-security-grid">
                {SECURITY_ITEMS.map((item) => (
                  <div
                    className={item.wide ? 'slp-security-item slp-wide' : 'slp-security-item'}
                    key={item.title}
                  >
                    <span className="slp-accent">
                      {renderIcon(item.icon, 24)}
                    </span>
                    <div>
                      <div className="slp-h3">{item.title}</div>
                      <div className="slp-small">{item.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="slp-container slp-section">
          <div className="slp-cta">
            <span className="slp-cta-blob slp-cta-blob-a" />
            <span className="slp-cta-blob slp-cta-blob-b" />
            <div className="slp-cta-copy">
              <h2 className="slp-h2 slp-on-primary">Ready to bring your course together?</h2>
              <p className="slp-lead slp-on-primary-soft">
                Log in and step into a clearer, calmer academic experience.
              </p>
            </div>
            <Link to="/login" className="slp-btn slp-btn-white slp-btn-lg slp-cta-btn">
              Go to my portal
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="slp-footer">
        <div className="slp-container slp-footer-inner">
          <div className="slp-footer-grid">
            <div className="slp-footer-brand">
              <Logo />
              <p className="slp-small">Smarter lectures. Stronger outcomes.</p>
            </div>

            {FOOTER_COLUMNS.map((column) => (
              <div key={column.title}>
                <div className="slp-footer-title">{column.title}</div>
                <ul className="slp-footer-list">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      {link.to ? (
                        <Link to={link.to}>{link.label}</Link>
                      ) : (
                        <a href={link.href}>{link.label}</a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="slp-footer-bottom">
            <span>© 2026 Smart Lecture Portal · Final Year Computer Science Project</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

const STYLES = `
.slp {
  --primary: #a03223;
  --on-primary: #ffffff;
  --primary-container: #c14a38;
  --on-primary-container: #fff5f3;
  --primary-fixed: #ffdad4;
  --secondary: #9e3e49;
  --secondary-container: #fd8892;
  --on-secondary-container: #76202c;
  --tertiary-container: #b2563e;
  --surface: #fef7ff;
  --surface-low: #faf0fe;
  --surface-mid: #f4ebf8;
  --surface-high: #eee5f2;
  --surface-lowest: #ffffff;
  --on-surface: #1e1a23;
  --on-surface-variant: #58413e;
  --outline: #8b716d;
  --outline-variant: #dfbfba;
  --header-h: 80px;
  font-family: 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  background: var(--surface);
  color: var(--on-surface);
  line-height: 1.5;
  text-align: left;
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
}
.slp *, .slp *::before, .slp *::after { box-sizing: border-box; }
.slp h1, .slp h2, .slp h3, .slp p, .slp ul, .slp ol { margin: 0; padding: 0; }
.slp ul, .slp ol { list-style: none; }
.slp a { color: inherit; text-decoration: none; }
.slp button { font-family: inherit; }
.slp section[id], .slp article[id] { scroll-margin-top: calc(var(--header-h) + 16px); }
.slp .material-symbols-outlined {
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
.slp a:focus-visible, .slp button:focus-visible {
  outline: 3px solid var(--primary-container);
  outline-offset: 3px;
  border-radius: 8px;
}

/* Layout helpers */
.slp-container { width: 100%; max-width: 1440px; margin: 0 auto; padding-left: 2rem; padding-right: 2rem; }
.slp-section { padding-top: 3rem; padding-bottom: 3rem; }
.slp-section-tight { padding-top: 0; }
.slp-band { background: var(--surface-mid); padding: 3rem 0; }
.slp-muted { color: var(--outline); }
.slp-accent { color: var(--primary); }

/* Header */
.slp-header {
  position: fixed; top: 0; left: 0; right: 0; z-index: 50;
  background: rgba(254, 247, 255, 0.85);
  -webkit-backdrop-filter: blur(16px);
  backdrop-filter: blur(16px);
  box-shadow: 0 1px 8px rgba(0, 0, 0, 0.05);
}
.slp-header-inner {
  height: var(--header-h); max-width: 1440px; margin: 0 auto; padding: 0 2rem;
  display: flex; align-items: center; justify-content: space-between; gap: 1.5rem;
}
.slp-brand { display: inline-flex; border-radius: 8px; }
.slp-logo { display: inline-flex; align-items: center; gap: 0.6rem; }
.slp-logo-mark {
  width: 34px; height: 34px; border-radius: 10px; background: var(--primary);
  color: var(--on-primary); display: inline-flex; align-items: center; justify-content: center;
}
.slp-logo-text { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; color: var(--on-surface); }
.slp-nav {
  display: none; align-items: center; gap: 0.25rem; padding: 4px;
  background: rgba(250, 240, 254, 0.8); border-radius: 9999px;
}
.slp-nav a {
  padding: 0.4rem 1rem; border-radius: 9999px; font-size: 13px; font-weight: 500;
  color: var(--on-surface-variant); transition: background 0.2s, color 0.2s;
}
.slp-nav a:hover { background: var(--primary-container); color: var(--on-primary-container); }
.slp-header-actions { display: flex; align-items: center; gap: 0.75rem; }
.slp-menu-toggle {
  display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px;
  border: 0; border-radius: 9999px; background: var(--surface-high); color: var(--on-surface); cursor: pointer;
}
.slp-mobile-menu {
  display: flex; flex-direction: column; gap: 0.25rem; padding: 0.75rem 2rem 1.25rem;
  background: var(--surface); border-top: 1px solid var(--outline-variant);
}
.slp-mobile-menu a { padding: 0.75rem 0.5rem; font-weight: 600; border-radius: 8px; }
.slp-mobile-menu a:hover { background: var(--surface-high); }

/* Buttons */
.slp-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
  border-radius: 9999px; font-weight: 600; letter-spacing: 0.01em; cursor: pointer;
  border: 1px solid transparent; transition: background 0.2s, color 0.2s, box-shadow 0.2s, transform 0.1s;
  white-space: nowrap;
}
.slp-btn:active { transform: scale(0.97); }
.slp-btn-sm { padding: 0.45rem 1.25rem; font-size: 12px; }
.slp-btn-lg { padding: 0.9rem 2rem; font-size: 13px; }
.slp-btn-primary { background: var(--primary); color: var(--on-primary); box-shadow: 0 2px 6px rgba(160, 50, 35, 0.25); }
.slp-btn-primary:hover { background: var(--primary-container); }
.slp-btn-outline { border-color: var(--secondary); color: var(--secondary); background: transparent; }
.slp-btn-outline:hover { background: var(--secondary-container); color: var(--on-secondary-container); }
.slp-btn-light { background: var(--surface-lowest); color: var(--on-surface); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08); }
.slp-btn-light:hover { background: var(--surface-high); }
.slp-btn-light .material-symbols-outlined { color: var(--primary); }
.slp-btn-white { background: var(--surface-lowest); color: var(--primary); box-shadow: 0 6px 16px rgba(0, 0, 0, 0.18); }
.slp-btn-white:hover { background: var(--surface-high); }

/* Main */
.slp-main { padding-top: var(--header-h); background: var(--surface); }
.slp-hero-bg {
  position: relative; overflow: hidden;
  background:
    linear-gradient(to right, rgba(223, 191, 186, 0.22) 1px, transparent 1px) 0 0 / 48px 48px,
    linear-gradient(to bottom, rgba(223, 191, 186, 0.22) 1px, transparent 1px) 0 0 / 48px 48px,
    linear-gradient(to bottom, var(--surface), var(--surface-low), var(--surface));
}
.slp-hero {
  position: relative; display: grid; grid-template-columns: 1fr; gap: 3rem; align-items: center;
  padding-top: 2.5rem; padding-bottom: 3rem;
}
.slp-hero-copy { display: flex; flex-direction: column; align-items: flex-start; position: relative; z-index: 2; }
.slp-pill {
  display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.3rem 1rem;
  background: var(--surface-high); border-radius: 9999px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  font-size: 12px; font-weight: 600; letter-spacing: 0.02em; color: var(--on-surface-variant);
}
.slp-pill-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--primary); animation: slp-pulse 2s ease-in-out infinite; }
@keyframes slp-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.slp-h1 {
  margin-top: 1rem; font-size: 36px; line-height: 1.12; font-weight: 800; letter-spacing: -0.025em;
}
.slp-br { display: none; }
.slp-h1-accent {
  color: var(--primary);
}
.slp-lead { margin-top: 1rem; max-width: 36rem; font-size: 16px; line-height: 1.65; color: var(--on-surface-variant); }
.slp-hero-actions { margin-top: 1.5rem; display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; }
.slp-caption { margin-top: 0.75rem; font-size: 11px; font-weight: 600; letter-spacing: 0.02em; color: var(--outline); }
.slp-chips {
  margin: 2rem 0 0; padding: 1rem 0 0; width: 100%; list-style: none;
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.875rem 1rem;
}
.slp-chips li {
  display: flex; align-items: center; gap: 0.5rem; white-space: nowrap;
  font-size: 12px; line-height: 16px; font-weight: 600; letter-spacing: 0.02em;
  color: var(--on-surface-variant);
}
.slp-chips .material-symbols-outlined {
  flex: 0 0 18px; width: 18px; height: 18px; overflow: hidden;
  line-height: 1; color: var(--primary);
}

/* Hero visual */
.slp-hero-visual { display: flex; align-items: center; justify-content: center; }
.slp-stage { position: relative; width: 100%; max-width: 580px; min-height: 500px; display: flex; align-items: center; justify-content: center; }
.slp-stage-bg {
  position: absolute; inset: 0; border-radius: 48px; transform: rotate(-1deg);
  background: linear-gradient(to top right, rgba(255, 218, 212, 0.45), rgba(238, 229, 242, 0.65), rgba(255, 255, 255, 0.85));
  box-shadow: 0 20px 40px rgba(30, 26, 35, 0.1);
}
.slp-stage-glow {
  position: absolute; top: -24px; right: -24px; width: 128px; height: 128px; border-radius: 50%;
  background: rgba(160, 50, 35, 0.12); filter: blur(32px); pointer-events: none;
}
.slp-stage-content {
  position: relative; width: 100%; height: 100%; min-height: 500px; padding: 1rem;
  display: flex; flex-direction: column; justify-content: space-between; gap: 1rem;
}
.slp-toast {
  align-self: flex-end; z-index: 3; display: flex; align-items: center; gap: 0.5rem;
  background: rgba(255, 255, 255, 0.95); border-radius: 12px; padding: 0.5rem 1rem 0.5rem 0.5rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}
.slp-toast-icon {
  width: 32px; height: 32px; border-radius: 50%; background: var(--surface-high); color: var(--primary);
  display: flex; align-items: center; justify-content: center;
}
.slp-toast-title { font-size: 11px; font-weight: 600; }
.slp-toast-text { font-size: 12px; color: var(--on-surface-variant); }
.slp-dash {
  position: relative; z-index: 2; width: 100%; max-width: 480px; margin: 0 auto;
  background: var(--surface-lowest); border-radius: 20px; padding: 1.5rem;
  box-shadow: 0 20px 40px rgba(30, 26, 35, 0.14); transform: rotate(-1deg); transition: transform 0.3s;
}
.slp-dash:hover { transform: rotate(0deg); }
.slp-dash-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding-bottom: 0.5rem; flex-wrap: wrap; }
.slp-dash-who { display: flex; align-items: center; gap: 0.5rem; }
.slp-dash-badge {
  width: 28px; height: 28px; border-radius: 8px; background: var(--primary-container); color: var(--on-primary-container);
  display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700;
}
.slp-dash-title { font-size: 15px; font-weight: 600; line-height: 1.2; }
.slp-dash-sub { font-size: 12px; color: var(--on-surface-variant); }
.slp-tag {
  padding: 2px 10px; border-radius: 9999px; background: var(--surface-high); color: var(--primary);
  font-size: 11px; font-weight: 600;
}
.slp-tag-sm { padding: 1px 6px; border-radius: 6px; background: var(--surface-mid); }
.slp-dash-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-top: 0.5rem; }
.slp-mini { background: var(--surface-low); border-radius: 12px; padding: 0.5rem 0.75rem; display: flex; flex-direction: column; justify-content: center; }
.slp-mini-row { flex-direction: row; align-items: center; gap: 0.5rem; }
.slp-mini-top { display: flex; align-items: center; justify-content: space-between; gap: 0.25rem; }
.slp-ring { width: 48px; height: 48px; transform: rotate(-90deg); flex-shrink: 0; }
.slp-ring-track { stroke: var(--surface-high); }
.slp-ring-value { stroke: var(--primary); }
.slp-stat { font-size: 20px; font-weight: 700; line-height: 1.2; }
.slp-stat-primary { color: var(--primary); }
.slp-stat-label { font-size: 11px; font-weight: 600; color: var(--on-surface-variant); }
.slp-score { display: flex; align-items: baseline; gap: 0.25rem; margin-top: 0.25rem; }
.slp-strip {
  margin-top: 0.5rem; padding: 0.5rem 0.75rem; background: var(--surface-mid); border-radius: 12px;
  display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
}
.slp-strip-info { display: flex; align-items: center; gap: 0.5rem; }
.slp-strip-info .material-symbols-outlined { color: var(--primary); }
.slp-strip-title { font-size: 12px; font-weight: 600; }
.slp-strip-btn { padding: 4px 12px; border-radius: 9999px; background: var(--primary); color: var(--on-primary); font-size: 11px; font-weight: 600; }
.slp-float-row { z-index: 3; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
.slp-note {
  background: var(--surface-lowest); border-radius: 12px; padding: 0.5rem 0.75rem 0.5rem 0.5rem; max-width: 280px;
  display: flex; align-items: center; gap: 0.5rem; box-shadow: 0 8px 20px rgba(0, 0, 0, 0.1);
}
.slp-note-icon {
  width: 32px; height: 32px; border-radius: 50%; background: var(--primary-fixed); color: #400200;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.slp-note-copy { min-width: 0; }
.slp-note-title { font-size: 12px; font-weight: 600; }
.slp-quick {
  background: var(--primary); color: var(--on-primary); padding: 0.4rem 1rem; border-radius: 9999px;
  display: flex; align-items: center; gap: 0.25rem; font-size: 11px; font-weight: 600;
  box-shadow: 0 4px 10px rgba(160, 50, 35, 0.3);
}

/* Section headings */
.slp-head { max-width: 42rem; margin-bottom: 2rem; }
.slp-head-center { text-align: center; margin-left: auto; margin-right: auto; margin-bottom: 3rem; }
.slp-eyebrow { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--primary); }
.slp-h2 { margin-top: 0.5rem; font-size: 26px; line-height: 1.3; font-weight: 700; letter-spacing: -0.015em; }
.slp-h3 { font-size: 16px; line-height: 1.4; font-weight: 600; margin-bottom: 4px; }
.slp-h3-lg { font-size: 18px; font-weight: 700; margin-top: 0.25rem; }
.slp-body { margin-top: 0.5rem; font-size: 14px; line-height: 1.6; color: var(--on-surface-variant); }
.slp-small { font-size: 13px; line-height: 1.5; color: var(--on-surface-variant); }
.slp-micro { font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }

/* Comparison rows */
.slp-rows { display: flex; flex-direction: column; gap: 0.5rem; }
.slp-row {
  display: grid; grid-template-columns: 1fr; gap: 0.5rem; align-items: center; padding: 1rem;
  background: var(--surface-lowest); border-radius: 12px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  transition: box-shadow 0.2s;
}
.slp-row:hover { box-shadow: 0 6px 16px rgba(0, 0, 0, 0.1); }
.slp-row-before, .slp-row-after { display: flex; align-items: center; gap: 0.75rem; font-size: 14px; }
.slp-row-after { background: rgba(255, 218, 212, 0.25); padding: 0.5rem 0.75rem; border-radius: 8px; }
.slp-row-solution { font-size: 16px; font-weight: 600; }
.slp-row-arrow { display: none; justify-content: center; color: var(--primary); }

/* Features */
.slp-features { display: grid; grid-template-columns: 1fr; gap: 1rem; }
.slp-feature {
  background: var(--surface-lowest); padding: 1rem; border-radius: 12px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  display: flex; flex-direction: column; justify-content: space-between; gap: 1rem; transition: box-shadow 0.2s;
}
.slp-feature:hover { box-shadow: 0 6px 16px rgba(0, 0, 0, 0.1); }
.slp-feature-icon {
  width: 40px; height: 40px; border-radius: 8px; background: var(--surface-high); color: var(--primary);
  display: flex; align-items: center; justify-content: center; margin-bottom: 0.75rem;
}
.slp-feature-tag { font-size: 12px; font-weight: 500; color: var(--outline); }

/* Role panels */
.slp-roles { display: grid; grid-template-columns: 1fr; gap: 1.5rem; }
.slp-role {
  background: var(--surface-lowest); border-radius: 20px; padding: 2rem; box-shadow: 0 6px 16px rgba(0, 0, 0, 0.07);
  display: flex; flex-direction: column; align-items: flex-start;
}
.slp-role-alt { background: var(--surface-mid); }
.slp-role-icon {
  width: 48px; height: 48px; border-radius: 12px; background: var(--primary-fixed); color: var(--primary);
  display: flex; align-items: center; justify-content: center; margin-bottom: 0.75rem;
}
.slp-checks { margin: 1.25rem 0 1.75rem; display: flex; flex-direction: column; gap: 0.6rem; }
.slp-checks li { display: flex; align-items: flex-start; gap: 0.6rem; font-size: 14px; color: var(--on-surface-variant); }
.slp-checks .material-symbols-outlined { color: var(--primary); }

/* Steps */
.slp-steps { position: relative; display: grid; grid-template-columns: 1fr; gap: 1.5rem; }
.slp-step {
  position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; text-align: center;
  padding: 1.5rem; background: var(--surface-lowest); border-radius: 20px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}
.slp-step-num {
  width: 56px; height: 56px; border-radius: 50%; background: var(--primary); color: var(--on-primary);
  display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: 800;
  box-shadow: 0 4px 10px rgba(160, 50, 35, 0.3); margin-bottom: 1rem;
}

/* Security */
.slp-security {
  background: var(--surface-lowest); border-radius: 20px; padding: 2rem; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  display: grid; grid-template-columns: 1fr; gap: 2rem; align-items: center;
}
.slp-security-intro { display: flex; flex-direction: column; align-items: flex-start; }
.slp-security-grid { display: grid; grid-template-columns: 1fr; gap: 0.5rem; }
.slp-security-item { display: flex; align-items: center; gap: 0.75rem; padding: 1rem; background: var(--surface-mid); border-radius: 12px; }

/* CTA */
.slp-cta {
  position: relative; overflow: hidden; background: var(--primary); color: var(--on-primary); border-radius: 28px;
  padding: 2rem; display: flex; flex-direction: column; align-items: center; justify-content: space-between;
  gap: 1.5rem; box-shadow: 0 16px 40px rgba(160, 50, 35, 0.3); text-align: center;
}
.slp-cta-blob { position: absolute; border-radius: 50%; pointer-events: none; }
.slp-cta-blob-a { right: -48px; bottom: -48px; width: 256px; height: 256px; background: var(--primary-container); opacity: 0.5; }
.slp-cta-blob-b { left: -48px; top: -48px; width: 192px; height: 192px; background: var(--tertiary-container); opacity: 0.3; }
.slp-cta-copy { position: relative; z-index: 1; max-width: 36rem; }
.slp-cta-btn { position: relative; z-index: 1; flex-shrink: 0; }
.slp-on-primary { color: var(--on-primary); margin-top: 0; }
.slp-on-primary-soft { color: var(--on-primary-container); }

/* Footer */
.slp-footer { background: var(--surface-low); margin-top: 1.5rem; }
.slp-footer-inner { padding-top: 3rem; padding-bottom: 2rem; }
.slp-footer-grid { display: grid; grid-template-columns: 1fr; gap: 2rem; margin-bottom: 2.5rem; }
.slp-footer-brand { display: flex; flex-direction: column; gap: 0.75rem; }
.slp-footer-title { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--primary); margin-bottom: 0.75rem; }
.slp-footer-list { display: flex; flex-direction: column; gap: 0.5rem; font-size: 13px; color: var(--on-surface-variant); }
.slp-footer-list a:hover { color: var(--primary); }
.slp-footer-bottom { padding-top: 1.5rem; font-size: 11px; font-weight: 600; color: var(--on-surface-variant); }

/* Tablet */
@media (min-width: 640px) {
  .slp-chips { display: flex; flex-wrap: wrap; gap: 0.875rem 1.75rem; }
  .slp-features { grid-template-columns: repeat(2, 1fr); }
  .slp-security-grid { grid-template-columns: repeat(2, 1fr); }
  .slp-wide { grid-column: span 2; }
  .slp-br { display: inline; }
}
@media (min-width: 768px) {
  .slp-features { grid-template-columns: repeat(3, 1fr); }
  .slp-row { grid-template-columns: 5fr 1fr 5fr; }
  .slp-row-arrow { display: flex; }
  .slp-steps { grid-template-columns: repeat(3, 1fr); gap: 1.5rem; }
  .slp-steps::before {
    content: ''; position: absolute; top: 56px; left: 16.6%; right: 16.6%; height: 0;
    border-top: 2px dashed var(--outline-variant); z-index: 0;
  }
  .slp-cta { flex-direction: row; padding: 3rem; text-align: left; }
  .slp-footer-grid { grid-template-columns: repeat(4, 1fr); }
  .slp-roles { grid-template-columns: 1fr 1fr; }
}

/* Desktop */
@media (min-width: 1024px) {
  .slp-nav { display: flex; }
  .slp-menu-toggle { display: none; }
  .slp-mobile-menu { display: none; }
  .slp-hero { grid-template-columns: repeat(2, 1fr); gap: 1.5rem; }
  .slp-h1 { font-size: 48px; line-height: 1.1; }
  .slp-h2 { font-size: 32px; }
  .slp-features { grid-template-columns: repeat(5, 1fr); }
  .slp-security { grid-template-columns: 1fr 2fr; padding: 2rem; }
}

@media (max-width: 480px) {
  .slp-container, .slp-header-inner { padding-left: 1rem; padding-right: 1rem; }
  .slp-mobile-menu { padding-left: 1rem; padding-right: 1rem; }
  .slp-logo-text { font-size: 14px; }
  .slp-hero-actions .slp-btn { width: 100%; }
  .slp-dash { padding: 1rem; }
  .slp-role, .slp-security { padding: 1.25rem; }
}

@media (prefers-reduced-motion: reduce) {
  .slp *, .slp *::before, .slp *::after { animation: none !important; transition: none !important; }
}
`

export default Landing
