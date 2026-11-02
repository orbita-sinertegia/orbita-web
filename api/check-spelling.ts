import type { VercelRequest, VercelResponse } from '@vercel/node'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

// Valida el JWT con Supabase Auth: si la sesión no existe o caducó, responde 401.
async function hasValidSession(req: VercelRequest) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ') || !SUPABASE_URL || !SUPABASE_ANON_KEY) return false
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: header, apikey: SUPABASE_ANON_KEY },
    signal: AbortSignal.timeout(5000),
  })
  return authRes.ok
}

// Direcciones locales, privadas y de metadatos de la nube que el servidor nunca debe visitar.
function isPrivateAddress(address: string) {
  if (isIP(address) === 6) {
    const ip = address.toLowerCase()
    if (ip.startsWith('::ffff:')) return isPrivateAddress(ip.slice(7))
    return ip === '::' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')
  }
  const [a, b] = address.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
}

async function isPublicHttpUrl(raw: string) {
  let parsed: URL
  try { parsed = new URL(raw) } catch { return false }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  const host = parsed.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => [])
  return addresses.length > 0 && addresses.every(({ address }) => !isPrivateAddress(address))
}

// Sigue redirecciones a mano para revisar cada destino antes de visitarlo.
async function fetchPublicPage(url: string) {
  let current = url
  for (let hop = 0; hop < 4; hop++) {
    if (!(await isPublicHttpUrl(current))) return null
    const pageRes = await fetch(current, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SpellingBot/1.0)' },
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    })
    const location = pageRes.headers.get('location')
    if (pageRes.status < 300 || pageRes.status >= 400 || !location) return pageRes
    current = new URL(location, current).toString()
  }
  return null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    if (!(await hasValidSession(req))) return res.status(401).json({ error: 'Inicia sesión para usar el revisor.' })
  } catch {
    return res.status(401).json({ error: 'Inicia sesión para usar el revisor.' })
  }

  const { url } = req.body
  if (!url) return res.status(400).json({ error: 'URL requerida' })

  try {
    const pageRes = await fetchPublicPage(String(url))
    if (!pageRes) return res.status(400).json({ error: 'Solo se pueden revisar páginas públicas (http o https).' })

    if (!pageRes.ok) return res.status(400).json({ error: `No se pudo acceder a la página (${pageRes.status})` })

    const html = await pageRes.text()

    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 10000)

    if (text.length < 50) return res.status(400).json({ error: 'No se pudo extraer texto suficiente de la página.' })

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Eres un experto revisor de ortografía y gramática en español. Analiza el siguiente texto extraído de una página web y lista ÚNICAMENTE los errores de ortografía y gramática que encuentres.

Para cada error usa este formato:
❌ "[palabra incorrecta]" → ✅ "[corrección]" — [breve explicación]

Si no hay errores escribe: "✅ Sin errores ortográficos detectados."
No hagas resumen, solo lista los errores directamente.

TEXTO A REVISAR:
${text}`
            }]
          }],
          generationConfig: { temperature: 0.1 }
        }),
      }
    )

    const geminiData = await geminiRes.json()
    const result = geminiData.candidates?.[0]?.content?.parts?.[0]?.text

    if (!result) return res.status(500).json({ error: 'Gemini no devolvió respuesta.' })

    res.status(200).json({ result, chars: text.length })
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Error desconocido' })
  }
}
