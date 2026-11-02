import { useEffect, useMemo, useState } from 'react'
import { LoaderCircle, Pencil, Plus, Trash2, Workflow } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { PROJECT_TEMPLATES, resolveTemplateTasks, templateTaskKey } from '../../data/projectTemplates'
import type { Department, Priority } from '../../types'
import CreateFunnelTemplateModal, { type EditableFunnel } from './CreateFunnelTemplateModal'

interface DbTemplate { id: string; name: string; icon: string; description: string | null; archived?: boolean }
interface DbTask { template_id: string; title: string; department: Department; priority: Priority; group?: string }

export default function FunnelTemplatesManager() {
  const [templates, setTemplates] = useState<DbTemplate[]>([])
  const [tasks, setTasks] = useState<DbTask[]>([])
  const [editing, setEditing] = useState<EditableFunnel | null | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { void load() }, [])

  async function load() {
    setLoading(true)
    const [templateResult, taskResult] = await Promise.all([
      supabase.from('project_templates').select('id, name, icon, description, archived').order('created_at'),
      supabase.from('template_tasks').select('template_id, title, department, priority').order('created_at'),
    ])
    if (templateResult.error || taskResult.error) {
      setError('No se pudieron cargar todos los embudos. Recarga la página para intentarlo de nuevo.')
      setLoading(false)
      return
    }
    setTemplates((templateResult.data as DbTemplate[]) || [])
    setTasks((taskResult.data as DbTask[]) || [])
    setError('')
    setLoading(false)
  }

  const funnels = useMemo<EditableFunnel[]>(() => {
    const builtIns = PROJECT_TEMPLATES.filter(template => templates.find(item => item.id === template.id)?.archived !== true).map(template => {
      const stored = templates.find(item => item.id === template.id)
      const storedTasks = tasks.filter(task => task.template_id === template.id)
      const resolvedTasks = resolveTemplateTasks(template, storedTasks, Boolean(stored))
      return {
        id: template.id,
        name: stored?.name || template.name,
        icon: stored?.icon || template.icon,
        description: stored?.description || template.description,
        tasks: resolvedTasks,
      }
    })
    const custom = templates
      .filter(template => !template.archived && !PROJECT_TEMPLATES.some(item => item.id === template.id))
      .map(template => ({
        id: template.id,
        name: template.name,
        icon: template.icon,
        description: template.description || '',
        tasks: tasks.filter(task => task.template_id === template.id).map(({ title, department, priority }) => ({ title, department, priority })),
      }))
    return [...builtIns, ...custom]
  }, [templates, tasks])

  async function removeFunnel(funnel: EditableFunnel) {
    if (!window.confirm(`¿Eliminar el embudo "${funnel.name}"?\n\nSe eliminará esta plantilla y sus ${funnel.tasks.length} tareas predefinidas. También se eliminarán las tareas que este embudo creó para los integrantes.`)) return
    setDeletingId(funnel.id)
    setError('')
    const { error: syncError } = await supabase.rpc('admin_remove_template_tasks', {
      p_template_id: funnel.id,
      p_task_keys: funnel.tasks.map(templateTaskKey),
    })
    if (syncError) {
      setError(`No se pudieron eliminar las tareas asignadas: ${syncError.message}`)
      setDeletingId('')
      return
    }
    const { error: tasksError } = await supabase.from('template_tasks').delete().eq('template_id', funnel.id)
    if (tasksError) {
      setError(`No se pudieron eliminar las tareas del embudo: ${tasksError.message}`)
      setDeletingId('')
      return
    }

    const isBuiltIn = PROJECT_TEMPLATES.some(template => template.id === funnel.id)
    const result = isBuiltIn
      ? await supabase.from('project_templates').upsert({ id: funnel.id, name: funnel.name, icon: funnel.icon, description: funnel.description || null, archived: true }, { onConflict: 'id' })
      : await supabase.from('project_templates').delete().eq('id', funnel.id)
    if (result.error) {
      setError(`No se pudo eliminar el embudo: ${result.error.message}`)
      setDeletingId('')
      return
    }
    if (editing?.id === funnel.id) setEditing(undefined)
    await load()
    setDeletingId('')
  }

  if (loading) return <div className="flex items-center justify-center gap-2 py-24 text-sm text-gray-400"><LoaderCircle className="animate-spin" size={18} /> Cargando embudos...</div>

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-blue-600"><Workflow size={14} /> Plantillas de proyectos</div><h1 className="text-2xl font-bold text-gray-900">Embudos</h1><p className="mt-1 text-sm text-gray-500">Administra las tareas que se crearán automáticamente en cada tipo de proyecto.</p></div>
        <button onClick={() => setEditing(null)} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700"><Plus size={17} /> Crear embudo</button>
      </header>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {funnels.map(funnel => (
          <article key={funnel.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3"><span className="grid h-12 w-12 place-items-center rounded-xl bg-blue-50 text-2xl">{funnel.icon}</span><div className="flex gap-2"><button onClick={() => setEditing(funnel)} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"><Pencil size={13} /> Editar</button><button onClick={() => void removeFunnel(funnel)} disabled={deletingId === funnel.id} className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-50">{deletingId === funnel.id ? <LoaderCircle className="animate-spin" size={13} /> : <Trash2 size={13} />} Eliminar</button></div></div>
            <h2 className="mt-4 text-lg font-bold text-gray-900">{funnel.name}</h2>
            <p className="mt-1 min-h-10 text-sm text-gray-500">{funnel.description}</p>
            <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-4"><span className="text-sm font-semibold text-blue-600">{funnel.tasks.length} tareas</span><span className="text-xs text-gray-400">Reutilizable</span></div>
          </article>
        ))}
      </div>

      {editing !== undefined && <CreateFunnelTemplateModal template={editing || undefined} onClose={() => setEditing(undefined)} onCreated={() => { setEditing(undefined); void load() }} />}
    </div>
  )
}
