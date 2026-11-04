// Utilidades para columnas de solo fecha ('YYYY-MM-DD', p. ej. commitment_date).
//
// `new Date('2026-10-30')` interpreta la cadena como medianoche UTC, que en CDMX (UTC-6)
// son las 18:00 del día ANTERIOR: la fecha se mostraba un día antes y las tareas de hoy
// aparecían como vencidas. Estas funciones leen la fecha como día local y comparan
// claves 'YYYY-MM-DD' contra el día actual en America/Mexico_City.

export const DAY_MS = 86400000

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})/

/** Lee 'YYYY-MM-DD' (o el inicio de un timestamp) como medianoche LOCAL de ese día. */
export function parseDateOnly(value?: string | null): Date | null {
  if (!value) return null
  const match = DATE_ONLY.exec(value)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

/** Clave 'YYYY-MM-DD' de la fecha local de un Date. */
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Clave 'YYYY-MM-DD' del día actual (o de `now`) en America/Mexico_City. */
export function cdmxTodayKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

/** Formatea una columna de solo fecha en español (es-MX) sin desfase de zona horaria. */
export function formatDateOnly(value?: string | null, options?: Intl.DateTimeFormatOptions, fallback = '—'): string {
  const date = parseDateOnly(value)
  return date ? date.toLocaleDateString('es-MX', options) : fallback
}

/** Vencida = su fecha es ANTERIOR a hoy (CDMX). Una tarea que vence hoy no está vencida. */
export function isDateKeyOverdue(value: string | null | undefined, now: Date = new Date()): boolean {
  if (!value) return false
  const key = value.slice(0, 10)
  return DATE_ONLY.test(key) && key < cdmxTodayKey(now)
}

/** Días de calendario de `fromKey` a `toKey` (ambos 'YYYY-MM-DD'); negativo si `toKey` es anterior. */
export function daysBetweenKeys(fromKey: string, toKey: string): number {
  const a = DATE_ONLY.exec(fromKey), b = DATE_ONLY.exec(toKey)
  if (!a || !b) return 0
  const utcA = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]))
  const utcB = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]))
  return Math.round((utcB - utcA) / DAY_MS)
}

/** Medianoche local del día de `date`. */
export function startOfLocalDay(date: Date = new Date()): Date {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  return result
}

/** Lunes (medianoche local) de la semana de `date`; el domingo pertenece a la semana que termina. */
export function mondayOf(date: Date): Date {
  const result = startOfLocalDay(date)
  const day = result.getDay()
  result.setDate(result.getDate() + (day === 0 ? -6 : 1 - day))
  return result
}

/** Suma días de calendario (seguro ante cambios de horario). */
export function addLocalDays(date: Date, amount: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + amount)
  return result
}

/** Índice de la columna "Hoy" en una línea de tiempo que inicia en `timelineStart` (medianoche local). */
export function todayIndexFrom(timelineStart: Date, now: Date = new Date()): number {
  return Math.round((startOfLocalDay(now).getTime() - startOfLocalDay(timelineStart).getTime()) / DAY_MS)
}

/** Semanas (lunes a domingo) que cubren el mes de `monthAnchor`; cada semana trae 7 fechas. */
export function monthWeeks(monthAnchor: Date): Date[][] {
  const first = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1)
  const last = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0)
  const weeks: Date[][] = []
  for (let start = mondayOf(first); start <= last; start = addLocalDays(start, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, index) => addLocalDays(start, index)))
  }
  return weeks
}
