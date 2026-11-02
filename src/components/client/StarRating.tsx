import { useState } from 'react'
import { supabase } from '../../lib/supabase'

interface Props {
  taskId: string
  clientId: string
  existing?: { stars: number; comment: string | null } | null
  onRated?: () => void
}

export default function StarRating({ taskId, clientId, existing, onRated }: Props) {
  const [stars, setStars] = useState(existing?.stars || 0)
  const [hover, setHover] = useState(0)
  const [comment, setComment] = useState(existing?.comment || '')
  const [saved, setSaved] = useState(!!existing)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)

  async function save() {
    if (!stars) return
    setSaving(true)
    await supabase.from('task_ratings').upsert(
      { task_id: taskId, client_id: clientId, stars, comment: comment || null },
      { onConflict: 'task_id,client_id' }
    )
    setSaving(false)
    setSaved(true)
    setEditing(false)
    if (onRated) onRated()
  }

  // Vista después de calificar
  if (saved && !editing) {
    return (
      <div className="mt-3 border-t border-gray-100 pt-3">
        <p className="text-xs font-semibold text-gray-500 mb-1.5">Tu calificación:</p>
        <div className="flex items-center gap-1 mb-1">
          {[1, 2, 3, 4, 5].map(s => (
            <span key={s} className={`text-xl ${s <= stars ? 'text-yellow-400' : 'text-gray-200'}`}>★</span>
          ))}
          <span className="text-xs text-gray-500 ml-2">{stars} de 5 estrellas</span>
        </div>
        {comment && (
          <p className="text-xs text-gray-500 italic bg-gray-50 rounded-lg px-3 py-1.5 mt-1">"{comment}"</p>
        )}
        <button
          onClick={() => setEditing(true)}
          className="text-xs text-blue-500 hover:underline mt-1"
        >
          Modificar calificación
        </button>
      </div>
    )
  }

  // Vista para calificar
  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <p className="text-xs font-semibold text-gray-600 mb-2">
        {saved ? 'Modificar tu calificación:' : '¿Cómo calificarías este entregable?'}
      </p>

      {/* Estrellas */}
      <div className="flex gap-1 mb-2">
        {[1, 2, 3, 4, 5].map(s => (
          <button
            key={s}
            type="button"
            onMouseEnter={() => setHover(s)}
            onMouseLeave={() => setHover(0)}
            onClick={() => setStars(s)}
            className={`text-3xl leading-none transition-transform hover:scale-110 focus:outline-none
              ${s <= (hover || stars) ? 'text-yellow-400' : 'text-gray-200 hover:text-yellow-200'}`}
          >
            ★
          </button>
        ))}
        {stars > 0 && (
          <span className="text-xs text-gray-400 self-center ml-2">
            {stars === 1 ? 'Muy malo' : stars === 2 ? 'Malo' : stars === 3 ? 'Regular' : stars === 4 ? 'Bueno' : 'Excelente'}
          </span>
        )}
      </div>

      {/* Comentario */}
      {stars > 0 && (
        <>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            rows={2}
            placeholder="Opcional: cuéntanos qué te pareció..."
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 resize-none"
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={save}
              disabled={saving}
              className="flex-1 bg-yellow-400 hover:bg-yellow-500 text-white font-semibold text-sm py-2 rounded-lg transition disabled:opacity-50"
            >
              {saving ? 'Guardando...' : '⭐ Enviar calificación'}
            </button>
            {editing && (
              <button
                onClick={() => { setEditing(false); setStars(existing?.stars || 0); setComment(existing?.comment || '') }}
                className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg transition"
              >
                Cancelar
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
