interface ProgressBarProps {
  percentage: number
  showLabel?: boolean
}

export default function ProgressBar({ percentage, showLabel = true }: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, Math.round(percentage)))
  const color = pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-blue-500' : pct >= 25 ? 'bg-yellow-500' : 'bg-red-400'

  return (
    <div className="w-full">
      {showLabel && (
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Progreso</span>
          <span className="font-semibold">{pct}%</span>
        </div>
      )}
      <div className="w-full bg-gray-200 rounded-full h-2.5">
        <div className={`${color} h-2.5 rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
