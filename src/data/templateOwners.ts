/**
 * Responsable por defecto de cada departamento / grupo al crear un proyecto desde una
 * plantilla de embudo ("Nuevo proyecto" → paso 2). EDITAR AQUÍ, en un solo lugar.
 *
 * - Llave: el grupo de la plantilla (mismo que se ve en el paso 2): lider, webmaster, copy,
 *   diseno_web, diseno_ads, edicion_video, edicion_presentacion, trafficker, grabacion.
 *   Si un grupo no está, se usa su departamento (p. ej. 'diseno' cubre diseno_web y diseno_ads).
 * - Valor: el CORREO de la persona (como aparece en Permisos). Debe ser un usuario activo del
 *   equipo (o quien crea el proyecto); si no se encuentra, se ignora.
 * - "cliente" no se configura: sus tareas siempre son del usuario cliente del proyecto.
 *
 * Si un grupo queda sin responsable, se mantiene el comportamiento de siempre: el selector
 * del paso 2 queda vacío y, al crear, la tarea queda a nombre de quien crea el proyecto
 * (para "lider" se sugiere a quien crea el proyecto).
 *
 * Ejemplo:
 *   lider: 'lider@tu-dominio.com',
 *   diseno: 'disenador@tu-dominio.com',
 *   edicion_video: 'editor@tu-dominio.com',
 */
export const DEFAULT_TEMPLATE_OWNERS: Record<string, string> = {
  // Sin responsables por defecto: vacío a propósito.
}

const GROUP_DEPARTMENT: Record<string, string> = {
  diseno_web: 'diseno',
  diseno_ads: 'diseno',
  edicion_video: 'edicion',
  edicion_presentacion: 'edicion',
}

type Member = { id: string; email?: string | null; active?: boolean | null; role?: string | null }

/**
 * Responsables por grupo (grupo → id de usuario) a partir de la configuración y las personas
 * disponibles. Solo devuelve los que se encontraron; nunca asigna tareas del cliente.
 */
export function resolveTemplateOwners(
  groups: string[],
  members: Member[],
  config: Record<string, string> = DEFAULT_TEMPLATE_OWNERS,
): Record<string, string> {
  const byEmail = new Map<string, string>()
  for (const member of members) {
    if (!member?.email || member.active === false || member.role === 'client') continue
    byEmail.set(member.email.trim().toLowerCase(), member.id)
  }
  const result: Record<string, string> = {}
  for (const group of groups) {
    if (group === 'cliente') continue
    const email = config[group] || config[GROUP_DEPARTMENT[group] || '']
    const id = email ? byEmail.get(email.trim().toLowerCase()) : undefined
    if (id) result[group] = id
  }
  return result
}
