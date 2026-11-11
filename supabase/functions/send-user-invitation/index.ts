import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import nodemailer from 'npm:nodemailer@6.9.16'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EMAIL_PATTERN = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/

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
    const gmailUser = Deno.env.get('GMAIL_USER')
    const gmailPassword = (Deno.env.get('GMAIL_APP_PASSWORD') || '').replace(/\s/g, '')
    const admin = createClient(supabaseUrl, serviceKey)
    const token = authorization.replace('Bearer ', '')
    const { data: authData } = await admin.auth.getUser(token)
    if (!authData.user) throw new Error('Sesión no válida')

    const { data: caller } = await admin.from('users').select('role, is_super_admin, active').eq('id', authData.user.id).single()
    const canInvite = !!caller && caller.active !== false && (caller.is_super_admin || caller.role === 'admin')
    if (!canInvite) return new Response(JSON.stringify({ error: 'Solo un administrador puede invitar usuarios' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } })
    if (!gmailUser || !gmailPassword) throw new Error('Falta configurar GMAIL_USER o GMAIL_APP_PASSWORD en Supabase Edge Functions')

    const { email, fullName, roleLabel, inviteUrl } = await request.json()
    const recipient = String(email || '').trim()
    if (!EMAIL_PATTERN.test(recipient)) throw new Error('Correo no válido')
    const safeName = escapeHtml(String(fullName || 'te invitamos'))
    const safeRole = escapeHtml(String(roleLabel || 'usuario'))
    const url = new URL(String(inviteUrl))
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('Enlace de invitación no válido')
    const safeUrl = escapeHtml(url.toString())

    // Supabase bloquea el puerto 587 en sus funciones; Gmail también acepta el 465.
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: gmailUser, pass: gmailPassword },
    })

    const info = await transporter.sendMail({
      from: { name: 'Órbita', address: gmailUser },
      replyTo: gmailUser,
      to: recipient,
      subject: 'Te damos la bienvenida a Órbita',
      text: `Hola, ${String(fullName || 'te invitamos')}.\n\nTe damos la bienvenida a Órbita. Tu acceso con el perfil ${String(roleLabel || 'usuario')} ya está listo. Crea tu cuenta aquí:\n${url.toString()}\n\nSi no esperabas este correo, puedes ignorarlo.`,
      html: `<div style="font-family:Arial,sans-serif;background:#f4f5fb;padding:32px"><div style="max-width:560px;margin:auto;background:white;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb"><div style="padding:24px 30px;color:white;background:linear-gradient(120deg,#9333EA,#6B21A8,#A855F7)"><b style="font-size:20px">Órbita</b></div><div style="padding:30px"><h2 style="color:#111827">Hola, ${safeName}</h2><p style="color:#667085;line-height:1.6">Te damos la bienvenida a Órbita. Tu acceso con el perfil <b>${safeRole}</b> ya está listo: crea tu cuenta con este botón.</p><a href="${safeUrl}" style="display:inline-block;margin-top:16px;background:#9333EA;color:white;text-decoration:none;padding:12px 20px;border-radius:9px;font-weight:bold">Crear mi cuenta</a><p style="margin-top:24px;color:#98a2b3;font-size:12px">Si no esperabas este correo, puedes ignorarlo.</p></div></div></div>`,
    })

    // Registro sin datos personales: cuántos destinos aceptó o rechazó Gmail.
    console.log('send-user-invitation: aceptados', info.accepted?.length ?? 0, 'rechazados', info.rejected?.length ?? 0, 'respuesta', String(info.response || '').slice(0, 60))
    if (info.rejected?.length) throw new Error('Gmail rechazó el correo de destino')
    return new Response(JSON.stringify({ success: true }), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (error) {
    console.error('send-user-invitation:', error instanceof Error ? error.message : error)
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'No se pudo enviar la invitación' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
