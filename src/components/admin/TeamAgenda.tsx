import { useState } from 'react'
import { AlertTriangle, CalendarClock, ChevronDown, ChevronRight, Eye, HelpCircle } from 'lucide-react'
import type { Task, User } from '../../types'
import { cdmxTodayKey, formatDateOnly } from '../../lib/dates'
import { AGENDA_WINDOW_LABELS, agendaDepartments, agendaPeople, buildAgenda, effectiveDate, windowEndKey, type AgendaWindow } from '../../lib/teamAgenda'
import { DEPT_LABELS } from '../../data/projectTemplates'
import TaskDetailModal from '../team/TaskDetailModal'

interface Props {
  teamMembers: User[]
  adminMembers: User[]
  tasks: Task[]
  onTasksChange?: () => void
}

const WINDOWS: AgendaWindow[] = ['hoy', 'semana', 'mes']
const deptLabel = (dept: string) => (dept === 'sin_departamento' ? 'Sin departamento' : DEPT_LABELS[dept] || dept)

/** Agenda del equipo: qué tiene cada persona hoy / esta semana / este mes (fecha CDMX). */
export default function TeamAgenda({ teamMembers, adminMembers, tasks, onTasksChange }: Props) {
  const [range, setRange] = useState<AgendaWindow>('hoy')
  const [department, setDepartment] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const todayKey = cdmxTodayKey()
  const endKey = windowEndKey(range, todayKey)
  const people = agendaPeople(teamMembers, adminMembers)
  const rows = buildAgenda(people, tasks, range, { todayKey, department })
  const departments = agendaDepartments(people)
  const rangeText = range === 'hoy'
    ? formatDateOnly(todayKey, { weekday: 'long', day: 'numeric', month: 'long' })
    : `${formatDateOnly(todayKey, { day: 'numeric', month: 'short' })} – ${formatDateOnly(endKey, { day: 'numeric', month: 'short' })}`

  function taskList(label: string, list: Task[], tone: string) {
    if (!list.length) return null
    return (
      <div className="mt-3">
        <p className={`text-xs font-semibold uppercase tracking-wide ${tone}`}>{label} ({list.length})</p>
        <ul className="mt-1 space-y-1">
          {list.map(task => (
            <li key={task.id}>
              <button type="button" onClick={() => setSelectedTask(task)}
                className="flex w-full items-center justify-between gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2 text-left text-sm hover:border-blue-200 hover:bg-blue-50">
                <span className="min-w-0 truncate"><b className="font-medium text-gray-900">{task.title}</b>{task.project?.name && <span className="text-gray-400"> · {task.project.name}</span>}</span>
                <span className="shrink-0 text-xs text-gray-500">{effectiveDate(task) ? formatDateOnly(effectiveDate(task), { day: 'numeric', month: 'short' }) : 'Sin fecha'}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Agenda del equipo</h2>
          <p className="text-sm text-gray-500">Qué tiene cada persona · {rangeText} (hora CDMX). Usa “Mi compromiso”; si no hay, “La necesito para”.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Ventana de tiempo" className="flex rounded-xl border border-gray-200 bg-white p-1">
            {WINDOWS.map(w => (
              <button key={w} type="button" aria-pressed={range === w} onClick={() => setRange(w)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${range === w ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                {AGENDA_WINDOW_LABELS[w]}
              </button>
            ))}
          </div>
          <select aria-label="Departamento" value={department} onChange={e => setDepartment(e.target.value)}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
            <option value="">Todos los departamentos</option>
            {departments.map(d => <option key={d} value={d}>{deptLabel(d)}</option>)}
          </select>
        </div>
      </div>

      {!rows.length && <p className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">No hay personas activas en este departamento.</p>}

      <div className="space-y-2">
        {rows.map(row => {
          const open = openId === row.person.id
          return (
            <div key={row.person.id} className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <button type="button" aria-expanded={open} onClick={() => setOpenId(open ? null : row.person.id)}
                className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left">
                {open ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
                <div className="min-w-[10rem] flex-1">
                  <p className="font-semibold text-gray-900">{row.person.full_name}</p>
                  <p className="text-xs text-gray-400">{row.person.role === 'admin' ? 'Admin' : 'Equipo'}{row.person.department ? ` · ${deptLabel(row.person.department)}` : ''}</p>
                </div>
                <span className="flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700" title={`Para ${AGENDA_WINDOW_LABELS[range].toLowerCase()}`}><CalendarClock size={13} /> {row.due.length} {range === 'hoy' ? 'hoy' : range === 'semana' ? 'esta semana' : 'este mes'}</span>
                <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${row.overdue.length ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-400'}`}><AlertTriangle size={13} /> {row.overdue.length} atrasadas</span>
                <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${row.inReview.length ? 'bg-violet-50 text-violet-700' : 'bg-gray-50 text-gray-400'}`}><Eye size={13} /> {row.inReview.length} en revisión</span>
                <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${row.undated.length ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-400'}`} title="Pendientes sin ninguna fecha">
                  <HelpCircle size={13} /> {row.undated.length} sin planear{row.undated.length ? ' ⚠' : ''}
                </span>
              </button>
              {open && (
                <div className="border-t border-gray-100 bg-gray-50 px-4 pb-4">
                  {taskList(`Para ${range === 'hoy' ? 'hoy' : range === 'semana' ? 'esta semana' : 'este mes'}`, row.due, 'text-blue-700')}
                  {taskList('Atrasadas', row.overdue, 'text-red-700')}
                  {taskList('En revisión', row.inReview, 'text-violet-700')}
                  {taskList('Sin planear (sin fecha)', row.undated, 'text-amber-700')}
                  {!row.due.length && !row.overdue.length && !row.inReview.length && !row.undated.length && (
                    <p className="pt-3 text-sm text-gray-500">Nada pendiente en esta ventana.</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {selectedTask && <TaskDetailModal task={selectedTask} onClose={() => setSelectedTask(null)} onUpdate={() => { setSelectedTask(null); onTasksChange?.() }} />}
    </div>
  )
}
