import Logo from './Logo'
import TopBarActions from './TopBarActions'

export default function Navbar() {
  return (
    <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shadow-sm">
      <div className="flex items-center gap-3">
        <Logo size={36} />
        <div>
          <h1 className="text-base font-bold text-gray-900 leading-tight">Sinertegia Launch 57</h1>
          <p className="text-xs text-gray-400">Gestión de proyectos</p>
        </div>
      </div>

      <TopBarActions />
    </nav>
  )
}
