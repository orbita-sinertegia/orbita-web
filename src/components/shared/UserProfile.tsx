import { useEffect, useState } from 'react'
import { Activity, BarChart3, BriefcaseBusiness, CalendarDays, Camera, Check, CheckCircle2, Clock3, KeyRound, MailCheck, Monitor, Moon, RotateCcw, Save, ShieldCheck, Sun, UserRound, X } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useWorkSession } from '../../contexts/WorkSessionContext'
import { supabase } from '../../lib/supabase'
import UserAvatar from './UserAvatar'
import { applyAppearance, readAppearance, saveAppearance, type AppearanceTheme, type TextSize } from '../../lib/appearance'
import BirthdayDatePicker from './BirthdayDatePicker'
import { formatHour, resolvedWorkSchedule, scheduleForDate, WEEK_DAYS } from '../../lib/workSchedule'

interface AttendanceWeekRow {
  date: string
  entrada: string | null
  estado: 'a_tiempo' | 'retardo' | 'sin_registro' | 'pendiente' | 'descanso' | 'dia_extra'
  minutos_regulares: number
  minutos_extra: number
}

const ATTENDANCE_ESTADO_LABELS: Record<string, { label: string; className: string }> = {
  a_tiempo: { label: 'A tiempo', className: 'text-green-600' },
  retardo: { label: 'Retardo', className: 'text-orange-600' },
  sin_registro: { label: 'Sin registro', className: 'text-red-600' },
  pendiente: { label: 'Pendiente', className: 'text-slate-400' },
  descanso: { label: 'Descanso', className: 'text-slate-400' },
  dia_extra: { label: 'Día extra', className: 'text-blue-600' },
}

function MyAttendanceCard({ userId }: { userId: string }) {
  const [rows, setRows] = useState<AttendanceWeekRow[]>([])

  useEffect(() => {
    if (!userId) return
    const now = new Date()
    const diff = now.getDay() === 0 ? -6 : 1 - now.getDay()
    const monday = new Date(now); monday.setDate(now.getDate() + diff)
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
    const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    supabase.rpc('asistencia_rango', { p_from: key(monday), p_to: key(sunday), p_tolerancia: 5 })
      .then(({ data }) => setRows(((data || []) as (AttendanceWeekRow & { user_id: string })[]).filter(r => r.user_id === userId)))
  }, [userId])

  return <Card className="lg:col-span-2">
    <h3 className="flex items-center gap-2 font-bold"><CalendarDays size={18} />Mi asistencia esta semana</h3>
    <div className="mt-4 space-y-2">
      {rows.length === 0 && <p className="text-sm text-slate-400">Sin datos esta semana.</p>}
      {rows.map(r => {
        const estado = ATTENDANCE_ESTADO_LABELS[r.estado] || { label: r.estado, className: 'text-slate-400' }
        return (
          <div key={r.date} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <span className="font-semibold text-slate-700 capitalize">{new Date(`${r.date}T12:00:00`).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric' })}</span>
            <span className="text-slate-500">{r.entrada ? new Date(r.entrada).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Mexico_City' }) : '—'}</span>
            <span className={`font-semibold ${estado.className}`}>{estado.label}</span>
            <span className="text-slate-500">{(((r.minutos_regulares || 0) + (r.minutos_extra || 0)) / 60).toFixed(1)}h</span>
          </div>
        )
      })}
    </div>
  </Card>
}

interface Props { onClose?: () => void; onChangePhoto: () => void; onChangePassword: () => void; embedded?: boolean }
type Tab = 'datos' | 'laboral' | 'seguridad' | 'preferencias'
const DEPTS: Record<string, string> = { edicion: 'Edición', grabacion: 'Grabación', diseno: 'Diseño', copy: 'Copy', webmaster: 'Webmaster', trafficker: 'Trafficker', lider: 'Líder', cliente: 'Cliente' }

export default function UserProfile({ onClose, onChangePhoto, onChangePassword, embedded = false }: Props) {
  const { user, session, refreshUser } = useAuth()
  const { currentSession, elapsedMinutes } = useWorkSession()
  const isClient = user?.role === 'client'
  const metadata = session?.user?.user_metadata || {}
  const nameParts = (user?.full_name || '').trim().split(/\s+/)
  const [tab, setTab] = useState<Tab>('datos')
  const initialAppearance = readAppearance()
  const [form, setForm] = useState({ first_names: metadata.first_names || (nameParts.length > 1 ? nameParts.slice(0, -1).join(' ') : ''), last_names: metadata.last_names || (nameParts.length > 1 ? nameParts.at(-1) : ''), phone: metadata.phone || '+52', birth_date: metadata.birth_date || '', timezone: metadata.timezone || 'America/Mexico_City', address: metadata.address || '', compact_mode: initialAppearance.compact || Boolean(metadata.compact_mode), theme: initialAppearance.theme, text_size: initialAppearance.textSize })
  const [stats, setStats] = useState({ completed: 0, review: 0, onTime: 0 })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!user) return
    void supabase.auth.mfa.listFactors().then(({ data }) => Promise.all((data?.totp || []).filter(item => item.status !== 'verified').map(item => supabase.auth.mfa.unenroll({ factorId: item.id }))))
    supabase.from('tasks').select('status, review_status, commitment_date, completion_date').eq('assigned_to', user.id).is('archived_at', null).then(({ data }) => {
      const rows = data || []; const completed = rows.filter(t => t.status === 'completada')
      const onTime = completed.length ? Math.round(completed.filter(t => !t.commitment_date || (t.completion_date && t.completion_date <= t.commitment_date)).length / completed.length * 100) : 0
      setStats({ completed: completed.length, review: rows.filter(t => t.review_status === 'pendiente_revision' || t.review_status === 'en_revision').length, onTime })
    })
  }, [user])

  async function saveProfile() {
    if (!user || form.first_names.trim().length < 2 || form.last_names.trim().length < 2) return
    setSaving(true); setMessage('')
    const fullName = `${form.first_names.trim()} ${form.last_names.trim()}`
    const { error: userError } = await supabase.from('users').update({ full_name: fullName }).eq('id', user.id)
    const { error: authError } = await supabase.auth.updateUser({ data: { first_names: form.first_names.trim(), last_names: form.last_names.trim(), phone: form.phone.trim(), birth_date: form.birth_date || null, timezone: form.timezone, address: form.address.trim(), compact_mode: form.compact_mode } })
    saveAppearance({ theme: form.theme, compact: form.compact_mode, textSize: form.text_size })
    if (userError || authError) setMessage(userError?.message || authError?.message || 'No se pudieron guardar los cambios.')
    else { await refreshUser(); setMessage('Cambios guardados correctamente.') }
    setSaving(false)
  }

  const todaySchedule = user ? scheduleForDate(user) : { enabled: true, start: 9, end: 18 }
  const start = todaySchedule.start, end = todaySchedule.end
  const hours = Math.floor(elapsedMinutes / 60), minutes = elapsedMinutes % 60
  const progress = todaySchedule.enabled ? Math.min(100, elapsedMinutes / Math.max(60, (end - start) * 60) * 100) : 100
  const lastSignIn = session?.user?.last_sign_in_at ? new Date(session.user.last_sign_in_at).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : 'Sin registro'

  return <div className={embedded ? 'w-full' : 'fixed inset-0 z-[60] overflow-y-auto bg-[#f5f6fb]'}>
    {!embedded && <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3 shadow-sm"><div><h1 className="text-xl font-bold text-slate-900">Mi perfil</h1><p className="text-xs text-slate-500">{isClient ? 'Administra tu información personal y la seguridad de tu cuenta' : 'Administra tu información personal y laboral'}</p></div><button onClick={onClose} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"><X size={20} /></button></header>}
    <main className={`mx-auto max-w-[1380px] space-y-5 ${embedded ? '' : 'p-4 sm:p-6'}`}>
      {embedded && <div className="mb-1"><h1 className="text-2xl font-bold text-slate-900">Mi perfil</h1><p className="mt-1 text-sm text-slate-500">{isClient ? 'Administra tu información personal y la seguridad de tu cuenta' : 'Administra tu información personal y laboral'}</p></div>}
      <div className={`grid gap-5 ${isClient ? '' : 'lg:grid-cols-[1.12fr_1fr]'}`}>
        <Card className="flex flex-wrap items-center gap-6"><UserAvatar name={user?.full_name || 'Usuario'} avatarUrl={user?.avatar_url} size={112} isOnline={!isClient && Boolean(currentSession)} /><div className="min-w-0 flex-1"><h2 className="truncate text-2xl font-bold text-slate-900">{user?.full_name}</h2><p className="mt-1 flex items-center gap-2 text-sm capitalize text-slate-500"><UserRound size={15} />{isClient ? 'Cliente' : user?.role}</p>{!isClient && <p className="mt-3 flex items-center gap-2 text-sm text-slate-600"><BriefcaseBusiness size={15} />Departamento: {DEPTS[user?.department || ''] || 'Sin asignar'}</p>}{!isClient && currentSession && <span className="mt-3 inline-flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-1 text-xs font-semibold text-green-700"><i className="h-2 w-2 animate-pulse rounded-full bg-green-500" />En sesión</span>}</div><button onClick={onChangePhoto} className="flex items-center gap-2 rounded-xl border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"><Camera size={16} />Cambiar foto</button></Card>
        {!isClient && <Card><h3 className="flex items-center gap-2 font-bold text-slate-900"><CalendarDays size={18} />Jornada de hoy</h3>{todaySchedule.enabled ? <><div className="mt-6 grid grid-cols-3 divide-x divide-slate-200 text-center"><Small label="Entrada" value={formatHour(start)} /><Small label="Salida" value={formatHour(end)} /><Small label="Tiempo trabajado" value={`${hours} h ${minutes} min`} green /></div><div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-green-500" style={{ width: `${progress}%` }} /></div><div className="mt-1 flex justify-between text-[10px] text-slate-400"><span>0 h</span><span>{end - start} h</span></div></> : <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-5 text-center text-sm font-semibold text-slate-500">Hoy no tienes jornada laboral asignada.</div>}</Card>}
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b border-slate-200">{([{ key: 'datos', label: 'Datos personales' }, ...(!isClient ? [{ key: 'laboral' as Tab, label: 'Información laboral' }] : []), { key: 'seguridad', label: 'Seguridad' }, { key: 'preferencias', label: 'Apariencia' }] as { key: Tab; label: string }[]).map(item => <button key={item.key} onClick={() => setTab(item.key)} className={`whitespace-nowrap border-b-2 px-5 py-3 text-sm font-semibold ${tab === item.key ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500'}`}>{item.label}</button>)}</nav>

      {tab === 'datos' && <Card><h3 className="flex items-center gap-2 font-bold text-slate-900"><UserRound size={18} />Datos personales</h3><div className="grid gap-x-4 sm:grid-cols-2"><Field label="Nombres *"><input value={form.first_names} onChange={e => setForm({ ...form, first_names: e.target.value })} /></Field><Field label="Apellidos *"><input value={form.last_names} onChange={e => setForm({ ...form, last_names: e.target.value })} /></Field><Field label="Correo electrónico"><input value={user?.email || ''} readOnly className="bg-slate-50 text-slate-500" /></Field><Field label="Teléfono (+52) *"><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+52 10 dígitos" /></Field><Field label="Fecha de nacimiento *"><BirthdayDatePicker value={form.birth_date} onChange={birth_date => setForm({ ...form, birth_date })} /></Field><Field label="Zona horaria"><select value={form.timezone} onChange={e => setForm({ ...form, timezone: e.target.value })}><option value="America/Mexico_City">Ciudad de México (GMT-6)</option><option value="America/Cancun">Cancún (GMT-5)</option><option value="America/Tijuana">Tijuana (GMT-8)</option></select></Field><Field label="Dirección"><input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} placeholder="Añadir dirección" /></Field></div><SaveButton saving={saving} onClick={saveProfile} />{message && <p className={`mt-3 text-xs font-semibold ${message.includes('correctamente') ? 'text-green-600' : 'text-red-600'}`}>{message}</p>}</Card>}
      {tab === 'laboral' && <div className="grid gap-5 lg:grid-cols-2"><WorkInfo user={user} /><Card><h3 className="flex items-center gap-2 font-bold"><Clock3 size={18} />Horario asignado</h3><div className="mt-5 grid gap-2 sm:grid-cols-2">{WEEK_DAYS.map(day => { const schedule = resolvedWorkSchedule(user)[day.key]; return <div key={day.key} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm"><span className="font-semibold text-slate-700">{day.label}</span><span className={schedule.enabled ? 'text-slate-600' : 'text-slate-400'}>{schedule.enabled ? `${formatHour(schedule.start)}–${formatHour(schedule.end)}` : 'Descanso'}</span></div> })}</div><p className="mt-3 text-xs text-slate-400">Puesto, departamento y horario solamente pueden modificarlos los administradores.</p></Card>{user && <MyAttendanceCard userId={user.id} />}</div>}
      {tab === 'seguridad' && <div className="grid items-start gap-5 lg:grid-cols-[1.08fr_1fr]"><Card><h3 className="flex items-center gap-2 font-bold"><ShieldCheck size={18} />Seguridad de la cuenta</h3><div className="mt-5 flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold">Contraseña</p><p className="text-xs text-slate-400">Para cambiarla debes confirmar un código enviado por correo.</p></div><button onClick={onChangePassword} className="flex w-full items-center justify-center gap-2 rounded-xl border border-purple-200 px-4 py-2 text-sm font-semibold text-purple-700 sm:w-auto"><KeyRound size={15} />Cambiar contraseña</button></div><div className="mt-3 rounded-xl border border-green-200 bg-green-50/60 p-4"><p className="flex items-center gap-2 text-sm font-semibold text-green-800"><MailCheck size={17} />Confirmación por correo</p><p className="mt-1 text-xs text-green-700">Los códigos de seguridad se enviarán a <strong>{user?.email}</strong>.</p></div><div className="mt-3 rounded-xl border border-slate-200 p-4"><p className="text-sm font-semibold">Último inicio de sesión</p><p className="mt-1 text-xs text-slate-500">{lastSignIn}</p></div></Card><ActivityCard lastSignIn={lastSignIn} /></div>}
      {tab === 'preferencias' && <AppearancePanel theme={form.theme} compact={form.compact_mode} textSize={form.text_size} saving={saving} onChange={(next) => { setForm({ ...form, theme: next.theme, compact_mode: next.compact, text_size: next.textSize }); applyAppearance(next) }} onReset={() => { const next = { theme: 'light' as const, compact: false, textSize: 'normal' as const }; setForm({ ...form, theme: next.theme, compact_mode: next.compact, text_size: next.textSize }); applyAppearance(next) }} onSave={saveProfile} />}

      {tab === 'laboral' && <Card><h3 className="flex items-center gap-2 font-bold"><BarChart3 size={18} />Resumen de desempeño</h3><div className="mt-6 grid grid-cols-1 gap-5 text-center sm:grid-cols-3 sm:divide-x sm:divide-slate-200"><Metric icon={<CheckCircle2 />} value={stats.completed} label="Completadas" tone="text-green-600" /><Metric icon={<Clock3 />} value={stats.review} label="En revisión" tone="text-amber-500" /><Metric icon={<Activity />} value={`${stats.onTime}%`} label="A tiempo" tone="text-blue-600" /></div></Card>}
    </main>
  </div>
}

interface AppearancePanelProps {
  theme: AppearanceTheme
  compact: boolean
  textSize: TextSize
  saving: boolean
  onChange: (value: { theme: AppearanceTheme; compact: boolean; textSize: TextSize }) => void
  onReset: () => void
  onSave: () => void
}

function AppearancePanel({ theme, compact, textSize, saving, onChange, onReset, onSave }: AppearancePanelProps) {
  const value = { theme, compact, textSize }
  return <div className="grid gap-5 lg:grid-cols-[1fr_1.08fr]">
    <Card>
      <h3 className="text-lg font-bold text-slate-900">Apariencia</h3>
      <p className="mt-1 text-sm text-slate-500">Personaliza cómo ves tu espacio de trabajo.</p>

      <OptionTitle number="1" label="Tema" />
      <div className="grid grid-cols-3 gap-3">
        <ThemeChoice label="Claro" icon={<Sun size={16} />} selected={theme === 'light'} preview="light" onClick={() => onChange({ ...value, theme: 'light' })} />
        <ThemeChoice label="Oscuro" icon={<Moon size={16} />} selected={theme === 'dark'} preview="dark" onClick={() => onChange({ ...value, theme: 'dark' })} />
        <ThemeChoice label="Automático" icon={<Monitor size={16} />} selected={theme === 'system'} preview="system" onClick={() => onChange({ ...value, theme: 'system' })} />
      </div>

      <OptionTitle number="2" label="Densidad de información" />
      <div className="grid grid-cols-2 gap-3">
        <DensityChoice label="Cómoda" selected={!compact} compact={false} onClick={() => onChange({ ...value, compact: false })} />
        <DensityChoice label="Compacta" selected={compact} compact onClick={() => onChange({ ...value, compact: true })} />
      </div>

      <OptionTitle number="3" label="Tamaño del texto" />
      <div className="grid max-w-xs grid-cols-2 overflow-hidden rounded-xl border border-slate-200">
        {(['normal', 'large'] as TextSize[]).map(size => <button key={size} type="button" onClick={() => onChange({ ...value, textSize: size })} className={`px-4 py-2.5 text-sm font-semibold transition ${textSize === size ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{size === 'normal' ? 'Normal' : 'Grande'}</button>)}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
        <p className="text-xs text-slate-500">Los cambios se aplican en todo tu panel.</p>
        <div className="flex gap-2"><button type="button" onClick={onReset} className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"><RotateCcw size={15} />Restablecer</button><button type="button" onClick={onSave} disabled={saving} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"><Save size={15} />{saving ? 'Guardando...' : 'Guardar cambios'}</button></div>
      </div>
    </Card>
    <AppearancePreview compact={compact} textSize={textSize} />
  </div>
}

function OptionTitle({ number, label }: { number: string; label: string }) { return <h4 className="mb-2 mt-5 text-sm font-bold text-slate-800">{number}. {label}</h4> }

function ThemeChoice({ label, icon, selected, preview, onClick }: { label: string; icon: React.ReactNode; selected: boolean; preview: 'light' | 'dark' | 'system'; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`relative rounded-xl border-2 p-2 text-left transition ${selected ? 'border-blue-600 bg-blue-50/50' : 'border-slate-200 hover:border-blue-300'}`}>
    {selected && <span className="absolute right-1.5 top-1.5 z-10 rounded-full bg-blue-600 p-0.5 text-white"><Check size={11} /></span>}
    <div className={`mb-2 flex h-14 overflow-hidden rounded-lg border border-slate-200 ${preview === 'dark' ? 'bg-slate-800' : preview === 'system' ? 'bg-gradient-to-r from-white to-slate-800' : 'bg-white'}`}><span className="w-3 bg-blue-600" /><span className="flex-1 space-y-1.5 p-3"><i className={`block h-1.5 w-2/3 rounded ${preview === 'dark' ? 'bg-slate-500' : 'bg-slate-200'}`} /><i className={`block h-1.5 w-1/2 rounded ${preview === 'dark' ? 'bg-slate-600' : 'bg-slate-100'}`} /></span></div>
    <span className="flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-700">{icon}{label}</span>
  </button>
}

function DensityChoice({ label, selected, compact, onClick }: { label: string; selected: boolean; compact: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`relative rounded-xl border-2 p-3 text-left transition ${selected ? 'border-blue-600 bg-blue-50/50' : 'border-slate-200 hover:border-blue-300'}`}>{selected && <span className="absolute right-2 top-2 rounded-full bg-blue-600 p-0.5 text-white"><Check size={11} /></span>}<span className="text-xs font-semibold text-slate-700">{label}</span><div className={compact ? 'mt-3 space-y-1' : 'mt-3 space-y-2'}>{[1, 2, 3].map(row => <div key={row} className={`flex items-center gap-2 rounded bg-slate-50 px-2 ${compact ? 'py-0.5' : 'py-1.5'}`}><i className="h-2 w-2 rounded-full bg-blue-300" /><i className="h-1.5 w-1/2 rounded bg-slate-200" /><i className="ml-auto h-1.5 w-1/5 rounded bg-slate-200" /></div>)}</div></button>
}

function AppearancePreview({ compact, textSize }: { compact: boolean; textSize: TextSize }) {
  return <Card><div className="flex items-center justify-between"><div><h3 className="text-lg font-bold text-slate-900">Vista previa</h3><p className="mt-1 text-xs text-slate-500">Así se verán tarjetas, tablas y textos.</p></div><span className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">En vivo</span></div><div className="mt-5 overflow-hidden rounded-xl border border-slate-200"><div className="flex items-center justify-between border-b border-slate-200 p-4"><p className={`${textSize === 'large' ? 'text-lg' : 'text-base'} font-bold text-slate-900`}>Mis tareas</p><button className="text-xs font-semibold text-blue-600">Ver todas</button></div><div className="flex gap-2 border-b border-slate-100 px-4 py-3"><span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white">Todas</span><span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">Pendientes</span><span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">En progreso</span></div>{[['Revisión de propuesta', 'Pendiente', 'Media'], ['Diseño de campaña', 'En progreso', 'Alta'], ['Pruebas de integración', 'Completada', 'Baja']].map((task, index) => <div key={task[0]} className={`grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-slate-100 px-4 ${compact ? 'py-2' : 'py-4'} last:border-0`}><div><p className={`${textSize === 'large' ? 'text-base' : 'text-sm'} font-semibold text-slate-800`}>{task[0]}</p><p className="mt-0.5 text-xs text-slate-400">Proyecto Sinertegia</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${index === 0 ? 'bg-slate-100 text-slate-600' : index === 1 ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'}`}>{task[1]}</span><span className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-600">{task[2]}</span></div>)}</div></Card>
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) { return <section className={`rounded-2xl border border-slate-200 bg-white p-6 shadow-sm ${className}`}>{children}</section> }
function ActivityCard({ lastSignIn }: { lastSignIn: string }) { return <Card><h3 className="flex items-center gap-2 font-bold"><Activity size={18} />Actividad reciente</h3><div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-semibold text-slate-800">Último inicio de sesión</p><p className="mt-1 text-xs text-slate-500">{lastSignIn}</p></div><p className="mt-4 text-xs leading-relaxed text-slate-400">Aquí aparecerán los cambios importantes realizados en tu cuenta.</p></Card> }
function Small({ label, value, green }: { label: string; value: string; green?: boolean }) { return <div><p className="text-xs text-slate-400">{label}</p><p className={`mt-1 font-bold ${green ? 'text-green-600' : 'text-slate-800'}`}>{value}</p></div> }
function Field({ label, children }: { label: string; children: React.ReactElement }) { return <label className="mt-4 block text-xs font-semibold text-slate-600">{label}<span className="mt-1 block [&>input]:w-full [&>input]:rounded-lg [&>input]:border [&>input]:border-slate-300 [&>input]:px-3 [&>input]:py-2.5 [&>input]:text-sm [&>select]:w-full [&>select]:rounded-lg [&>select]:border [&>select]:border-slate-300 [&>select]:bg-white [&>select]:px-3 [&>select]:py-2.5 [&>select]:text-sm">{children}</span></label> }
function SaveButton({ saving, onClick }: { saving: boolean; onClick: () => void }) { return <button onClick={onClick} disabled={saving} className="mt-5 flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"><Save size={16} />{saving ? 'Guardando...' : 'Guardar cambios'}</button> }
function Metric({ icon, value, label, tone }: { icon: React.ReactNode; value: string | number; label: string; tone: string }) { return <div className="px-3"><span className={`mx-auto flex w-fit ${tone}`}>{icon}</span><p className="mt-1 text-2xl font-bold">{value}</p><p className="text-xs text-slate-500">{label}</p></div> }
function WorkInfo({ user }: { user: ReturnType<typeof useAuth>['user'] }) { const activeDays = WEEK_DAYS.filter(day => resolvedWorkSchedule(user)[day.key].enabled).map(day => day.short).join(', '); return <Card><h3 className="flex items-center gap-2 font-bold"><BriefcaseBusiness size={18} />Información laboral</h3><dl className="mt-5 divide-y divide-slate-200 text-sm"><Row label="Puesto" value={DEPTS[user?.department || ''] || user?.role || 'Sin asignar'} /><Row label="Departamento" value={DEPTS[user?.department || ''] || 'Sin asignar'} /><Row label="Días laborales" value={activeDays || 'Sin jornada asignada'} /><Row label="Modalidad" value="Según registro diario" /><Row label="Rol de acceso" value={user?.role || '—'} /></dl><p className="mt-5 text-xs text-slate-400">Estos datos los administra la empresa.</p></Card> }
function Row({ label, value }: { label: string; value: string }) { return <div className="grid grid-cols-2 gap-3 py-3"><dt className="text-slate-500">{label}</dt><dd className="font-medium capitalize">{value}</dd></div> }
