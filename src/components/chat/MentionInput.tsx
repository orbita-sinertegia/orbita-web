import { useRef, useState } from 'react'
import { Send, Paperclip, X, Image, Music } from 'lucide-react'
import type { User } from '../../types'

interface Props {
  value: string
  onChange: (val: string) => void
  onSend: () => void
  onFileSelect?: (file: File) => void
  users: User[]
  placeholder?: string
  selectedFile?: File | null
  onClearFile?: () => void
}

export default function MentionInput({ value, onChange, onSend, onFileSelect, users, placeholder, selectedFile, onClearFile }: Props) {
  const [showPicker, setShowPicker] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    onChange(val)
    const lastAt = val.lastIndexOf('@')
    if (lastAt !== -1) {
      const afterAt = val.slice(lastAt + 1)
      if (!afterAt.includes(' ')) {
        setMentionQuery(afterAt.toLowerCase())
        setShowPicker(true)
        return
      }
    }
    setShowPicker(false)
    setMentionQuery('')
  }

  function selectUser(user: User) {
    const lastAt = value.lastIndexOf('@')
    const newVal = value.slice(0, lastAt) + `@${user.full_name} `
    onChange(newVal)
    setShowPicker(false)
    setMentionQuery('')
    inputRef.current?.focus()
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file && onFileSelect) onFileSelect(file)
    e.target.value = ''
  }

  const filtered = users.filter(u => u.full_name.toLowerCase().includes(mentionQuery))
  const isImage = selectedFile?.type.startsWith('image/')

  return (
    <div className="relative flex flex-col gap-2 flex-1">
      {/* Vista previa del archivo seleccionado */}
      {selectedFile && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
          {isImage
            ? <Image size={14} className="text-blue-500 shrink-0" />
            : <Music size={14} className="text-blue-500 shrink-0" />
          }
          <span className="text-xs text-blue-700 truncate flex-1">{selectedFile.name}</span>
          <button onClick={onClearFile} className="text-blue-400 hover:text-blue-700 transition shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex gap-2">
        {/* Dropdown de menciones */}
        {showPicker && filtered.length > 0 && (
          <div className="absolute bottom-full left-0 mb-2 w-60 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden z-20">
            <p className="text-xs text-gray-400 px-3 py-2 border-b border-gray-100 font-medium uppercase tracking-wide">
              Mencionar a...
            </p>
            {filtered.map(user => (
              <button
                key={user.id}
                onMouseDown={e => { e.preventDefault(); selectUser(user) }}
                className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-blue-50 transition text-left"
              >
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-red-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                  {user.full_name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-800">{user.full_name}</p>
                  {user.department && (
                    <p className="text-xs text-gray-400 capitalize">{user.department}</p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Botón adjuntar */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="border border-gray-300 text-gray-500 px-3 py-2 rounded-lg hover:bg-gray-50 transition shrink-0"
          title="Adjuntar imagen o audio"
        >
          <Paperclip size={16} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,audio/*"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Input de texto */}
        <input
          ref={inputRef}
          value={value}
          onChange={handleChange}
          onKeyDown={e => {
            if (e.key === 'Escape') { setShowPicker(false); return }
            if (e.key === 'Enter' && !e.shiftKey && !showPicker) onSend()
          }}
          onBlur={() => setTimeout(() => setShowPicker(false), 150)}
          placeholder={placeholder || 'Escribe un mensaje... (@ para mencionar)'}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {/* Botón enviar */}
        <button
          onMouseDown={onSend}
          disabled={!value.trim() && !selectedFile}
          className="bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-40 shrink-0"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}
