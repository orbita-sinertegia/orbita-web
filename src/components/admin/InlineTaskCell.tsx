import { useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { isCommittableDate } from '../../lib/inlineTaskEdit'

const trigger = 'group/inline -mx-1.5 -my-1 flex max-w-full items-center gap-1 rounded-md px-1.5 py-1 text-left transition hover:bg-blue-50 hover:ring-1 hover:ring-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-400'
const control = 'max-w-[11rem] rounded-md border border-blue-300 bg-white px-2 py-1 text-xs text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

interface SelectProps {
  value: string
  options: { value: string; label: string }[]
  display: ReactNode
  label: string
  onSave: (value: string) => void
  /** Texto de ayuda cuando el valor actual no está en la lista. */
  placeholder?: string
}

/** Celda editable con lista: clic → selector; al elegir se guarda. Esc cancela. */
export function InlineSelectCell({ value, options, display, label, onSave, placeholder }: SelectProps) {
  const [editing, setEditing] = useState(false)
  if (!editing) {
    return (
      <button type="button" title={`Cambiar ${label}`} aria-label={`Cambiar ${label}`}
        onClick={event => { event.stopPropagation(); setEditing(true) }} className={trigger}>
        {display}
      </button>
    )
  }
  const known = options.some(option => option.value === value)
  return (
    <select autoFocus aria-label={label} value={known ? value : ''} className={control}
      onClick={event => event.stopPropagation()}
      onKeyDown={event => { if (event.key === 'Escape') setEditing(false) }}
      onBlur={() => setEditing(false)}
      onChange={event => {
        const next = event.target.value
        setEditing(false)
        if (next && next !== value) onSave(next)
      }}>
      {!known && <option value="" disabled>{placeholder || 'Elige una opción'}</option>}
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  )
}

interface DateProps {
  value: string
  display: ReactNode
  label: string
  onSave: (value: string) => void
}

/** Celda de fecha: clic → selector de fecha; al elegir se guarda. "Quitar" la deja vacía. */
export function InlineDateCell({ value, display, label, onSave }: DateProps) {
  const [editing, setEditing] = useState(false)
  if (!editing) {
    return (
      <button type="button" title={`Cambiar ${label}`} aria-label={`Cambiar ${label}`}
        onClick={event => { event.stopPropagation(); setEditing(true) }} className={trigger}>
        {display}
      </button>
    )
  }
  return (
    <span className="flex items-center gap-1" onClick={event => event.stopPropagation()}>
      <input type="date" autoFocus aria-label={label} defaultValue={value} className={control}
        onKeyDown={event => { if (event.key === 'Escape') setEditing(false) }}
        onBlur={() => setEditing(false)}
        onChange={event => {
          const next = event.target.value
          // Vacío a medio teclear no borra la fecha: para quitarla está el botón.
          if (!next || !isCommittableDate(next)) return
          setEditing(false)
          if (next !== value) onSave(next)
        }} />
      {value && (
        <button type="button" title="Quitar fecha" aria-label="Quitar fecha"
          // mousedown para que no se cierre antes por el blur del selector
          onMouseDown={event => { event.preventDefault(); setEditing(false); onSave('') }}
          className="rounded-md border border-gray-200 bg-white p-1 text-gray-500 hover:border-red-200 hover:text-red-600">
          <X size={12} />
        </button>
      )}
    </span>
  )
}
