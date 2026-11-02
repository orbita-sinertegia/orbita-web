import { useState } from 'react'
import { Eye, EyeOff, Lock, KeyRound } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import logoImg from '../../assets/logo.png'

export default function ChangePasswordModal() {
  const { user, refreshUser } = useAuth()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (newPassword.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setLoading(true)
    const { error: authErr } = await supabase.auth.updateUser({ password: newPassword })
    if (authErr) {
      setError('No se pudo actualizar la contraseña. Intenta de nuevo.')
      setLoading(false)
      return
    }

    await supabase.from('users').update({ must_change_password: false }).eq('id', user!.id)
    await refreshUser()
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-blue-900 via-blue-800 to-red-700 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">

        <div className="flex flex-col items-center mb-6">
          <img src={logoImg} alt="Logo" className="w-16 h-16 object-contain mb-3" />
          <div className="flex items-center gap-2 mb-1">
            <KeyRound size={20} className="text-blue-600" />
            <h2 className="text-xl font-bold text-gray-900">Crea tu contraseña</h2>
          </div>
          <p className="text-sm text-gray-500 text-center">
            Por seguridad, elige una contraseña personal antes de continuar.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <Lock size={13} className="inline mr-1 text-gray-400" />
              Nueva contraseña
            </label>
            <div className="relative">
              <input
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                required
                minLength={8}
                className="w-full border border-gray-300 rounded-lg px-4 py-3 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Mínimo 8 caracteres"
              />
              <button
                type="button"
                onClick={() => setShowNew(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
              >
                {showNew ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              <Lock size={13} className="inline mr-1 text-gray-400" />
              Confirmar contraseña
            </label>
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-lg px-4 py-3 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Repite la contraseña"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
              >
                {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {newPassword.length > 0 && confirmPassword.length > 0 && newPassword === confirmPassword && (
            <p className="text-green-600 text-xs flex items-center gap-1">
              ✓ Las contraseñas coinciden
            </p>
          )}

          {error && (
            <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-blue-700 to-red-600 text-white font-semibold py-3 rounded-lg hover:opacity-90 transition disabled:opacity-60"
          >
            {loading ? 'Guardando...' : 'Guardar mi contraseña'}
          </button>
        </form>
      </div>
    </div>
  )
}
