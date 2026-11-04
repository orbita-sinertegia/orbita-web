/**
 * Días de descanso obligatorio en México (Ley Federal del Trabajo, art. 74), 2026–2027.
 * Se usan en los estimados de fechas (no se planea trabajo esos días) y se marcan en los
 * calendarios. Para agregar un año o un día propio de la agencia: añade una línea aquí.
 * No incluye Jueves/Viernes Santo ni el 12 de diciembre (no son obligatorios por ley).
 */
export const MX_HOLIDAYS: Record<string, string> = {
  '2026-01-01': 'Año Nuevo',
  '2026-02-02': 'Día de la Constitución',
  '2026-03-16': 'Natalicio de Benito Juárez',
  '2026-05-01': 'Día del Trabajo',
  '2026-09-16': 'Día de la Independencia',
  '2026-11-16': 'Día de la Revolución',
  '2026-12-25': 'Navidad',
  '2027-01-01': 'Año Nuevo',
  '2027-02-01': 'Día de la Constitución',
  '2027-03-15': 'Natalicio de Benito Juárez',
  '2027-05-01': 'Día del Trabajo',
  '2027-09-16': 'Día de la Independencia',
  '2027-11-15': 'Día de la Revolución',
  '2027-12-25': 'Navidad',
}

/** ¿La clave 'YYYY-MM-DD' es día feriado? */
export function isHoliday(dateKey: string | null | undefined): boolean {
  return !!dateKey && Object.prototype.hasOwnProperty.call(MX_HOLIDAYS, dateKey.slice(0, 10))
}

/** Nombre del feriado o '' si no lo es. */
export function holidayName(dateKey: string | null | undefined): string {
  return dateKey && isHoliday(dateKey) ? MX_HOLIDAYS[dateKey.slice(0, 10)] : ''
}
