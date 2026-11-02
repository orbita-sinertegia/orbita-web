import { useState } from 'react'
import { X, CheckCircle, Clock, AlertCircle, TrendingUp, Download } from 'lucide-react'
import type { Project, Task } from '../../types'

interface Props {
  project: Project
  tasks: Task[]
  onClose: () => void
}

export default function ClientReportModal({ project, tasks, onClose }: Props) {
  const projectTasks = tasks.filter(t => t.project_id === project.id)
  const [generatingPdf, setGeneratingPdf] = useState(false)

  const completed = projectTasks.filter(t => t.status === 'completada')
  const inProgress = projectTasks.filter(t => t.status === 'en_progreso')
  const pending = projectTasks.filter(t => t.status === 'pendiente')
  const blocked = projectTasks.filter(t => t.status === 'bloqueada')
  const progress = projectTasks.length > 0 ? Math.round((completed.length / projectTasks.length) * 100) : 0

  const today = new Date()
  const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7)
  const completedThisWeek = completed.filter(t => t.completion_date && new Date(t.completion_date) >= weekAgo)

  const nextDeadlines = projectTasks
    .filter(t => t.status !== 'completada' && t.commitment_date)
    .sort((a, b) => new Date(a.commitment_date!).getTime() - new Date(b.commitment_date!).getTime())
    .slice(0, 5)

  const toReportTask = (t: Task) => ({
    title: t.title,
    responsable: t.assignee?.full_name || 'Sin asignar',
    priority: t.priority,
    date: t.commitment_date ? new Date(t.commitment_date + 'T00:00:00').toLocaleDateString('es-MX') : null,
  })

  async function handleExport() {
    setGeneratingPdf(true)
    try {
      const { generateClientReportPdf } = await import('../../lib/clientReportPdf')
      await generateClientReportPdf({
        titulo: `${project.client?.name} — ${project.name}`,
        subtitulo: 'Estado del embudo y producción de campaña',
        fecha: today.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }),
        pie: `Reporte ${project.client?.name} · Sinertegia Launch 57`,
        completadas: completed.map(toReportTask),
        enProgreso: inProgress.map(toReportTask),
        pendientes: [...pending, ...blocked].map(toReportTask),
        filename: `Reporte_${(project.client?.name || 'cliente').replace(/\s+/g, '_')}_${project.name.replace(/\s+/g, '_')}.pdf`,
      })
    } finally {
      setGeneratingPdf(false)
    }
  }

  const statusColor: Record<string, string> = {
    completada: 'bg-green-100 text-green-700',
    en_progreso: 'bg-blue-100 text-blue-700',
    pendiente: 'bg-gray-100 text-gray-600',
    bloqueada: 'bg-red-100 text-red-700',
  }

  const statusLabel: Record<string, string> = {
    completada: 'Completada',
    en_progreso: 'En progreso',
    pendiente: 'Pendiente',
    bloqueada: 'Bloqueada',
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Reporte de avance</p>
            <h3 className="text-lg font-bold text-gray-900">{project.client?.name}</h3>
            <p className="text-sm text-gray-500">{project.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleExport} disabled={generatingPdf}
              className="flex items-center gap-1.5 text-xs font-semibold text-white bg-gradient-to-r from-blue-700 to-red-600 px-3 py-2 rounded-lg hover:opacity-90 transition disabled:opacity-60">
              <Download size={13} /> {generatingPdf ? 'Generando...' : 'Exportar / Imprimir'}
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Avance general */}
          <div className="bg-gradient-to-r from-blue-700 to-blue-900 rounded-xl p-5 text-white">
            <p className="text-sm text-blue-200 mb-1">Avance general del proyecto</p>
            <div className="flex items-end justify-between mb-3">
              <p className="text-4xl font-bold">{progress}%</p>
              <p className="text-sm text-blue-200">{completed.length} de {projectTasks.length} tareas</p>
            </div>
            <div className="w-full bg-blue-600/50 rounded-full h-2">
              <div className="bg-white rounded-full h-2 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Completadas', value: completed.length, icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50' },
              { label: 'En progreso', value: inProgress.length, icon: TrendingUp, color: 'text-blue-600', bg: 'bg-blue-50' },
              { label: 'Pendientes', value: pending.length, icon: Clock, color: 'text-gray-600', bg: 'bg-gray-50' },
              { label: 'Bloqueadas', value: blocked.length, icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50' },
            ].map(({ label, value, icon: Icon, color, bg }) => (
              <div key={label} className={`${bg} rounded-xl p-3 text-center`}>
                <Icon size={18} className={`${color} mx-auto mb-1`} />
                <p className={`text-2xl font-bold ${color}`}>{value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Completadas esta semana */}
          {completedThisWeek.length > 0 && (
            <div>
              <h4 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
                <CheckCircle size={15} className="text-green-600" /> Completadas esta semana ({completedThisWeek.length})
              </h4>
              <div className="space-y-2">
                {completedThisWeek.map(t => (
                  <div key={t.id} className="flex items-center gap-3 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                    <CheckCircle size={14} className="text-green-500 shrink-0" />
                    <span className="text-sm text-gray-700 flex-1">{t.title}</span>
                    <span className="text-xs text-gray-400">
                      {t.completion_date ? new Date(t.completion_date + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* En progreso */}
          {inProgress.length > 0 && (
            <div>
              <h4 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
                <TrendingUp size={15} className="text-blue-600" /> En proceso ahora
              </h4>
              <div className="space-y-2">
                {inProgress.map(t => (
                  <div key={t.id} className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse shrink-0" />
                    <span className="text-sm text-gray-700 flex-1">{t.title}</span>
                    {t.commitment_date && (
                      <span className="text-xs text-blue-600 font-medium shrink-0">
                        Entrega: {new Date(t.commitment_date + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Próximas fechas de entrega */}
          {nextDeadlines.length > 0 && (
            <div>
              <h4 className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
                <Clock size={15} className="text-orange-600" /> Próximas entregas
              </h4>
              <div className="space-y-2">
                {nextDeadlines.map(t => (
                  <div key={t.id} className="flex items-center gap-3 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
                    <span className="text-sm text-gray-700 flex-1">{t.title}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColor[t.status]}`}>
                      {statusLabel[t.status]}
                    </span>
                    <span className="text-xs text-orange-700 font-bold shrink-0">
                      {new Date(t.commitment_date! + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fecha del reporte */}
          <p className="text-xs text-gray-400 text-center pt-2 border-t border-gray-100">
            Reporte generado el {today.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
        </div>
      </div>
    </div>
  )
}
