import { useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Lightbulb, Menu, X } from 'lucide-react'
import Logo from './Logo'

export interface SidebarItem {
  id: string
  label: string
  icon: LucideIcon
  badge?: number
}

interface Props {
  items: SidebarItem[]
  activeId: string
  onSelect: (id: string) => void
  /** Si es true, el sidebar se puede colapsar/expandir con un botón (oculta marca y textos al colapsar). */
  collapsible?: boolean
  /** Logo + nombre de la app, solo se muestra si collapsible está expandido. */
  brand?: { title: string; subtitle: string }
  /** Caja de tip al fondo del sidebar (oculta si está colapsado). */
  tip?: { text: string }
  /** 'dark' = fondo navy oscuro (solo para sidebars colapsables); 'light' = como antes. */
  theme?: 'light' | 'dark'
}

export default function Sidebar({ items, activeId, onSelect, collapsible = false, brand, tip, theme = 'light' }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const isDark = theme === 'dark'
  const showExpanded = !collapsible || !collapsed

  if (!collapsible) {
    return (
      <aside className="w-16 md:w-60 shrink-0 bg-white border border-gray-200 rounded-xl flex flex-col self-start">
        <nav className="flex-1 p-2 md:p-3 space-y-1">
          {items.map(({ id, label, icon: Icon, badge }) => (
            <button key={id} type="button" onClick={() => onSelect(id)}
              className={`relative w-full flex items-center justify-center md:justify-start gap-3 px-2 md:px-3 py-2.5 rounded-lg text-sm font-medium transition text-left ${
                activeId === id ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}>
              <Icon size={16} className="shrink-0" />
              <span className="truncate hidden md:inline">{label}</span>
              {!!badge && (
                <span className="absolute top-1 right-1 md:static md:ml-auto bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] rounded-full flex items-center justify-center px-1">
                  {badge > 9 ? '9+' : badge}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="hidden md:block p-3 border-t border-gray-100">
          <div className="bg-blue-50 rounded-xl p-3">
            <p className="text-xs font-semibold text-blue-700 flex items-center gap-1.5">
              <Lightbulb size={13} /> Consejo rápido
            </p>
            <p className="text-xs text-blue-600 mt-1.5 leading-relaxed">
              Organiza tus tareas con prioridades y fechas de entrega para mejorar tu productividad.
            </p>
          </div>
        </div>
      </aside>
    )
  }

  return (
    <aside className={`shrink-0 h-screen flex flex-col transition-all ${collapsed ? 'w-16' : 'w-64'} ${isDark ? 'bg-[#1e1b3a] text-white' : 'bg-white border-r border-gray-200'}`}>
      <div className={`flex items-center gap-2 p-3 ${isDark ? 'border-b border-white/10' : 'border-b border-gray-100'}`}>
        <button type="button" onClick={() => setCollapsed(c => !c)}
          className={`shrink-0 p-2 rounded-lg transition ${isDark ? 'hover:bg-white/10 text-white' : 'hover:bg-gray-100 text-gray-600'}`}>
          {collapsed ? <Menu size={18} /> : <X size={18} />}
        </button>
        {showExpanded && brand && (
          <div className="flex items-center gap-2 min-w-0">
            <Logo size={28} />
            <div className="min-w-0">
              <p className="text-sm font-bold leading-tight truncate">{brand.title}</p>
              <p className={`text-xs truncate ${isDark ? 'text-white/50' : 'text-gray-400'}`}>{brand.subtitle}</p>
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {items.map(({ id, label, icon: Icon, badge }) => (
          <button key={id} type="button" onClick={() => onSelect(id)}
            className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition text-left ${
              activeId === id
                ? 'bg-blue-600 text-white'
                : isDark ? 'text-white/70 hover:bg-white/10' : 'text-gray-600 hover:bg-gray-100'
            }`}>
            <Icon size={17} className="shrink-0" />
            {showExpanded && <span className="truncate">{label}</span>}
            {!!badge && (
              <span className={`bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] rounded-full flex items-center justify-center px-1 ${showExpanded ? 'ml-auto' : 'absolute top-1 right-1'}`}>
                {badge > 9 ? '9+' : badge}
              </span>
            )}
          </button>
        ))}
      </nav>

      {showExpanded && tip && (
        <div className="p-3">
          <div className={`rounded-xl p-3 ${isDark ? 'bg-white/10' : 'bg-blue-50'}`}>
            <p className={`text-xs font-semibold flex items-center gap-1.5 ${isDark ? 'text-white' : 'text-blue-700'}`}>
              <Lightbulb size={13} /> Consejo rápido
            </p>
            <p className={`text-xs mt-1.5 leading-relaxed ${isDark ? 'text-white/70' : 'text-blue-600'}`}>
              {tip.text}
            </p>
          </div>
        </div>
      )}
    </aside>
  )
}
