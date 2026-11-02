import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useWorkSession } from '../../contexts/WorkSessionContext'
import { cdmxDateKey } from '../../lib/workSchedule'
import {
  filterUndatedMissions, orderMissions, shouldShowMissingDatesModal,
  isPastDate, isAfterLaunch, type MissionTask,
} from '../../lib/missingDates'

function skipKey(userId: string) {
  return `misiones-sin-fecha:skip:${userId}`
}

function formatDiaMes(dateKey: string) {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit' })
}

export default function MissingDatesModal() {
  const { user } = useAuth()
  const { currentSession, needsCheckIn, showOvertimeModal } = useWorkSession()
  const gateOpen = needsCheckIn || showOvertimeModal
  const fetchedRef = useRef(false)

  const [open, setOpen] = useState(false)
  const [missions, setMissions] = useState<MissionTask[] | null>(null)
  const [dates, setDates] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  const todayKey = cdmxDateKey()

  function handleSkip() {
    if (user) localStorage.setItem(skipKey(user.id), todayKey)
    setOpen(false)
  }

  useEffect(() => {
    if (fetchedRef.current) return
    if (!user || user.role !== 'team' || !currentSession || gateOpen) return
    fetchedRef.current = true
    let cancelled = false
    supabase
      .from('tasks')
      .select('id, title, department, status, review_status, commitment_date, assigned_to, project_id, phase, created_at, updated_at, project:projects(status, launch_date, name, client:clients(name))')
      .eq('assigned_to', user.id)
      .is('commitment_date', null)
      .is('archived_at', null)
      .neq('department', 'cliente')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.error('No se pudieron cargar las misiones sin fecha:', error)
          setMissions([])
          return
        }
        const ordered = orderMissions(filterUndatedMissions((data || []) as unknown as MissionTask[], user.id))
        setMissions(ordered)
        const skippedOn = localStorage.getItem(skipKey(user.id))
        if (shouldShowMissingDatesModal({
          role: user.role, hasSessionToday: true, checkInGateOpen: false,
          skippedOn, todayKey: cdmxDateKey(), count: ordered.length,
        })) setOpen(true)
      })
    return () => { cancelled = true }
  }, [user, currentSession, gateOpen])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') handleSkip() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open || gateOpen || !missions || !user) return null

  async function saveOne(task: MissionTask) {
    const dateValue = dates[task.id]
    if (!dateValue) return
    if (isPastDate(dateValue, todayKey)) {
      setRowErrors(e => ({ ...e, [task.id]: 'No se permiten fechas pasadas.' }))
      return
    }
    setRowErrors(e => ({ ...e, [task.id]: '' }))
    setSaving(s => ({ ...s, [task.id]: true }))
    const { data, error } = await supabase
      .from('tasks')
      .update({ commitment_date: dateValue })
      .eq('id', task.id)
      .eq('assigned_to', user!.id)
      .is('commitment_date', null)
      .select('id')
    setSaving(s => ({ ...s, [task.id]: false }))
    if (error || !data || data.length === 0) {
      setRowErrors(e => ({ ...e, [task.id]: 'No se pudo guardar. Actualiza la página e intenta de nuevo.' }))
      return
    }
    setMissions(prev => (prev || []).filter(t => t.id !== task.id))
  }

  async function saveAll() {
    const pending = missions!.filter(t => dates[t.id])
    for (const task of pending) await saveOne(task)
  }

  const anyDateChosen = missions.some(t => dates[t.id])

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'linear-gradient(135deg, rgba(29,78,216,0.92) 0%, rgba(185,28,28,0.88) 100%)', backdropFilter: 'blur(4px)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        <div className="bg-gradient-to-r from-blue-700 to-red-600 px-6 py-5 text-white relative">
          <button type="button" onClick={handleSkip} aria-label="Cerrar" className="absolute top-4 right-4 text-white/70 hover:text-white">
            <X size={18} />
          </button>
          {missions.length === 0 ? (
            <h2 className="text-xl font-bold">¡Listo! Todas tus misiones tienen fecha ✅</h2>
          ) : (
            <>
              <h2 className="text-xl font-bold">Tienes {missions.length} misión{missions.length === 1 ? '' : 'es'} sin fecha de entrega</h2>
              <p className="text-blue-200 text-sm mt-1">Ponles fecha para arrancar el día 🚀</p>
            </>
          )}
        </div>

        {missions.length === 0 ? (
          <div className="p-6 text-center">
            <button type="button" onClick={() => setOpen(false)}
              className="w-full py-2.5 bg-gradient-to-r from-blue-700 to-red-600 text-white rounded-xl text-sm font-semibold hover:opacity-90 transition">
              Continuar
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {missions.map(task => {
                const launchDate = task.project?.launch_date
                const dateValue = dates[task.id] || ''
                const showLaunchWarning = dateValue && isAfterLaunch(dateValue, launchDate)
                return (
                  <div key={task.id} className="border border-gray-200 rounded-xl p-3">
                    <p className="text-xs text-gray-400 truncate">{task.project?.client?.name || 'Sin cliente'} · {task.project?.name || 'Sin proyecto'}</p>
                    <p className="text-sm font-semibold text-gray-800 mt-0.5">{task.title}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="date"
                        min={todayKey}
                        value={dateValue}
                        onChange={e => setDates(d => ({ ...d, [task.id]: e.target.value }))}
                        className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      />
                      <button
                        type="button"
                        onClick={() => saveOne(task)}
                        disabled={!dateValue || saving[task.id]}
                        className="bg-blue-600 text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                      >
                        {saving[task.id] ? 'Guardando...' : 'Guardar'}
                      </button>
                    </div>
                    {showLaunchWarning && (
                      <p className="mt-1.5 text-xs text-amber-600 font-medium">⚠ Queda después del lanzamiento ({formatDiaMes(launchDate!)})</p>
                    )}
                    {rowErrors[task.id] && <p role="alert" className="mt-1.5 text-xs text-red-600">{rowErrors[task.id]}</p>}
                  </div>
                )
              })}
            </div>

            <div className="p-4 border-t border-gray-100 flex gap-3">
              <button type="button" onClick={handleSkip}
                className="flex-1 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-semibold hover:bg-gray-50 transition">
                Lo hago después
              </button>
              <button type="button" onClick={saveAll} disabled={!anyDateChosen}
                className="flex-1 py-2.5 bg-gradient-to-r from-blue-700 to-red-600 text-white rounded-xl text-sm font-semibold hover:opacity-90 transition disabled:opacity-50">
                Guardar todas
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
