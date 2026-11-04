interface Props {
  checked: boolean
  onChange: (value: boolean) => void
  label?: string
  className?: string
}

/** Interruptor "Mostrar estimados" (fechas aproximadas difuminadas con "≈"). */
export default function EstimatesToggle({ checked, onChange, label = 'Mostrar estimados', className = '' }: Props) {
  return (
    <label className={`flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600 ${className}`}>
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-blue-600' : 'bg-slate-300'}`}
      >
        <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${checked ? 'left-6' : 'left-1'}`} />
      </button>
    </label>
  )
}
