import { supabase } from './supabase'
import { PROJECT_TEMPLATES, templateTaskKey } from '../data/projectTemplates'
import type { Department, Priority } from '../types'

export interface FunnelToDelete {
  id: string
  name: string
  icon: string
  description?: string | null
  tasks: { title: string; department: Department; priority: Priority }[]
}

/**
 * Elimina un embudo: retira de los proyectos las tareas que creó, borra sus tareas predefinidas
 * y la plantilla. Los embudos de fábrica solo se archivan. Devuelve el error o null.
 */
export async function deleteFunnel(funnel: FunnelToDelete): Promise<string | null> {
  if (funnel.tasks.length > 0) {
    const { error: syncError } = await supabase.rpc('admin_remove_template_tasks', {
      p_template_id: funnel.id,
      p_task_keys: funnel.tasks.map(templateTaskKey),
    })
    if (syncError) return `No se pudieron eliminar las tareas asignadas: ${syncError.message}`
  }
  const { error: tasksError } = await supabase.from('template_tasks').delete().eq('template_id', funnel.id)
  if (tasksError) return `No se pudieron eliminar las tareas del embudo: ${tasksError.message}`

  const isBuiltIn = PROJECT_TEMPLATES.some(template => template.id === funnel.id)
  const result = isBuiltIn
    ? await supabase.from('project_templates').upsert({ id: funnel.id, name: funnel.name, icon: funnel.icon, description: funnel.description || null, archived: true }, { onConflict: 'id' })
    : await supabase.from('project_templates').delete().eq('id', funnel.id)
  if (result.error) return `No se pudo eliminar el embudo: ${result.error.message}`
  return null
}
