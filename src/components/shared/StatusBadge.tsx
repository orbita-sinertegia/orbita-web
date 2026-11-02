import type { TaskStatus } from '../../types'

const config: Record<TaskStatus, { label: string; className: string }> = {
  pendiente: { label: 'Pendiente', className: 'bg-gray-100 text-gray-600 border-gray-200' },
  en_progreso: { label: 'En progreso', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  completada: { label: '✓ Completada', className: 'bg-green-100 text-green-700 border-green-200' },
  bloqueada: { label: '⚠ Bloqueada', className: 'bg-red-100 text-red-700 border-red-200' },
}

export default function StatusBadge({ status }: { status: TaskStatus }) {
  const { label, className } = config[status]
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${className}`}>
      {label}
    </span>
  )
}
