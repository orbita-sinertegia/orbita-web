import { supabase } from './supabase'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Pide el correo de la persona invitada: la invitación solo será válida para ese correo. */
export function askInviteEmail(clientName?: string): string | null {
  const label = clientName ? ` de ${clientName}` : ''
  const answer = window.prompt(`Escribe el correo${label}. La invitación solo funcionará con ese correo.`)
  if (answer === null) return null
  const email = answer.trim()
  if (!EMAIL_PATTERN.test(email)) {
    window.alert('Ese correo no parece válido. Revísalo e intenta de nuevo.')
    return null
  }
  return email
}

/** Manda el correo de bienvenida con el enlace. Devuelve false si no se pudo; el enlace sigue sirviendo. */
export async function sendWelcomeEmail(params: { email: string; fullName: string; roleLabel: string; inviteUrl: string }): Promise<boolean> {
  const { error } = await supabase.functions.invoke('send-user-invitation', { body: params })
  return !error
}
