import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/apiClient.js'
import { supabase } from '../../services/supabase.js'
import { useAuth } from '../../app/AuthContext.jsx'
import { COURSE_STYLES, ErrorCard, PhasePanel, Skeleton, initials, renderIcon, useCourseFonts } from '../../components/courseKit.jsx'
import { DISPLAY_DEFAULTS, SIZES, applyDisplay, readDisplay, saveDisplay } from '../../utils/display.js'
import { formatDate, sentenceCase } from '../../utils/format.js'
import { baseValues, changedPayload, detailsOf, firstText, passwordChecks, validateProfile, without } from '../../utils/settingsHelpers.js'

/*
 * Smart Lecture Portal: lecturer Faculty Settings & Preferences
 * Place at: src/pages/lecturer/LecturerSettings.jsx
 *
 * Routes (see routes.jsx): /lecturer/settings and /lecturer/profile
 *
 * - Renders inside AppShell, which already draws the sidebar and top bar.
 * - Uses only what the API provides (docs/API.md, "Profile" and "Auth"):
 *     GET   /me                      profile, email, role details (staff_number, department, title, status)
 *     PATCH /me                      only full_name, phone, avatar_url can change; the page sends only what changed
 *     POST  /auth/password/change    { current_password, new_password } -> 204; 400 with details per field
 *     POST  /auth/password/reset     { email } -> 202, same answer for any address
 *   plus Supabase sign-out (this device, or every other device).
 * - Email, staff number, department and title are shown read-only: the server rejects edits to them (422).
 * - The password rules shown are the server's: at least 8 characters, letters and digits, different from the current one.
 * - Interface size, reduced motion and high contrast are per-device settings kept in this browser (utils/display.js).
 * - Not in the API, so not drawn: notification preferences (Phase 7), two-factor authentication, a list of signed-in
 *   devices, theme/date-format/timezone choices, and the office and bio fields. Nothing here pretends otherwise.
 */

const ME_KEY = ['me']
const TABS = [
  { id: 'profile', label: 'Profile information', icon: 'badge' },
  { id: 'security', label: 'Account & security', icon: 'security' },
  { id: 'notifications', label: 'Notification preferences', icon: 'notifications_active' },
  { id: 'display', label: 'Display & accessibility', icon: 'contrast' },
  { id: 'sessions', label: 'Sessions', icon: 'devices' },
]
const SIZE_LABELS = { 100: 'Standard (100%)', 110: 'Medium (110%)', 125: 'Large (125%)' }

const SETTINGS_STYLES = `
.slpx-card { padding: 1.5rem; min-width: 0; }
.slpx-head { display: flex; flex-direction: column; gap: 0.5rem; }
.slpx-title { font-size: 26px; line-height: 34px; font-weight: 800; letter-spacing: -0.02em; }
.slpx-tabs { display: flex; flex-wrap: wrap; gap: 4px; padding: 0.5rem; background: var(--surface-low); }
.slpx-tab { display: inline-flex; align-items: center; gap: 0.5rem; padding: 9px 16px; border: 0; border-radius: 12px; background: transparent; color: var(--on-surface-variant); font-size: 13px; line-height: 18px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.slpx-tab:hover { background: var(--surface-high); color: var(--on-surface); }
.slpx-tab[aria-selected='true'] { background: var(--surface-lowest); color: var(--primary); font-weight: 700; box-shadow: 0 1px 2px rgba(30, 26, 35, 0.12); }
.slpx-layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.5rem; align-items: start; }
.slpx-id { overflow: hidden; padding: 0; }
.slpx-id-band { height: 84px; background: linear-gradient(135deg, var(--primary-container), var(--primary)); }
.slpx-id-body { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; padding: 0 1.25rem 1.25rem; text-align: center; margin-top: -42px; }
.slpx-avatar { width: 84px; height: 84px; border-radius: 999px; border: 4px solid var(--surface-lowest); background: var(--primary-fixed); color: var(--primary); display: flex; align-items: center; justify-content: center; font-size: 26px; font-weight: 800; overflow: hidden; flex: 0 0 auto; }
.slpx-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.slpx-name { font-size: 19px; line-height: 26px; font-weight: 800; overflow-wrap: anywhere; }
.slpx-role { font-size: 12px; line-height: 16px; font-weight: 700; color: var(--primary); }
.slpx-chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.5rem; }
.slpx-chip { display: inline-flex; align-items: center; gap: 0.375rem; padding: 3px 10px; border-radius: 999px; background: var(--surface-high); color: var(--on-surface-variant); font-family: 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace; font-size: 11px; line-height: 16px; font-weight: 700; }
.slpx-chip.is-ok { background: var(--ok-bg); color: var(--ok); font-family: inherit; }
.slpx-facts { align-self: stretch; display: flex; flex-direction: column; gap: 0.5rem; margin: 0.5rem 0 0; padding: 0.75rem 0 0; border-top: 1px solid var(--surface-mid); text-align: left; }
.slpx-fact { display: flex; justify-content: space-between; gap: 1rem; font-size: 12px; line-height: 18px; }
.slpx-fact dt { color: var(--on-surface-variant); font-weight: 600; }
.slpx-fact dd { margin: 0; font-weight: 700; text-align: right; overflow-wrap: anywhere; }
.slpx-audit { display: flex; flex-direction: column; gap: 0.5rem; padding: 1rem 1.25rem; margin-top: 1rem; }
.slpx-audit p { display: flex; align-items: center; gap: 0.5rem; font-size: 12px; line-height: 18px; color: var(--on-surface-variant); }
.slpx-audit p strong { color: var(--on-surface); }
.slpx-audit .material-symbols-outlined { color: var(--outline); }
.slpx-panel { display: flex; flex-direction: column; gap: 1.25rem; }
.slpx-h { font-size: 18px; line-height: 26px; font-weight: 700; letter-spacing: -0.005em; }
.slpx-sub { margin-top: 2px; font-size: 13px; line-height: 20px; color: var(--on-surface-variant); }
.slpx-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem; }
.slpx-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.slpx-label { display: flex; align-items: center; flex-wrap: wrap; min-height: 22px; font-size: 12px; line-height: 16px; font-weight: 700; color: var(--on-surface); }
.slpx-label .req { color: var(--error); }
.slpx-wrap { position: relative; display: flex; align-items: center; }
.slpx-wrap > .material-symbols-outlined { position: absolute; left: 12px; color: var(--primary); pointer-events: none; }
.slpx-input { width: 100%; min-width: 0; height: 44px; padding: 0 14px 0 42px; border: 1px solid var(--surface-highest); border-radius: 12px; background: var(--surface-low); color: var(--on-surface); font: inherit; font-size: 14px; }
.slpx-input.has-end { padding-right: 46px; }
.slpx-input:focus { outline: 2px solid var(--primary); outline-offset: 1px; background: var(--surface-lowest); }
.slpx-input[readonly]:focus { outline: 2px solid var(--outline); }
.slpx-input[readonly] { background: var(--surface-high); border-color: transparent; color: var(--on-surface-variant); cursor: default; }
.slpx-input.is-bad { border-color: var(--error); }
.slpx-end { position: absolute; right: 4px; width: 36px; height: 36px; border: 0; border-radius: 999px; background: transparent; color: var(--on-surface-variant); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }
.slpx-end:hover { background: var(--surface-high); }
.slpx-help { font-size: 12px; line-height: 16px; color: var(--on-surface-variant); }
.slpx-err { font-size: 12px; line-height: 16px; font-weight: 600; color: var(--error); }
.slpx-lock { display: inline-flex; align-items: center; gap: 0.25rem; margin-left: 0.5rem; padding: 1px 8px; border-radius: 999px; background: var(--warn-bg); color: var(--warn); font-size: 10px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.slpx-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 0.75rem; padding-top: 1rem; border-top: 1px solid var(--surface-mid); }
.slpx-actions .slpx-note { margin-right: auto; }
.slpx-note { display: inline-flex; align-items: center; gap: 0.5rem; font-size: 12px; line-height: 16px; color: var(--on-surface-variant); }
.slpx-status { padding: 0.75rem 1rem; border-radius: 12px; background: var(--ok-bg); color: var(--ok); font-size: 13px; line-height: 18px; font-weight: 600; }
.slpx-status.is-bad { background: var(--error-container); color: var(--on-error-container); }
.slpx-checks { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.375rem; margin: 0; padding: 0.875rem; list-style: none; border-radius: 12px; background: var(--surface-low); }
.slpx-checks li { display: flex; align-items: center; gap: 0.5rem; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--on-surface-variant); }
.slpx-checks li.is-met { color: var(--ok); }
.slpx-split { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 1rem; border-radius: 12px; background: var(--surface-low); }
.slpx-split p { display: flex; align-items: center; gap: 0.5rem; font-size: 13px; line-height: 18px; color: var(--on-surface-variant); }
.slpx-sizes { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.75rem; border: 0; margin: 0; padding: 0; }
.slpx-size { display: flex; align-items: center; gap: 0.75rem; padding: 0.875rem 1rem; border-radius: 12px; background: var(--surface-low); cursor: pointer; font-size: 13px; font-weight: 700; border: 2px solid transparent; }
.slpx-size:has(input:checked) { border-color: var(--primary); background: var(--primary-fixed); }
.slpx-size input { accent-color: var(--primary); width: 18px; height: 18px; flex: 0 0 auto; }
.slpx-size small { display: block; font-weight: 500; color: var(--on-surface-variant); }
.slpx-toggle { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.875rem 1rem; border-radius: 12px; background: var(--surface-low); }
.slpx-toggle strong { display: block; font-size: 14px; line-height: 20px; }
.slpx-toggle span.slpx-help { display: block; margin-top: 2px; }
.slpx-sw { position: relative; flex: 0 0 auto; width: 48px; height: 28px; border: 0; border-radius: 999px; background: var(--surface-highest); cursor: pointer; transition: background 0.2s; }
.slpx-sw::after { content: ''; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 999px; background: #fff; box-shadow: 0 1px 3px rgba(30, 26, 35, 0.3); transition: transform 0.2s; }
.slpx-sw[aria-checked='true'] { background: var(--primary); }
.slpx-sw[aria-checked='true']::after { transform: translateX(20px); }
.slpx-session { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem; border-radius: 16px; background: var(--surface-low); }
.slpx-session-main { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
.slpx-session-main .material-symbols-outlined { color: var(--primary); }
.slpx-session strong { display: block; font-size: 14px; line-height: 20px; overflow-wrap: anywhere; }
.slpx-confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; padding: 0.875rem 1rem; border-radius: 12px; background: var(--warn-bg); color: var(--warn); font-size: 13px; line-height: 18px; font-weight: 600; }
.slpx-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.slpx-row-btns { display: flex; flex-wrap: wrap; gap: 0.5rem; }
@media (min-width: 640px) {
  .slpx-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .slpx-grid .is-full { grid-column: 1 / -1; }
  .slpx-checks { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .slpx-sizes { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (min-width: 1024px) {
  .slpx-layout { grid-template-columns: 300px minmax(0, 1fr); }
  .slpx-sticky { position: sticky; top: 5rem; }
}
@media (max-width: 639px) {
  .slpx-tab { flex: 1 1 auto; justify-content: center; }
}
@media (max-width: 479px) {
  .slpx-card { padding: 1.125rem; }
  .slpx-title { font-size: 22px; line-height: 30px; }
  .slpx-actions .slpc-btn { flex: 1 1 100%; justify-content: center; }
}
`

/* ---------- helpers ---------- */

/* ---------- pieces ---------- */

function Field({ id, label, required, lock, help, error, icon, end, children }) {
  return (
    <div className="slpx-field">
      <label className="slpx-label" htmlFor={id}>
        {label}
        {required && <span className="req"> *</span>}
        {lock && (
          <span className="slpx-lock">
            {renderIcon('lock', 12)}
            {lock}
          </span>
        )}
      </label>
      <div className="slpx-wrap">
        {icon && renderIcon(icon, 20)}
        {children}
        {end}
      </div>
      {error ? (
        <span className="slpx-err" id={`${id}-err`} role="alert">
          {error}
        </span>
      ) : (
        help && <span className="slpx-help">{help}</span>
      )}
    </div>
  )
}

function PasswordField({ id, label, value, onChange, error, autoComplete }) {
  const [shown, setShown] = useState(false)
  return (
    <Field
      id={id}
      label={label}
      icon="lock"
      error={error}
      end={
        <button type="button" className="slpx-end" aria-label={`${shown ? 'Hide' : 'Show'} ${label.toLowerCase()}`} aria-pressed={shown} onClick={() => setShown(!shown)}>
          {renderIcon(shown ? 'visibility_off' : 'visibility', 20)}
        </button>
      }
    >
      <input id={id} className={`slpx-input has-end ${error ? 'is-bad' : ''}`} type={shown ? 'text' : 'password'} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? `${id}-err` : undefined} />
    </Field>
  )
}

function ProfileTab({ me }) {
  const queryClient = useQueryClient()
  const { refresh } = useAuth()
  const [draft, setDraft] = useState({})
  const [serverErrors, setServerErrors] = useState({})
  const [status, setStatus] = useState(null)
  const values = { ...baseValues(me), ...draft }
  const errors = { ...validateProfile(values), ...serverErrors }
  const payload = changedPayload(me, values)
  const dirty = Object.keys(payload).length > 0
  const details = me.details ?? {}

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
  const cancel = () => {
    setDraft({})
    setServerErrors({})
    setStatus(null)
  }
  const submit = (event) => {
    event.preventDefault()
    if (!dirty || Object.values(validateProfile(values)).some(Boolean)) return
    save.mutate(payload)
  }
  const invalid = Object.values(validateProfile(values)).some(Boolean)

  return (
    <form className="slpx-panel" onSubmit={submit} noValidate aria-label="Profile form">
      <div>
        <h2 className="slpx-h">Faculty dossier details</h2>
        <p className="slpx-sub">Your name, phone and photo link are visible to students and colleagues. Registry details are read-only.</p>
      </div>
      <div className="slpx-grid">
        <Field id="set-name" label="Full name" required icon="person" error={errors.full_name}>
          <input id="set-name" className={`slpx-input ${errors.full_name ? 'is-bad' : ''}`} value={values.full_name} onChange={edit('full_name')} autoComplete="name" aria-invalid={errors.full_name ? 'true' : undefined} />
        </Field>
        <Field id="set-email" label="Institutional email" lock="Managed by sign-in" icon="mail" help="Your sign-in address cannot be changed here.">
          <input id="set-email" className="slpx-input" value={me.email ?? ''} readOnly />
        </Field>
        <Field id="set-phone" label="Direct contact phone" icon="call" error={errors.phone} help="Optional. Leave empty to remove it.">
          <input id="set-phone" className={`slpx-input ${errors.phone ? 'is-bad' : ''}`} value={values.phone} onChange={edit('phone')} autoComplete="tel" inputMode="tel" aria-invalid={errors.phone ? 'true' : undefined} />
        </Field>
        <Field id="set-dept" label="Department" lock="Set by registry" icon="domain">
          <input id="set-dept" className="slpx-input" value={details.department ?? ''} readOnly />
        </Field>
        <Field id="set-title" label="Academic title" lock="Set by registry" icon="school">
          <input id="set-title" className="slpx-input" value={details.title ?? ''} readOnly />
        </Field>
        <Field id="set-staff" label="Staff number" lock="Set by registry" icon="badge">
          <input id="set-staff" className="slpx-input" value={details.staff_number ?? ''} readOnly />
        </Field>
        <div className="is-full" style={{ gridColumn: '1 / -1' }}>
          <Field id="set-avatar" label="Profile photo link" icon="image" error={errors.avatar_url} help="An https:// link to an image. Leave empty to show your initials.">
            <input id="set-avatar" className={`slpx-input ${errors.avatar_url ? 'is-bad' : ''}`} value={values.avatar_url} onChange={edit('avatar_url')} inputMode="url" autoComplete="off" aria-invalid={errors.avatar_url ? 'true' : undefined} />
          </Field>
        </div>
      </div>
      {status && (
        <p className={`slpx-status ${status.ok ? '' : 'is-bad'}`} role={status.ok ? 'status' : 'alert'}>
          {status.text}
        </p>
      )}
      <div className="slpx-actions">
        <span className="slpx-note">
          {renderIcon(dirty ? 'edit_note' : 'cloud_done', 18)}
          {dirty ? 'You have unsaved changes' : 'Everything is saved'}
        </span>
        <button type="button" className="slpc-btn slpc-btn-soft" onClick={cancel} disabled={!dirty || save.isPending}>
          Cancel
        </button>
        <button type="submit" className="slpc-btn slpc-btn-primary" disabled={!dirty || invalid || save.isPending}>
          {renderIcon('check_circle', 18)}
          {save.isPending ? 'Saving…' : 'Save profile changes'}
        </button>
      </div>
    </form>
  )
}

function SecurityTab({ me }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [serverErrors, setServerErrors] = useState({})
  const [status, setStatus] = useState(null)
  const [resetStatus, setResetStatus] = useState(null)
  const checks = passwordChecks(current, next, confirm)
  const ready = current.length > 0 && checks.every((check) => check.met)

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
    <div className="slpx-panel">
      <form className="slpx-panel" onSubmit={submit} noValidate aria-label="Change password">
        <div>
          <h2 className="slpx-h">Change password</h2>
          <p className="slpx-sub">Choose a password you do not use anywhere else. It is never shown or stored in plain text.</p>
        </div>
        <div className="slpx-grid">
          <div className="is-full" style={{ gridColumn: '1 / -1' }}>
            <PasswordField id="pw-current" label="Current password" value={current} onChange={(value) => { setCurrent(value); setServerErrors(without(serverErrors, 'current')) }} error={serverErrors.current} autoComplete="current-password" />
          </div>
          <PasswordField id="pw-new" label="New password" value={next} onChange={(value) => { setNext(value); setServerErrors(without(serverErrors, 'next')) }} error={serverErrors.next} autoComplete="new-password" />
          <PasswordField id="pw-confirm" label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        </div>
        <ul className="slpx-checks" aria-label="Password rules">
          {checks.map((check) => (
            <li key={check.id} className={check.met ? 'is-met' : ''}>
              {renderIcon(check.met ? 'check_circle' : 'radio_button_unchecked', 18)}
              {check.label}
              <span className="slpx-sr">{check.met ? ' (met)' : ' (not met)'}</span>
            </li>
          ))}
        </ul>
        {status && (
          <p className={`slpx-status ${status.ok ? '' : 'is-bad'}`} role={status.ok ? 'status' : 'alert'}>
            {status.text}
          </p>
        )}
        <div className="slpx-actions">
          <span className="slpx-note">
            {renderIcon('shield', 18)}
            Passwords are checked by the server, never kept in this page.
          </span>
          <button type="submit" className="slpc-btn slpc-btn-primary" disabled={!ready || change.isPending}>
            {renderIcon('lock_reset', 18)}
            {change.isPending ? 'Updating…' : 'Update password'}
          </button>
        </div>
      </form>

      <div className="slpx-split">
        <p>
          {renderIcon('forward_to_inbox', 20)}
          Forgot your current password? Email a reset link to {me.email}.
        </p>
        <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => { setResetStatus(null); reset.mutate() }} disabled={reset.isPending || !me.email}>
          {reset.isPending ? 'Sending…' : 'Email me a reset link'}
        </button>
      </div>
      {resetStatus && (
        <p className={`slpx-status ${resetStatus.ok ? '' : 'is-bad'}`} role={resetStatus.ok ? 'status' : 'alert'}>
          {resetStatus.text}
        </p>
      )}
      <p className="slpx-note">
        {renderIcon('info', 18)}
        Two-factor authentication is not offered by the portal yet.
      </p>
    </div>
  )
}

function DisplayTab() {
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
    <div className="slpx-panel">
      <div>
        <h2 className="slpx-h">Display &amp; accessibility</h2>
        <p className="slpx-sub">These choices apply to this device and browser only, and take effect straight away.</p>
      </div>
      <fieldset className="slpx-sizes">
        <legend className="slpx-label" style={{ marginBottom: 8 }}>
          Interface size
        </legend>
        {SIZES.map((size) => (
          <label key={size} className="slpx-size">
            <input type="radio" name="interface-size" value={size} checked={prefs.size === size} onChange={() => update({ size })} />
            <span>
              {SIZE_LABELS[size]}
              <small>{size === 100 ? 'The default layout.' : size === 110 ? 'A little larger text and controls.' : 'Highest legibility on dense screens.'}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="slpx-toggle">
        <div>
          <strong id="sw-contrast">High contrast</strong>
          <span className="slpx-help">Darkens secondary text and borders for easier reading.</span>
        </div>
        <button type="button" role="switch" aria-checked={prefs.highContrast} aria-labelledby="sw-contrast" className="slpx-sw" onClick={() => update({ highContrast: !prefs.highContrast })} />
      </div>
      <div className="slpx-toggle">
        <div>
          <strong id="sw-motion">Reduced motion</strong>
          <span className="slpx-help">Turns off animated transitions across the portal.</span>
        </div>
        <button type="button" role="switch" aria-checked={prefs.reduceMotion} aria-labelledby="sw-motion" className="slpx-sw" onClick={() => update({ reduceMotion: !prefs.reduceMotion })} />
      </div>
      {!saved && (
        <p className="slpx-status is-bad" role="alert">
          This browser would not keep your choices, so they will reset when you reload.
        </p>
      )}
      <div className="slpx-actions">
        <span className="slpx-note">
          {renderIcon('devices', 18)}
          Saved on this device
        </span>
        <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => update({ ...DISPLAY_DEFAULTS })} disabled={isDefault}>
          Reset to defaults
        </button>
      </div>
    </div>
  )
}

function SessionsTab({ me }) {
  const [asking, setAsking] = useState(false)
  const [status, setStatus] = useState(null)
  const others = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut({ scope: 'others' })
      if (error) throw error
    },
    onSuccess: () => {
      setAsking(false)
      setStatus({ ok: true, text: 'All other devices have been signed out. This device stays signed in.' })
    },
    onError: () => {
      setAsking(false)
      setStatus({ ok: false, text: 'Other devices could not be signed out. Please try again.' })
    },
  })
  // scope 'local' ends only this browser; the default would end every device.
  const leave = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut({ scope: 'local' })
      if (error) throw error
    },
    onError: () => setStatus({ ok: false, text: 'You could not be signed out. Please try again.' }),
  })

  return (
    <div className="slpx-panel">
      <div>
        <h2 className="slpx-h">Sessions</h2>
        <p className="slpx-sub">Sign out of this device, or end every other place your account is signed in.</p>
      </div>
      <div className="slpx-session">
        <div className="slpx-session-main">
          {renderIcon('laptop_mac', 24)}
          <div>
            <strong>This device</strong>
            <span className="slpx-help">Signed in as {me.email}</span>
          </div>
        </div>
        <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => leave.mutate()} disabled={leave.isPending}>
          {renderIcon('logout', 18)}
          {leave.isPending ? 'Signing out…' : 'Log out'}
        </button>
      </div>
      {asking ? (
        <div className="slpx-confirm" role="alertdialog" aria-label="Confirm sign out of other devices">
          <span>Sign out every other device? Anyone using them will need to sign in again.</span>
          <span className="slpx-row-btns">
            <button type="button" className="slpc-btn slpc-btn-primary" onClick={() => others.mutate()} disabled={others.isPending}>
              {others.isPending ? 'Signing out…' : 'Yes, sign them out'}
            </button>
            <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => setAsking(false)} disabled={others.isPending}>
              Keep them
            </button>
          </span>
        </div>
      ) : (
        <div className="slpx-split">
          <p>
            {renderIcon('no_encryption', 20)}
            Lost a device or used a shared computer? End all other sessions.
          </p>
          <button type="button" className="slpc-btn slpc-btn-soft" onClick={() => { setStatus(null); setAsking(true) }}>
            Sign out other devices
          </button>
        </div>
      )}
      {status && (
        <p className={`slpx-status ${status.ok ? '' : 'is-bad'}`} role={status.ok ? 'status' : 'alert'}>
          {status.text}
        </p>
      )}
      <p className="slpx-note">
        {renderIcon('info', 18)}
        A list of individual devices is not available yet.
      </p>
    </div>
  )
}

/* ---------- page ---------- */

export default function LecturerSettings() {
  useCourseFonts()
  const [tab, setTab] = useState('profile')
  const [failedPhoto, setFailedPhoto] = useState('')
  const meQuery = useQuery({ queryKey: ME_KEY, queryFn: () => api('/me') })
  const me = meQuery.data
  const details = me?.details ?? {}
  const displayName = me?.full_name || me?.email || 'Lecturer'
  const hasPhoto = typeof me?.avatar_url === 'string' && me.avatar_url.startsWith('https://') && failedPhoto !== me.avatar_url

  return (
    <div className="slpc" aria-label="Faculty settings and preferences">
      <style>{COURSE_STYLES}</style>
      <style>{SETTINGS_STYLES}</style>

      <div className="slpc-stack slpc-gap-lg">
        <div className="slpx-head">
          <nav className="slpc-trail" aria-label="Breadcrumb">
            <Link to="/lecturer" className="slpc-trail-link">
              {renderIcon('home', 16)}
              Dashboard
            </Link>
            <span className="slpc-trail-sep">{renderIcon('chevron_right', 16)}</span>
            <span className="slpc-trail-current">Settings</span>
          </nav>
          <h1 className="slpx-title">Faculty Settings &amp; Preferences</h1>
        </div>

        <div className="slpc-card slpx-tabs" role="tablist" aria-label="Settings sections">
          {TABS.map((entry) => (
            <button key={entry.id} type="button" role="tab" id={`tab-${entry.id}`} aria-selected={tab === entry.id} aria-controls="settings-panel" className="slpx-tab" onClick={() => setTab(entry.id)}>
              {renderIcon(entry.icon, 18)}
              {entry.label}
            </button>
          ))}
        </div>

        {meQuery.isPending && <Skeleton height={220} label="Loading your profile" />}
        {meQuery.isError && <ErrorCard message="Your profile could not be loaded." onRetry={() => meQuery.refetch()} />}

        {me && (
          <div className="slpx-layout">
            <aside className="slpx-sticky" aria-label="Account summary">
              <section className="slpc-card slpx-id">
                <div className="slpx-id-band" aria-hidden="true" />
                <div className="slpx-id-body">
                  <span className="slpx-avatar" aria-hidden="true">
                    {hasPhoto ? <img src={me.avatar_url} alt="" onError={() => setFailedPhoto(me.avatar_url)} /> : initials(me.full_name)}
                  </span>
                  <h2 className="slpx-name">{displayName}</h2>
                  {details.title && <p className="slpx-role">{details.title}</p>}
                  <div className="slpx-chips">
                    {details.staff_number && (
                      <span className="slpx-chip">
                        {renderIcon('lock', 12)}#{details.staff_number}
                      </span>
                    )}
                    {details.status && (
                      <span className={`slpx-chip ${details.status === 'active' ? 'is-ok' : ''}`}>{sentenceCase(details.status)}</span>
                    )}
                  </div>
                  <dl className="slpx-facts">
                    {details.department && (
                      <div className="slpx-fact">
                        <dt>Department</dt>
                        <dd>{details.department}</dd>
                      </div>
                    )}
                    <div className="slpx-fact">
                      <dt>Role</dt>
                      <dd>{sentenceCase(me.role)}</dd>
                    </div>
                  </dl>
                </div>
              </section>
              <section className="slpc-card slpx-audit" aria-label="Audit record">
                <span className="slpc-eyebrow">Audit record</span>
                {me.created_at && (
                  <p>
                    {renderIcon('calendar_today', 16)}
                    Profile created: <strong>{formatDate(me.created_at)}</strong>
                  </p>
                )}
                {me.updated_at && (
                  <p>
                    {renderIcon('update', 16)}
                    Last updated: <strong>{formatDate(me.updated_at)}</strong>
                  </p>
                )}
              </section>
            </aside>

            <section className="slpc-card slpx-card" id="settings-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
              {tab === 'profile' && <ProfileTab me={me} />}
              {tab === 'security' && <SecurityTab me={me} />}
              {tab === 'notifications' && (
                <PhasePanel icon="notifications_active" title="Notification preferences are not switched on yet" phase="Phase 7">
                  Choosing which events notify you (submissions, reminders, announcements) arrives with notifications. Until then nothing here can be saved, so no switches are shown.
                </PhasePanel>
              )}
              {tab === 'display' && <DisplayTab />}
              {tab === 'sessions' && <SessionsTab me={me} />}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
