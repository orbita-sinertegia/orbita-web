import { useMemo, useState, type CSSProperties, type DragEvent } from 'react'
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Clock3, GripVertical } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { Task } from '../../types'
import { addLocalDays, cdmxTodayKey, formatDateOnly, isDateKeyOverdue, localDateKey, mondayOf, monthWeeks } from '../../lib/dates'
import type { EstimatePlanTask } from '../../lib/roadmapEstimate'
import { calendarDayOf } from '../../lib/estimateViews'
import { useProjectEstimates } from '../../hooks/useProjectEstimates'
import EstimatesToggle from '../shared/EstimatesToggle'
import { holidayName } from '../../lib/holidays'

interface Props {
  tasks: Task[]
  /** Tareas de los mismos proyectos (de compañeros), solo para calcular estimados. */
  contextTasks?: EstimatePlanTask[]
  onSelectTask: (task: Task) => void
  onTasksChange?: () => void | Promise<void>
}

const HOURS = Array.from({ length: 11 }, (_, index) => index + 8)
const MONTH_DAY_NAMES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const CLIENT_COLORS = [
  { card: 'bg-purple-50 border-purple-300 text-purple-950', dot: 'bg-purple-500' },
  { card: 'bg-green-50 border-green-300 text-green-950', dot: 'bg-green-500' },
  { card: 'bg-blue-50 border-blue-300 text-blue-950', dot: 'bg-blue-500' },
  { card: 'bg-amber-50 border-amber-300 text-amber-950', dot: 'bg-amber-500' },
  { card: 'bg-orange-50 border-orange-300 text-orange-950', dot: 'bg-orange-500' },
]

function firstOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export default function TeamCalendarView({ tasks, contextTasks, onSelectTask, onTasksChange }: Props) {
  const [anchor, setAnchor] = useState(() => mondayOf(new Date()))
  const [monthAnchor, setMonthAnchor] = useState(() => firstOfMonth(new Date()))
  const [mode, setMode] = useState<'semana' | 'mes'>('semana')
  const [savingTask, setSavingTask] = useState<string | null>(null)
  const [dropDay, setDropDay] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [showEstimates, setShowEstimates] = useState(true)

  const activeTasks = tasks.filter(task => task.status !== 'completada')
  // Estimados: tareas sin fecha de entrega se colocan (difuminadas, "≈") en su entrega aproximada.
  const estimates = useProjectEstimates({ tasks, contextTasks, enabled: showEstimates })
  const dayOf = (task: Task) => calendarDayOf(task, estimates)
  const undatedTasks = activeTasks.filter(task => !dayOf(task))
  const estimatedCount = activeTasks.filter(task => dayOf(task)?.estimated).length
  const clientNames = useMemo(
    () => Array.from(new Set(tasks.map(task => task.project?.client?.name || task.project?.name || 'Trabajo interno'))),
    [tasks],
  )

  const colorFor = (task: Task) => {
    const name = task.project?.client?.name || task.project?.name || 'Trabajo interno'
    return CLIENT_COLORS[Math.max(0, clientNames.indexOf(name)) % CLIENT_COLORS.length]
  }

  const todayKey = cdmxTodayKey()
  // Lunes a sábado: el equipo trabaja medio día los sábados.
  const weekDays = Array.from({ length: 6 }, (_, index) => addLocalDays(anchor, index))
  const tasksOn = (key: string) => activeTasks.filter(task => dayOf(task)?.key === key)
  const sundayTasks = tasksOn(localDateKey(addLocalDays(anchor, 6)))
  const weeks = monthWeeks(monthAnchor)

  async function assignDate(taskId: string, date: Date) {
    setDropDay(null)
    if (!taskId) return
    const task = tasks.find(item => item.id === taskId)
    if (task && task.commitment_date?.slice(0, 10) === localDateKey(date)) return
    setSavingTask(taskId)
    setSaveError(null)
    const { error } = await supabase.from('tasks').update({ commitment_date: localDateKey(date) }).eq('id', taskId)
    setSavingTask(null)
    if (error) {
      setSaveError(`No se pudo guardar la fecha de "${task?.title || 'la tarea'}". Intenta de nuevo.`)
      return
    }
    await onTasksChange?.()
  }

  function dropProps(key: string, day: Date) {
    return {
      onDragOver: (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDropDay(key) },
      onDragLeave: () => setDropDay(null),
      onDrop: (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); void assignDate(event.dataTransfer.getData('text/task-id'), day) },
    }
  }

  function move(direction: number) {
    if (mode === 'semana') setAnchor(current => addLocalDays(current, direction * 7))
    else setMonthAnchor(current => new Date(current.getFullYear(), current.getMonth() + direction, 1))
  }

  function goToday() {
    setAnchor(mondayOf(new Date()))
    setMonthAnchor(firstOfMonth(new Date()))
  }

  function changeMode(value: 'semana' | 'mes') {
    if (value === 'mes' && mode === 'semana') setMonthAnchor(firstOfMonth(anchor))
    if (value === 'semana' && mode === 'mes') {
      const sameMonth = (date: Date) => date.getFullYear() === monthAnchor.getFullYear() && date.getMonth() === monthAnchor.getMonth()
      setAnchor(mondayOf(sameMonth(new Date()) ? new Date() : monthAnchor))
    }
    setMode(value)
  }

  const rangeLabel = mode === 'semana'
    ? `${weekDays[0].toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} – ${weekDays[5].toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}`
    : monthAnchor.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })

  const taskCard = (task: Task, extra: string, style?: CSSProperties) => {
    const color = colorFor(task)
    const late = isDateKeyOverdue(task.commitment_date)
    const estimate = !task.commitment_date ? estimates.get(task.id) : undefined
    const title = estimate
      ? `${task.title} · Estimado: ${formatDateOnly(estimate.start, { day: 'numeric', month: 'short' })} a ${formatDateOnly(estimate.end, { day: 'numeric', month: 'short' })} (aún sin fecha de entrega; arrástrala a un día para fijarla)`
      : late ? `${task.title} · vencida` : task.title
    return <button key={task.id} type="button" draggable disabled={savingTask === task.id} onDragStart={event => event.dataTransfer.setData('text/task-id', task.id)} onClick={() => onSelectTask(task)} title={title} data-estimated={estimate ? 'true' : undefined} className={`${extra} rounded-md border p-2 text-left shadow-sm transition hover:z-20 hover:shadow-md ${color.card} ${late ? 'ring-2 ring-red-400' : ''} ${estimate ? 'border-dashed opacity-45 shadow-none hover:opacity-80' : ''} ${savingTask === task.id ? 'opacity-50' : ''}`} style={style}><span className="block truncate text-[11px] font-bold">{late && <AlertTriangle size={10} className="mr-1 inline text-red-500" />}{estimate ? '≈ ' : ''}{task.title}</span><span className="mt-1 flex items-center gap-1 truncate text-[10px] opacity-75"><span className={`h-1.5 w-1.5 rounded-full ${color.dot}`} />{task.project?.client?.name || task.project?.name || 'Trabajo interno'}</span></button>
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <CalendarDays className="text-blue-700" size={28} />
          <div>
            <h2 className="text-xl font-bold text-slate-900">Mi calendario</h2>
            <p className="text-xs capitalize text-slate-400">{rangeLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1">
            {(['semana', 'mes'] as const).map(value => (
              <button key={value} type="button" onClick={() => changeMode(value)} className={`rounded-md px-5 py-2 text-xs font-semibold capitalize transition ${mode === value ? 'bg-blue-800 text-white shadow-sm' : 'text-slate-600 hover:bg-white'}`}>{value}</button>
            ))}
          </div>
          <EstimatesToggle checked={showEstimates} onChange={setShowEstimates} />
          <button type="button" onClick={goToday} className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Hoy</button>
          <button type="button" aria-label={mode === 'semana' ? 'Semana anterior' : 'Mes anterior'} onClick={() => move(-1)} className="rounded-lg border border-slate-200 p-2 hover:bg-slate-50"><ChevronLeft size={18} /></button>
          <button type="button" aria-label={mode === 'semana' ? 'Semana siguiente' : 'Mes siguiente'} onClick={() => move(1)} className="rounded-lg border border-slate-200 p-2 hover:bg-slate-50"><ChevronRight size={18} /></button>
        </div>
      </header>

      {saveError && (
        <div role="alert" className="mx-5 mt-4 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800">
          <span className="flex items-center gap-2"><AlertTriangle size={16} className="text-red-500" />{saveError}</span>
          <button type="button" onClick={() => setSaveError(null)} className="text-xs font-semibold text-red-700 hover:underline">Cerrar</button>
        </div>
      )}

      {undatedTasks.length > 0 && (
        <div className="mx-5 mt-4 flex items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <AlertTriangle size={17} className="text-amber-500" />
          <strong>{undatedTasks.length} tareas no aparecen porque no tienen fecha de compromiso</strong>
        </div>
      )}

      {showEstimates && estimatedCount > 0 && (
        <p className="mx-5 mt-3 text-xs text-slate-500">≈ {estimatedCount} {estimatedCount === 1 ? 'tarea aparece' : 'tareas aparecen'} difuminada{estimatedCount === 1 ? '' : 's'} en su fecha aproximada (aún sin fecha de entrega). Arrástrala a un día para fijar la fecha real.</p>
      )}

      {mode === 'semana' && sundayTasks.length > 0 && (
        <div className="mx-5 mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-600">
          {sundayTasks.length} {sundayTasks.length === 1 ? 'tarea tiene' : 'tareas tienen'} fecha el domingo: {sundayTasks.map(task => task.title).join(', ')}. Velas en la vista de mes o arrástralas a otro día.
        </div>
      )}

      <div className="grid min-h-[620px] grid-cols-1 p-5 lg:grid-cols-[210px_minmax(760px,1fr)]">
        <aside className="border border-slate-200 bg-slate-50/50 lg:rounded-l-xl">
          <div className="flex h-12 items-center justify-between border-b border-slate-200 px-3">
            <span className="text-sm font-bold text-slate-800">Sin fecha ({undatedTasks.length})</span>
            <GripVertical size={17} className="text-slate-400" />
          </div>
          <div className="max-h-[560px] space-y-3 overflow-y-auto p-2.5">
            {undatedTasks.map(task => {
              const color = colorFor(task)
              return (
                <button key={task.id} type="button" draggable disabled={savingTask === task.id} onDragStart={event => event.dataTransfer.setData('text/task-id', task.id)} onClick={() => onSelectTask(task)} className={`w-full rounded-lg border-l-4 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow ${color.card}`}>
                  <span className="block truncate text-xs font-bold">{task.title}</span>
                  <span className="mt-2 flex items-center gap-1.5 truncate text-[11px] text-slate-500"><span className={`h-2 w-2 rounded-full ${color.dot}`} />{task.project?.client?.name || task.project?.name || 'Trabajo interno'}</span>
                  <span className="mt-1 flex items-center gap-1 text-[11px] text-slate-500"><Clock3 size={11} /> Arrastra a un día</span>
                </button>
              )
            })}
          </div>
        </aside>

        {mode === 'semana' ? (
          <div className="overflow-x-auto rounded-r-xl border border-l-0 border-slate-200">
            <div className="min-w-[840px]">
              <div className="grid grid-cols-[48px_repeat(6,minmax(130px,1fr))] border-b border-slate-200 bg-white">
                <div />
                {weekDays.map(day => {
                  const key = localDateKey(day)
                  const dayTasks = tasksOn(key)
                  const isToday = key === todayKey
                  return <div key={key} className={`border-l border-slate-200 px-2 py-2 text-center ${isToday ? 'bg-blue-50' : ''}`}><p className={`text-sm font-bold capitalize ${isToday ? 'text-blue-700' : 'text-slate-800'}`}>{day.toLocaleDateString('es-MX', { weekday: 'short' })}{isToday && <span className="ml-1 rounded-full bg-blue-600 px-1.5 py-0.5 text-[9px] font-bold normal-case text-white">Hoy</span>}</p><p className="text-xs text-slate-500">{day.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}{day.getDay() === 6 ? ' · medio día' : ''}</p>{holidayName(key) && <p className="truncate text-[10px] font-semibold text-rose-600" title={`Feriado: ${holidayName(key)}`}>Feriado · {holidayName(key)}</p>}<p className="mt-2 rounded bg-blue-50 py-1 text-[11px] font-medium text-blue-900">{dayTasks.length} {dayTasks.length === 1 ? 'tarea' : 'tareas'}</p></div>
                })}
              </div>
              <div className="relative grid grid-cols-[48px_repeat(6,minmax(130px,1fr))]" style={{ height: HOURS.length * 54 }}>
                <div className="relative bg-white">
                  {HOURS.map((hour, index) => <span key={hour} className="absolute right-2 text-[11px] text-slate-400" style={{ top: index * 54 - 7 }}>{String(hour).padStart(2, '0')}:00</span>)}
                </div>
                {weekDays.map((day, dayIndex) => {
                  const key = localDateKey(day)
                  const dayTasks = tasksOn(key)
                  return (
                    <div key={key} {...dropProps(key, day)} className={`relative border-l border-slate-200 transition ${dropDay === key ? 'bg-blue-50 ring-2 ring-inset ring-blue-300' : key === todayKey ? 'bg-blue-50/40' : 'bg-white'}`}>
                      {HOURS.map((hour, index) => <div key={hour} className="absolute left-0 right-0 border-t border-slate-100" style={{ top: index * 54 }} />)}
                      {dayTasks.map((task, index) => taskCard(task, 'absolute left-2 right-2 z-10', { top: (1 + ((index * 2 + dayIndex) % 9)) * 54 + 5, minHeight: 48 }))}
                      {dayTasks.length === 0 && dropDay === key && <div className="absolute inset-x-3 top-20 rounded-lg border-2 border-dashed border-blue-300 bg-white/80 p-4 text-center text-xs font-semibold text-blue-700">Soltar para asignar fecha</div>}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-r-xl border border-l-0 border-slate-200">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
                {MONTH_DAY_NAMES.map(name => <div key={name} className="border-l border-slate-200 px-2 py-2 text-center text-xs font-bold text-slate-600 first:border-l-0">{name}</div>)}
              </div>
              {weeks.map(week => (
                <div key={localDateKey(week[0])} className="grid grid-cols-7 border-b border-slate-200 last:border-b-0">
                  {week.map(day => {
                    const key = localDateKey(day)
                    const dayTasks = tasksOn(key)
                    const inMonth = day.getMonth() === monthAnchor.getMonth()
                    const isToday = key === todayKey
                    return (
                      <div key={key} {...dropProps(key, day)} className={`min-h-[110px] space-y-1 border-l border-slate-200 p-1.5 first:border-l-0 transition ${dropDay === key ? 'bg-blue-50 ring-2 ring-inset ring-blue-300' : isToday ? 'bg-blue-50/60' : !inMonth ? 'bg-slate-50/80' : day.getDay() === 0 ? 'bg-slate-50/40' : 'bg-white'}`}>
                        <div className="flex items-center justify-between">
                          <span className={`text-xs font-bold ${isToday ? 'rounded-full bg-blue-600 px-1.5 text-white' : inMonth ? 'text-slate-700' : 'text-slate-300'}`}>{day.getDate()}</span>{holidayName(key) && <span className="ml-1 truncate text-[9px] font-semibold text-rose-600" title={`Feriado: ${holidayName(key)}`}>Feriado</span>}
                          {dayTasks.length > 0 && <span className="text-[10px] text-slate-400">{dayTasks.length}</span>}
                        </div>
                        {dayTasks.slice(0, 4).map(task => taskCard(task, 'relative block w-full !p-1.5'))}
                        {dayTasks.length > 4 && <button type="button" onClick={() => { setAnchor(mondayOf(day)); setMode('semana') }} className="w-full text-left text-[10px] font-semibold text-blue-700 hover:underline">+{dayTasks.length - 4} más (ver semana)</button>}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
