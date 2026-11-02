import { useState } from 'react'
import { Search, Loader2, ExternalLink, AlertCircle, CheckCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

export default function SpellingChecker() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const [chars, setChars] = useState(0)

  async function handleCheck() {
    if (!url.trim()) return
    setLoading(true)
    setResult('')
    setError('')
    setChars(0)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/check-spelling', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Error al analizar la página')
      } else {
        setResult(data.result)
        setChars(data.chars)
      }
    } catch {
      setError('No se pudo conectar con el servidor.')
    }

    setLoading(false)
  }

  const noErrors = result.includes('Sin errores')

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="font-bold text-gray-800 text-lg">Revisor de ortografía</h3>
          <p className="text-sm text-gray-400">Pega la URL de cualquier página web y Gemini detectará errores de ortografía</p>
        </div>
        <div className="flex items-center gap-1.5 bg-blue-50 text-blue-700 text-xs font-semibold px-3 py-1.5 rounded-full border border-blue-200">
          <span>✨</span> Gemini AI
        </div>
      </div>

      {/* Input URL */}
      <div className="flex gap-3 mb-6">
        <div className="flex-1 flex items-center gap-2 border border-gray-300 rounded-xl px-4 py-3 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 bg-white">
          <ExternalLink size={16} className="text-gray-400 shrink-0" />
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCheck()}
            placeholder="https://ejemplo.com/pagina"
            className="flex-1 text-sm text-gray-800 placeholder-gray-400 focus:outline-none"
          />
        </div>
        <button
          onClick={handleCheck}
          disabled={loading || !url.trim()}
          className="flex items-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          {loading ? 'Analizando...' : 'Analizar'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Resultado */}
      {result && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <div className={`px-5 py-3 border-b flex items-center gap-2 ${noErrors ? 'bg-green-50 border-green-200' : 'bg-orange-50 border-orange-200'}`}>
            {noErrors
              ? <><CheckCircle size={16} className="text-green-600" /><span className="text-sm font-semibold text-green-700">Sin errores detectados</span></>
              : <><AlertCircle size={16} className="text-orange-600" /><span className="text-sm font-semibold text-orange-700">Se encontraron posibles errores</span></>
            }
            {chars > 0 && <span className="ml-auto text-xs text-gray-400">{chars.toLocaleString()} caracteres analizados</span>}
          </div>
          <div className="p-5">
            <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">{result}</pre>
          </div>
        </div>
      )}

      {/* Estado vacío */}
      {!result && !error && !loading && (
        <div className="text-center py-16 text-gray-400">
          <Search size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Ingresa una URL para analizar su ortografía</p>
        </div>
      )}
    </div>
  )
}
