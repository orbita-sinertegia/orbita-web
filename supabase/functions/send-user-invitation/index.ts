import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function escapeHtml(value: string) {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }
  return value.replace(/[&<>'"]/g, character => entities[character])
}

serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const authorization = request.headers.get('Authorization') || ''
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const admin = createClient(supabaseUrl, serviceKey)
    const token = authorization.replace('Bearer ', '')
    const { data: authData } = await admin.auth.getUser(token)
    if (!authData.user) throw new Error('Sesión no válida')

    const { data: caller } = await admin.from('users').select('is_super_admin').eq('id', authData.user.id).single()
    if (!caller?.is_super_admin) return new Response(JSON.stringify({ error: 'Solo el superadmin puede invitar usuarios' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } })
    if (!resendKey) throw new Error('Falta configurar RESEND_API_KEY en Supabase Edge Functions')

    const { email, fullName, roleLabel, inviteUrl } = await request.json()
    const safeName = escapeHtml(String(fullName || 'te invitamos'))
    const safeRole = escapeHtml(String(roleLabel || 'usuario'))
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Sinertegia Launch 57 <notificaciones@sinertegia.com>',
        to: [email],
        subject: `Invitación para unirte como ${roleLabel} en Sinertegia`,
        html: `<div style="font-family:Arial,sans-serif;background:#f4f5fb;padding:32px"><div style="max-width:560px;margin:auto;background:white;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb"><div style="padding:24px 30px;color:white;background:linear-gradient(120deg,#2456df,#643dbb,#e32636)"><b style="font-size:20px">Sinertegia Launch 57</b></div><div style="padding:30px"><h2 style="color:#111827">Hola, ${safeName}</h2><p style="color:#667085;line-height:1.6">Recibiste una invitación para formar parte de Sinertegia con el perfil <b>${safeRole}</b>.</p><a href="${inviteUrl}" style="display:inline-block;margin-top:16px;background:#2456df;color:white;text-decoration:none;padding:12px 20px;border-radius:9px;font-weight:bold">Aceptar invitación</a><p style="margin-top:24px;color:#98a2b3;font-size:12px">Si no esperabas esta invitación, puedes ignorar este correo.</p></div></div></div>`,
      }),
    })
    if (!response.ok) throw new Error(await response.text())
    return new Response(JSON.stringify({ success: true }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'No se pudo enviar la invitación' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
