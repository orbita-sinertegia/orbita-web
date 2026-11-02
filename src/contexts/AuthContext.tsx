import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { User } from '../types'

interface AuthContextType {
  session: Session | null
  user: User | null
  loading: boolean
  isPasswordRecovery: boolean
  unauthorizedEmail: string | null
  deactivatedEmail: string | null
  licenseSuspended: boolean
  signOut: () => Promise<void>
  refreshUser: () => Promise<void>
  finishPasswordRecovery: () => void
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  isPasswordRecovery: false,
  unauthorizedEmail: null,
  deactivatedEmail: null,
  licenseSuspended: false,
  signOut: async () => {},
  refreshUser: async () => {},
  finishPasswordRecovery: () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)
  const [unauthorizedEmail, setUnauthorizedEmail] = useState<string | null>(null)
  const [deactivatedEmail, setDeactivatedEmail] = useState<string | null>(null)
  const [licenseSuspended, setLicenseSuspended] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) fetchUser(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true)
        setSession(session)
        setLoading(false)
        return
      }
      setSession(session)
      if (session) fetchUser(session.user.id)
      else { setUser(null); setIsPasswordRecovery(false); setLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchUser(id: string) {
    // Keep the invitation form mounted until all registration writes finish.
    const params = new URLSearchParams(window.location.search)
    if (params.has('invite') || params.has('team_invite')) {
      setLoading(false)
      return
    }
    const { data } = await supabase.from('users').select('*').eq('id', id).single()
    if (!data) {
      // Cuenta autenticada (ej. Google) pero sin registro en el sistema: se rechaza el acceso.
      const { data: { session: currentSession } } = await supabase.auth.getSession()
      setUnauthorizedEmail(currentSession?.user.email || null)
      await supabase.auth.signOut()
      setUser(null)
      setSession(null)
      setLoading(false)
      return
    }
    if ((data as any).active === false) {
      // Cuenta desactivada por el admin: se rechaza el acceso sin borrar su historial.
      setDeactivatedEmail(data.email)
      await supabase.auth.signOut()
      setUser(null)
      setSession(null)
      setLoading(false)
      return
    }
    // La licencia de esta instancia puede ser suspendida por el súper admin (ej. si no se pagó la renta).
    // El súper admin siempre puede entrar, aunque la licencia esté suspendida, para poder reactivarla.
    if (!(data as any).is_super_admin) {
      const { data: license } = await supabase.from('app_license').select('status').eq('id', 1).single()
      if (license?.status === 'suspended') {
        setLicenseSuspended(true)
        await supabase.auth.signOut()
        setUser(null)
        setSession(null)
        setLoading(false)
        return
      }
    }
    setUser(data)
    setLoading(false)
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  async function refreshUser() {
    if (session) await fetchUser(session.user.id)
  }

  return (
    <AuthContext.Provider value={{ session, user, loading, isPasswordRecovery, unauthorizedEmail, deactivatedEmail, licenseSuspended, signOut, refreshUser, finishPasswordRecovery: () => setIsPasswordRecovery(false) }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
