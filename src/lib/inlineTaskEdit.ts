/**
 * Edición en línea en las tablas de tareas: "Asignado a", "Depto", "Prioridad" y
 * "La necesito para". Guarda con la misma RPC que el lápiz (admin_update_task), así
 * las notificaciones de reasignación / actualización siguen saliendo desde la base.
 * Funciones puras para poder probarlas sin React.
 */
import type { Department, Priority, Task, User } from '../types'
import type { TaskChanges } from './adminTasks'

export type InlineField = 'assigned_to' | 'department' | 'priority' | 'needed_date'

type Editor = Pick<User, 'role' | 'is_super_admin' | 'active'> | null | undefined

export const INLINE_PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'critica', label: '🔴 Crítica' },
  { value: 'alta', label: '🟠 Alta' },
  { value: 'media', label: '🟡 Media' },
  { value: 'baja', label: '🟢 Baja' },
]

/** Departamentos del equipo. "Cliente" no se ofrece en línea: exige al usuario cliente del proyecto (usa el lápiz). */
export const INLINE_DEPARTMENTS: { value: Exclude<Department, 'cliente'>; label: string }[] = [
  { value: 'lider', label: 'Líder' },
  { value: 'webmaster', label: 'Webmaster' },
  { value: 'copy', label: 'Copy' },
  { value: 'diseno', label: 'Diseño' },
  { value: 'edicion', label: 'Edición' },
  { value: 'trafficker', label: 'Trafficker' },
  { value: 'grabacion', label: 'Grabación' },
]

function isSuperAdmin(user: Editor): boolean {
  return !!user?.is_super_admin && user.active !== false
}

/**
 * Mismas reglas que el lápiz: admins y super admin. Las tareas realizadas solo las
 * edita el super admin. Las archivadas no se editan.
 */
export function canInlineEditTask(user: Editor, task: Pick<Task, 'status' | 'archived_at'>): boolean {
  if (!user || user.active === false) return false
  const isAdmin = user.role === 'admin' || !!user.is_super_admin
  if (!isAdmin || task.archived_at) return false
  if (task.status === 'completada') return isSuperAdmin(user)
  return true
}

/** Campos que no se pueden cambiar en línea para esta tarea (las del cliente se editan con el lápiz). */
export function inlineFieldLocked(task: Pick<Task, 'department'>, field: InlineField): boolean {
  return task.department === 'cliente' && (field === 'assigned_to' || field === 'department')
}

/** Cambio listo para admin_update_task, o null si no cambió nada / no es válido. */
export function buildInlineChange(task: Task, field: InlineField, rawValue: string): TaskChanges | null {
  const value = rawValue.trim()
  if (field === 'needed_date') {
    const next = value ? value.slice(0, 10) : null
    const prev = task.needed_date ? task.needed_date.slice(0, 10) : null
    return next === prev ? null : { needed_date: next }
  }
  if (!value) return null
  if (field === 'priority' && !INLINE_PRIORITIES.some(p => p.value === value)) return null
  if (field === 'department' && !INLINE_DEPARTMENTS.some(d => d.value === value)) return null
  if (inlineFieldLocked(task, field)) return null
  const prev = (task as unknown as Record<string, unknown>)[field] ?? null
  return prev === value ? null : { [field]: value }
}

export type TaskOverrides = Record<string, Partial<Task>>

/** Cambio optimista: lo que se ve en pantalla mientras la base confirma. */
export function optimisticPatch(changes: TaskChanges, members: Pick<User, 'id'>[]): Partial<Task> {
  const patch: Partial<Task> = {}
  for (const [key, value] of Object.entries(changes)) {
    (patch as Record<string, unknown>)[key] = value === null ? undefined : value
  }
  if ('assigned_to' in changes) {
    const member = members.find(m => m.id === changes.assigned_to)
    patch.assignee = member as User | undefined
  }
  return patch
}

export function addOverride(overrides: TaskOverrides, taskId: string, patch: Partial<Task>): TaskOverrides {
  return { ...overrides, [taskId]: { ...(overrides[taskId] || {}), ...patch } }
}

/**
 * Quita del override las llaves de `patch` (al revertir, o cuando la lista ya trae el dato),
 * solo si siguen con ese mismo valor: así no se pisa un cambio más nuevo del mismo campo.
 */
export function removeOverride(overrides: TaskOverrides, taskId: string, patch: Partial<Task>): TaskOverrides {
  const current = overrides[taskId] as Record<string, unknown> | undefined
  if (!current) return overrides
  const rest = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (key in rest && JSON.stringify(rest[key]) === JSON.stringify(value)) delete rest[key]
  }
  const next = { ...overrides }
  if (Object.keys(rest).length) next[taskId] = rest as Partial<Task>
  else delete next[taskId]
  return next
}

export function applyOverrides<T extends Task>(tasks: T[], overrides: TaskOverrides): T[] {
  return tasks.map(task => overrides[task.id] ? { ...task, ...overrides[task.id] } : task)
}

/** Solo usuarios activos (active nulo cuenta como activo), sin duplicados, por nombre. */
export function activeAssignableMembers(members: User[]): User[] {
  const byId = new Map<string, User>()
  for (const member of members) if (member && member.active !== false) byId.set(member.id, member)
  return [...byId.values()].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', 'es'))
}

const FIELD_LABELS: Record<InlineField, string> = {
  assigned_to: 'la persona asignada',
  department: 'el departamento',
  priority: 'la prioridad',
  needed_date: 'la fecha "La necesito para"',
}

export function inlineErrorNotice(field: InlineField, message: string): string {
  const clean = (message || 'Intenta de nuevo').trim().replace(/[.\s]+$/, '')
  return `No se pudo cambiar ${FIELD_LABELS[field]}: ${clean}. Se regresó al valor anterior.`
}

/**
 * El selector de fecha avisa cambios mientras se teclea el año (0002, 0020, 0202...).
 * Solo se guarda una fecha completa con año razonable, o vacío para quitarla.
 */
export function isCommittableDate(value: string): boolean {
  if (value === '') return true
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  return year >= 2000 && year <= 2100
}
