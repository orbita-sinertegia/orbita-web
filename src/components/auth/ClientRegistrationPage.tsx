import { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import logoImg from '../../assets/logo.png'

interface Props {
  inviteToken: string
}

interface InviteData {
  id: string
  used: boolean
  permissions: Record<string, boolean> | null
  client: { id: string; name: string; company: string }
}

export default function ClientRegistrationPage({ inviteToken }: Props) {
  const [invite, setInvite] = useState<InviteData | null>(null)
  const [inviteError, setInviteError] = useState('')
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    password: '',
    confirm: '',
  })
  const [showPass, setShowPass] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    loadInvite()
  }, [inviteToken])

  async function loadInvite() {
    const { data, error } = await supabase.from('client_invitations').select('id, used, permissions, client:clients(id, name, company)').eq('id', inviteToken).single()

    if (error || !data) {
      setInviteError('Este link de invitación no es válido.')
    } else if ((data as any).used) {
      setInviteError('Este link ya fue utilizado. Contacta a tu asesor para obtener uno nuevo.')
    } else {
      setInvite(data as any)
    }
    setLoading(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (form.full_name.trim().length < 2) {
      setError('Ingresa tu nombre completo.')
      return
    }
    if (form.password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (form.password !== form.confirm) {
      setError('Las contraseñas no coinciden.')
      return
    }

    if (saving) return
    setSaving(true)
    try {

      // 1. Crear cuenta en Supabase Auth
      const { data: authData, error: authErr } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
      })

      if (authErr || !authData.user) {
        setError(authErr?.message === 'User already registered' ? 'Este correo ya tiene una cuenta registrada.' : 'No se pudo crear la cuenta. Intenta de nuevo.')
        setSaving(false)
        return
      }

      // 2. Perfil con rol 'client', vínculo al cliente, permisos y cierre de la invitación,
      // todo validado en la base de datos
      const { error: acceptError } = await supabase.rpc('accept_client_invitation', {
        p_invitation_id: inviteToken,
        p_full_name: form.full_name.trim(),
      })
      if (acceptError) throw new Error('La cuenta se creó, pero no se pudo completar el registro. Contacta al administrador.')

      setDone(true)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'No se pudo completar el registro. Contacta al administrador.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-red-700 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-blue-800 to-red-700 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div className="flex flex-col items-center mb-6">
          <img src={logoImg} alt="Logo" className="w-16 h-16 object-contain mb-3" />
          <h1 className="text-xl font-bold text-gray-900">Sinertegia Launch 57</h1>
        </div>

        {inviteError ? (
          <div className="text-center">
            <p className="text-4xl mb-4">⚠️</p>
            <p className="text-red-600 font-semibold">{inviteError}</p>
          </div>
        ) : done ? (
          <div className="text-center">
            <p className="text-5xl mb-4">🎉</p>
            <h2 className="text-lg font-bold text-gray-900 mb-2">¡Cuenta creada!</h2>
            <p className="text-sm text-gray-500 mb-4">Ya puedes acceder a tu portal de cliente.</p>
            <a href="/" className="inline-block w-full bg-gradient-to-r from-blue-700 to-red-600 text-white font-semibold py-3 rounded-lg text-center hover:opacity-90 transition">
              Ir al portal
            </a>
          </div>
        ) : (
          <>
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-6 text-center">
              <p className="text-xs text-blue-500 font-semibold uppercase tracking-wide mb-0.5">Invitación para</p>
              <p className="text-base font-bold text-blue-800">{invite?.client.name}</p>
              <p className="text-xs text-blue-600">{invite?.client.company}</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre completo</label>
                <input
                  type="text"
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  required
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Tu nombre"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Correo electrónico</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="tu@correo.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña</label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required
                    className="w-full border border-gray-300 rounded-lg px-4 py-3 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Mínimo 8 caracteres"
                  />
                  <button type="button" onClick={() => setShowPass((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar contraseña</label>
                <div className="relative">
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    value={form.confirm}
                    onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                    required
                    className="w-full border border-gray-300 rounded-lg px-4 py-3 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Repite tu contraseña"
                  />
                  <button type="button" onClick={() => setShowConfirm((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {form.password.length >= 8 && form.confirm === form.password && <p className="text-green-600 text-xs">✓ Las contraseñas coinciden</p>}

              {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</p>}

              <button
                type="submit"
                disabled={saving}
                className="w-full bg-gradient-to-r from-blue-700 to-red-600 text-white font-semibold py-3 rounded-lg hover:opacity-90 transition disabled:opacity-60"
              >
                {saving ? 'Creando cuenta...' : 'Crear mi cuenta'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
