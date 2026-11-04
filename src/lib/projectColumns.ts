// Las columnas projects.stage y projects.funnel_type se crean con
// sql/2026-11-02_etapa_proyecto.sql. Hasta que ese SQL se corra, la app no debe
// leerlas ni escribirlas explícitamente (PostgREST fallaría), así que se detectan.
import { supabase } from './supabase'

let cached: Promise<boolean> | null = null

/** true si la base ya tiene projects.stage y projects.funnel_type (se consulta una vez por sesión). */
export function projectStageColumnsExist(): Promise<boolean> {
  if (!cached) {
    cached = Promise.resolve(supabase.from('projects').select('id, stage, funnel_type').limit(1))
      .then(({ error }) => !error)
      .catch(() => false)
    // Si falló por red, se vuelve a intentar la próxima vez.
    cached.then(ok => { if (!ok) cached = null })
  }
  return cached
}

