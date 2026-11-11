import { lazy, Suspense, useCallback, useState } from 'react'
import { Eye, EyeOff, ArrowLeft, Mail } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import logoImg from '../../assets/logo.png'
import { isNoInvitationError, NO_INVITATION_MESSAGE } from '../../lib/signInErrors'
import GoogleSignInButton from './GoogleSignInButton'
import './LoginCristal.css'

const FloatingLines = lazy(() => import('./FloatingLines'))

interface Props {
  unauthorizedEmail?: string | null
  deactivatedEmail?: string | null
  licenseSuspended?: boolean
}

// Supabase regresa aquí con error_description cuando rechaza un inicio de sesión por redirección.
function readSignInError(): string {
  const params = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const description = params.get('error_description') || hash.get('error_description')
  if (!description) return ''
  window.history.replaceState(null, '', window.location.pathname)
  return isNoInvitationError(description) ? NO_INVITATION_MESSAGE : 'No se pudo iniciar sesión. Intenta de nuevo.'
}

export default function LoginPage({ unauthorizedEmail, deactivatedEmail, licenseSuspended }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(readSignInError)

  const [view, setView] = useState<'login' | 'forgot'>('login')
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotSent, setForgotSent] = useState(false)
  const [forgotError, setForgotError] = useState('')

  const clearError = useCallback(() => setError(''), [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('Correo o contraseña incorrectos')
    setLoading(false)
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault()
    setForgotLoading(true)
    setForgotError('')
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${window.location.origin}/`,
    })
    if (error) {
      setForgotError('No se pudo enviar el correo. Verifica la dirección e intenta de nuevo.')
    } else {
      setForgotSent(true)
    }
    setForgotLoading(false)
  }

  return (
    <div className="min-h-screen relative bg-[#14082A] flex items-center justify-center p-4 overflow-hidden">
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
            linesGradient={['#2D2B55', '#6A5ACD', '#F4A62A']}
          />
        </Suspense>
      </div>

      <section className="login-cristal" aria-labelledby="titulo-login">
        <div className="login-cristal__emblema">
          <img src={logoImg} alt="Órbita" width={72} height={72} />
        </div>

        <h1 id="titulo-login">Iniciar sesión</h1>
        <p className="login-cristal__subtitulo">Tus proyectos, en un solo lugar</p>

        {view === 'login' ? (
          <>
            {unauthorizedEmail && (
              <p className="login-cristal__aviso" role="alert">
                La cuenta de Google <strong>{unauthorizedEmail}</strong> no está registrada en el sistema. Contacta a tu administrador.
              </p>
            )}
            {deactivatedEmail && (
              <p className="login-cristal__aviso" role="alert">
                La cuenta <strong>{deactivatedEmail}</strong> fue desactivada. Contacta a tu administrador si crees que es un error.
              </p>
            )}
            {licenseSuspended && (
              <p className="login-cristal__aviso" role="alert">
                Esta aplicación está temporalmente suspendida. Contacta a tu proveedor del servicio para reactivarla.
              </p>
            )}

            <GoogleSignInButton onError={setError} onStart={clearError} />

            <div className="login-cristal__separador">o con tu correo</div>

            <form className="login-cristal__form" onSubmit={handleLogin}>
              <label htmlFor="email">Correo electrónico</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="tu@correo.com"
                required
              />

              <label htmlFor="password">Contraseña</label>
              <div className="login-cristal__clave">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="login-cristal__ojo"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              <button
                type="button"
                className="login-cristal__recuperar"
                onClick={() => { setView('forgot'); setForgotSent(false); setForgotError('') }}
              >
                ¿Olvidaste tu contraseña?
              </button>

              {error && <p className="login-cristal__aviso" role="alert">{error}</p>}

              <button className="login-cristal__entrar" type="submit" disabled={loading}>
                {loading ? 'Entrando...' : 'Entrar'}
              </button>
            </form>
          </>
        ) : (
          <>
            <button type="button" className="login-cristal__volver" onClick={() => setView('login')}>
              <ArrowLeft size={15} /> Volver al inicio de sesión
            </button>

            <h2 className="login-cristal__titulo-secundario">Recuperar contraseña</h2>
            <p className="login-cristal__texto">
              Ingresa tu correo y te enviaremos un link para crear una nueva contraseña.
            </p>

            {forgotSent ? (
              <div className="login-cristal__listo" role="status">
                <Mail size={18} />
                <span>
                  ¡Listo! Revisa tu correo <strong>{forgotEmail}</strong> y haz clic en el link para restablecer tu contraseña.
                </span>
              </div>
            ) : (
              <form className="login-cristal__form" onSubmit={handleForgot}>
                <label htmlFor="correo-recuperar">Correo electrónico</label>
                <input
                  id="correo-recuperar"
                  type="email"
                  autoComplete="username"
                  value={forgotEmail}
                  onChange={e => setForgotEmail(e.target.value)}
                  placeholder="tu@correo.com"
                  required
                />

                {forgotError && <p className="login-cristal__aviso" role="alert">{forgotError}</p>}

                <button className="login-cristal__entrar" type="submit" disabled={forgotLoading}>
                  {forgotLoading ? 'Enviando...' : 'Enviar link de recuperación'}
                </button>
              </form>
            )}
          </>
        )}

        <p className="login-cristal__legal">
          <a href="/privacidad.html">Política de privacidad</a>
          {' · '}
          <a href="/condiciones.html">Condiciones del servicio</a>
          {' · '}
          <a href="/app.html">App para Android</a>
        </p>
      </section>
    </div>
  )
}
