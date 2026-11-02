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
  modalidad?: Modalidad // solo para las tareas de grabación/cliente que dependen de la modalidad elegida
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

// ─────────────────────────────────────────────
//  TAREAS BASE (compartidas VSL y Webinar)
// ─────────────────────────────────────────────

const baseTasks: TemplateTask[] = [
  // ── Cliente ──
  { title: 'Llenar los 3 documentos', department: 'cliente', priority: 'alta', phase: 'entrada' },
  { title: 'Reunión con el líder del proyecto para revisar guiones', department: 'cliente', priority: 'alta', phase: 'guiones' },
  { title: 'Revisar el embudo con el equipo para dar check final', department: 'cliente', priority: 'alta', phase: 'revision' },
  { title: 'Compartir con el equipo de BGI los links para autorizarlos', department: 'cliente', priority: 'alta', phase: 'revision' },
  // ── Líder (ScrumMaster) ──
  { title: 'Crear grupo de WhatsApp con cliente y equipo', department: 'lider', priority: 'alta', phase: 'entrada' },
  { title: 'Enviar 3 documentos para llenar', department: 'lider', priority: 'alta', phase: 'entrada' },
  { title: 'Agendar reunión inicial con cliente y equipo', department: 'lider', priority: 'alta', phase: 'entrada' },
  { title: 'Recolección de accesos', department: 'lider', priority: 'alta', phase: 'entrada' },
  { title: 'Reunión con el equipo interno, para confirmar fechas de entrega', department: 'lider', priority: 'alta', phase: 'entrada' },
  { title: 'Validar guiones VSL, Gracias, 12 anuncios', department: 'lider', priority: 'alta', phase: 'guiones' },
  { title: 'Agendar reunión con el cliente para el feedback y entrega de guiones', department: 'lider', priority: 'alta', phase: 'guiones' },
  { title: 'Entregar al cliente para feedback los guiones', department: 'lider', priority: 'alta', phase: 'guiones' },
  { title: 'Agendar sesión de grabación', department: 'lider', priority: 'alta', phase: 'produccion_video' },
  { title: 'Revisar con el equipo de webmaster el embudo completo', department: 'lider', priority: 'alta', phase: 'revision' },
  { title: 'Solicitar reunión con el experto para dar check final del embudo', department: 'lider', priority: 'alta', phase: 'revision' },
  // ── Webmaster ──
  { title: 'Montar funnel completo en GHL', department: 'webmaster', priority: 'alta', phase: 'produccion_paginas' },
  { title: 'Cambiar diseño visual de Pág. Gracias', department: 'webmaster', priority: 'alta', phase: 'produccion_paginas' },
  { title: 'Cambiar diseño visual y de texto a la Página de Oferta', department: 'webmaster', priority: 'alta', phase: 'produccion_paginas' },
  { title: 'Instalar "Pixel" de Meta ADS', department: 'webmaster', priority: 'alta', phase: 'produccion_paginas' },
  { title: 'Crear los "custom value" en GHL', department: 'webmaster', priority: 'alta', phase: 'produccion_paginas' },
  { title: 'Crear grupo de WhatsApp en Funnelchat', department: 'webmaster', priority: 'alta', phase: 'produccion_paginas' },
  { title: 'Crear la automatización de correos', department: 'webmaster', priority: 'alta', phase: 'produccion_paginas' },
  { title: 'Agregar los copys en correo', department: 'webmaster', priority: 'alta', phase: 'produccion_paginas' },
  { title: 'Agregar video de gracias y VSL', department: 'webmaster', priority: 'alta', phase: 'produccion_paginas' },
  { title: 'Solicitar revisión de embudo con el líder', department: 'webmaster', priority: 'alta', phase: 'revision' },
  { title: 'Programar los mensajes de WhatsApp en Funnelchat', department: 'webmaster', priority: 'alta', phase: 'produccion_paginas' },
  { title: 'Reset de timers de embudo', department: 'webmaster', priority: 'alta', phase: 'produccion_paginas' },
  // ── Copy ──
  { title: 'Crear carpeta de ChatGPT del cliente', department: 'copy', priority: 'alta', phase: 'estrategia' },
  { title: 'Subir archivo de Preguntas de Poder', department: 'copy', priority: 'alta', phase: 'estrategia' },
  { title: 'Subir ADN de Marca (si aplica)', department: 'copy', priority: 'media', phase: 'estrategia' },
  { title: 'Subir el NTPVS a la carpeta del experto', department: 'copy', priority: 'alta', phase: 'estrategia' },
  { title: 'Hacer investigación en Comet (IG, TikTok, YT)', department: 'copy', priority: 'alta', phase: 'estrategia' },
  { title: 'Crear prompt experto: Mapa Emocional', department: 'copy', priority: 'alta', phase: 'estrategia' },
  { title: 'Crear prompt experto: Guiones VSL y Gracias', department: 'copy', priority: 'alta', phase: 'guiones' },
  { title: 'Crear prompt: Meta Ads (guiones de video)', department: 'copy', priority: 'alta', phase: 'guiones' },
  { title: 'Crear prompt experto: LP', department: 'copy', priority: 'alta', phase: 'produccion_paginas' },
  { title: 'Crear prompt: Emails + WhatsApp', department: 'copy', priority: 'alta', phase: 'produccion_paginas' },
  { title: 'Entregar textos a la Diseñadora de páginas web', department: 'copy', priority: 'alta', phase: 'produccion_paginas' },
  { title: 'Entregar textos a la Web Master de Correo y WhatsApp', department: 'copy', priority: 'alta', phase: 'produccion_paginas' },
  { title: 'Crear prompt: Copy In / Out para Ads', department: 'copy', priority: 'alta', phase: 'produccion_paginas' },
  { title: 'Entregar textos de Copy In / Out para Ads a la diseñadora de ADS', department: 'copy', priority: 'alta', phase: 'produccion_paginas' },
  // ── Diseño — Páginas web ──
  { title: 'Diseñar Landing Page (LP)', department: 'diseno', priority: 'alta', group: 'diseno_web', phase: 'produccion_paginas' },
  { title: 'Diseñar Página de Gracias', department: 'diseno', priority: 'alta', group: 'diseno_web', phase: 'produccion_paginas' },
  { title: 'Diseñar miniatura del video de LP y Gracias', department: 'diseno', priority: 'alta', group: 'diseno_web', phase: 'produccion_paginas' },
  { title: 'Diseñar imagen mockup para WhatsApp en página de gracias', department: 'diseno', priority: 'alta', group: 'diseno_web', phase: 'produccion_paginas' },
  // ── Diseño — Imágenes / Ads ──
  { title: 'Diseñar imágenes para correos', department: 'diseno', priority: 'alta', group: 'diseno_ads', phase: 'produccion_paginas' },
  { title: 'Diseñar Mockup para página de Oferta', department: 'diseno', priority: 'alta', group: 'diseno_ads', phase: 'produccion_paginas' },
  { title: 'Diseñar imágenes para grupo de WhatsApp', department: 'diseno', priority: 'alta', group: 'diseno_ads', phase: 'produccion_paginas' },
  { title: 'Diseñar imágenes para mensajes de WhatsApp', department: 'diseno', priority: 'alta', group: 'diseno_ads', phase: 'produccion_paginas' },
  { title: 'Diseñar 3 imágenes tipo carruseles para Meta Ads', department: 'diseno', priority: 'alta', group: 'diseno_ads', phase: 'produccion_paginas' },
  { title: 'Diseñar 3 imágenes simples para Meta Ads', department: 'diseno', priority: 'alta', group: 'diseno_ads', phase: 'produccion_paginas' },
  // ── Edición — Videos ──
  { title: 'Editar VSL principal', department: 'edicion', priority: 'alta', group: 'edicion_video', phase: 'produccion_video' },
  { title: 'Editar video de Gracias', department: 'edicion', priority: 'alta', group: 'edicion_video', phase: 'produccion_video' },
  { title: 'Editar 6 anuncios — ronda 1 (2 fríos, 2 templados, 2 calientes)', department: 'edicion', priority: 'alta', group: 'edicion_video', phase: 'produccion_video' },
  { title: 'Editar 6 anuncios — ronda 2 (2 fríos, 2 templados, 2 calientes)', department: 'edicion', priority: 'alta', group: 'edicion_video', phase: 'produccion_video' },
  // ── Trafficker ──
  { title: 'Revisar cuenta publicitaria y BM', department: 'trafficker', priority: 'alta', phase: 'entrada' },
  { title: 'Crear Pixel de Meta', department: 'trafficker', priority: 'alta', phase: 'entrada' },
  { title: 'Compartir Pixel a Web Master', department: 'trafficker', priority: 'alta', phase: 'entrada' },
  { title: 'Montar campañas en Meta Ads', department: 'trafficker', priority: 'alta', phase: 'lanzamiento' },
  { title: 'Lanzar campañas', department: 'trafficker', priority: 'alta', phase: 'lanzamiento' },
  // ── Grabación (Producción) ──
  { title: 'Encarpetar', department: 'grabacion', priority: 'media', phase: 'produccion_video' },
]

// Tareas exclusivas de VSL (ninguna por ahora: VSL usa solo la base común).
const soloVslTasks: TemplateTask[] = []

// Tareas exclusivas de Webinar: presentación del cliente, su página de ingreso,
// el evento de Addevent, el diseño de la presentación y el video de edificación.
const soloWebinarTasks: TemplateTask[] = [
  { title: 'Crear Presentación', department: 'cliente', priority: 'alta', phase: 'produccion_video' },
  { title: 'Solicitar reunión de revisión de presentación con Alfredo Mota', department: 'cliente', priority: 'alta', phase: 'produccion_video' },
  { title: 'Cambiar diseño visual de Pág. Ingreso al Webinar', department: 'webmaster', priority: 'alta', phase: 'produccion_paginas' },
  { title: 'Crear el Evento en Addevent', department: 'webmaster', priority: 'alta', phase: 'produccion_paginas' },
  { title: 'Diseñar presentación de webinar (solo diseño, no estructura)', department: 'diseno', priority: 'alta', group: 'diseno_web', phase: 'produccion_video' },
  { title: 'Video de Edificación - Presentación', department: 'edicion', priority: 'alta', group: 'edicion_presentacion', phase: 'produccion_video' },
]

// Títulos exclusivos de Webinar — se usan para inferir la plantilla de un proyecto
// existente cuando no hay un campo explícito que lo indique.
export const WEBINAR_ONLY_TITLES = new Set(soloWebinarTasks.map(task => task.title))

const vslTasks: TemplateTask[] = [...baseTasks, ...soloVslTasks]
const webinarTasks: TemplateTask[] = [...baseTasks, ...soloWebinarTasks]

// Tareas de grabación/cliente que dependen de la modalidad elegida al crear el proyecto.
// En oficina, Grabación es la responsable de grabar y el cliente solo asiste a la sesión.
// En remota, el cliente es el responsable de grabar y compartir, y Grabación solo apoya.
const modalidadTasks: TemplateTask[] = [
  { title: 'Grabar 12 anuncios', department: 'grabacion', priority: 'alta', modalidad: 'oficina', phase: 'produccion_video' },
  { title: 'Grabar VSL y Video de Gracias', department: 'grabacion', priority: 'alta', modalidad: 'oficina', phase: 'produccion_video' },
  { title: 'Asistir a la sesión de grabación', department: 'cliente', priority: 'alta', modalidad: 'oficina', phase: 'produccion_video' },
  { title: 'Grabar VSL, Gracias y 12 anuncios', department: 'cliente', priority: 'alta', modalidad: 'remota', phase: 'produccion_video' },
  { title: 'Compartir la grabación de video de VSL, Gracias, 12 anuncios', department: 'cliente', priority: 'alta', modalidad: 'remota', phase: 'produccion_video' },
  { title: 'Enviar guía de grabación al cliente y revisar material recibido', department: 'grabacion', priority: 'media', modalidad: 'remota', phase: 'produccion_video' },
]

/** Tareas de grabación/cliente para la modalidad elegida (se agregan aparte de resolveTemplateTasks). */
export function tasksForModalidad(modalidad: Modalidad): TemplateTask[] {
  return modalidadTasks.filter(task => task.modalidad === modalidad)
}

// ── Fase por título (para tareas guardadas sin fase o de proyectos viejos) ──
const TITLE_PHASE_MAP = new Map<string, Phase>()
;[...baseTasks, ...soloWebinarTasks, ...modalidadTasks].forEach(task => {
  TITLE_PHASE_MAP.set(task.title.trim().toLocaleLowerCase('es-MX'), task.phase)
})

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
 * Asigna una fase a una tarea existente sin escribir en la base: primero busca el título
 * exacto en las plantillas (cubre el 100% de las tareas de VSL/Webinar), y si no lo
 * encuentra (tarea personalizada o de un embudo "otro") cae al departamento.
 */
export function inferPhase(title: string, department: Department): Phase {
  return TITLE_PHASE_MAP.get(title.trim().toLocaleLowerCase('es-MX')) || DEPARTMENT_FALLBACK_PHASE[department] || 'entrada'
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'vsl',
    name: 'VSL',
    icon: '🎬',
    description: 'Embudo VSL completo — producción de video, copy, diseño, webmaster y tráfico',
    tasks: vslTasks,
  },
  {
    id: 'webinar',
    name: 'Webinar',
    icon: '📡',
    description: 'Embudo Webinar — incluye presentación del webinar y video de edificación',
    tasks: webinarTasks,
  },
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
  grabacion: 'bg-violet-100 text-violet-700 border-violet-200',
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
  grabacion: 'bg-violet-100 text-violet-700 border-violet-200',
}

export const TEMPLATE_GROUP_ORDER: string[] = [
  'cliente', 'lider', 'webmaster', 'copy',
  'diseno_web', 'diseno_ads',
  'edicion_video', 'edicion_presentacion',
  'trafficker', 'grabacion',
]
