import type { Task } from '../../types'
import { DEPT_LABELS, DEPT_COLORS, DEPT_ORDER } from '../../data/projectTemplates'

interface Props {
  tasks: Task[]
}

const STATUS_COLORS: Record<string, string> = {
  pendiente: 'bg-gray-100 text-gray-600 border-gray-200',
  en_progreso: 'bg-blue-100 text-blue-700 border-blue-200',
  completada: 'bg-green-100 text-green-700 border-green-200',
  bloqueada: 'bg-red-100 text-red-700 border-red-200',
}

const STATUS_LABELS: Record<string, string> = {
  pendiente: 'Pendiente',
  en_progreso: 'En proceso',
  completada: 'Listo',
  bloqueada: 'Bloqueada',
}

function getMonday(weeksFromNow: number) {
  const today = new Date()
  const day = today.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(today)
  monday.setDate(today.getDate() + diff + weeksFromNow * 7)
  monday.setHours(0, 0, 0, 0)
  return monday
}

function getSunday(monday: Date) {
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  return sunday
}

function formatWeekRange(monday: Date) {
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  return `${monday.toLocaleDateString('es-MX', opts)} – ${sunday.toLocaleDateString('es-MX', opts)}`
}

function getTasksForWeek(tasks: Task[], weeksFromNow: number) {
  const monday = getMonday(weeksFromNow)
  const sunday = getSunday(monday)

  return tasks.filter(t => {
    const start = t.start_date ? new Date(t.start_date + 'T00:00:00') : null
    const commit = t.commitment_date ? new Date(t.commitment_date + 'T00:00:00') : null
    if (!start && !commit) return false
    const taskStart = start || commit!
    const taskEnd = commit || start!
    return taskStart <= sunday && taskEnd >= monday
  })
}

export default function ClientCalendar({ tasks }: Props) {
  const weeks = [0, 1, 2, 3]

  return (
    <div className="space-y-6">
      {weeks.map(w => {
        const monday = getMonday(w)
        const weekTasks = getTasksForWeek(tasks, w)

        // Group by department
        const byDept: Record<string, Task[]> = {}
        DEPT_ORDER.forEach(dept => {
          const dt = weekTasks.filter(t => t.department === dept)
          if (dt.length) byDept[dept] = dt
        })

        const hasTasks = Object.keys(byDept).length > 0

        return (
          <div key={w} className={`rounded-2xl border ${w === 0 ? 'border-blue-300 shadow-md' : 'border-gray-200'} overflow-hidden`}>
            {/* Week header */}
            <div className={`px-5 py-3 flex items-center justify-between ${w === 0 ? 'bg-gradient-to-r from-blue-700 to-blue-800 text-white' : 'bg-gray-50 text-gray-700'}`}>
              <div>
                <p className={`text-xs font-semibold uppercase tracking-wide ${w === 0 ? 'text-blue-200' : 'text-gray-400'}`}>
                  {w === 0 ? '📅 Esta semana' : w === 1 ? 'Próxima semana' : `Semana ${w + 1}`}
                </p>
                <p className={`font-semibold ${w === 0 ? 'text-white' : 'text-gray-700'}`}>{formatWeekRange(monday)}</p>
              </div>
              {hasTasks && (
                <span className={`text-sm font-semibold px-3 py-1 rounded-full ${w === 0 ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-700'}`}>
                  {weekTasks.length} tarea{weekTasks.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {/* Tasks by department */}
            {!hasTasks ? (
              <div className="px-5 py-6 text-center text-sm text-gray-400">
                No hay tareas programadas para esta semana
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {DEPT_ORDER.filter(d => byDept[d]).map(dept => (
                  <div key={dept} className="px-5 py-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${DEPT_COLORS[dept]}`}>
                        {DEPT_LABELS[dept]}
                      </span>
                    </div>
                    <div className="space-y-1.5 ml-1">
                      {byDept[dept].map(task => (
                        <div key={task.id} className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium shrink-0 ${STATUS_COLORS[task.status]}`}>
                            {STATUS_LABELS[task.status]}
                          </span>
                          <span className={`text-sm ${task.status === 'completada' ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                            {task.title}
                          </span>
                          {task.commitment_date && (
                            <span className="text-xs text-gray-400 shrink-0 ml-auto">
                              Entrega: {new Date(task.commitment_date + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      <p className="text-center text-xs text-gray-400 pb-2">
        Las tareas aparecen según sus fechas de inicio y compromiso de entrega
      </p>
    </div>
  )
}
