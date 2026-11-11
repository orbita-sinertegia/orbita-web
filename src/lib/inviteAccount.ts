import { supabase } from './supabase'

export const EXISTING_ACCOUNT_MESSAGE =
  'Este correo ya tiene una cuenta en Órbita. Escribe la contraseña que ya usas para aceptar la invitación. Si no la recuerdas, pídele a tu administrador que la cambie.'

/**
 * Crea la cuenta de la invitación o, si el correo ya tiene cuenta (por ejemplo, una persona que
 * ya era cliente y recibe una invitación nueva), entra con su contraseña para poder aceptarla.
 */
export async function createOrSignIn(email: string, password: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (!error && data.user) return { ok: true }
  if (error?.message === 'User already registered') {
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (!signInError) return { ok: true }
    return { ok: false, message: EXISTING_ACCOUNT_MESSAGE }
  }
  return { ok: false, message: 'No se pudo crear la cuenta. Intenta de nuevo.' }
}
