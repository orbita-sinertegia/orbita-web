import { lazy, Suspense, useState } from 'react'
import { Eye, EyeOff, ArrowLeft, Mail } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import logoImg from '../../assets/logo.png'

const FloatingLines = lazy(() => import('./FloatingLines'))

interface Props {
  unauthorizedEmail?: string | null
  deactivatedEmail?: string | null
  licenseSuspended?: boolean
}

export default function LoginPage({ unauthorizedEmail, deactivatedEmail, licenseSuspended }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [googleLoading, setGoogleLoading] = useState(false)

  const [view, setView] = useState<'login' | 'forgot'>('login')
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotError, setForgotError] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('Correo o contraseña incorrectos')
    setLoading(false)
  }

  async function handleGoogleLogin() {
    setGoogleLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) {
      setError('No se pudo iniciar sesión con Google. Intenta de nuevo.')
      setGoogleLoading(false)
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    setForgotLoading(true)
    setForgotError('')
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: 'https://agencia.sinertegia.com/',
    })
    if (error) {
      setForgotError('No se pudo enviar el correo. Verifica la dirección e intenta de nuevo.')
    } else {
      setForgotSent(true)
    }
    setForgotLoading(false)
  }

  return (
    <div className="min-h-screen relative bg-[#0b1230] flex items-center justify-center p-4 overflow-hidden">
      <div className="absolute inset-0">
        <Suspense fallback={null}>
          <FloatingLines
            enabledWaves={['top', 'middle', 'bottom']}
            lineCount={8}
            lineDistance={8}
            bendRadius={8}
            bendStrength={-2}
            interactive
            parallax
            animationSpeed={1}
            linesGradient={['#1e3a8a', '#3b82f6', '#dc2626']}
          />
        </Suspense>
      </div>

      <div className="relative z-10 bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">

        <div className="flex flex-col items-center mb-8">
          <img src={logoImg} alt="Sinertegia Logo" className="w-24 h-24 object-contain" />
          <h1 className="mt-4 text-2xl font-bold text-gray-900">Sinertegia Launch 57</h1>
          <p className="text-sm text-gray-500 mt-1">Plataforma de gestión de proyectos</p>
        </div>

        {view === 'login' ? (
          <div className="space-y-4">
            {unauthorizedEmail && (
              <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">
                La cuenta de Google <strong>{unauthorizedEmail}</strong> no está registrada en el sistema. Contacta a tu administrador.
              </p>
            )}
            {deactivatedEmail && (
              <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">
                La cuenta <strong>{deactivatedEmail}</strong> fue desactivada. Contacta a tu administrador si crees que es un error.
              </p>
            )}
            {licenseSuspended && (
              <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">
                Esta aplicación está temporalmente suspendida. Contacta a tu proveedor del servicio para reactivarla.
              </p>
            )}

            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={googleLoading}
              className="w-full flex items-center justify-center gap-2 border border-gray-300 rounded-lg py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition disabled:opacity-60"
            >
              <svg width="18" height="18" viewBox="0 0 18 18">
                <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9A8.78 8.78 0 0 0 17.64 9.2z" />
                <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.55-1.84.87-3.06.87-2.36 0-4.36-1.6-5.07-3.74H.9v2.33A9 9 0 0 0 9 18z" />
                <path fill="#FBBC05" d="M3.93 10.69A5.4 5.4 0 0 1 3.65 9c0-.59.1-1.16.28-1.69V4.98H.9A9 9 0 0 0 0 9c0 1.45.35 2.83.9 4.02l3.03-2.33z" />
                <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.59 8.59 0 0 0 9 0a9 9 0 0 0-8.1 4.98l3.03 2.33C4.64 5.18 6.64 3.58 9 3.58z" />
              </svg>
              {googleLoading ? 'Conectando...' : 'Iniciar sesión con Google'}
            </button>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400">o con tu correo</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Correo electrónico</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="tu@correo.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contraseña</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="text-right">
              <button
                type="button"
                onClick={() => { setView('forgot'); setForgotSent(false); setForgotError('') }}
                className="text-sm text-blue-600 hover:text-blue-800 hover:underline transition"
              >
                ¿Olvidaste tu contraseña?
              </button>
            </div>

            {error && (
              <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-blue-700 to-red-600 text-white font-semibold py-3 rounded-lg hover:opacity-90 transition disabled:opacity-60"
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
            </form>
          </div>
        ) : (
          <div className="space-y-4">
            <button
              type="button"
              onClick={() => setView('login')}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition mb-2"
            >
              <ArrowLeft size={15} /> Volver al inicio de sesión
            </button>

            <h2 className="text-lg font-bold text-gray-800">Recuperar contraseña</h2>
            <p className="text-sm text-gray-500">
              Ingresa tu correo y te enviaremos un link para crear una nueva contraseña.
            </p>

            {forgotSent ? (
              <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-xl p-4 text-green-700 text-sm">
                <Mail size={18} className="shrink-0 mt-0.5" />
                <span>
                  ¡Listo! Revisa tu correo <strong>{forgotEmail}</strong> y haz clic en el link para restablecer tu contraseña.
                </span>
              </div>
            ) : (
              <form onSubmit={handleForgot} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Correo electrónico</label>
                  <input
                    type="email"
                    value={forgotEmail}
                    onChange={e => setForgotEmail(e.target.value)}
                    required
                    className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="tu@correo.com"
                  />
                </div>

                {forgotError && (
                  <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">{forgotError}</p>
                )}

                <button
                  type="submit"
                  disabled={forgotLoading}
                  className="w-full bg-gradient-to-r from-blue-700 to-red-600 text-white font-semibold py-3 rounded-lg hover:opacity-90 transition disabled:opacity-60"
                >
                  {forgotLoading ? 'Enviando...' : 'Enviar link de recuperación'}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
