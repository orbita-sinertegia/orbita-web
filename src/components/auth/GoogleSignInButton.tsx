import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { isNoInvitationError, NO_INVITATION_MESSAGE } from '../../lib/signInErrors'

// El ID de cliente es público: Google lo muestra en cada inicio de sesión.
const GOOGLE_CLIENT_ID = '614135047244-sgsnsavc2u5pdvjkkg3pjhnvksj6no3l.apps.googleusercontent.com'
const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client'

interface GoogleIdentity {
  accounts: {
    id: {
      initialize: (config: {
        client_id: string
        nonce: string
        callback: (response: { credential: string }) => void
      }) => void
      renderButton: (parent: HTMLElement, options: Record<string, string | number>) => void
    }
  }
}

declare global {
  interface Window {
    google?: GoogleIdentity
  }
}

function loadGoogleScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google) return resolve()
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_SCRIPT}"]`)
    const script = existing || document.createElement('script')
    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener('error', () => reject(new Error('No cargó el script de Google')), { once: true })
    if (!existing) {
      script.src = GOOGLE_SCRIPT
      script.async = true
      document.head.appendChild(script)
    }
  })
}

// El nonce une este intento de inicio de sesión con el token que devuelve Google.
async function createNonce() {
  const raw = crypto.randomUUID()
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  const hashed = Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')
  return { raw, hashed }
}

interface Props {
  onError: (message: string) => void
  onStart: () => void
}

/** Botón oficial de Google: la pantalla de Google muestra este sitio en lugar del dominio de Supabase. */
export default function GoogleSignInButton({ onError, onStart }: Props) {
  const slot = useRef<HTMLDivElement>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [redirecting, setRedirecting] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function setup() {
      try {
        const [nonce] = await Promise.all([createNonce(), loadGoogleScript()])
        if (cancelled || !slot.current || !window.google) return
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          nonce: nonce.hashed,
          callback: async ({ credential }) => {
            onStart()
            const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: credential, nonce: nonce.raw })
            if (error) {
              console.error('Inicio de sesión con Google:', error.message)
              onError(isNoInvitationError(error.message) ? NO_INVITATION_MESSAGE : 'No se pudo iniciar sesión con Google. Intenta de nuevo.')
            }
          },
        })
        window.google.accounts.id.renderButton(slot.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'center',
          locale: 'es',
          width: Math.min(slot.current.offsetWidth || 350, 400),
        })
      } catch (error) {
        console.error(error)
        if (!cancelled) setUnavailable(true)
      }
    }

    void setup()
    return () => { cancelled = true }
  }, [onError, onStart])

  // Si un bloqueador impide cargar a Google, sigue disponible el inicio de sesión por redirección.
  async function signInWithRedirect() {
    setRedirecting(true)
    onStart()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) {
      onError('No se pudo iniciar sesión con Google. Intenta de nuevo.')
      setRedirecting(false)
    }
  }

  if (unavailable) {
    return (
      <button type="button" onClick={signInWithRedirect} disabled={redirecting} className="login-cristal__google-alterno">
        {redirecting ? 'Conectando...' : 'Continuar con Google'}
      </button>
    )
  }

  return <div ref={slot} className="login-cristal__google" />
}
