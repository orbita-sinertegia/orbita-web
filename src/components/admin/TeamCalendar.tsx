import { useMemo, useState, type ReactNode } from 'react'
import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, FileDown, GripVertical, LoaderCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { Task, User } from '../../types'
import UserAvatar from '../shared/UserAvatar'
import { addLocalDays, formatDateOnly, isDateKeyOverdue, localDateKey, mondayOf } from '../../lib/dates'
import { calendarDayOf } from '../../lib/estimateViews'
import { useProjectEstimates } from '../../hooks/useProjectEstimates'
import EstimatesToggle from '../shared/EstimatesToggle'
import { holidayName } from '../../lib/holidays'

interface Props {
  teamMembers: User[]
  /** Administradores activos: también tienen tareas y aparecen como filas. */
  adminMembers?: User[]
  tasks: Task[]
  onlineIds?: Set<string>
  onTasksChange?: () => void | Promise<void>
}

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const TASK_COLORS = [
  'border-pink-200 bg-pink-100 text-pink-800',
  'border-blue-200 bg-blue-100 text-blue-800',
  'border-violet-200 bg-violet-100 text-violet-800',
  'border-cyan-200 bg-cyan-100 text-cyan-800',
  'border-amber-200 bg-amber-100 text-amber-800',
  'border-emerald-200 bg-emerald-100 text-emerald-800',
]
const PRIORITY_DOTS: Record<string, string> = {
  critica: 'bg-red-500', alta: 'bg-orange-500', media: 'bg-violet-500', baja: 'bg-cyan-500',
}

const startOfWeek = mondayOf
const addDays = addLocalDays
const dateKey = localDateKey
const UNASSIGNED_ROW = 'sin_asignar'
const OTHERS_ROW = 'otros'

function sameDay(a: Date, b: Date) {
  return dateKey(a) === dateKey(b)
}

function hashIndex(value: string, length: number) {
  let hash = 0
  for (let index = 0; index < value.length; index++) hash = (hash * 31 + value.charCodeAt(index)) | 0
  return Math.abs(hash) % length
}

export default function TeamCalendar({ teamMembers, adminMembers = [], tasks, onlineIds = new Set(), onTasksChange }: Props) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [memberFilter, setMemberFilter] = useState('all')
  const [clientFilter, setClientFilter] = useState('all')
  const [departmentFilter, setDepartmentFilter] = useState('all')
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null)
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null)
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'error' | 'info'; text: string } | null>(null)
  const [showEstimates, setShowEstimates] = useState(true)
  // Estimados: tareas sin fecha de entrega de proyectos en proceso, en su entrega aproximada.
  const estimates = useProjectEstimates({ tasks, enabled: showEstimates })
  const dayOf = (task: Task) => task.status === 'completada' && !task.commitment_date ? null : calendarDayOf(task, estimates)

  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const clients = useMemo(() => [...new Set(tasks.map(task => task.project?.client?.name).filter(Boolean) as string[])].sort(), [tasks])
  // Equipo + administradores (sin duplicados): los administradores también tienen tareas.
  const members = useMemo(() => {
    const seen = new Set(teamMembers.map(member => member.id))
    const extra = adminMembers.filter(member => !seen.has(member.id) && !member.directory_hidden).sort((a, b) => a.full_name.localeCompare(b.full_name))
    return [...teamMembers, ...extra]
  }, [teamMembers, adminMembers])
  const memberIds = useMemo(() => new Set(members.map(member => member.id)), [members])
  const departments = useMemo(() => [...new Set(members.map(member => member.department).filter(Boolean) as string[])].sort(), [members])
  const filtersActive = memberFilter !== 'all' || departmentFilter !== 'all'
  const visibleMembers = members.filter(member =>
    (memberFilter === 'all' || member.id === memberFilter) &&
    (departmentFilter === 'all' || member.department === departmentFilter),
  )
  const visibleMemberIds = new Set(visibleMembers.map(member => member.id))
  const visibleTasks = tasks.filter(task => clientFilter === 'all' || task.project?.client?.name === clientFilter)
  // "Sin fecha" respeta los filtros de integrante y departamento.
  const undatedTasks = visibleTasks.filter(task => task.status !== 'completada' && !dayOf(task) && (!filtersActive || (!!task.assigned_to && visibleMemberIds.has(task.assigned_to))))
  const rowOf = (task: Task) => !task.assigned_to ? UNASSIGNED_ROW : memberIds.has(task.assigned_to) ? task.assigned_to : OTHERS_ROW
  const weekKeys = new Set(weekDays.map(day => dateKey(day)))
  const hasOthersThisWeek = visibleTasks.some(task => rowOf(task) === OTHERS_ROW && weekKeys.has(dayOf(task)?.key || ''))
  const estimatedCount = visibleTasks.filter(task => dayOf(task)?.estimated).length

  function tasksFor(rowId: string, day: Date) {
    return visibleTasks.filter(task => rowOf(task) === rowId && dayOf(task)?.key === dateKey(day))
  }

  async function assignDate(taskId: string | null, rowId: string, day: Date) {
    setDraggingTaskId(null)
    if (!taskId) return
    const task = tasks.find(item => item.id === taskId)
    if (!task) return
    if (rowOf(task) !== rowId) {
      const owner = task.assignee?.full_name || members.find(member => member.id === task.assigned_to)?.full_name
      setNotice({ tone: 'info', text: `"${task.title}" ${owner ? `es de ${owner}` : 'no tiene responsable'}. Suéltala en su propia fila para cambiar la fecha; para cambiar de responsable, abre la tarea.` })
      return
    }
    if (task.commitment_date?.slice(0, 10) === dateKey(day)) return
    setSavingTaskId(taskId)
    setNotice(null)
    const { error } = await supabase.from('tasks').update({ commitment_date: dateKey(day) }).eq('id', taskId)
    setSavingTaskId(null)
    if (error) {
      setNotice({ tone: 'error', text: `No se pudo guardar la fecha de "${task.title}". Intenta de nuevo.` })
      return
    }
    await onTasksChange?.()
  }

  async function generateClientPdf(clientName: string) {
    const clientTasks = tasks.filter(task => task.project?.client?.name === clientName)
    const mapTask = (task: Task) => ({
      title: task.title,
      responsable: task.assignee?.full_name || 'Sin asignar',
      priority: task.priority,
      date: task.commitment_date ? new Date(`${task.commitment_date.slice(0, 10)}T00:00:00`).toLocaleDateString('es-MX') : null,
    })
    setGeneratingPdf(true)
    try {
      const { generateClientReportPdf } = await import('../../lib/clientReportPdf')
      await generateClientReportPdf({
        titulo: clientName,
        subtitulo: 'Estado del embudo y producción de campaña',
        fecha: new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }),
        pie: `Reporte ${clientName} · Sinertegia Launch 57`,
        completadas: clientTasks.filter(task => task.status === 'completada').map(mapTask),
        enProgreso: clientTasks.filter(task => task.status === 'en_progreso').map(mapTask),
        pendientes: clientTasks.filter(task => task.status === 'pendiente' || task.status === 'bloqueada').map(mapTask),
        filename: `Reporte_${clientName.replace(/\s+/g, '_')}.pdf`,
      })
    } finally {
      setGeneratingPdf(false)
    }
  }

  const rangeEnd = weekDays[6]

  function renderRow(rowId: string, label: ReactNode) {
    return <div key={rowId} className="grid min-h-[82px] grid-cols-[180px_repeat(7,minmax(90px,1fr))] border-b border-gray-100 last:border-b-0">
      <div className="flex items-center gap-2 border-r border-gray-200 px-3 py-3">{label}</div>
      {weekDays.map(day => {
        const dayTasks = tasksFor(rowId, day)
        return <div key={dateKey(day)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); void assignDate(draggingTaskId, rowId, day) }} className={`min-h-[82px] space-y-1 border-r border-gray-100 p-1.5 last:border-r-0 ${sameDay(day, today) ? 'bg-blue-50/40' : day.getDay() === 0 || day.getDay() === 6 ? 'bg-gray-50/70' : ''} ${draggingTaskId ? 'hover:bg-blue-100' : ''}`}>
          {dayTasks.map(task => {
            const done = task.status === 'completada'
            const late = !done && isDateKeyOverdue(task.commitment_date)
            const owner = rowId === OTHERS_ROW ? task.assignee?.full_name : null
            const estimate = !task.commitment_date ? estimates.get(task.id) : undefined
            const estimateText = estimate ? ` · Estimado: ${formatDateOnly(estimate.start, { day: 'numeric', month: 'short' })} a ${formatDateOnly(estimate.end, { day: 'numeric', month: 'short' })} (aún sin fecha de entrega; arrástrala para fijarla)` : ''
            return <button key={task.id} type="button" draggable={!done} onDragStart={() => setDraggingTaskId(task.id)} onDragEnd={() => setDraggingTaskId(null)} onClick={() => window.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: task.id } }))} title={`${task.title}${owner ? ` · ${owner}` : ''}${done ? ' · completada' : late ? ' · vencida' : ''}${estimateText}`} data-estimated={estimate ? 'true' : undefined} className={`w-full truncate rounded-md border px-2 py-1.5 text-left text-[10px] font-semibold ${TASK_COLORS[hashIndex(task.project?.client?.name || task.id, TASK_COLORS.length)]} ${done ? 'line-through opacity-50' : ''} ${late ? 'ring-2 ring-red-400' : ''} ${estimate ? 'border-dashed opacity-45 hover:opacity-80' : ''} ${savingTaskId === task.id ? 'opacity-50' : ''}`}>{estimate ? '≈ ' : ''}{task.title}{owner ? ` · ${owner}` : ''}</button>
          })}
        </div>
      })}
    </div>
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Calendario del equipo</h1>
          <p className="mt-1 text-xs text-gray-500">Organiza compromisos y carga semanal en un solo lugar.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <EstimatesToggle checked={showEstimates} onChange={setShowEstimates} className="mr-1" />
          <button type="button" onClick={() => setWeekStart(startOfWeek(new Date()))} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50">Hoy</button>
          <input type="date" value={dateKey(weekStart)} onChange={event => event.target.value && setWeekStart(startOfWeek(new Date(`${event.target.value}T00:00:00`)))} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 outline-none focus:ring-2 focus:ring-blue-500" />
          <button type="button" onClick={() => setWeekStart(current => addDays(current, -7))} className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50"><ChevronLeft size={15} /></button>
          <span className="min-w-[165px] text-center text-xs font-semibold text-gray-600">{weekStart.getDate()} {MONTHS[weekStart.getMonth()]} — {rangeEnd.getDate()} {MONTHS[rangeEnd.getMonth()]}</span>
          <button type="button" onClick={() => setWeekStart(current => addDays(current, 7))} className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50"><ChevronRight size={15} /></button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm md:grid-cols-3">
        <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-500"><span>Integrante</span><select value={memberFilter} onChange={event => setMemberFilter(event.target.value)} className="ml-auto min-w-0 bg-transparent font-semibold text-gray-700 outline-none"><option value="all">Todos</option>{members.map(member => <option key={member.id} value={member.id}>{member.full_name}{member.role === 'admin' ? ' (admin)' : ''}</option>)}</select></label>
        <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-500"><span>Cliente</span><select value={clientFilter} onChange={event => setClientFilter(event.target.value)} className="ml-auto min-w-0 bg-transparent font-semibold text-gray-700 outline-none"><option value="all">Todos</option>{clients.map(client => <option key={client} value={client}>{client}</option>)}</select></label>
        <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-500"><span>Departamento</span><select value={departmentFilter} onChange={event => setDepartmentFilter(event.target.value)} className="ml-auto min-w-0 bg-transparent font-semibold capitalize text-gray-700 outline-none"><option value="all">Todos</option>{departments.map(department => <option key={department} value={department}>{department}</option>)}</select></label>
      </div>

      {notice && <div role="alert" className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${notice.tone === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-blue-200 bg-blue-50 text-blue-800'}`}><span className="flex items-center gap-2"><AlertCircle size={16} />{notice.text}</span><button type="button" onClick={() => setNotice(null)} className="text-xs font-semibold hover:underline">Cerrar</button></div>}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <AlertCircle size={17} className="text-amber-600" />
        <strong className="text-sm text-amber-900">{undatedTasks.length} tareas sin fecha</strong>
        <span className="text-xs text-amber-700">Arrástralas a un día en la fila de su responsable para asignar el compromiso.</span>
        {showEstimates && estimatedCount > 0 && <span className="text-xs text-slate-500">≈ {estimatedCount} con fecha aproximada (difuminadas); al arrastrarlas se fija la fecha real.</span>}
        {clientFilter !== 'all' && <button type="button" onClick={() => generateClientPdf(clientFilter)} disabled={generatingPdf} className="ml-auto flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-800 disabled:opacity-60">{generatingPdf ? <LoaderCircle size={13} className="animate-spin" /> : <FileDown size={13} />} Exportar PDF</button>}
      </div>

      <div className="grid min-h-[590px] grid-cols-1 gap-4 lg:grid-cols-[250px_minmax(720px,1fr)]">
        <aside className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3"><div><h2 className="text-sm font-bold text-gray-800">Sin fecha</h2><p className="mt-0.5 text-[10px] text-gray-400">Arrastra una tarea a un día</p></div><span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-bold text-gray-500">{undatedTasks.length}</span></div>
          <div className="max-h-[520px] space-y-2 overflow-y-auto bg-gray-50/60 p-3">
            {undatedTasks.map(task => {
              const clientName = task.project?.client?.name || task.project?.name || 'Trabajo interno'
              return <button key={task.id} type="button" draggable onDragStart={() => setDraggingTaskId(task.id)} onDragEnd={() => setDraggingTaskId(null)} onClick={() => window.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: task.id } }))} className={`w-full rounded-xl border border-gray-200 bg-white p-3 text-left shadow-sm transition hover:border-blue-300 hover:shadow ${draggingTaskId === task.id ? 'opacity-50' : ''}`}>
                <div className="flex items-start gap-2"><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOTS[task.priority] || 'bg-gray-400'}`} /><div className="min-w-0 flex-1"><p className="line-clamp-2 text-xs font-semibold text-gray-800">{task.title}</p><p className="mt-1 truncate text-[10px] text-gray-400">{clientName} · {task.priority}</p></div>{savingTaskId === task.id ? <LoaderCircle size={13} className="animate-spin text-blue-600" /> : <GripVertical size={14} className="shrink-0 text-gray-300" />}</div>
              </button>
            })}
            {undatedTasks.length === 0 && <div className="py-12 text-center"><CalendarDays size={24} className="mx-auto text-green-400" /><p className="mt-2 text-xs font-semibold text-green-700">Todas tienen fecha</p></div>}
          </div>
        </aside>

        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="min-w-[820px]">
            <div className="grid grid-cols-[180px_repeat(7,minmax(90px,1fr))] border-b border-gray-200 bg-gray-50">
              <div className="border-r border-gray-200 px-4 py-3 text-xs font-bold text-gray-500">Integrante</div>
              {weekDays.map((day, index) => <div key={dateKey(day)} className={`relative border-r border-gray-100 px-2 py-2 text-center last:border-r-0 ${sameDay(day, today) ? 'bg-blue-50' : ''}`}><p className={`text-[10px] ${sameDay(day, today) ? 'font-bold text-blue-600' : 'text-gray-400'}`}>{DAYS[index]}</p><p className={`text-sm font-bold ${sameDay(day, today) ? 'text-blue-700' : 'text-gray-600'}`}>{day.getDate()}</p>{holidayName(dateKey(day)) && <p className="truncate text-[9px] font-semibold text-rose-600" title={`Feriado: ${holidayName(dateKey(day))}`}>Feriado · {holidayName(dateKey(day))}</p>}{sameDay(day, today) && <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-2 py-0.5 text-[8px] font-bold text-white">Hoy</span>}</div>)}
            </div>

            {visibleMembers.map(member => renderRow(member.id, <><UserAvatar name={member.full_name} avatarUrl={member.avatar_url} size={32} isOnline={onlineIds.has(member.id)} /><div className="min-w-0"><p className="truncate text-xs font-semibold text-gray-800">{member.full_name}</p><p className="truncate text-[10px] capitalize text-gray-400">{member.role === 'admin' ? 'Administrador' : member.department || 'Sin departamento'}</p></div></>))}
            {!filtersActive && renderRow(UNASSIGNED_ROW, <div className="min-w-0"><p className="truncate text-xs font-semibold text-gray-800">Sin asignar</p><p className="truncate text-[10px] text-gray-400">Tareas sin responsable</p></div>)}
            {!filtersActive && hasOthersThisWeek && renderRow(OTHERS_ROW, <div className="min-w-0"><p className="truncate text-xs font-semibold text-gray-800">Otros responsables</p><p className="truncate text-[10px] text-gray-400">Usuarios inactivos o fuera del equipo</p></div>)}
            {visibleMembers.length === 0 && <div className="py-20 text-center text-sm text-gray-400">No hay integrantes con estos filtros.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
