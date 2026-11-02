import { useState } from 'react'
import { CheckCircle2, ChevronDown, Circle, Clock3, History, Map as MapIcon, Rocket } from 'lucide-react'
import type { Project, Task } from '../../types'
import {
  DISPLAY_PHASE_LABELS, DISPLAY_PHASE_ORDER, buildMilestones, displayPhaseStats,
  currentDisplayPhase, dueLabel, launchDelayBreakdown, overallProgress, phaseResponsibleLabel, type Phase,
} from '../../lib/roadmapPhases'
import RoadmapView from './RoadmapView'

export interface DelayEventLike {
  id: string
  task_id: string | null
  responsible: 'cliente' | 'agencia'
  days: number | null
  reason: string | null
  created_at: string
}

interface Props {
  project: Project
  tasks: Task[]
  delayEvents: DelayEventLike[]
  mode: 'interno' | 'cliente'
}

export default function ClientRoadmapView({ project, tasks, delayEvents, mode }: Props) {
  const [showGantt, setShowGantt] = useState(false)
  const [delayHistoryOpen, setDelayHistoryOpen] = useState(false)
  const current = currentDisplayPhase(tasks)
  const overall = overallProgress(tasks)
  const breakdown = launchDelayBreakdown(project, delayEvents)
  const milestones = buildMilestones(project, tasks)
  const pendingClientTasks = tasks
    .filter(task => task.department === 'cliente' && task.status !== 'completada')
    .sort((a, b) => (a.commitment_date || '').localeCompare(b.commitment_date || ''))

  function openTask(taskId: string) {
    window.dispatchEvent(new CustomEvent('open-task', { detail: { taskId } }))
  }

  return (
    <div className="space-y-5">
      {/* ── Fases en línea horizontal ── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <MapIcon size={16} className="text-blue-700" /> Hoja de ruta — {DISPLAY_PHASE_LABELS[current]}
          </h3>
          <span className="text-sm font-bold text-blue-700">{overall}% completado</span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
          {DISPLAY_PHASE_ORDER.map(phase => {
            const stats = displayPhaseStats(tasks, phase)
            const isCurrent = phase === current
            return (
              <div key={phase} className={`rounded-xl border p-2.5 text-center ${isCurrent ? 'border-blue-400 bg-blue-50' : stats.pct === 100 && stats.total > 0 ? 'border-green-200 bg-green-50' : 'border-slate-200 bg-slate-50'}`}>
                <p className={`truncate text-[11px] font-bold ${isCurrent ? 'text-blue-800' : 'text-slate-600'}`}>{DISPLAY_PHASE_LABELS[phase]}</p>
                <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-200">
                  <div className={`h-1.5 rounded-full ${stats.pct === 100 ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${stats.pct}%` }} />
                </div>
                <p className="mt-1 text-[10px] text-slate-400">{stats.total > 0 ? `${stats.done}/${stats.total}` : '—'}</p>
                {phase === 'produccion' && stats.lanes && (
                  <div className="mt-1.5 space-y-1 text-left">
                    <p className="text-[9px] text-slate-400">Video {stats.lanes.produccion_video.done}/{stats.lanes.produccion_video.total}</p>
                    <p className="text-[9px] text-slate-400">Páginas {stats.lanes.produccion_paginas.done}/{stats.lanes.produccion_paginas.total}</p>
                  </div>
                )}
                {mode === 'interno' && phase !== 'produccion' && phase !== 'optimizacion' && (
                  <p className="mt-1 truncate text-[9px] font-medium text-slate-400">{phaseResponsibleLabel(phase as Phase, project.recording_mode)}</p>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Hitos ── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-bold text-slate-800">Hitos</h3>
        <div className="flex flex-wrap gap-3">
          {milestones.map(milestone => (
            <div key={milestone.key} className={`min-w-[150px] flex-1 rounded-xl border p-3 ${milestone.status === 'done' ? 'border-green-200 bg-green-50' : milestone.status === 'current' ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-slate-50'}`}>
              <div className="flex items-center gap-1.5">
                {milestone.status === 'done' ? <CheckCircle2 size={14} className="text-green-600" /> : <Circle size={14} className={milestone.status === 'current' ? 'text-blue-600' : 'text-slate-300'} />}
                <p className={`text-xs font-bold ${milestone.status === 'done' ? 'text-green-800' : milestone.status === 'current' ? 'text-blue-800' : 'text-slate-500'}`}>{milestone.label}</p>
              </div>
              {milestone.date && <p className="mt-1 text-[11px] text-slate-400">{new Date(milestone.date + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</p>}
              {milestone.detail && mode === 'interno' && <p className="mt-0.5 text-[10px] text-slate-400">{milestone.detail}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* ── Lanzamiento ── */}
      <section className="rounded-2xl border border-slate-200 bg-gradient-to-br from-[#0d2258] via-[#153c9d] to-[#5b35a8] p-5 text-white shadow-sm">
        <div className="flex items-center gap-2 text-sm font-bold"><Rocket size={16} /> Lanzamiento</div>
        {project.launch_date ? (
          <>
            <p className="mt-2 text-2xl font-bold">{new Date(project.launch_date + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
            {project.launch_date_original && project.launch_date_original !== project.launch_date && (
              <p className="mt-1 text-sm text-blue-100">
                Original: {new Date(project.launch_date_original + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                {breakdown.clientDays > 0 && <span className="ml-1">· +{breakdown.clientDays} día{breakdown.clientDays === 1 ? '' : 's'} por retraso del cliente</span>}
                {breakdown.agencyDays > 0 && <span className="ml-1">· +{breakdown.agencyDays} día{breakdown.agencyDays === 1 ? '' : 's'} de la agencia</span>}
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-sm text-blue-100">Aún no se ha definido la fecha de lanzamiento.</p>
        )}
      </section>

      {/* ── Pendientes del cliente ── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-bold text-slate-800">Pendientes del cliente {pendingClientTasks.length > 0 && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">{pendingClientTasks.length}</span>}</h3>
        {pendingClientTasks.length === 0 ? (
          <p className="text-center text-sm text-slate-400">No hay pendientes del cliente por ahora.</p>
        ) : (
          <div className="space-y-2">
            {pendingClientTasks.map(task => {
              const due = task.commitment_date ? dueLabel(task.commitment_date) : null
              return (
                <button key={task.id} type="button" onClick={() => openTask(task.id)} className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition hover:border-blue-300 ${due?.late ? 'border-red-200 bg-red-50/40' : 'border-slate-200'}`}>
                  <span className="text-sm font-medium text-slate-700">{task.title}</span>
                  {due && <span className={`shrink-0 text-xs font-semibold ${due.late ? 'text-red-600' : 'text-slate-400'}`}><Clock3 size={11} className="mr-1 inline" />{due.text}</span>}
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* ── Historial de retrasos (transparencia total, cliente y agencia) ── */}
      {delayEvents.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <button type="button" onClick={() => setDelayHistoryOpen(open => !open)} className="flex w-full items-center justify-between px-5 py-4 text-left">
            <span className="flex items-center gap-2 text-sm font-bold text-slate-800"><History size={15} className="text-slate-500" /> Historial de retrasos <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-bold text-slate-700">{delayEvents.length}</span></span>
            <ChevronDown size={16} className={`text-slate-400 transition-transform ${delayHistoryOpen ? 'rotate-180' : ''}`} />
          </button>
          {delayHistoryOpen && (
            <div className="divide-y divide-slate-100 border-t border-slate-100">
              {delayEvents.map(event => (
                <div key={event.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="text-sm text-slate-700">{event.reason || (event.responsible === 'cliente' ? 'Retraso del cliente' : 'Retraso de la agencia')}</p>
                    <p className="text-xs text-slate-400">{new Date(event.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}{event.days ? ` · ${event.days} día${event.days === 1 ? '' : 's'}` : ''}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${event.responsible === 'cliente' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                    {event.responsible === 'cliente' ? 'Cliente' : 'Agencia'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── Ver tareas en el tiempo ── */}
      <div>
        <button type="button" onClick={() => setShowGantt(value => !value)} className="text-sm font-semibold text-blue-600 hover:underline">
          {showGantt ? 'Ocultar tareas en el tiempo' : 'Ver tareas en el tiempo →'}
        </button>
      </div>
      {showGantt && <RoadmapView tasks={tasks} title={project.name} onSelectTask={task => openTask(task.id)} />}
    </div>
  )
}
