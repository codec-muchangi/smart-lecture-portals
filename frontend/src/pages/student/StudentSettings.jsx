import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/apiClient.js'
import { supabase } from '../../services/supabase.js'
import { useAuth } from '../../app/AuthContext.jsx'
import { COURSE_STYLES, ErrorCard, Skeleton, initials, renderIcon, useCourseFonts } from '../../components/courseKit.jsx'
import { DISPLAY_DEFAULTS, SIZES, applyDisplay, readDisplay, saveDisplay } from '../../utils/display.js'
import { sentenceCase } from '../../utils/format.js'
import { baseValues, changedPayload, detailsOf, firstText, passwordChecks, validateProfile, without } from '../../utils/settingsHelpers.js'

/*
 * Smart Lecture Portal: student Account Settings & Preferences
 * Place at: src/pages/student/StudentSettings.jsx
 *
 * Routes (see routes.jsx): /student/profile and /student/settings
 *
 * - Renders inside AppShell, which already draws the sidebar and top bar.
 * - Uses only what the API provides (docs/API.md, "Profile" and "Auth"):
 *     GET   /me                      profile, email, student details (registration_number, program, year_of_study, status)
 *     PATCH /me                      only full_name, phone, avatar_url can change; the page sends only what changed
 *     POST  /auth/password/change    { current_password, new_password } -> 204; 400 with details per field
 *     POST  /auth/password/reset     { email } -> 202, same answer for any address
 *   plus Supabase sign-out: this device only (scope 'local'), or every device (scope 'global').
 * - Email, registration number, programme, year and status are read-only: the server rejects edits to them (422).
 * - The password rules shown are the server's: at least 8 characters, letters and digits, different from the current one.
 * - Interface size, reduced motion and high contrast are per-device settings kept in this browser (utils/display.js).
 * - Not in the API, so not drawn: photo upload (a https link is used instead), the biography field, notification
 *   subscriptions (Phase 7), theme/timezone/timestamp choices, session ids, locations and token details. Nothing
 *   here pretends otherwise.
 * - "Save changes" and "Discard changes" in the header act on the profile form. The password has its own button,
 *   and display choices apply the moment you pick them.
 */

const ME_KEY = ['me']
const SECTIONS = [
  { id: 'set-profile', label: 'Profile information', icon: 'person' },
  { id: 'set-security', label: 'Account & security', icon: 'lock_reset' },
  { id: 'set-notifications', label: 'Notification preferences', icon: 'notifications_active' },
  { id: 'set-display', label: 'Display & accessibility', icon: 'accessibility_new' },
  { id: 'set-sessions', label: 'Active sessions', icon: 'devices' },
]
const SIZE_LABELS = { 100: 'Standard (100%)', 110: 'Medium (110%)', 125: 'Large (125%)' }

const SETTINGS_STYLES = `
.slpz-head { display: flex; flex-direction: column; gap: 0.75rem; }
.slpz-head-row { display: flex; flex-direction: column; gap: 1rem; }
.slpz-title { font-size: 26px; line-height: 34px; font-weight: 800; letter-spacing: -0.02em; }
.slpz-head-btns { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.slpz-pills { display: flex; flex-wrap: wrap; gap: 4px; }
.slpz-pill { display: inline-flex; align-items: center; gap: 0.5rem; padding: 8px 16px; border: 0; border-radius: 999px; background: transparent; color: var(--on-surface-variant); font-size: 12px; line-height: 16px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.slpz-pill:hover { background: var(--surface-high); color: var(--on-surface); }
.slpz-pill[aria-current='true'] { background: var(--primary-container); color: var(--on-primary-container); box-shadow: 0 1px 3px rgba(30, 26, 35, 0.2); }
.slpz-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.slpz-col { display: flex; flex-direction: column; gap: 1.5rem; min-width: 0; }
.slpz-section { display: flex; flex-direction: column; gap: 1.25rem; padding: 1.5rem; min-width: 0; scroll-margin-top: 5rem; }
.slpz-sec-head { display: flex; align-items: flex-start; gap: 0.75rem; }
.slpz-sec-icon { width: 32px; height: 32px; border-radius: 10px; background: var(--primary-fixed); color: var(--primary); display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.slpz-h { font-size: 17px; line-height: 24px; font-weight: 700; letter-spacing: -0.005em; }
.slpz-sub { margin-top: 2px; font-size: 13px; line-height: 20px; color: var(--on-surface-variant); }
.slpz-avatar-block { display: flex; flex-direction: column; align-items: center; gap: 1rem; padding: 1rem; border-radius: 16px; background: var(--surface-low); text-align: center; }
.slpz-avatar { position: relative; width: 80px; height: 80px; border-radius: 20px; background: var(--primary-container); color: var(--on-primary-container); display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 800; flex: 0 0 auto; }
.slpz-avatar img { width: 100%; height: 100%; object-fit: cover; border-radius: 20px; display: block; }
.slpz-avatar-main { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; min-width: 0; width: 100%; flex: 1 1 0; }
.slpz-avatar-main .slpz-field { width: 100%; text-align: left; }
.slpz-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; }
.slpz-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.slpz-label { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.25rem 0.5rem; min-height: 22px; font-size: 12px; line-height: 16px; font-weight: 700; color: var(--on-surface); }
.slpz-label .req { color: var(--primary); font-size: 11px; }
.slpz-lock { display: inline-flex; align-items: center; gap: 0.25rem; padding: 1px 8px; border-radius: 999px; background: var(--warn-bg); color: var(--warn); font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.slpz-wrap { position: relative; display: flex; align-items: center; }
.slpz-wrap > .material-symbols-outlined { position: absolute; left: 12px; color: var(--primary); pointer-events: none; }
.slpz-input { width: 100%; min-width: 0; height: 44px; padding: 0 14px 0 42px; border: 1px solid var(--surface-highest); border-radius: 12px; background: var(--surface-low); color: var(--on-surface); font: inherit; font-size: 14px; }
.slpz-input.has-end { padding-right: 46px; }
.slpz-input:focus { outline: 2px solid var(--primary); outline-offset: 1px; background: var(--surface-lowest); }
.slpz-input[readonly] { background: var(--surface-high); border-color: transparent; color: var(--on-surface-variant); cursor: default; }
.slpz-input[readonly]:focus { outline: 2px solid var(--outline); }
.slpz-input.is-bad { border-color: var(--error); }
.slpz-end { position: absolute; right: 4px; width: 36px; height: 36px; border: 0; border-radius: 999px; background: transparent; color: var(--on-surface-variant); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.slpz-end:hover { background: var(--surface-high); }
.slpz-help { font-size: 12px; line-height: 16px; color: var(--on-surface-variant); }
.slpz-err { font-size: 12px; line-height: 16px; font-weight: 600; color: var(--error); }
.slpz-link { border: 0; padding: 0; background: none; color: var(--primary); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
.slpz-link:hover:not(:disabled) { text-decoration: underline; }
.slpz-link:disabled { opacity: 0.6; cursor: default; }
.slpz-callout { display: flex; align-items: flex-start; gap: 0.75rem; padding: 1rem; border-radius: 12px; background: var(--surface-low); font-size: 13px; line-height: 20px; color: var(--on-surface-variant); }
.slpz-callout .material-symbols-outlined { color: var(--primary); }
.slpz-status { padding: 0.75rem 1rem; border-radius: 12px; background: var(--ok-bg); color: var(--ok); font-size: 13px; line-height: 18px; font-weight: 600; }
.slpz-status.is-bad { background: var(--error-container); color: var(--on-error-container); }
.slpz-meter { display: flex; flex-direction: column; gap: 6px; }
.slpz-meter-row { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; font-size: 11px; line-height: 16px; font-weight: 600; color: var(--on-surface-variant); }
.slpz-bar { height: 6px; border-radius: 999px; background: var(--surface-high); overflow: hidden; }
.slpz-bar > span { display: block; height: 100%; border-radius: 999px; background: var(--primary-container); transition: width 0.3s; }
.slpz-checks { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.375rem; margin: 0; padding: 0.875rem; list-style: none; border-radius: 12px; background: var(--surface-low); }
.slpz-checks li { display: flex; align-items: center; gap: 0.5rem; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--on-surface-variant); }
.slpz-checks li.is-met { color: var(--ok); }
.slpz-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.slpz-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 0.75rem; padding-top: 1rem; border-top: 1px solid var(--surface-mid); }
.slpz-note { display: inline-flex; align-items: center; gap: 0.5rem; margin-right: auto; font-size: 12px; line-height: 16px; color: var(--on-surface-variant); }
.slpz-sizes { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.75rem; border: 0; margin: 0; padding: 0; }
.slpz-size { display: flex; align-items: center; gap: 0.75rem; padding: 0.875rem 1rem; border-radius: 12px; background: var(--surface-low); border: 2px solid transparent; cursor: pointer; font-size: 13px; font-weight: 700; }
.slpz-size:has(input:checked) { border-color: var(--primary); background: var(--primary-fixed); }
.slpz-size input { accent-color: var(--primary); width: 18px; height: 18px; flex: 0 0 auto; }
.slpz-size small { display: block; font-weight: 500; color: var(--on-surface-variant); }
.slpz-toggle { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.875rem 1rem; border-radius: 12px; background: var(--surface-low); }
.slpz-toggle strong { display: block; font-size: 14px; line-height: 20px; }
.slpz-sw { position: relative; flex: 0 0 auto; width: 48px; height: 28px; border: 0; border-radius: 999px; background: var(--surface-highest); cursor: pointer; transition: background 0.2s; }
.slpz-sw::after { content: ''; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 999px; background: #fff; box-shadow: 0 1px 3px rgba(30, 26, 35, 0.3); transition: transform 0.2s; }
.slpz-sw[aria-checked='true'] { background: var(--primary-container); }
.slpz-sw[aria-checked='true']::after { transform: translateX(20px); }
.slpz-side { display: flex; flex-direction: column; gap: 1.5rem; min-width: 0; }
.slpz-device { display: flex; align-items: flex-start; gap: 0.75rem; padding: 1rem; border-radius: 12px; background: var(--surface-low); }
.slpz-device .material-symbols-outlined { color: var(--primary); }
.slpz-device strong { display: block; font-size: 15px; line-height: 22px; }
.slpz-device span.slpz-help { display: block; overflow-wrap: anywhere; }
.slpz-state { display: inline-flex; align-items: center; gap: 0.375rem; margin-top: 4px; font-size: 12px; font-weight: 700; color: var(--ok); }
.slpz-state i { width: 8px; height: 8px; border-radius: 999px; background: var(--ok); }
.slpz-btns { display: flex; flex-direction: column; gap: 0.5rem; }
.slpz-btns .slpc-btn { width: 100%; justify-content: center; }
.slpz-danger { background: var(--error); color: var(--on-error); box-shadow: 0 1px 3px rgba(30, 26, 35, 0.2); }
.slpz-danger:hover:not(:disabled) { filter: brightness(0.92); }
.slpz-danger-soft { background: var(--error-container); color: var(--on-error-container); }
.slpz-confirm { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.875rem 1rem; border-radius: 12px; background: var(--warn-bg); color: var(--warn); font-size: 13px; line-height: 18px; font-weight: 600; }
.slpz-facts { display: flex; flex-direction: column; gap: 0.5rem; margin: 0; }
.slpz-fact { display: flex; justify-content: space-between; gap: 1rem; padding: 0.625rem 0.75rem; border-radius: 10px; background: var(--surface-lowest); font-size: 12px; line-height: 18px; }
.slpz-fact dt { color: var(--on-surface-variant); font-weight: 600; }
.slpz-fact dd { margin: 0; font-weight: 700; text-align: right; overflow-wrap: anywhere; }
.slpz-registry { display: flex; flex-direction: column; gap: 1rem; padding: 1.5rem; background: var(--surface-low); }
.slpz-registry-top { display: flex; align-items: center; gap: 0.75rem; }
.slpz-registry-icon { width: 40px; height: 40px; border-radius: 12px; background: var(--primary-container); color: var(--on-primary-container); display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; }
@media (min-width: 640px) {
  .slpz-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .slpz-grid .is-full { grid-column: 1 / -1; }
  .slpz-checks { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .slpz-sizes { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .slpz-avatar-block { flex-direction: row; text-align: left; }
  .slpz-avatar-main { align-items: flex-start; }
  .slpz-avatar-main .slpc-btn { align-self: flex-start; }
}
@media (min-width: 1024px) {
  .slpz-head-row { flex-direction: row; align-items: center; justify-content: space-between; }
  .slpz-title { font-size: 30px; line-height: 38px; }
}
@media (min-width: 1280px) {
  .slpz-layout { grid-template-columns: minmax(0, 2fr) minmax(300px, 1fr); }
  .slpz-sticky { position: sticky; top: 5rem; }
}
@media (max-width: 639px) {
  .slpz-pill { flex: 1 1 auto; justify-content: center; }
}
@media (max-width: 479px) {
  .slpz-section { padding: 1.125rem; }
  .slpz-title { font-size: 22px; line-height: 30px; }
  .slpz-head-btns .slpc-btn, .slpz-actions .slpc-btn { flex: 1 1 100%; justify-content: center; }
}
`

/* ---------- pieces ---------- */

function SectionHead({ icon, title, children }) {
  return (
    <div className="slpz-sec-head">
      <span className="slpz-sec-icon">{renderIcon(icon, 18)}</span>
      <div>
        <h2 className="slpz-h">{title}</h2>
        <p className="slpz-sub">{children}</p>
      </div>
    </div>
  )
}

function Field({ id, label, required, lock, help, error, icon, end, action, children }) {
  return (
    <div className="slpz-field">
      <div className="slpz-label">
        <label htmlFor={id}>
          {label}
          {required && <span className="req"> *</span>}
        </label>
        {lock && (
          <span className="slpz-lock">
            {renderIcon('lock', 12)}
            {lock}
          </span>
        )}
        {action}
      </div>
      <div className="slpz-wrap">
        {icon && renderIcon(icon, 20)}
        {children}
        {end}
      </div>
      {error ? (
        <span className="slpz-err" id={`${id}-err`} role="alert">
          {error}
        </span>
      ) : (
        help && <span className="slpz-help">{help}</span>
      )}
    </div>
  )
}

function PasswordField({ id, label, value, onChange, error, autoComplete, action }) {
  const [shown, setShown] = useState(false)
  return (
    <Field
      id={id}
      label={label}
      icon="lock"
      error={error}
      action={action}
      end={
        <button type="button" className="slpz-end" aria-label={`${shown ? 'Hide' : 'Show'} ${label.toLowerCase()}`} aria-pressed={shown} onClick={() => setShown(!shown)}>
          {renderIcon(shown ? 'visibility_off' : 'visibility', 20)}
        </button>
      }
    >
      <input id={id} className={`slpz-input has-end ${error ? 'is-bad' : ''}`} type={shown ? 'text' : 'password'} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? `${id}-err` : undefined} />
    </Field>
  )
}

function SecuritySection({ me }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [serverErrors, setServerErrors] = useState({})
  const [status, setStatus] = useState(null)
  const [resetStatus, setResetStatus] = useState(null)
  const checks = passwordChecks(current, next, confirm)
  const metCount = checks.filter((check) => check.met).length
  const ready = current.length > 0 && metCount === checks.length

  const change = useMutation({
    mutationFn: (body) => api('/auth/password/change', { method: 'POST', body }),
    onSuccess: () => {
      setCurrent('')
      setNext('')
      setConfirm('')
      setServerErrors({})
      setStatus({ ok: true, text: 'Password updated.' })
    },
    onError: (error) => {
      const fields = detailsOf(error)
      const mapped = {}
      if (fields.current_password) mapped.current = firstText(fields.current_password)
      if (fields.new_password) mapped.next = firstText(fields.new_password)
      setServerErrors(mapped)
      setStatus({ ok: false, text: Object.keys(mapped).length > 0 ? 'Please check the highlighted fields.' : error?.message || 'The password could not be changed.' })
    },
  })
  const reset = useMutation({
    mutationFn: () => api('/auth/password/reset', { method: 'POST', body: { email: me.email } }),
    onSuccess: () => setResetStatus({ ok: true, text: `If ${me.email} can sign in, a reset link is on its way.` }),
    onError: (error) => setResetStatus({ ok: false, text: error?.status === 429 ? 'Too many requests. Please wait a few minutes and try again.' : 'The reset email could not be requested. Try again shortly.' }),
  })

  const submit = (event) => {
    event.preventDefault()
    if (!ready) return
    setStatus(null)
    change.mutate({ current_password: current, new_password: next })
  }

  return (
    <section className="slpc-card slpz-section" id="set-security" aria-label="Account and security">
      <SectionHead icon="password" title="Security & password">
        Change your password. It is checked by the server and never shown or stored in plain text.
      </SectionHead>
      <div className="slpz-callout">
        {renderIcon('shield', 20)}
        <p>Use at least 8 characters with letters and digits, and pick something different from your current password.</p>
      </div>
      <form className="slpz-col" onSubmit={submit} noValidate aria-label="Change password">
        <PasswordField
          id="pw-current"
          label="Current password"
          value={current}
          onChange={(value) => {
            setCurrent(value)
            setServerErrors(without(serverErrors, 'current'))
          }}
          error={serverErrors.current}
          autoComplete="current-password"
          action={
            <button type="button" className="slpz-link" onClick={() => { setResetStatus(null); reset.mutate() }} disabled={reset.isPending || !me.email}>
              {reset.isPending ? 'Sending…' : 'Forgot password?'}
            </button>
          }
        />
        {resetStatus && (
          <p className={`slpz-status ${resetStatus.ok ? '' : 'is-bad'}`} role={resetStatus.ok ? 'status' : 'alert'}>
            {resetStatus.text}
          </p>
        )}
        <div className="slpz-grid">
          <div className="slpz-col" style={{ gap: '0.75rem' }}>
            <PasswordField
              id="pw-new"
              label="New password"
              value={next}
              onChange={(value) => {
                setNext(value)
                setServerErrors(without(serverErrors, 'next'))
              }}
              error={serverErrors.next}
              autoComplete="new-password"
            />
            <div className="slpz-meter">
              <div className="slpz-meter-row">
                <span>
                  Rules met: <strong>{metCount} of {checks.length}</strong>
                </span>
              </div>
              <div className="slpz-bar" aria-hidden="true">
                <span style={{ width: `${(metCount / checks.length) * 100}%` }} />
              </div>
            </div>
          </div>
          <PasswordField id="pw-confirm" label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        </div>
        <ul className="slpz-checks" aria-label="Password rules">
          {checks.map((check) => (
            <li key={check.id} className={check.met ? 'is-met' : ''}>
              {renderIcon(check.met ? 'check_circle' : 'radio_button_unchecked', 18)}
              {check.label}
              <span className="slpz-sr">{check.met ? ' (met)' : ' (not met)'}</span>
            </li>
          ))}
        </ul>
        {status && (
          <p className={`slpz-status ${status.ok ? '' : 'is-bad'}`} role={status.ok ? 'status' : 'alert'}>
            {status.text}
          </p>
        )}
        <div className="slpz-actions">
          <span className="slpz-note">
            {renderIcon('shield', 18)}
            Two-factor authentication is not offered yet.
          </span>
          <button type="submit" className="slpc-btn slpc-btn-primary" disabled={!ready || change.isPending}>
            {renderIcon('lock_reset', 18)}
            {change.isPending ? 'Updating…' : 'Update password'}
          </button>
        </div>
      </form>
    </section>
  )
}

function DisplaySection() {
  const [prefs, setPrefs] = useState(() => readDisplay())
  const [saved, setSaved] = useState(true)
  const update = (patch) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    applyDisplay(next)
    setSaved(saveDisplay(next))
  }
  const isDefault = prefs.size === DISPLAY_DEFAULTS.size && prefs.reduceMotion === DISPLAY_DEFAULTS.reduceMotion && prefs.highContrast === DISPLAY_DEFAULTS.highContrast

  return (
    <section className="slpc-card slpz-section" id="set-display" aria-label="Display and accessibility">
      <SectionHead icon="contrast" title="Display & accessibility">
        These choices apply to this device and browser only, and take effect straight away.
      </SectionHead>
      <fieldset className="slpz-sizes">
        <legend className="slpz-label" style={{ marginBottom: 8 }}>
          Interface size
        </legend>
        {SIZES.map((size) => (
          <label key={size} className="slpz-size">
            <input type="radio" name="interface-size" value={size} checked={prefs.size === size} onChange={() => update({ size })} />
            <span>
              {SIZE_LABELS[size]}
              <small>{size === 100 ? 'The default layout.' : size === 110 ? 'A little larger text and controls.' : 'Highest legibility on dense screens.'}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="slpz-toggle">
        <div>
          <strong id="sw-contrast">High contrast</strong>
          <span className="slpz-help">Darkens secondary text and borders for easier reading.</span>
        </div>
        <button type="button" role="switch" aria-checked={prefs.highContrast} aria-labelledby="sw-contrast" className="slpz-sw" onClick={() => update({ highContrast: !prefs.highContrast })} />
      </div>
      <div className="slpz-toggle">
        <div>
          <strong id="sw-motion">Reduced motion</strong>
          <span className="slpz-help">Turns off animated transitions across the portal.</span>
        </div>
        <button type="button" role="switch" aria-checked={prefs.reduceMotion} aria-labelledby="sw-motion" className="slpz-sw" onClick={() => update({ reduceMotion: !prefs.reduceMotion })} />
      </div>
      {!saved && (
        <p className="slpz-status is-bad" role="alert">
          This browser would not keep your choices, so they will reset when you reload.
        </p>
      )}
      <div className="slpz-actions">
        <span className="slpz-note">
          {renderIcon('devices', 18)}
          Saved on this device
        </span>
        <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => update({ ...DISPLAY_DEFAULTS })} disabled={isDefault}>
          Reset to defaults
        </button>
      </div>
    </section>
  )
}

function SessionCard({ me }) {
  const [asking, setAsking] = useState(false)
  const [status, setStatus] = useState(null)
  // scope 'local' ends only this browser; 'global' ends every device, this one included.
  const leave = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut({ scope: 'local' })
      if (error) throw error
    },
    onError: () => setStatus({ ok: false, text: 'You could not be signed out. Please try again.' }),
  })
  const revoke = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut({ scope: 'global' })
      if (error) throw error
    },
    onError: () => {
      setAsking(false)
      setStatus({ ok: false, text: 'Your devices could not be signed out. Please try again.' })
    },
  })

  return (
    <section className="slpc-card slpz-section" id="set-sessions" aria-label="Active session">
      <SectionHead icon="devices_other" title="Active session">
        The device you are using now. Sign out here, or end every session on every device.
      </SectionHead>
      <div className="slpz-device">
        {renderIcon('laptop_mac', 22)}
        <div style={{ minWidth: 0 }}>
          <strong>This device</strong>
          <span className="slpz-help">Signed in as {me.email}</span>
          <span className="slpz-state">
            <i aria-hidden="true" />
            Active now
          </span>
        </div>
      </div>
      {asking ? (
        <div className="slpz-confirm" role="alertdialog" aria-label="Confirm sign out of all devices">
          <span>Sign out of every device, including this one? You will need to sign in again everywhere.</span>
          <span className="slpz-btns">
            <button type="button" className="slpc-btn slpz-danger" onClick={() => revoke.mutate()} disabled={revoke.isPending}>
              {revoke.isPending ? 'Signing out…' : 'Yes, sign out everywhere'}
            </button>
            <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => setAsking(false)} disabled={revoke.isPending}>
              Keep me signed in
            </button>
          </span>
        </div>
      ) : (
        <div className="slpz-btns">
          <button type="button" className="slpc-btn slpz-danger" onClick={() => { setStatus(null); leave.mutate() }} disabled={leave.isPending}>
            {renderIcon('logout', 18)}
            {leave.isPending ? 'Signing out…' : 'Log out current session'}
          </button>
          <button type="button" className="slpc-btn slpz-danger-soft" onClick={() => { setStatus(null); setAsking(true) }}>
            {renderIcon('power_settings_new', 18)}
            Log out of all devices
          </button>
        </div>
      )}
      {status && (
        <p className="slpz-status is-bad" role="alert">
          {status.text}
        </p>
      )}
      <p className="slpz-help">Locations and individual devices are not shown yet.</p>
    </section>
  )
}

/* ---------- page ---------- */

export default function StudentSettings() {
  useCourseFonts()
  const queryClient = useQueryClient()
  const { refresh } = useAuth()
  const [active, setActive] = useState('set-profile')
  const [draft, setDraft] = useState({})
  const [serverErrors, setServerErrors] = useState({})
  const [status, setStatus] = useState(null)
  const [failedPhoto, setFailedPhoto] = useState('')

  const meQuery = useQuery({ queryKey: ME_KEY, queryFn: () => api('/me') })
  const me = meQuery.data
  const details = me?.details ?? {}

  const values = { ...baseValues(me), ...draft }
  const clientErrors = validateProfile(values)
  const errors = { ...clientErrors, ...serverErrors }
  const payload = me ? changedPayload(me, values) : {}
  const dirty = Object.keys(payload).length > 0
  const invalid = Object.values(clientErrors).some(Boolean)
  const shownPhoto = values.avatar_url.trim()
  const hasPhoto = shownPhoto.startsWith('https://') && !clientErrors.avatar_url && failedPhoto !== shownPhoto

  const save = useMutation({
    mutationFn: (body) => api('/me', { method: 'PATCH', body }),
    onSuccess: async () => {
      setDraft({})
      setServerErrors({})
      setStatus({ ok: true, text: 'Profile saved.' })
      await queryClient.invalidateQueries({ queryKey: ME_KEY })
      if (typeof refresh === 'function') await refresh()
    },
    onError: (error) => {
      const fields = detailsOf(error)
      const next = {}
      ;['full_name', 'phone', 'avatar_url'].forEach((key) => {
        if (fields[key]) next[key] = firstText(fields[key])
      })
      setServerErrors(next)
      setStatus({ ok: false, text: Object.keys(next).length > 0 ? 'Some fields need fixing.' : error?.message || 'The profile could not be saved.' })
    },
  })

  const edit = (key) => (event) => {
    setDraft({ ...draft, [key]: event.target.value })
    setServerErrors(without(serverErrors, key))
    setStatus(null)
  }
  const discard = () => {
    setDraft({})
    setServerErrors({})
    setStatus(null)
  }
  const submit = (event) => {
    event?.preventDefault()
    if (!dirty || invalid || save.isPending) return
    save.mutate(payload)
  }
  const go = (id) => {
    setActive(id)
    document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="slpc" aria-label="Account settings and preferences">
      <style>{COURSE_STYLES}</style>
      <style>{SETTINGS_STYLES}</style>

      <div className="slpc-stack slpc-gap-lg">
        <div className="slpz-head">
          <nav className="slpc-trail" aria-label="Breadcrumb">
            <Link to="/student" className="slpc-trail-link">
              {renderIcon('home', 16)}
              Student Dashboard
            </Link>
            <span className="slpc-trail-sep">{renderIcon('chevron_right', 16)}</span>
            <span className="slpc-trail-current">Settings &amp; Account Preferences</span>
          </nav>
          <div className="slpz-head-row">
            <div style={{ maxWidth: '42rem' }}>
              <h1 className="slpz-title">Account Settings &amp; Preferences</h1>
              <p className="slpc-lead">Manage your profile, password and display settings. Changes to your profile are saved when you press Save changes.</p>
            </div>
            <div className="slpz-head-btns">
              <button type="button" className="slpc-btn slpc-btn-soft" onClick={discard} disabled={!dirty || save.isPending}>
                Discard changes
              </button>
              <button type="button" className="slpc-btn slpc-btn-primary" onClick={submit} disabled={!dirty || invalid || save.isPending}>
                {renderIcon('check_circle', 18)}
                {save.isPending ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
          <nav className="slpc-card slpc-switcher" aria-label="Settings sections">
            <div className="slpz-pills">
              {SECTIONS.map((entry) => (
                <button key={entry.id} type="button" className="slpz-pill" aria-current={active === entry.id ? 'true' : undefined} onClick={() => go(entry.id)}>
                  {renderIcon(entry.icon, 16)}
                  {entry.label}
                </button>
              ))}
            </div>
          </nav>
        </div>

        {meQuery.isPending && <Skeleton height={240} label="Loading your profile" />}
        {meQuery.isError && <ErrorCard message="Your profile could not be loaded." onRetry={() => meQuery.refetch()} />}

        {me && (
          <div className="slpz-layout">
            <div className="slpz-col">
              <form className="slpc-card slpz-section" id="set-profile" onSubmit={submit} noValidate aria-label="Profile form">
                <SectionHead icon="badge" title="Student profile identity">
                  Your name, phone and photo link are editable. Registry details are read-only.
                </SectionHead>
                <div className="slpz-avatar-block">
                  <span className="slpz-avatar" aria-hidden="true">
                    {hasPhoto ? <img src={shownPhoto} alt="" onError={() => setFailedPhoto(shownPhoto)} /> : initials(values.full_name || me.full_name)}
                  </span>
                  <div className="slpz-avatar-main">
                    <Field id="set-avatar" label="Profile photo link" icon="image" error={errors.avatar_url} help="An https:// link to an image. Photo uploads are not available yet.">
                      <input id="set-avatar" className={`slpz-input ${errors.avatar_url ? 'is-bad' : ''}`} value={values.avatar_url} onChange={edit('avatar_url')} inputMode="url" autoComplete="off" aria-invalid={errors.avatar_url ? 'true' : undefined} />
                    </Field>
                    <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => { setDraft({ ...draft, avatar_url: '' }); setServerErrors(without(serverErrors, 'avatar_url')); setStatus(null) }} disabled={!values.avatar_url.trim()}>
                      {renderIcon('delete', 18)}
                      Remove photo
                    </button>
                  </div>
                </div>
                <div className="slpz-grid">
                  <Field id="set-name" label="Full name" required icon="person" error={errors.full_name} help="Shown to your lecturers on class lists.">
                    <input id="set-name" className={`slpz-input ${errors.full_name ? 'is-bad' : ''}`} value={values.full_name} onChange={edit('full_name')} autoComplete="name" aria-invalid={errors.full_name ? 'true' : undefined} />
                  </Field>
                  <Field id="set-phone" label="Mobile phone" icon="call" error={errors.phone} help="Optional. Leave empty to remove it.">
                    <input id="set-phone" className={`slpz-input ${errors.phone ? 'is-bad' : ''}`} value={values.phone} onChange={edit('phone')} autoComplete="tel" inputMode="tel" aria-invalid={errors.phone ? 'true' : undefined} />
                  </Field>
                  <Field id="set-email" label="Institutional email" lock="Managed by sign-in" icon="mail">
                    <input id="set-email" className="slpz-input" value={me.email ?? ''} readOnly />
                  </Field>
                  <Field id="set-reg" label="Registration number" lock="Set by registry" icon="badge">
                    <input id="set-reg" className="slpz-input" value={details.registration_number ?? ''} readOnly />
                  </Field>
                  <Field id="set-program" label="Programme" lock="Set by registry" icon="school">
                    <input id="set-program" className="slpz-input" value={details.program ?? ''} readOnly />
                  </Field>
                  <Field id="set-year" label="Year of study" lock="Set by registry" icon="event">
                    <input id="set-year" className="slpz-input" value={details.year_of_study ?? ''} readOnly />
                  </Field>
                </div>
                {status && (
                  <p className={`slpz-status ${status.ok ? '' : 'is-bad'}`} role={status.ok ? 'status' : 'alert'}>
                    {status.text}
                  </p>
                )}
                <div className="slpz-actions">
                  <span className="slpz-note">
                    {renderIcon(dirty ? 'edit_note' : 'cloud_done', 18)}
                    {dirty ? 'You have unsaved changes' : 'Everything is saved'}
                  </span>
                  <button type="button" className="slpc-btn slpc-btn-soft" onClick={discard} disabled={!dirty || save.isPending}>
                    Cancel
                  </button>
                  <button type="submit" className="slpc-btn slpc-btn-primary" disabled={!dirty || invalid || save.isPending}>
                    {renderIcon('check_circle', 18)}
                    {save.isPending ? 'Saving…' : 'Save profile changes'}
                  </button>
                </div>
              </form>

              <SecuritySection me={me} />

              <section className="slpz-section" id="set-notifications" aria-label="Notification preferences" style={{ padding: 0 }}>
                <div className="slpc-card">
  <h2 className="slpc-h2">Your notifications</h2>
  <p className="slpc-muted">
    You receive an alert whenever a lecturer publishes an announcement for a course you are
    enrolled in. Alerts appear under the bell icon at the top of the page, where you can mark
    them as read.
  </p>
  <p className="slpc-muted">
    Choosing which alerts to receive is not available in this version, so there are no switches here.
  </p>
</div>
              </section>

              <DisplaySection />
            </div>

            <aside className="slpz-side slpz-sticky" aria-label="Session and registry">
              <SessionCard me={me} />
              <section className="slpc-card slpz-registry" aria-label="Registry record">
                <div className="slpz-registry-top">
                  <span className="slpz-registry-icon">{renderIcon('account_balance', 20)}</span>
                  <div>
                    <h2 className="slpz-h">Registry record</h2>
                    {details.status && <p className="slpz-sub">Status: {sentenceCase(details.status)}</p>}
                  </div>
                </div>
                <p className="slpz-help" style={{ fontSize: 13, lineHeight: '20px' }}>
                  These details come from the registrar and cannot be edited here. To change your programme, year or course enrolment, contact the registrar.
                </p>
                <dl className="slpz-facts">
                  {details.registration_number && (
                    <div className="slpz-fact">
                      <dt>Registration no.</dt>
                      <dd>{details.registration_number}</dd>
                    </div>
                  )}
                  {details.program && (
                    <div className="slpz-fact">
                      <dt>Programme</dt>
                      <dd>{details.program}</dd>
                    </div>
                  )}
                  {details.year_of_study && (
                    <div className="slpz-fact">
                      <dt>Year of study</dt>
                      <dd>{details.year_of_study}</dd>
                    </div>
                  )}
                </dl>
              </section>
            </aside>
          </div>
        )}
      </div>
    </div>
  )
}
