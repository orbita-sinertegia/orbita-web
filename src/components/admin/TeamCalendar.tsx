import { useMemo, useState } from 'react'
import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, FileDown, GripVertical, LoaderCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { Task, User } from '../../types'
import UserAvatar from '../shared/UserAvatar'

interface Props {
  teamMembers: User[]
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

function startOfWeek(value: Date) {
  const date = new Date(value)
  const day = date.getDay()
  date.setDate(date.getDate() - day + (day === 0 ? -6 : 1))
  date.setHours(0, 0, 0, 0)
  return date
}

function addDays(value: Date, amount: number) {
  const date = new Date(value)
  date.setDate(date.getDate() + amount)
  return date
}

function dateKey(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function sameDay(a: Date, b: Date) {
  return dateKey(a) === dateKey(b)
}

function hashIndex(value: string, length: number) {
  let hash = 0
  for (let index = 0; index < value.length; index++) hash = (hash * 31 + value.charCodeAt(index)) | 0
  return Math.abs(hash) % length
}

export default function TeamCalendar({ teamMembers, tasks, onlineIds = new Set(), onTasksChange }: Props) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [memberFilter, setMemberFilter] = useState('all')
  const [clientFilter, setClientFilter] = useState('all')
  const [departmentFilter, setDepartmentFilter] = useState('all')
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null)
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null)
  const [generatingPdf, setGeneratingPdf] = useState(false)

  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const clients = useMemo(() => [...new Set(tasks.map(task => task.project?.client?.name).filter(Boolean) as string[])].sort(), [tasks])
  const departments = useMemo(() => [...new Set(teamMembers.map(member => member.department).filter(Boolean) as string[])].sort(), [teamMembers])
  const visibleMembers = teamMembers.filter(member =>
    (memberFilter === 'all' || member.id === memberFilter) &&
    (departmentFilter === 'all' || member.department === departmentFilter),
  )
  const visibleTasks = tasks.filter(task => clientFilter === 'all' || task.project?.client?.name === clientFilter)
  const undatedTasks = visibleTasks.filter(task => task.status !== 'completada' && !task.commitment_date)

  function tasksFor(memberId: string, day: Date) {
    return visibleTasks.filter(task => task.assigned_to === memberId && task.commitment_date?.slice(0, 10) === dateKey(day))
  }

  async function assignDate(taskId: string, day: Date) {
    setSavingTaskId(taskId)
    const { error } = await supabase.from('tasks').update({ commitment_date: dateKey(day) }).eq('id', taskId)
    setDraggingTaskId(null)
    setSavingTaskId(null)
    if (!error) await onTasksChange?.()
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

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Calendario del equipo</h1>
          <p className="mt-1 text-xs text-gray-500">Organiza compromisos y carga semanal en un solo lugar.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setWeekStart(startOfWeek(new Date()))} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50">Hoy</button>
          <input type="date" value={dateKey(weekStart)} onChange={event => event.target.value && setWeekStart(startOfWeek(new Date(`${event.target.value}T00:00:00`)))} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 outline-none focus:ring-2 focus:ring-blue-500" />
          <button type="button" onClick={() => setWeekStart(current => addDays(current, -7))} className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50"><ChevronLeft size={15} /></button>
          <span className="min-w-[165px] text-center text-xs font-semibold text-gray-600">{weekStart.getDate()} {MONTHS[weekStart.getMonth()]} — {rangeEnd.getDate()} {MONTHS[rangeEnd.getMonth()]}</span>
          <button type="button" onClick={() => setWeekStart(current => addDays(current, 7))} className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50"><ChevronRight size={15} /></button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm md:grid-cols-3">
        <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-500"><span>Integrante</span><select value={memberFilter} onChange={event => setMemberFilter(event.target.value)} className="ml-auto min-w-0 bg-transparent font-semibold text-gray-700 outline-none"><option value="all">Todos</option>{teamMembers.map(member => <option key={member.id} value={member.id}>{member.full_name}</option>)}</select></label>
        <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-500"><span>Cliente</span><select value={clientFilter} onChange={event => setClientFilter(event.target.value)} className="ml-auto min-w-0 bg-transparent font-semibold text-gray-700 outline-none"><option value="all">Todos</option>{clients.map(client => <option key={client} value={client}>{client}</option>)}</select></label>
        <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-500"><span>Departamento</span><select value={departmentFilter} onChange={event => setDepartmentFilter(event.target.value)} className="ml-auto min-w-0 bg-transparent font-semibold capitalize text-gray-700 outline-none"><option value="all">Todos</option>{departments.map(department => <option key={department} value={department}>{department}</option>)}</select></label>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <AlertCircle size={17} className="text-amber-600" />
        <strong className="text-sm text-amber-900">{undatedTasks.length} tareas sin fecha</strong>
        <span className="text-xs text-amber-700">Arrástralas hacia un día para asignar el compromiso.</span>
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
              {weekDays.map((day, index) => <div key={dateKey(day)} className={`relative border-r border-gray-100 px-2 py-2 text-center last:border-r-0 ${sameDay(day, today) ? 'bg-blue-50' : ''}`}><p className={`text-[10px] ${sameDay(day, today) ? 'font-bold text-blue-600' : 'text-gray-400'}`}>{DAYS[index]}</p><p className={`text-sm font-bold ${sameDay(day, today) ? 'text-blue-700' : 'text-gray-600'}`}>{day.getDate()}</p>{sameDay(day, today) && <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-blue-600 px-2 py-0.5 text-[8px] font-bold text-white">Hoy</span>}</div>)}
            </div>

            {visibleMembers.map(member => <div key={member.id} className="grid min-h-[82px] grid-cols-[180px_repeat(7,minmax(90px,1fr))] border-b border-gray-100 last:border-b-0">
              <div className="flex items-center gap-2 border-r border-gray-200 px-3 py-3"><UserAvatar name={member.full_name} avatarUrl={member.avatar_url} size={32} isOnline={onlineIds.has(member.id)} /><div className="min-w-0"><p className="truncate text-xs font-semibold text-gray-800">{member.full_name}</p><p className="truncate text-[10px] capitalize text-gray-400">{member.department || 'Sin departamento'}</p></div></div>
              {weekDays.map(day => {
                const dayTasks = tasksFor(member.id, day)
                return <div key={dateKey(day)} onDragOver={event => event.preventDefault()} onDrop={() => draggingTaskId && assignDate(draggingTaskId, day)} className={`min-h-[82px] space-y-1 border-r border-gray-100 p-1.5 last:border-r-0 ${sameDay(day, today) ? 'bg-blue-50/40' : day.getDay() === 0 || day.getDay() === 6 ? 'bg-gray-50/70' : ''} ${draggingTaskId ? 'hover:bg-blue-100' : ''}`}>
                  {dayTasks.map(task => <button key={task.id} type="button" onClick={() => window.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: task.id } }))} title={task.title} className={`w-full truncate rounded-md border px-2 py-1.5 text-left text-[10px] font-semibold ${TASK_COLORS[hashIndex(task.project?.client?.name || task.id, TASK_COLORS.length)]}`}>{task.title}</button>)}
                </div>
              })}
            </div>)}
            {visibleMembers.length === 0 && <div className="py-20 text-center text-sm text-gray-400">No hay integrantes con estos filtros.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
