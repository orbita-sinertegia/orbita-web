import type { Department, Priority } from '../types'

export type Modalidad = 'oficina' | 'remota'

// Fases de la hoja de ruta, en orden. Producción (video/páginas) corre en paralelo
// y se muestra agrupada como "Producción" en las vistas de hoja de ruta.
export const PHASES = [
  'entrada', 'estrategia', 'guiones', 'produccion_video', 'produccion_paginas',
  'revision', 'lanzamiento', 'optimizacion',
] as const
export type Phase = typeof PHASES[number]

export const PHASE_LABELS: Record<Phase, string> = {
  entrada: 'Entrada',
  estrategia: 'Estrategia',
  guiones: 'Guiones',
  produccion_video: 'Producción · Video',
  produccion_paginas: 'Producción · Páginas',
  revision: 'Revisión',
  lanzamiento: 'Lanzamiento',
  optimizacion: 'Optimización',
}

export interface TemplateTask {
  title: string
  department: Department
  priority: Priority
  phase: Phase
  group?: string // sub-grupo visual (solo para el modal de plantilla)
}

export interface ProjectTemplate {
  id: string
  name: string
  icon: string
  description: string
  tasks: TemplateTask[]
}

export interface StoredTemplateTask {
  title: string
  department: Department
  priority: Priority
  group?: string
  phase?: Phase | null
}

export function templateTaskKey(task: Pick<StoredTemplateTask, 'title' | 'department'>) {
  return `${task.department}:${task.title.trim().toLocaleLowerCase('es-MX')}`
}

/**
 * Resolves the one canonical task list used by the funnel manager and project creation.
 * A stored project_templates row means the built-in was explicitly edited, so its DB
 * tasks replace the code defaults. Rows added only through "Guardar en plantilla"
 * extend the defaults instead. Duplicate title/department pairs are kept once.
 */
export function resolveTemplateTasks(
  template: ProjectTemplate | undefined,
  storedTasks: StoredTemplateTask[],
  hasStoredTemplate: boolean,
): TemplateTask[] {
  const baseTasks = template && !hasStoredTemplate ? template.tasks : []
  const baseByKey = new Map((template?.tasks || []).map(task => [templateTaskKey(task), task]))
  const merged = [...baseTasks, ...storedTasks.map(task => ({
    ...task,
    group: task.group || baseByKey.get(templateTaskKey(task))?.group,
    phase: task.phase || baseByKey.get(templateTaskKey(task))?.phase || inferPhase(task.title, task.department),
  }))]
  const seen = new Set<string>()
  return merged.filter(task => {
    const key = templateTaskKey(task)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const DEPARTMENT_FALLBACK_PHASE: Record<Department, Phase> = {
  cliente: 'entrada',
  lider: 'entrada',
  webmaster: 'produccion_paginas',
  copy: 'estrategia',
  diseno: 'produccion_paginas',
  edicion: 'produccion_video',
  trafficker: 'lanzamiento',
  grabacion: 'produccion_video',
}

/**
 * Asigna una fase a una tarea sin fase guardada, según su departamento.
 */
export function inferPhase(_title: string, department: Department): Phase {
  return DEPARTMENT_FALLBACK_PHASE[department] || 'entrada'
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'otro',
    name: 'Sin plantilla',
    icon: '➕',
    description: 'Proyecto en blanco — agregas las tareas manualmente',
    tasks: [],
  },
]

// ── Labels y colores por departamento (para portal cliente y vistas generales) ──
export const DEPT_LABELS: Record<string, string> = {
  cliente: 'Cliente',
  lider: 'Líder / ScrumMaster',
  webmaster: 'WebMaster',
  copy: 'Copy',
  diseno: 'Diseño',
  edicion: 'Edición',
  trafficker: 'Trafficker',
  grabacion: 'Grabación / Producción',
}

export const DEPT_COLORS: Record<string, string> = {
  cliente: 'bg-blue-100 text-blue-700 border-blue-200',
  lider: 'bg-purple-100 text-purple-700 border-purple-200',
  webmaster: 'bg-pink-100 text-pink-700 border-pink-200',
  copy: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  diseno: 'bg-green-100 text-green-700 border-green-200',
  edicion: 'bg-orange-100 text-orange-700 border-orange-200',
  trafficker: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  grabacion: 'bg-cyan-100 text-cyan-700 border-cyan-200',
}

export const DEPT_ORDER: string[] = [
  'cliente', 'lider', 'webmaster', 'copy', 'diseno', 'edicion', 'trafficker', 'grabacion',
]

// ── Sub-grupos para el modal de plantilla ──
export const GROUP_LABELS: Record<string, string> = {
  cliente: 'Cliente',
  lider: 'Líder / ScrumMaster',
  webmaster: 'WebMaster',
  copy: 'Copy',
  diseno_web: 'Diseño — Páginas web',
  diseno_ads: 'Diseño — Imágenes / Ads',
  edicion_video: 'Edición — Videos',
  edicion_presentacion: 'Edición — Presentación',
  trafficker: 'Trafficker',
  grabacion: 'Grabación / Producción',
}

export const GROUP_COLORS: Record<string, string> = {
  cliente: 'bg-blue-100 text-blue-700 border-blue-200',
  lider: 'bg-purple-100 text-purple-700 border-purple-200',
  webmaster: 'bg-pink-100 text-pink-700 border-pink-200',
  copy: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  diseno_web: 'bg-green-100 text-green-700 border-green-200',
  diseno_ads: 'bg-teal-100 text-teal-700 border-teal-200',
  edicion_video: 'bg-orange-100 text-orange-700 border-orange-200',
  edicion_presentacion: 'bg-amber-100 text-amber-800 border-amber-200',
  trafficker: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  grabacion: 'bg-cyan-100 text-cyan-700 border-cyan-200',
}

export const TEMPLATE_GROUP_ORDER: string[] = [
  'cliente', 'lider', 'webmaster', 'copy',
  'diseno_web', 'diseno_ads',
  'edicion_video', 'edicion_presentacion',
  'trafficker', 'grabacion',
]

// ── Tipo de embudo (projects.funnel_type) sugerido al elegir una plantilla ──
export type TemplateFunnelType = 'low2funnel' | 'vsl_high_ticket' | 'high_ticket' | 'restaurante' | 'webinar' | 'otro'

const BUILT_IN_FUNNEL_TYPE: Record<string, TemplateFunnelType> = {
  otro: 'otro',
}

/** Plantillas que vienen en el código (sus filas en project_templates solo las editan o archivan). */
export const BUILT_IN_TEMPLATE_IDS = PROJECT_TEMPLATES.map(template => template.id)

/**
 * Tipo de embudo sugerido para una plantilla: las del código tienen uno fijo; para los embudos
 * personalizados se deduce del nombre (p. ej. "Low ticket" → low2funnel). '' si no se sabe.
 */
export function funnelTypeForTemplate(templateId: string, templateName = ''): TemplateFunnelType | '' {
  if (BUILT_IN_FUNNEL_TYPE[templateId]) return BUILT_IN_FUNNEL_TYPE[templateId]
  const text = `${templateId} ${templateName}`.toLocaleLowerCase('es-MX')
  if (/low\s*-?\s*(2|to|two)?\s*-?\s*funnel|low\s*-?\s*ticket|lowticket/.test(text)) return 'low2funnel'
  if (/high\s*-?\s*ticket|highticket/.test(text)) return /\bvsl\b/.test(text) ? 'vsl_high_ticket' : 'high_ticket'
  if (/restaur/.test(text)) return 'restaurante'
  if (/webinar/.test(text)) return 'webinar'
  if (/\bvsl\b/.test(text)) return 'vsl_high_ticket'
  return ''
}
