import { useEffect, useState } from 'react'
import { ShieldAlert, ShieldCheck, Save, Plus, Copy, Check, Link2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'

interface License {
  status: 'active' | 'suspended'
  client_name: string | null
  start_date: string | null
  expires_at: string | null
  monthly_amount: number
  notes: string | null
  payment_link: string | null
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const target = new Date(dateStr + 'T00:00:00')
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

export default function LicenseManager() {
  const [license, setLicense] = useState<License | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [clientName, setClientName] = useState('')
  const [status, setStatus] = useState<'active' | 'suspended'>('active')
  const [startDate, setStartDate] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [monthlyAmount, setMonthlyAmount] = useState('0')
  const [notes, setNotes] = useState('')
  const [paymentLink, setPaymentLink] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)
  const [confirmSuspend, setConfirmSuspend] = useState(false)

  useEffect(() => {
    fetchLicense()
  }, [])

  async function fetchLicense() {
    const { data } = await supabase.from('app_license').select('*').eq('id', 1).single()
    if (data) {
      const l = data as License
      setLicense(l)
      setClientName(l.client_name || '')
      setStatus(l.status)
      setStartDate(l.start_date || '')
      setExpiresAt(l.expires_at || '')
      setMonthlyAmount(String(l.monthly_amount ?? 0))
      setNotes(l.notes || '')
      setPaymentLink(l.payment_link || '')
    }
    setLoading(false)
  }

  async function saveAll(overrides?: Partial<{ status: 'active' | 'suspended'; expires_at: string }>) {
    setSaving(true)
    await supabase.from('app_license').update({
      client_name: clientName.trim() || null,
      status: overrides?.status ?? status,
      start_date: startDate || null,
      expires_at: overrides?.expires_at ?? (expiresAt || null),
      monthly_amount: parseFloat(monthlyAmount) || 0,
      notes: notes.trim() || null,
      payment_link: paymentLink.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', 1)
    await fetchLicense()
    setSaving(false)
  }

  function copyPaymentLink() {
    if (!license?.payment_link) return
    navigator.clipboard.writeText(license.payment_link)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  async function toggleStatus() {
    const newStatus = status === 'active' ? 'suspended' : 'active'
    setStatus(newStatus)
    await saveAll({ status: newStatus })
    setConfirmSuspend(false)
  }

  function extend(months: number) {
    const base = expiresAt && new Date(expiresAt + 'T00:00:00') > new Date() ? new Date(expiresAt + 'T00:00:00') : new Date()
    base.setMonth(base.getMonth() + months)
    const newExpires = base.toISOString().split('T')[0]
    setExpiresAt(newExpires)
    saveAll({ expires_at: newExpires })
  }

  if (loading || !license) return <div className="text-center py-12 text-gray-400">Cargando licencia...</div>

  const isActive = status === 'active'
  const remaining = daysUntil(expiresAt)

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">Licencia</h1>
        <p className="mt-1 text-sm text-gray-500">Administra la vigencia, mensualidad y acceso de esta instalación.</p>
      </div>
      <p className="hidden">
        Panel exclusivo de súper administrador. Suspende esta instancia si el cliente que renta la app no cubrió su pago — nadie más podrá entrar hasta que la reactives.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Columna izquierda: estado */}
        <div className="space-y-5">
          <div className={`rounded-2xl border p-6 text-center ${isActive ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
            <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3 ${isActive ? 'bg-green-100' : 'bg-red-100'}`}>
              {isActive ? <ShieldCheck size={30} className="text-green-600" /> : <ShieldAlert size={30} className="text-red-600" />}
            </div>
            <p className={`text-xl font-extrabold ${isActive ? 'text-green-700' : 'text-red-700'}`}>
              {isActive ? 'APP ACTIVA' : 'APP SUSPENDIDA'}
            </p>
            <p className="text-sm text-gray-700 mt-2">
              <strong>Cliente:</strong> {license.client_name || '—'}
            </p>
            <p className="text-sm text-gray-700">
              <strong>Vence:</strong> {expiresAt ? new Date(expiresAt + 'T00:00:00').toLocaleDateString('es-MX') : '—'}
            </p>
            {remaining !== null && (
              <span className={`inline-block mt-2 text-xs font-semibold px-3 py-1 rounded-full ${
                remaining < 0 ? 'bg-red-100 text-red-700' : remaining <= 7 ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'
              }`}>
                {remaining < 0 ? `Vencida hace ${Math.abs(remaining)} días` : `Faltan ${remaining} días`}
              </span>
            )}
            {!isActive && <button onClick={toggleStatus} disabled={saving}
              className={`mt-4 w-full py-2.5 rounded-lg text-sm font-semibold transition disabled:opacity-50 ${
                isActive ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-green-600 hover:bg-green-700 text-white'
              }`}>
              {saving ? 'Procesando...' : isActive ? 'Suspender ahora' : 'Reactivar ahora'}
            </button>}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Mensualidad</p>
            <div className="space-y-1.5 text-sm">
              <p><span className="text-gray-400">Monto:</span> <strong>${Number(license.monthly_amount || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN</strong></p>
              <p><span className="text-gray-400">Inicio contrato:</span> {license.start_date ? new Date(license.start_date + 'T00:00:00').toLocaleDateString('es-MX') : '—'}</p>
              <p><span className="text-gray-400">Estado:</span> <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{isActive ? 'ACTIVA' : 'SUSPENDIDA'}</span></p>
              {license.notes && <p className="pt-1 text-gray-500 text-xs">{license.notes}</p>}
            </div>
            {license.payment_link && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs text-gray-400 mb-1.5">Link de pago mensual</p>
                <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                  <Link2 size={13} className="text-blue-500 shrink-0" />
                  <a href={license.payment_link} target="_blank" rel="noreferrer" className="text-xs text-blue-700 truncate flex-1 hover:underline">
                    {license.payment_link}
                  </a>
                  <button onClick={copyPaymentLink} className="shrink-0 text-blue-600 hover:text-blue-800 transition">
                    {linkCopied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Columna derecha: formulario */}
        <div className="space-y-5">
          <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Actualizar licencia</p>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Nombre del cliente (renta)</label>
              <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Ej: Terraza360 — Instalación inicial"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Fecha inicio</label>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Fecha vencimiento</label>
                <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Mensualidad (MXN)</label>
              <input type="number" step="0.01" value={monthlyAmount} onChange={e => setMonthlyAmount(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Link de pago (Mercado Pago, Stripe, etc.)</label>
              <input type="url" value={paymentLink} onChange={e => setPaymentLink(e.target.value)} placeholder="https://mpago.la/..."
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Notas internas</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            </div>
            <button onClick={() => saveAll()} disabled={saving}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2.5 rounded-lg transition disabled:opacity-50">
              <Save size={14} /> Guardar configuración
            </button>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Extensiones rápidas</p>
            <div className="grid grid-cols-2 gap-2">
              {[{ n: 1, l: '+1 mes' }, { n: 3, l: '+3 meses' }, { n: 6, l: '+6 meses' }, { n: 12, l: '+1 año' }].map(({ n, l }) => (
                <button key={n} onClick={() => extend(n)} disabled={saving}
                  className="flex items-center justify-center gap-1.5 border border-green-300 text-green-700 bg-green-50 hover:bg-green-100 text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50">
                  <Plus size={13} /> {l}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3">
              Extiende el vencimiento desde hoy (si ya venció) o desde la fecha de vencimiento actual.
            </p>
          </div>
        </div>
      </div>

      {isActive && <section className="mt-5 rounded-2xl border border-red-200 bg-red-50/70 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="font-bold text-red-700">Zona de peligro</h2><p className="mt-1 text-sm text-gray-600">Suspender el acceso impedirá que todos los usuarios entren a la aplicación.</p></div>
          <div className="text-right"><button type="button" onClick={() => setConfirmSuspend(true)} className="rounded-lg border border-red-300 bg-white px-5 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50">Suspender aplicación</button><p className="mt-1 text-xs text-gray-400">Requiere confirmación</p></div>
        </div>
      </section>}

      {confirmSuspend && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-red-100 text-red-600"><ShieldAlert size={24} /></div><h2 className="mt-4 text-center text-lg font-bold text-gray-900">¿Suspender la aplicación?</h2><p className="mt-2 text-center text-sm leading-relaxed text-gray-500">Ningún usuario podrá entrar hasta que un superadministrador reactive la licencia.</p><div className="mt-6 grid grid-cols-2 gap-3"><button type="button" onClick={() => setConfirmSuspend(false)} className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-600">Cancelar</button><button type="button" onClick={toggleStatus} disabled={saving} className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Suspendiendo...' : 'Sí, suspender'}</button></div></div></div>}
    </div>
  )
}
