import { createContext, useCallback, useContext, useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'
import type { User } from '../types'
import { scheduleForDate, nowInCdmx } from '../lib/workSchedule'

export interface WorkSession {
  id: string
  user_id: string
  location: 'oficina' | 'home_office'
  started_at: string
  ended_at: string | null
  regular_minutes: number
  overtime_minutes: number
  date: string
  late_minutes?: number
  scheduled_start_min?: number | null
  is_first_of_day?: boolean
}

interface WorkSessionContextType {
  currentSession: WorkSession | null
  needsCheckIn: boolean
  showOvertimeModal: boolean
  checkIn: (location: 'oficina' | 'home_office') => Promise<void>
  checkOut: () => Promise<boolean>
  continueOvertime: () => void
  declineOvertime: () => void
  elapsedMinutes: number
  isInOvertime: boolean
  sessionError: string
  savingSession: boolean
  lastCheckInNotice: string
  dismissCheckInNotice: () => void
}

const WorkSessionContext = createContext<WorkSessionContextType>({
  currentSession: null, needsCheckIn: false, showOvertimeModal: false,
  checkIn: async () => {}, checkOut: async () => true,
  continueOvertime: () => {}, declineOvertime: () => {},
  elapsedMinutes: 0, isInOvertime: false, sessionError: '', savingSession: false,
  lastCheckInNotice: '', dismissCheckInNotice: () => {},
})

function getScheduleHours(user: User, date = nowInCdmx()) {
  return scheduleForDate(user, date)
}

export function WorkSessionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [currentSession, setCurrentSession] = useState<WorkSession | null>(null)
  const [needsCheckIn, setNeedsCheckIn] = useState(false)
  const [showOvertimeModal, setShowOvertimeModal] = useState(false)
  const [elapsedMinutes, setElapsedMinutes] = useState(0)
  const overtimeAlerted = useRef<string | null>(null)
  const savingRef = useRef(false)
  const [sessionError, setSessionError] = useState('')
  const [savingSession, setSavingSession] = useState(false)
  const [lastCheckInNotice, setLastCheckInNotice] = useState('')

  const schedule = user ? getScheduleHours(user) : { enabled: true, start: 9, end: 18 }
  const isInOvertime = !schedule.enabled || nowInCdmx().getHours() >= schedule.end

  const loadTodaySession = useCallback(async () => {
    if (!user || user.role === 'client') {
      setCurrentSession(null)
      setElapsedMinutes(0)
      setNeedsCheckIn(false)
      setShowOvertimeModal(false)
      setSessionError('')
      overtimeAlerted.current = null
      return
    }

    const { data, error } = await supabase.rpc('mi_sesion_hoy')

    if (error) {
      // Ante un fallo temporal no mostramos el check-in: hacerlo podría crear
      // otra sesión y aparentar que el tiempo anterior se perdió.
      console.error('No se pudo recuperar la sesión laboral activa', error)
      setNeedsCheckIn(false)
      return
    }

    const session = ((data || []) as WorkSession[])[0] || null
    if (session) {
      setCurrentSession(session)
      setElapsedMinutes(Math.max(0, Math.floor((Date.now() - new Date(session.started_at).getTime()) / 60000)))
      setNeedsCheckIn(false)
    } else {
      setCurrentSession(null)
      setElapsedMinutes(0)
      setNeedsCheckIn(true)
    }
  }, [user])

  useEffect(() => {
    const id = window.setTimeout(() => { void loadTodaySession() }, 0)
    return () => window.clearTimeout(id)
  }, [loadTodaySession])

  // Reloj — actualiza cada minuto
  useEffect(() => {
    if (!currentSession) return
    const tick = () => {
      const start = new Date(currentSession.started_at)
      setElapsedMinutes(Math.max(0, Math.floor((Date.now() - start.getTime()) / 60000)))

      const todaySchedule = user ? getScheduleHours(user) : { enabled: true, start: 9, end: 18 }
      const reachedOvertime = !todaySchedule.enabled || nowInCdmx().getHours() >= todaySchedule.end
      if (reachedOvertime && overtimeAlerted.current !== currentSession.id) {
        overtimeAlerted.current = currentSession.id
        setShowOvertimeModal(true)
      }
    }
    tick()
    const id = setInterval(tick, 60000)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [currentSession, user])

  async function checkIn(location: 'oficina' | 'home_office') {
    if (!user || savingRef.current) return
    savingRef.current = true
    setSavingSession(true)
    setSessionError('')
    try {
      const { data, error } = await supabase.rpc('registrar_entrada', { p_location: location })
      if (error || !data) throw error || new Error('No se pudo registrar la entrada')
      const session = data as WorkSession
      setCurrentSession(session)
      setElapsedMinutes(Math.max(0, Math.floor((Date.now() - new Date(session.started_at).getTime()) / 60000)))
      const hora = new Date(session.started_at).toLocaleTimeString('es-MX', {
        hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City',
      })
      setLastCheckInNotice(
        session.is_first_of_day && (session.late_minutes || 0) > 0
          ? `Entrada registrada a las ${hora} (hora del servidor) · ${session.late_minutes} min después de tu horario`
          : `Entrada registrada a las ${hora} (hora del servidor) · a tiempo`
      )
    } catch {
      setSessionError('No se pudo guardar la entrada. Intenta de nuevo.')
    } finally {
      savingRef.current = false
      setSavingSession(false)
    }
  }

  function dismissCheckInNotice() {
    setLastCheckInNotice('')
    setNeedsCheckIn(false)
  }

  async function checkOut() {
    if (savingRef.current) return false
    if (!currentSession || !user) return true
    savingRef.current = true
    setSavingSession(true)
    setSessionError('')
    try {
      const { error } = await supabase.rpc('registrar_salida')
      if (error) throw error
      setCurrentSession(null)
      setElapsedMinutes(0)
      setShowOvertimeModal(false)
      return true
    } catch {
      setSessionError('No se pudo guardar la salida. Tu sesión sigue abierta; intenta de nuevo.')
      return false
    } finally {
      savingRef.current = false
      setSavingSession(false)
    }
  }

  function continueOvertime() { setShowOvertimeModal(false) }

  async function declineOvertime() {
    await checkOut()
  }

  return (
    <WorkSessionContext.Provider value={{
      currentSession, needsCheckIn, showOvertimeModal,
      checkIn, checkOut, continueOvertime, declineOvertime,
      elapsedMinutes, isInOvertime, sessionError, savingSession,
      lastCheckInNotice, dismissCheckInNotice,
    }}>
      {children}
    </WorkSessionContext.Provider>
  )
}

export const useWorkSession = () => useContext(WorkSessionContext)
