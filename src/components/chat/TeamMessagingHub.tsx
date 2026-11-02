import { useState } from 'react'
import { MessageSquare, UserRound } from 'lucide-react'
import TeamChat from './TeamChat'
import DirectMessages from './DirectMessages'

export default function TeamMessagingHub() {
  const [mode, setMode] = useState<'general' | 'directos'>('general')
  return <div className="space-y-3">
    <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
      <button type="button" onClick={() => setMode('general')} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${mode === 'general' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}><MessageSquare size={15} /> General</button>
      <button type="button" onClick={() => setMode('directos')} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${mode === 'directos' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}><UserRound size={15} /> Mensajes directos</button>
    </div>
    {mode === 'general' ? <TeamChat /> : <DirectMessages />}
  </div>
}
