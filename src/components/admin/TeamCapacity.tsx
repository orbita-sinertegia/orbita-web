import { useState } from 'react'
import type { Department, Task, User } from '../../types'
import {
  AlertTriangle, CalendarDays, CheckCircle2, Clock3,
  Search, UserCheck, UserPlus, Users,
} from 'lucide-react'

interface Props {
  teamMembers: User[]
  tasks: Task[]
  onAssign: () => void
}

const DEPT_LABELS: Record<string, string> = {
  edicion: 'Edición', grabacion: 'Grabación', diseno: 'Diseño', copy: 'Copy',
  webmaster: 'Webmaster', trafficker: 'Trafficker', lider: 'Líder', cliente: 'Cliente',
}

const PRIORITY_WEIGHT = { critica: 2, alta: 1.5, media: 1, baja: 0.65 }

function startOfToday() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date
}

export default function TeamCapacity({ teamMembers, tasks, onAssign }: Props) {
  const [search, setSearch] = useState('')
  const [department, setDepartment] = useState<'all' | Department>('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const today = startOfToday()
  const weekEnd = new Date(today)
  weekEnd.setDate(today.getDate() + 7)

  function activeTasksOf(memberId: string) {
    return tasks.filter(t => t.assigned_to === memberId && t.status !== 'completada')
  }

  function overdueTasksOf(memberId: string) {
    return activeTasksOf(memberId).filter(t => t.commitment_date && new Date(`${t.commitment_date}T23:59:59`) < today)
  }

  function weekTasksOf(memberId: string) {
    return activeTasksOf(memberId).filter(t => t.commitment_date && new Date(`${t.commitment_date}T23:59:59`) <= weekEnd)
  }

  function loadOf(memberId: string) {
    const active = activeTasksOf(memberId)
    const overdueIds = new Set(overdueTasksOf(memberId).map(t => t.id))
    const score = active.reduce((total, task) => {
      const priority = PRIORITY_WEIGHT[task.priority] ?? 1
      const dueSoon = task.commitment_date && new Date(`${task.commitment_date}T23:59:59`) <= weekEnd ? 1.25 : 0.35
      const overdue = overdueIds.has(task.id) ? 1.4 : 0
      return total + priority * dueSoon + overdue
    }, 0)
    return Math.min(130, Math.round((score / 8) * 100))
  }

  function stateOf(load: number) {
    if (load >= 100) return { key: 'overloaded', label: 'Sobrecargado', color: 'red' }
    if (load >= 55) return { key: 'balanced', label: 'Carga equilibrada', color: 'blue' }
    return { key: 'available', label: 'Disponible', color: 'green' }
  }

  const members = teamMembers.map(member => {
    const active = activeTasksOf(member.id)
    const weekly = weekTasksOf(member.id)
    const overdue = overdueTasksOf(member.id)
    const load = loadOf(member.id)
    return { member, active, weekly, overdue, load, state: stateOf(load) }
  })

  const filteredMembers = members.filter(({ member, state }) => {
    const text = `${member.full_name} ${member.department ?? ''}`.toLowerCase()
    return text.includes(search.toLowerCase()) &&
      (department === 'all' || member.department === department) &&
      (statusFilter === 'all' || state.key === statusFilter)
  })

  const totals = {
    available: members.filter(m => m.state.key === 'available').length,
    balanced: members.filter(m => m.state.key === 'balanced').length,
    overloaded: members.filter(m => m.state.key === 'overloaded').length,
    overdue: members.reduce((sum, m) => sum + m.overdue.length, 0),
  }

  const summary = [
    { label: 'Disponibles', value: totals.available, help: 'Pueden recibir trabajo', icon: UserCheck, tone: 'green' },
    { label: 'Carga equilibrada', value: totals.balanced, help: 'Carga estable esta semana', icon: Users, tone: 'blue' },
    { label: 'Sobrecargados', value: totals.overloaded, help: 'Requieren redistribución', icon: AlertTriangle, tone: 'orange' },
    { label: 'Tareas vencidas', value: totals.overdue, help: 'Fuera de su fecha límite', icon: CalendarDays, tone: 'red' },
  ]

  return (
    <section className="team-load-view">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-blue-600">Planeación semanal</p>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">Carga del equipo</h1>
          <p className="mt-1 text-sm text-gray-500">Distribuye el trabajo según disponibilidad, fechas y prioridad.</p>
        </div>
        <button onClick={onAssign} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700">
          <UserPlus size={17} /> Asignar tarea
        </button>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summary.map(item => <div key={item.label} className={`team-load-summary team-load-summary--${item.tone}`}>
          <span className="team-load-summary__icon"><item.icon size={22} /></span>
          <div><p className="text-sm font-semibold text-gray-700">{item.label}</p><p className="text-2xl font-bold text-gray-900">{item.value}</p><p className="text-xs text-gray-500">{item.help}</p></div>
        </div>)}
      </div>

      <div className="my-5 grid gap-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-sm md:grid-cols-[1.4fr_1fr_1fr]">
        <label className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={17} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre" className="team-load-input pl-10" /></label>
        <select value={department} onChange={e => setDepartment(e.target.value as 'all' | Department)} className="team-load-input"><option value="all">Todos los departamentos</option>{Object.entries(DEPT_LABELS).filter(([key]) => key !== 'cliente').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="team-load-input"><option value="all">Todos los estados</option><option value="available">Disponibles</option><option value="balanced">Carga equilibrada</option><option value="overloaded">Sobrecargados</option></select>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {filteredMembers.map(({ member, active, weekly, overdue, load, state }) => {
          const upcoming = [...active].sort((a, b) => (a.commitment_date ?? '9999').localeCompare(b.commitment_date ?? '9999')).slice(0, 3)
          return <article key={member.id} className="team-load-card">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                {member.avatar_url ? <img src={member.avatar_url} alt="" className="h-12 w-12 rounded-full object-cover ring-2 ring-white shadow" /> : <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-500 font-bold text-white">{member.full_name.charAt(0)}</div>}
                <div className="min-w-0"><p className="truncate font-bold text-gray-900">{member.full_name}</p><p className="text-xs text-gray-500">{member.department ? DEPT_LABELS[member.department] : 'Sin departamento'}</p><span className={`team-load-badge team-load-badge--${state.color}`}>● {state.label}</span></div>
              </div>
              {member.role === 'admin' && <span className="rounded-full bg-purple-50 px-2 py-1 text-[10px] font-bold text-purple-700">Admin</span>}
            </div>

            <div className="mt-5">
              <div className="mb-2 flex items-end justify-between"><div><p className="text-xs text-gray-500">Carga semanal estimada</p><p className={`text-2xl font-bold team-load-text--${state.color}`}>{load}%</p></div><p className="text-xs text-gray-500">{weekly.length} con fecha esta semana</p></div>
              <div className="h-2.5 overflow-hidden rounded-full bg-gray-100"><div className={`team-load-bar team-load-bar--${state.color}`} style={{ width: `${Math.min(load, 100)}%` }} /></div>
            </div>

            <div className="my-4 grid grid-cols-3 divide-x divide-gray-200 rounded-xl bg-gray-50 py-3 text-center"><div><b className="block text-gray-900">{active.length}</b><span className="text-[11px] text-gray-500">Activas</span></div><div><b className="block text-gray-900">{weekly.length}</b><span className="text-[11px] text-gray-500">Esta semana</span></div><div><b className={overdue.length ? 'block text-red-600' : 'block text-gray-900'}>{overdue.length}</b><span className="text-[11px] text-gray-500">Vencidas</span></div></div>

            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Próximas tareas</p>
            <div className="min-h-24 space-y-2">{upcoming.length ? upcoming.map(task => {
              const late = task.commitment_date && new Date(`${task.commitment_date}T23:59:59`) < today
              return <div key={task.id} className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 text-xs"><span className={`h-2 w-2 shrink-0 rounded-full ${task.priority === 'critica' ? 'bg-red-500' : task.priority === 'alta' ? 'bg-orange-500' : task.priority === 'media' ? 'bg-amber-400' : 'bg-green-500'}`} /><span className="min-w-0 flex-1 truncate font-medium text-gray-700" title={task.title}>{task.title}</span><span className={late ? 'font-semibold text-red-600' : 'text-gray-400'}>{task.commitment_date ? new Date(`${task.commitment_date}T12:00:00`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : 'Sin fecha'}</span></div>
            }) : <div className="flex h-20 items-center justify-center gap-2 rounded-xl bg-green-50 text-sm text-green-700"><CheckCircle2 size={16} /> Sin tareas activas</div>}</div>

            <button onClick={onAssign} className="team-load-primary mt-4 w-full"><UserPlus size={15} /> Asignar tarea a {member.full_name.split(' ')[0]}</button>
          </article>
        })}
      </div>

      {!filteredMembers.length && <div className="mt-5 rounded-2xl border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">No encontramos integrantes con esos filtros.</div>}
      <div className="mt-5 flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-700"><Clock3 size={16} className="mt-0.5 shrink-0" /><p><b>Estimación orientativa:</b> la carga combina tareas activas, prioridad, vencimientos y compromisos de los próximos siete días. Cuando se agreguen horas estimadas a las tareas, esta vista podrá calcular capacidad por horas reales.</p></div>
    </section>
  )
}
