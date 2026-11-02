import { useEffect, useState } from 'react'

interface Props { value: string; onChange: (value: string) => void; required?: boolean }

const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

export default function BirthdayDatePicker({ value, onChange, required }: Props) {
  const initial = value ? value.split('-') : ['', '', '']
  const [year, setYear] = useState(initial[0] || '')
  const [month, setMonth] = useState(initial[1] ? String(Number(initial[1])) : '')
  const [day, setDay] = useState(initial[2] ? String(Number(initial[2])) : '')
  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 90 }, (_, index) => currentYear - 15 - index)
  const maxDays = month && year ? new Date(Number(year), Number(month), 0).getDate() : 31
  useEffect(() => {
    if (!value) { setYear(''); setMonth(''); setDay(''); return }
    const [nextYear, nextMonth, nextDay] = value.split('-')
    setYear(nextYear || '')
    setMonth(nextMonth ? String(Number(nextMonth)) : '')
    setDay(nextDay ? String(Number(nextDay)) : '')
  }, [value])

  function update(nextDay: string, nextMonth: string, nextYear: string) {
    setDay(nextDay); setMonth(nextMonth); setYear(nextYear)
    if (!nextDay || !nextMonth || !nextYear) return
    const safeDay = Math.min(Number(nextDay), new Date(Number(nextYear), Number(nextMonth), 0).getDate())
    if (String(safeDay) !== nextDay) setDay(String(safeDay))
    onChange(`${nextYear}-${nextMonth.padStart(2, '0')}-${String(safeDay).padStart(2, '0')}`)
  }
  const classes = 'h-11 min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100'
  return <div className="grid grid-cols-[.8fr_1.35fr_1fr] gap-2">
    <select aria-label="Día de nacimiento" required={required} value={day ? String(Number(day)) : ''} onChange={e => update(e.target.value, month, year)} className={classes}><option value="">Día</option>{Array.from({ length: maxDays }, (_, i) => i + 1).map(item => <option key={item} value={item}>{item}</option>)}</select>
    <select aria-label="Mes de nacimiento" required={required} value={month ? String(Number(month)) : ''} onChange={e => update(day, e.target.value, year)} className={classes}><option value="">Mes</option>{MONTHS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select>
    <select aria-label="Año de nacimiento" required={required} value={year} onChange={e => update(day, month, e.target.value)} className={classes}><option value="">Año</option>{years.map(item => <option key={item} value={item}>{item}</option>)}</select>
  </div>
}
