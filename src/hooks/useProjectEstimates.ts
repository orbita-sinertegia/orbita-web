import { useMemo } from 'react'
import { computeProjectEstimates, type EstimateMap, type EstimateProject } from '../lib/estimateViews'
import type { EstimatePlanTask } from '../lib/roadmapEstimate'

interface Options {
  /** Tareas que se muestran (deben traer project_id; `project` opcional con status/stage/funnel_type). */
  tasks: EstimatePlanTask[]
  /** Otras tareas de los mismos proyectos, solo para ordenar el plan (nunca se dibujan). */
  contextTasks?: EstimatePlanTask[]
  /** Proyectos con status/stage/funnel_type conocidos (tienen prioridad sobre task.project). */
  projects?: EstimateProject[]
  /** Interruptor "Mostrar estimados". */
  enabled?: boolean
}

const EMPTY: EstimateMap = new Map()

/** Estimados de fecha (id de tarea → rango) compartidos por hoja de ruta y calendarios. */
export function useProjectEstimates({ tasks, contextTasks, projects, enabled = true }: Options): EstimateMap {
  return useMemo(
    () => (enabled ? computeProjectEstimates(tasks, contextTasks, projects) : EMPTY),
    [enabled, tasks, contextTasks, projects],
  )
}
