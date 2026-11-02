import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { LogOut, Camera, Clock, Building2, Home, X, KeyRound, UserRound } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useWorkSession } from '../../contexts/WorkSessionContext'
import { supabase } from '../../lib/supabase'
import NotificationBell from './NotificationBell'
import UserAvatar from './UserAvatar'
import GlobalSearch from './GlobalSearch'

export default function TopBarActions() {
  const { user, signOut, refreshUser } = useAuth()
  const { currentSession, checkOut, elapsedMinutes, isInOvertime, sessionError, savingSession } = useWorkSession()
  const [menuOpen, setMenuOpen] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [sendingCode, setSendingCode] = useState(false)
  const [passwordMsg, setPasswordMsg] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [showSessionSummary, setShowSessionSummary] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const isTeam = user?.role === 'team' || user?.role === 'admin'
  const hours = Math.floor(elapsedMinutes / 60)
  const mins = elapsedMinutes % 60
  const timerLabel = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`

  useEffect(() => {
    const changePhoto = () => fileInputRef.current?.click()
    const changePassword = () => { void openSecurePasswordChange() }
    const requestLogout = () => { void handleLogout() }
    window.addEventListener('change-profile-photo', changePhoto)
    window.addEventListener('change-profile-password', changePassword)
    window.addEventListener('request-logout', requestLogout)
    return () => {
      window.removeEventListener('change-profile-photo', changePhoto)
      window.removeEventListener('change-profile-password', changePassword)
      window.removeEventListener('request-logout', requestLogout)
    }
  }, [currentSession])

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !user) return
    setUploading(true)
    setMenuOpen(false)
    const ext = file.name.split('.').pop()
    const path = `${user.id}.${ext}`
    setUploadError('')
    const { error: uploadErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
    if (uploadErr) {
      setUploadError(uploadErr.message)
      setUploading(false)
      return
    }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    const url = `${data.publicUrl}?t=${Date.now()}`
    const { error: updateErr } = await supabase.from('users').update({ avatar_url: url }).eq('id', user.id)
    if (updateErr) setUploadError(updateErr.message)
    else await refreshUser()
    setUploading(false)
  }

  async function handleLogout() {
    if (isTeam && currentSession) {
      setMenuOpen(false)
      setShowLogoutConfirm(true)
    } else {
      await signOut()
    }
  }

  async function confirmLogout() {
    if (await checkOut()) await signOut()
  }

  async function handleChangePassword() {
    if (emailCode.length < 6) {
      setPasswordMsg('Escribe el código que enviamos a tu correo.')
      return
    }
    if (!newPassword || newPassword.length < 8) {
      setPasswordMsg('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg('Las contraseñas no coinciden.')
      return
    }
    setChangingPassword(true)
    setPasswordMsg('')
    const { error } = await supabase.auth.updateUser({ password: newPassword, nonce: emailCode })
    if (error) {
      setPasswordMsg('Error: ' + error.message)
    } else {
      setPasswordMsg('✅ Contraseña actualizada correctamente.')
      setNewPassword('')
      setConfirmPassword('')
      setEmailCode('')
    }
    setChangingPassword(false)
  }

  async function sendReauthenticationCode() {
    setSendingCode(true); setPasswordMsg('')
    const { error } = await supabase.auth.reauthenticate()
    setPasswordMsg(error ? `Error: ${error.message}` : `Código enviado a ${user?.email || 'tu correo registrado'}.`)
    setSendingCode(false)
  }

  async function openSecurePasswordChange() {
    setMenuOpen(false)
    setShowChangePassword(true)
    setEmailCode(''); setNewPassword(''); setConfirmPassword(''); setPasswordMsg('')
    await sendReauthenticationCode()
  }

  return (
    <>
      {/* Toast de error de foto — visible fuera del menú */}
      {uploadError && (
        <div className="fixed top-4 right-4 z-50 bg-red-600 text-white text-sm px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 max-w-xs">
          <span className="flex-1">{uploadError}</span>
          <button onClick={() => setUploadError('')} className="shrink-0 opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex items-center gap-3">
        {/* Timer del equipo */}
        {isTeam && currentSession && (
          <button type="button" onClick={() => setShowSessionSummary(true)} title="Ver resumen de jornada" className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition hover:brightness-95 ${
            isInOvertime
              ? 'bg-orange-100 text-orange-700'
              : 'bg-green-100 text-green-700'
          }`}>
            <Clock size={12} />
            {timerLabel}
            {currentSession.location === 'oficina'
              ? <Building2 size={12} className="ml-0.5" />
              : <Home size={12} className="ml-0.5" />
            }
            {isInOvertime && <span className="text-orange-500 font-bold">·HE</span>}
          </button>
        )}

        <GlobalSearch />
        <NotificationBell />

        {/* Avatar + menú */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="flex items-center gap-2 hover:opacity-80 transition"
          >
            {uploading
              ? <div className="w-8 h-8 rounded-full bg-gray-200 animate-pulse" />
              : <UserAvatar name={user?.full_name || ''} avatarUrl={user?.avatar_url} size={32} />
            }
            <div className="text-left hidden sm:block">
              <p className="text-sm font-medium text-gray-700 leading-tight">{user?.full_name}</p>
              <p className="text-xs text-gray-400 capitalize">{user?.role}</p>
            </div>
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-10 z-20 bg-white border border-gray-200 rounded-xl shadow-lg w-52 py-2 overflow-hidden">
                <div className="px-4 py-2 border-b border-gray-100">
                  <p className="text-sm font-semibold text-gray-800">{user?.full_name}</p>
                  <p className="text-xs text-gray-400 capitalize">{user?.role}</p>
                  {isTeam && currentSession && (
                    <p className="text-xs text-green-600 font-medium mt-0.5 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full inline-block animate-pulse" />
                      En sesión · {timerLabel}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => { setMenuOpen(false); window.dispatchEvent(new CustomEvent('open-profile')) }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-blue-50 transition"
                >
                  <UserRound size={15} className="text-blue-600" />
                  Mi perfil
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition"
                >
                  <Camera size={15} className="text-blue-500" />
                  Cambiar foto de perfil
                </button>
                <button
                  onClick={() => { void openSecurePasswordChange() }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition"
                >
                  <KeyRound size={15} className="text-purple-500" />
                  Cambiar contraseña
                </button>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition"
                >
                  <LogOut size={15} />
                  Cerrar sesión
                </button>
              </div>
            </>
          )}
        </div>

        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
      </div>

      {/* Modal cambiar contraseña */}
      {showSessionSummary && currentSession && (
        <Portal>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-5 flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-wide text-blue-600">Jornada de hoy</p><h3 className="mt-1 text-xl font-bold text-gray-900">Resumen de sesión</h3></div><button type="button" onClick={() => setShowSessionSummary(false)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"><X size={18} /></button></div>
            <div className="rounded-xl bg-gray-50 p-5 text-center"><p className="text-4xl font-bold text-gray-900">{timerLabel}</p><p className="mt-1 text-xs text-gray-500">tiempo trabajado hoy</p></div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div className="rounded-xl border border-gray-200 p-3"><p className="text-xs text-gray-400">Modalidad</p><p className="mt-1 flex items-center gap-1.5 font-semibold text-gray-700">{currentSession.location === 'oficina' ? <><Building2 size={14} /> Oficina</> : <><Home size={14} /> Home Office</>}</p></div><div className="rounded-xl border border-gray-200 p-3"><p className="text-xs text-gray-400">Estado</p><p className={`mt-1 font-semibold ${isInOvertime ? 'text-orange-600' : 'text-green-600'}`}>{isInOvertime ? 'Tiempo extra' : 'Horario regular'}</p></div></div>
            <button type="button" onClick={() => setShowSessionSummary(false)} className="mt-5 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">Cerrar</button>
          </div>
        </div>
        </Portal>
      )}

      {showChangePassword && (
        <Portal>
        <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm">
          <div className="my-auto max-h-[calc(100vh-2rem)] w-full max-w-sm overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-bold text-gray-900 flex items-center gap-2"><KeyRound size={16} className="text-purple-500" /> Cambiar contraseña</h3>
              <button onClick={() => { setShowChangePassword(false); setPasswordMsg(''); setEmailCode(''); setNewPassword(''); setConfirmPassword('') }} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-3">
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
                <p className="text-xs font-semibold text-blue-800">Confirma que eres tú</p>
                <p className="mt-1 text-xs text-blue-600">Enviamos un código al correo registrado: {user?.email}</p>
              </div>
              <input
                inputMode="numeric"
                maxLength={8}
                placeholder="Código del correo"
                value={emailCode}
                onChange={e => setEmailCode(e.target.value.replace(/\D/g, ''))}
                className="w-full rounded-xl border border-gray-300 px-4 py-2.5 text-center font-mono text-lg tracking-[.25em] focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button type="button" onClick={sendReauthenticationCode} disabled={sendingCode} className="w-full text-xs font-semibold text-blue-600 hover:text-blue-800 disabled:opacity-50">{sendingCode ? 'Enviando...' : 'Reenviar código'}</button>
              <input
                type="password"
                placeholder="Nueva contraseña"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
              <input
                type="password"
                placeholder="Confirmar contraseña"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
              {passwordMsg && (
                <p className={`text-xs font-medium ${passwordMsg.startsWith('✅') ? 'text-green-600' : 'text-red-500'}`}>{passwordMsg}</p>
              )}
              <button
                onClick={handleChangePassword}
                disabled={changingPassword}
                className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-semibold transition disabled:opacity-60"
              >
                {changingPassword ? 'Guardando...' : 'Guardar contraseña'}
              </button>
            </div>
          </div>
        </div>
        </Portal>
      )}

      {/* Popup confirmación de cierre de sesión */}
      {showLogoutConfirm && (
        <Portal>
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-bold text-gray-900">¿Ya cerrarás sesión?</h3>
              <button onClick={() => setShowLogoutConfirm(false)} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="p-6">
              {sessionError && <p role="alert" className="text-sm text-red-600 mb-3">{sessionError}</p>}
              <div className="bg-gray-50 rounded-xl p-4 mb-4 text-center">
                <p className="text-3xl font-bold text-gray-800">{timerLabel}</p>
                <p className="text-xs text-gray-500 mt-1">horas trabajadas hoy</p>
                {isInOvertime && (
                  <p className="text-xs text-orange-600 font-semibold mt-1">
                    🕐 Incluye horas extras
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-2 flex items-center justify-center gap-1">
                  {currentSession?.location === 'oficina'
                    ? <><Building2 size={11} /> Oficina</>
                    : <><Home size={11} /> Home Office</>
                  }
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setShowLogoutConfirm(false)}
                  className="py-2.5 border border-gray-300 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50 transition"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmLogout}
                  disabled={savingSession}
                  className="py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-semibold transition"
                >
                  Cerrar sesión
                </button>
              </div>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </>
  )
}

function Portal({ children }: { children: React.ReactNode }) {
  return createPortal(children, document.body)
}
