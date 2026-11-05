export const NO_INVITATION_MESSAGE = 'Esta cuenta no tiene una invitación. Pídele a tu administrador un enlace de invitación y regístrate desde ahí.'

/** Supabase responde "Database error saving new user" cuando el registro rechaza un correo sin invitación. */
export function isNoInvitationError(message: string) {
  return /database error|invitaci/i.test(message)
}
