import type { Priority } from '../../types'

const config: Record<Priority, { label: string; className: string }> = {
  critica: { label: '🔴 Crítica', className: 'bg-red-100 text-red-700 border-red-200' },
  alta: { label: '🟠 Alta', className: 'bg-orange-100 text-orange-700 border-orange-200' },
  media: { label: '🟡 Media', className: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  baja: { label: '🟢 Baja', className: 'bg-green-100 text-green-700 border-green-200' },
}

export default function PriorityBadge({ priority }: { priority: Priority }) {
  const { label, className } = config[priority]
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${className}`}>
      {label}
    </span>
  )
}
