import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../services/supabase.js'
import { api } from '../services/apiClient.js'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async () => {
    try { setUser(await api('/me')) } catch { setUser(null) } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => (data.session ? loadProfile() : setLoading(false)))
    const { data: sub } = supabase.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') setUser(null) })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  const login = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error('Invalid email or password')
    await loadProfile()
  }
  const logout = async () => { await supabase.auth.signOut(); setUser(null) }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
}
