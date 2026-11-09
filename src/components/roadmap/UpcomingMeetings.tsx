import { useEffect, useState } from 'react'
import { CalendarClock, MapPin, Video } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// Próximas reuniones del proyecto (solo lectura). Se agendan desde la app móvil.
// La base solo devuelve las citas que esta persona puede ver.
interface Meeting {
  id: string
  kind: string
  title: string
  status: string
  modality: 'presencial' | 'virtual' | null
  location: string | null
  meeting_url: string | null
  starts_at: string | null
  ends_at: string | null
}

const KIND_LABEL: Record<string, string> = {
  grabacion: 'Grabación',
  reunion: 'Reunión',
  entrevista: 'Entrevista',
  accesos: 'Accesos a cuentas',
}

const STATUS: Record<string, { label: string; className: string }> = {
  solicitada: { label: 'Solicitada', className: 'bg-purple-100 text-purple-700' },
  programada: { label: 'Programada', className: 'bg-blue-100 text-blue-800' },
  en_curso: { label: 'En curso', className: 'bg-amber-100 text-amber-800' },
}

const TIME_ZONE = 'America/Mexico_City'

function formatRange(start: string, end: string | null) {
  const day = new Date(start).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TIME_ZONE })
  const time = (value: string) => new Date(value).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TIME_ZONE })
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} · ${time(start)}${end ? ` – ${time(end)}` : ''}`
}

function platform(url: string) {
  if (url.includes('meet.google')) return 'Meet'
  if (url.includes('zoom.')) return 'Zoom'
  return 'la videollamada'
}

export default function UpcomingMeetings({ projectId }: { projectId: string }) {
  const [meetings, setMeetings] = useState<Meeting[]>([])

  useEffect(() => {
    let active = true
    supabase
      .from('appointments')
      .select('id, kind, title, status, modality, location, meeting_url, starts_at, ends_at')
      .eq('project_id', projectId)
      .in('status', ['solicitada', 'programada', 'en_curso'])
      .order('starts_at', { ascending: true, nullsFirst: false })
      .limit(5)
      .then(({ data, error }) => {
        // Si la tabla aún no existe o no hay permiso, la tarjeta no se muestra.
        if (active) setMeetings(error ? [] : (data as Meeting[]) || [])
      })
    return () => { active = false }
  }, [projectId])

  if (meetings.length === 0) return null

  return (
    <section className="mb-6 rounded-2xl border border-gray-200 bg-white p-5" aria-labelledby="proximas-reuniones">
      <div className="mb-3 flex items-center gap-2">
        <CalendarClock className="h-5 w-5 text-blue-600" aria-hidden />
        <h3 id="proximas-reuniones" className="text-base font-bold text-gray-900">Próximas reuniones</h3>
      </div>
      <ul className="space-y-3">
        {meetings.map(meeting => {
          const status = STATUS[meeting.status] || STATUS.programada
          return (
            <li key={meeting.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-gray-50 p-3">
              <div className="min-w-0">
                <p className="font-semibold text-gray-900">{meeting.title}</p>
                <p className="text-sm text-gray-500">
                  {KIND_LABEL[meeting.kind] || meeting.kind}
                  {meeting.starts_at ? ` · ${formatRange(meeting.starts_at, meeting.ends_at)}` : ' · Horario por confirmar'}
                </p>
                {meeting.modality === 'presencial' && (
                  <p className="mt-1 flex items-center gap-1 text-sm text-gray-500">
                    <MapPin className="h-4 w-4" aria-hidden /> Presencial{meeting.location ? ` · ${meeting.location}` : ''}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${status.className}`}>{status.label}</span>
                {meeting.modality === 'virtual' && meeting.meeting_url && meeting.status !== 'solicitada' && (
                  <a
                    href={meeting.meeting_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                  >
                    <Video className="h-4 w-4" aria-hidden /> Unirse por {platform(meeting.meeting_url)}
                  </a>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      <p className="mt-3 text-xs text-gray-400">Las citas se solicitan y confirman desde la app móvil de Órbita.</p>
    </section>
  )
}
