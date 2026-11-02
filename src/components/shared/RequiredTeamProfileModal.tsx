import { useMemo, useState } from 'react'
import { CalendarDays, LockKeyhole, Phone, UserRound } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import BirthdayDatePicker from './BirthdayDatePicker'

export const REQUIRED_PROFILE_START = new Date(2026, 7, 5, 0, 0, 0)

export function missingRequiredProfileData(fullName: string, metadata: Record<string, any>) {
  const fallback = fullName.trim().split(/\s+/)
  const firstNames = String(metadata.first_names || (fallback.length > 1 ? fallback.slice(0, -1).join(' ') : '')).trim()
  const lastNames = String(metadata.last_names || (fallback.length > 1 ? fallback.at(-1) : '')).trim()
  const phone = String(metadata.phone || '').replace(/[\s()-]/g, '')
  return !firstNames || !lastNames || !/^\+52\d{10}$/.test(phone) || !metadata.birth_date
}

export default function RequiredTeamProfileModal({ onComplete }: { onComplete: () => void }) {
  const { user, session, refreshUser } = useAuth()
  const metadata = session?.user?.user_metadata || {}
  const initial = useMemo(() => {
    const parts = (user?.full_name || '').trim().split(/\s+/)
    return {
      firstNames: String(metadata.first_names || (parts.length > 1 ? parts.slice(0, -1).join(' ') : '')),
      lastNames: String(metadata.last_names || (parts.length > 1 ? parts.at(-1) : '')),
      phone: String(metadata.phone || '').replace(/^\+52/, '').replace(/\D/g, '').slice(0, 10),
      birthDate: String(metadata.birth_date || ''),
    }
  }, [user?.id])
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    const firstNames = form.firstNames.trim().replace(/\s+/g, ' ')
    const lastNames = form.lastNames.trim().replace(/\s+/g, ' ')
    const phoneDigits = form.phone.replace(/\D/g, '')
    if (firstNames.length < 2 || lastNames.length < 2) return setError('Escribe tus nombres y apellidos completos.')
    if (phoneDigits.length !== 10) return setError('El teléfono debe tener 10 dígitos después de +52.')
    if (!form.birthDate) return setError('La fecha de nacimiento es obligatoria.')
    if (new Date(`${form.birthDate}T00:00:00`) >= new Date()) return setError('Revisa la fecha de nacimiento.')
    if (!user) return
    setSaving(true); setError('')
    const fullName = `${firstNames} ${lastNames}`
    const { error: userError } = await supabase.from('users').update({ full_name: fullName }).eq('id', user.id)
    const { error: authError } = await supabase.auth.updateUser({ data: { ...metadata, first_names: firstNames, last_names: lastNames, phone: `+52${phoneDigits}`, birth_date: form.birthDate } })
    if (userError || authError) setError(userError?.message || authError?.message || 'No fue posible guardar tus datos.')
    else { await refreshUser(); onComplete() }
    setSaving(false)
  }

  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md">
    <section className="w-full max-w-2xl overflow-hidden rounded-3xl border border-white/10 bg-white shadow-2xl">
      <header className="bg-gradient-to-r from-blue-700 via-blue-600 to-purple-600 px-6 py-6 text-white sm:px-8"><div className="flex items-start gap-4"><span className="rounded-2xl bg-white/15 p-3"><LockKeyhole size={28} /></span><div><p className="text-xs font-bold uppercase tracking-widest text-blue-100">Actualización obligatoria</p><h2 className="mt-1 text-2xl font-bold">Completa tus datos para continuar</h2><p className="mt-2 text-sm text-blue-100">Esta información permite identificar tu cuenta y celebrar tu cumpleaños con el equipo.</p></div></div></header>
      <div className="p-6 sm:p-8"><div className="grid gap-4 sm:grid-cols-2">
        <RequiredField label="Nombres" icon={<UserRound size={15} />}><input autoFocus value={form.firstNames} onChange={e => setForm({ ...form, firstNames: e.target.value })} placeholder="Ej. Leslie Nayeli" /></RequiredField>
        <RequiredField label="Apellidos" icon={<UserRound size={15} />}><input value={form.lastNames} onChange={e => setForm({ ...form, lastNames: e.target.value })} placeholder="Ej. Hernández López" /></RequiredField>
        <RequiredField label="Teléfono celular" icon={<Phone size={15} />}><div className="flex"><span className="flex items-center rounded-l-xl border border-r-0 border-slate-300 bg-slate-50 px-3 text-sm font-bold text-slate-700">🇲🇽 +52</span><input inputMode="numeric" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} placeholder="10 dígitos" className="rounded-l-none!" /></div></RequiredField>
        <RequiredField label="Fecha de nacimiento" icon={<CalendarDays size={15} />}><BirthdayDatePicker required value={form.birthDate} onChange={birthDate => setForm({ ...form, birthDate })} /></RequiredField>
      </div><p className="mt-4 text-xs text-slate-500">El prefijo +52 corresponde a México. Tu fecha completa es privada; al equipo solamente se le mostrará que es tu cumpleaños.</p>{error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">{error}</p>}<button onClick={save} disabled={saving} className="mt-6 w-full rounded-xl bg-blue-600 px-5 py-3.5 font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 disabled:opacity-60">{saving ? 'Guardando datos...' : 'Guardar y entrar a mis tareas'}</button></div>
    </section>
  </div>
}

function RequiredField({ label, icon, children }: { label: string; icon: React.ReactNode; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700">{icon}{label} *</span><span className="block [&_input]:h-11 [&_input]:w-full [&_input]:rounded-xl [&_input]:border [&_input]:border-slate-300 [&_input]:px-3 [&_input]:text-sm [&_input]:outline-none [&_input:focus]:border-blue-500 [&_input:focus]:ring-2 [&_input:focus]:ring-blue-100">{children}</span></label> }
