import { useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { Department, Priority } from '../../types'
import { templateTaskKey } from '../../data/projectTemplates'

export interface FunnelTaskInput {
  title: string
  department: Department
  priority: Priority
}

export interface EditableFunnel {
  id: string
  name: string
  icon: string
  description: string
  tasks: FunnelTaskInput[]
}

interface Props {
  onClose: () => void
  onCreated: (template: { id: string; name: string; icon: string; description: string }) => void
  template?: EditableFunnel
}

const DEPARTMENTS: { value: Department; label: string }[] = [
  { value: 'edicion', label: 'Edición' },
  { value: 'grabacion', label: 'Grabación' },
  { value: 'diseno', label: 'Diseño' },
  { value: 'copy', label: 'Copy' },
  { value: 'webmaster', label: 'Webmaster' },
  { value: 'trafficker', label: 'Trafficker' },
  { value: 'lider', label: 'Líder de Proyecto' },
  { value: 'cliente', label: 'Tarea del Cliente' },
]

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'critica', label: 'Crítica' },
  { value: 'alta', label: 'Alta' },
  { value: 'media', label: 'Media' },
  { value: 'baja', label: 'Baja' },
]

const EMOJI_OPTIONS = [
  '🎬', '📡', '🛒', '🎪', '💰', '📦', '🎯', '📈', '🚀', '🛍️',
  '🎟️', '🎫', '💼', '📋', '✨', '🔥', '⚡', '🌟', '💎', '🎁',
  '📺', '🎙️', '📱', '💻', '🖥️', '🗂️', '📊', '🧩', '🏷️', '🛠️',
  '🧲', '📣', '🛫', '🏢', '🏠', '🎓', '🍽️', '🩺', '⚖️', '💪',
]

type TaskRow = FunnelTaskInput

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const suffix = Math.random().toString(36).slice(2, 6)
  return `${base || 'embudo'}_${suffix}`
}

export default function CreateFunnelTemplateModal({ onClose, onCreated, template }: Props) {
  const [name, setName] = useState(template?.name || '')
  const [icon, setIcon] = useState(template?.icon || '🗂️')
  const [description, setDescription] = useState(template?.description || '')
  const [tasks, setTasks] = useState<TaskRow[]>(template?.tasks.length ? template.tasks : [{ title: '', department: 'lider', priority: 'alta' }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [removedTasks, setRemovedTasks] = useState<TaskRow[]>([])
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)

  function updateTask(idx: number, patch: Partial<TaskRow>) {
    setTasks(prev => prev.map((t, i) => i === idx ? { ...t, ...patch } : t))
  }

  function addTaskRow() {
    setTasks(prev => [...prev, { title: '', department: 'lider', priority: 'alta' }])
  }

  function removeTaskRow(idx: number) {
    if (template) setRemovedTasks(prev => [...prev, tasks[idx]])
    setTasks(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleSave(removalConfirmed = false) {
    if (!name.trim()) { setError('Ponle un nombre al embudo'); return }
    const validTasks = tasks.filter(t => t.title.trim())
    const validKeys = new Set(validTasks.map(templateTaskKey))
    const removedKeys = [...new Set(removedTasks.map(templateTaskKey).filter(key => !validKeys.has(key)))]
    if (removedKeys.length > 0 && !removalConfirmed) {
      setConfirmingRemoval(true)
      return
    }
    setSaving(true)
    setError('')

    const id = template?.id || slugify(name)
    const { error: tplErr } = await supabase.from('project_templates').upsert({
      id, name: name.trim(), icon: icon.trim() || '🗂️', description: description.trim() || null, archived: false,
    }, { onConflict: 'id' })
    if (tplErr) { setError('Error al crear el embudo: ' + tplErr.message); setSaving(false); return }

    const { error: deleteError } = await supabase.from('template_tasks').delete().eq('template_id', id)
    if (deleteError) { setError('No se pudieron actualizar las tareas: ' + deleteError.message); setSaving(false); return }

    if (validTasks.length > 0) {
      const { error: tasksErr } = await supabase.from('template_tasks').insert(
        validTasks.map(t => ({ title: t.title.trim(), department: t.department, priority: t.priority, template_id: id }))
      )
      if (tasksErr) { setError('El embudo se creó, pero hubo un error al guardar las tareas: ' + tasksErr.message); setSaving(false); return }
    }

    if (template && removedKeys.length > 0) {
      const { error: syncError } = await supabase.rpc('admin_remove_template_tasks', {
        p_template_id: id,
        p_task_keys: removedKeys,
      })
      if (syncError) {
        setError('El embudo se actualizó, pero no se pudieron retirar las tareas asignadas: ' + syncError.message)
        setSaving(false)
        return
      }
    }

    setSaving(false)
    onCreated({ id, name: name.trim(), icon: icon.trim() || '🗂️', description: description.trim() })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-100 shrink-0">
          <h3 className="text-lg font-bold text-gray-900">{template ? 'Editar embudo' : 'Crear embudo nuevo'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          <div className="flex gap-3">
            <div className="w-20 relative">
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Ícono</label>
              <button type="button" onClick={() => setShowEmojiPicker(o => !o)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-center text-xl hover:bg-gray-50 transition">
                {icon || '🗂️'}
              </button>
              {showEmojiPicker && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowEmojiPicker(false)} />
                  <div className="absolute left-0 top-[calc(100%+4px)] z-40 bg-white border border-gray-200 rounded-xl shadow-lg p-2 grid grid-cols-5 gap-1 w-[220px]">
                    {EMOJI_OPTIONS.map(e => (
                      <button key={e} type="button" onClick={() => { setIcon(e); setShowEmojiPicker(false) }}
                        className="text-xl hover:bg-gray-100 rounded-lg py-1.5 transition">
                        {e}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Nombre del embudo *</label>
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder="Ej: Low Ticket, Evento Presencial..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1 uppercase tracking-wide">Descripción</label>
            <input value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Breve descripción de este tipo de embudo..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">Tareas de este embudo</label>
              <button type="button" onClick={addTaskRow}
                className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800">
                <Plus size={13} /> Agregar tarea
              </button>
            </div>
            <div className="space-y-2">
              {tasks.map((t, idx) => (
                <div key={idx} className="flex gap-2 items-start bg-gray-50 border border-gray-200 rounded-lg p-2">
                  <input value={t.title} onChange={e => updateTask(idx, { title: e.target.value })}
                    placeholder="Título de la tarea"
                    className="flex-1 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <select value={t.department} onChange={e => updateTask(idx, { department: e.target.value as Department })}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {DEPARTMENTS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                  <select value={t.priority} onChange={e => updateTask(idx, { priority: e.target.value as Priority })}
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                  <button type="button" onClick={() => removeTaskRow(idx)}
                    className="text-gray-300 hover:text-red-500 transition shrink-0 p-1.5">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              {tasks.length === 0 && (
                <p className="text-xs text-gray-400 italic">Sin tareas — puedes agregarlas después también.</p>
              )}
            </div>
          </div>

          {error && (
            <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</p>
          )}
        </div>

        <div className="p-6 border-t border-gray-100 shrink-0 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg transition">
            Cancelar
          </button>
          <button onClick={() => void handleSave()} disabled={saving}
            className="px-4 py-2 bg-gradient-to-r from-blue-700 to-red-600 text-white text-sm font-semibold rounded-lg hover:opacity-90 transition disabled:opacity-50">
            {saving ? 'Guardando...' : template ? 'Guardar cambios' : 'Crear embudo'}
          </button>
        </div>
      </div>
      {confirmingRemoval && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 grid h-11 w-11 place-items-center rounded-full bg-red-100 text-red-600"><Trash2 size={20} /></div>
            <h4 className="text-lg font-bold text-gray-900">¿Eliminar también las tareas asignadas?</h4>
            <p className="mt-2 text-sm leading-6 text-gray-600">Se eliminarán estas tareas del embudo y de los proyectos donde fueron creadas desde esta plantilla. También se borrarán sus subtareas, comentarios, enlaces y registros de tiempo.</p>
            <p className="mt-3 text-sm font-semibold text-red-600">Esta acción no se puede deshacer.</p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmingRemoval(false)} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={() => { setConfirmingRemoval(false); void handleSave(true) }} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">Eliminar y guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
