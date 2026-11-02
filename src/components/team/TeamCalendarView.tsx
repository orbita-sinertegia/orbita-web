import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Clock3, GripVertical } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { Task } from '../../types'

interface Props {
  tasks: Task[]
  onSelectTask: (task: Task) => void
  onTasksChange?: () => void | Promise<void>
}

const DAY_MS = 86400000
const HOURS = Array.from({ length: 11 }, (_, index) => index + 8)
const CLIENT_COLORS = [
  { card: 'bg-purple-50 border-purple-300 text-purple-950', dot: 'bg-purple-500' },
  { card: 'bg-green-50 border-green-300 text-green-950', dot: 'bg-green-500' },
  { card: 'bg-blue-50 border-blue-300 text-blue-950', dot: 'bg-blue-500' },
  { card: 'bg-amber-50 border-amber-300 text-amber-950', dot: 'bg-amber-500' },
  { card: 'bg-orange-50 border-orange-300 text-orange-950', dot: 'bg-orange-500' },
]

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function mondayOf(date: Date) {
  const result = new Date(date)
  const day = result.getDay()
  result.setDate(result.getDate() + (day === 0 ? -6 : 1 - day))
  result.setHours(0, 0, 0, 0)
  return result
}

export default function TeamCalendarView({ tasks, onSelectTask, onTasksChange }: Props) {
  const [anchor, setAnchor] = useState(() => mondayOf(new Date()))
  const [mode, setMode] = useState<'semana' | 'mes'>('semana')
  const [savingTask, setSavingTask] = useState<string | null>(null)
  const [dropDay, setDropDay] = useState<string | null>(null)

  const activeTasks = tasks.filter(task => task.status !== 'completada')
  const undatedTasks = activeTasks.filter(task => !task.commitment_date)
  const clientNames = useMemo(
    () => Array.from(new Set(tasks.map(task => task.project?.client?.name || task.project?.name || 'Trabajo interno'))),
    [tasks],
  )

  const colorFor = (task: Task) => {
    const name = task.project?.client?.name || task.project?.name || 'Trabajo interno'
    return CLIENT_COLORS[Math.max(0, clientNames.indexOf(name)) % CLIENT_COLORS.length]
  }

  const weekDays = Array.from({ length: 5 }, (_, index) => new Date(anchor.getTime() + index * DAY_MS))
  const datedTasks = activeTasks.filter(task => task.commitment_date)

  async function assignDate(taskId: string, date: Date) {
    setDropDay(null)
    setSavingTask(taskId)
    const { error } = await supabase.from('tasks').update({ commitment_date: dateKey(date) }).eq('id', taskId)
    setSavingTask(null)
    if (!error) await onTasksChange?.()
  }

  function move(direction: number) {
    const next = new Date(anchor)
    next.setDate(next.getDate() + direction * (mode === 'semana' ? 7 : 28))
    setAnchor(mondayOf(next))
  }

  const rangeLabel = `${weekDays[0].toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} – ${weekDays[4].toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}`

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <CalendarDays className="text-blue-700" size={28} />
          <div>
            <h2 className="text-xl font-bold text-slate-900">Mi calendario</h2>
            <p className="text-xs text-slate-400">{rangeLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1">
            {(['semana', 'mes'] as const).map(value => (
              <button key={value} onClick={() => setMode(value)} className={`rounded-md px-5 py-2 text-xs font-semibold capitalize transition ${mode === value ? 'bg-blue-800 text-white shadow-sm' : 'text-slate-600 hover:bg-white'}`}>{value}</button>
            ))}
          </div>
          <button onClick={() => setAnchor(mondayOf(new Date()))} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Hoy</button>
          <button onClick={() => move(-1)} className="rounded-lg border border-slate-200 p-2 hover:bg-slate-50"><ChevronLeft size={18} /></button>
          <button onClick={() => move(1)} className="rounded-lg border border-slate-200 p-2 hover:bg-slate-50"><ChevronRight size={18} /></button>
        </div>
      </header>

      {undatedTasks.length > 0 && (
        <div className="mx-5 mt-4 flex items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <AlertTriangle size={17} className="text-amber-500" />
          <strong>{undatedTasks.length} tareas no aparecen porque no tienen fecha de compromiso</strong>
        </div>
      )}

      <div className="grid min-h-[620px] grid-cols-1 p-5 lg:grid-cols-[210px_minmax(760px,1fr)]">
        <aside className="border border-slate-200 bg-slate-50/50 lg:rounded-l-xl">
          <div className="flex h-12 items-center justify-between border-b border-slate-200 px-3">
            <span className="text-sm font-bold text-slate-800">Sin fecha</span>
            <GripVertical size={17} className="text-slate-400" />
          </div>
          <div className="space-y-3 p-2.5">
            {undatedTasks.slice(0, 10).map(task => {
              const color = colorFor(task)
              return (
                <button key={task.id} draggable disabled={savingTask === task.id} onDragStart={event => event.dataTransfer.setData('text/task-id', task.id)} onClick={() => onSelectTask(task)} className={`w-full rounded-lg border-l-4 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow ${color.card}`}>
                  <span className="block truncate text-xs font-bold">{task.title}</span>
                  <span className="mt-2 flex items-center gap-1.5 truncate text-[11px] text-slate-500"><span className={`h-2 w-2 rounded-full ${color.dot}`} />{task.project?.client?.name || task.project?.name || 'Trabajo interno'}</span>
                  <span className="mt-1 flex items-center gap-1 text-[11px] text-slate-500"><Clock3 size={11} /> Arrastra a un día</span>
                </button>
              )
            })}
          </div>
        </aside>

        <div className="overflow-x-auto rounded-r-xl border border-l-0 border-slate-200">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[48px_repeat(5,minmax(140px,1fr))] border-b border-slate-200 bg-white">
              <div />
              {weekDays.map(day => {
                const dayTasks = datedTasks.filter(task => task.commitment_date?.slice(0, 10) === dateKey(day))
                return <div key={dateKey(day)} className="border-l border-slate-200 px-2 py-2 text-center"><p className="text-sm font-bold text-slate-800 capitalize">{day.toLocaleDateString('es-MX', { weekday: 'short' })}</p><p className="text-xs text-slate-500">{day.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</p><p className="mt-2 rounded bg-blue-50 py-1 text-[11px] font-medium text-blue-900">{dayTasks.length} tareas · {dayTasks.length} h</p></div>
              })}
            </div>
            <div className="relative grid grid-cols-[48px_repeat(5,minmax(140px,1fr))]" style={{ height: HOURS.length * 54 }}>
              <div className="relative bg-white">
                {HOURS.map((hour, index) => <span key={hour} className="absolute right-2 text-[11px] text-slate-400" style={{ top: index * 54 - 7 }}>{String(hour).padStart(2, '0')}:00</span>)}
              </div>
              {weekDays.map((day, dayIndex) => {
                const key = dateKey(day)
                const dayTasks = datedTasks.filter(task => task.commitment_date?.slice(0, 10) === key)
                return (
                  <div key={key} onDragOver={event => { event.preventDefault(); setDropDay(key) }} onDragLeave={() => setDropDay(null)} onDrop={event => { event.preventDefault(); void assignDate(event.dataTransfer.getData('text/task-id'), day) }} className={`relative border-l border-slate-200 transition ${dropDay === key ? 'bg-blue-50 ring-2 ring-inset ring-blue-300' : 'bg-white'}`}>
                    {HOURS.map((hour, index) => <div key={hour} className="absolute left-0 right-0 border-t border-slate-100" style={{ top: index * 54 }} />)}
                    {dayTasks.map((task, index) => {
                      const color = colorFor(task)
                      const top = (1 + ((index * 2 + dayIndex) % 9)) * 54 + 5
                      return <button key={task.id} onClick={() => onSelectTask(task)} className={`absolute left-2 right-2 z-10 rounded-md border p-2 text-left shadow-sm transition hover:z-20 hover:shadow-md ${color.card}`} style={{ top, minHeight: 48 }}><span className="block truncate text-[11px] font-bold">{task.title}</span><span className="mt-1 flex items-center gap-1 truncate text-[10px] opacity-75"><span className={`h-1.5 w-1.5 rounded-full ${color.dot}`} />{task.project?.client?.name || task.project?.name}</span></button>
                    })}
                    {dayTasks.length === 0 && dropDay === key && <div className="absolute inset-x-3 top-20 rounded-lg border-2 border-dashed border-blue-300 bg-white/80 p-4 text-center text-xs font-semibold text-blue-700">Soltar para asignar fecha</div>}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
