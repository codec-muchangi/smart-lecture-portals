import { supabase } from './supabase.js'

const BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1'

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details || {}
  }
}

export async function api(path, { method = 'GET', body, form, retry = true } = {}) {
  const { data } = await supabase.auth.getSession()
  const headers = {}
  if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`
  if (body) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${BASE}${path}`, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) })
  if (res.status === 401 && retry) {
    const { error } = await supabase.auth.refreshSession()
    if (!error) return api(path, { method, body, form, retry: false })
    await supabase.auth.signOut()
    window.location.assign('/login')
  }
  if (res.status === 204) return null
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, json.code || 'HTTP_ERROR', json.message || 'Request failed', json.details)
  return json
}
