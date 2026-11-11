// Envía un aviso de Órbita como notificación push (Firebase Cloud Messaging, API HTTP v1).
// La llama la base (trigger "enviar_push") con { notification_id }. Se publica sin verificar JWT:
// no recibe datos de quien la llama, solo el id; el aviso se lee con la clave de servicio y
// se marca como enviado, así que llamarla de nuevo no manda nada dos veces.
//
// Secretos: FCM_SERVICE_ACCOUNT (el JSON de la cuenta de servicio de Firebase).
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya existen en las funciones.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface CuentaServicio {
  project_id: string
  client_email: string
  private_key: string
  token_uri?: string
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function base64url(data: ArrayBuffer | Uint8Array | string) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

let tokenGoogle: { valor: string; vence: number } | null = null

/** Token de acceso de Google para FCM, firmado con la llave de la cuenta de servicio (RS256). */
async function accesoGoogle(cuenta: CuentaServicio): Promise<string> {
  const ahora = Math.floor(Date.now() / 1000)
  if (tokenGoogle && tokenGoogle.vence - 60 > ahora) return tokenGoogle.valor

  const aud = cuenta.token_uri || 'https://oauth2.googleapis.com/token'
  const encabezado = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const datos = base64url(JSON.stringify({
    iss: cuenta.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud,
    iat: ahora,
    exp: ahora + 3600,
  }))
  const pem = cuenta.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0))
  const llave = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', llave, new TextEncoder().encode(`${encabezado}.${datos}`))
  const jwt = `${encabezado}.${datos}.${base64url(firma)}`

  const r = await fetch(aud, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  if (!r.ok) throw new Error(`Google rechazó la cuenta de servicio (${r.status})`)
  const { access_token, expires_in } = await r.json()
  tokenGoogle = { valor: access_token, vence: ahora + Number(expires_in || 3600) }
  return access_token
}

function enlaceMaps(direccion: string | null, lat: number | null, lng: number | null) {
  if (lat !== null && lng !== null) return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
  if (direccion) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(direccion)}`
  return ''
}

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Método no permitido' }, 405)
  try {
    const { notification_id } = await request.json()
    if (typeof notification_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(notification_id)) {
      return json({ error: 'Aviso no válido' }, 400)
    }
    const crudo = Deno.env.get('FCM_SERVICE_ACCOUNT')
    if (!crudo) throw new Error('Falta el secreto FCM_SERVICE_ACCOUNT')
    const cuenta = JSON.parse(crudo) as CuentaServicio

    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Se "aparta" el aviso: solo uno lo envía, solo una vez, y solo si es reciente.
    const hace10 = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const { data: aviso } = await db.from('notifications')
      .update({ pushed_at: new Date().toISOString() })
      .eq('id', notification_id).is('pushed_at', null).gte('created_at', hace10)
      .select('id, user_id, title, message, type, appointment_id, created_at')
      .maybeSingle()
    if (!aviso) return json({ enviado: false, motivo: 'ya enviado, viejo o inexistente' })

    const { data: telefonos } = await db.from('device_tokens').select('token').eq('user_id', aviso.user_id)
    if (!telefonos?.length) return json({ enviado: false, motivo: 'sin teléfonos' })

    // Datos para los botones de la notificación (Aceptar, Unirse, Cómo llegar).
    let meetingUrl = ''
    let mapsUrl = ''
    let puedeAceptar = false
    if (aviso.appointment_id) {
      const { data: cita } = await db.from('appointments')
        .select('status, modality, meeting_url, address, latitude, longitude, participants:appointment_participants(user_id, response)')
        .eq('id', aviso.appointment_id).maybeSingle()
      if (cita) {
        if (cita.modality === 'virtual' && cita.meeting_url) meetingUrl = cita.meeting_url
        if (cita.modality === 'presencial') mapsUrl = enlaceMaps(cita.address, cita.latitude, cita.longitude)
        const mio = (cita.participants || []).find((p: { user_id: string }) => p.user_id === aviso.user_id)
        puedeAceptar = cita.status === 'programada' && !!mio && mio.response !== 'aceptada'
      }
    }

    const acceso = await accesoGoogle(cuenta)
    let enviados = 0
    for (const { token } of telefonos) {
      // Mensaje solo de datos y prioridad alta: la app arma la notificación con sus botones.
      const r = await fetch(`https://fcm.googleapis.com/v1/projects/${cuenta.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${acceso}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            android: { priority: 'HIGH', ttl: '86400s' },
            data: {
              id: aviso.id,
              title: aviso.title || '',
              message: aviso.message || '',
              type: aviso.type || '',
              appointment_id: aviso.appointment_id || '',
              created_at: aviso.created_at,
              puede_aceptar: puedeAceptar ? '1' : '0',
              meeting_url: meetingUrl,
              maps_url: mapsUrl,
            },
          },
        }),
      })
      if (r.ok) enviados++
      else {
        const detalle = await r.text()
        // Teléfono que ya no existe (app desinstalada o token viejo): se borra.
        if (r.status === 404 || detalle.includes('UNREGISTERED') || detalle.includes('INVALID_ARGUMENT')) {
          await db.from('device_tokens').delete().eq('token', token)
        } else {
          console.error('enviar-push FCM', r.status, detalle.slice(0, 300))
        }
      }
    }
    return json({ enviado: enviados > 0, enviados })
  } catch (error) {
    console.error('enviar-push:', error instanceof Error ? error.message : error)
    return json({ error: 'No se pudo enviar' }, 500)
  }
})
