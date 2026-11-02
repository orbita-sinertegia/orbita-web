import { useEffect, useMemo, useState } from 'react'
import { Check, Clock3, Copy, KeyRound, LoaderCircle, Mail, Plus, Search, ShieldCheck, Trash2, UserX, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import type { Client, User, WorkSchedule } from '../../types'
import UserAvatar from '../shared/UserAvatar'
import { defaultWorkSchedule, formatHour, resolvedWorkSchedule, WEEK_DAYS } from '../../lib/workSchedule'

type Tab = 'client' | 'team' | 'admin'
type Section = { key: string; label: string; description: string }
type Permission = { user_id: string; section_key: string; allowed: boolean }

const SECTIONS: Record<Tab, Section[]> = {
  admin: [
    ['overview', 'Proyectos', 'Consultar y administrar proyectos'],
    ['team', 'Carga del equipo', 'Distribuir trabajo y revisar disponibilidad'],
    ['team_tasks', 'Tareas del equipo', 'Completar y eliminar tareas de cualquier integrante'],
    ['calendar', 'Calendario general', 'Consultar fechas de todo el equipo'],
    ['performance', 'Rendimiento', 'Acceder a métricas del equipo'],
    ['mytasks', 'Mis tareas', 'Trabajar en sus tareas'],
    ['roadmap', 'Hoja de ruta', 'Consultar la planeación general'],
    ['client_roadmaps', 'Hoja de ruta de clientes', 'Buscar clientes y ver el resumen de todos los proyectos activos'],
    ['clientes', 'Clientes', 'Administrar clientes y asignaciones'],
    ['requests', 'Solicitudes', 'Autorizar solicitudes de clientes'],
    ['chat_team', 'Chat del equipo', 'Participar en conversaciones internas'],
    ['chat_clients', 'Chat con clientes', 'Conversar con clientes'],
    ['entregables', 'Entregables', 'Revisar y administrar entregables'],
    ['funnels', 'Embudos', 'Crear y modificar plantillas de proyectos'],
  ].map(([key, label, description]) => ({ key, label, description })),
  team: [
    ['tasks', 'Mis tareas', 'Consultar y trabajar en tareas asignadas'],
    ['calendar', 'Mi calendario', 'Ver fechas y compromisos'],
    ['roadmap', 'Hoja de ruta', 'Consultar la planeación de tareas'],
    ['client_roadmaps', 'Hoja de ruta de clientes', 'Ver el resumen de sus clientes asignados (apagada por defecto)'],
    ['chat_team', 'Chat del equipo', 'Participar en el chat interno'],
    ['chat_clients', 'Chat con clientes', 'Conversar con clientes asignados'],
    ['entregables', 'Entregables', 'Subir y consultar entregables'],
  ].map(([key, label, description]) => ({ key, label, description })),
  client: [
    ['mistareas', 'Mis tareas', 'Consultar tareas que requieren su participación'],
    ['progreso', 'Todas las tareas', 'Ver el avance completo'],
    ['area', 'Por área', 'Consultar trabajo por departamento'],
    ['calendario', 'Calendario', 'Ver fechas y compromisos'],
    ['roadmap', 'Hoja de ruta', 'Consultar la planeación del proyecto'],
    ['mihojaderuta', 'Mi hoja de ruta', 'Ver fases, hitos y lanzamiento de su proyecto'],
    ['chat', 'Chat con el equipo', 'Comunicarse con el equipo'],
    ['entregables', 'Entregables', 'Revisar archivos y versiones finales'],
  ].map(([key, label, description]) => ({ key, label, description })),
}

const DEFAULT_DEPARTMENTS = [
  ['edicion', 'Edición'], ['grabacion', 'Grabación'], ['diseno', 'Diseño'], ['copy', 'Copy'],
  ['webmaster', 'Webmaster'], ['trafficker', 'Trafficker'], ['lider', 'Líder'],
] as const
type WorkDepartment = { id: string; name: string }

interface Person {
  id: string
  userId?: string
  name: string
  email: string
  role: Tab
  subtitle: string
  active: boolean
  avatarUrl?: string | null
  isSuperAdmin?: boolean
}

export default function RolePermissionsManager() {
  const { user: currentUser } = useAuth()
  const [tab, setTab] = useState<Tab>('client')
  const [users, setUsers] = useState<User[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [departments, setDepartments] = useState<WorkDepartment[]>(DEFAULT_DEPARTMENTS.map(([id, name]) => ({ id, name })))
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [roleDefaults, setRoleDefaults] = useState<Record<string, boolean>>({})
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteLink, setInviteLink] = useState('')
  const [inviteStatus, setInviteStatus] = useState('')
  const [invite, setInvite] = useState({
    full_name: '',
    email: '',
    company: '',
    department: '',
  })
  const [invitePermissions, setInvitePermissions] = useState<Record<string, boolean>>({})
  const [newDepartment, setNewDepartment] = useState('')
  const [departmentOpen, setDepartmentOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [activeTaskCount, setActiveTaskCount] = useState(0)
  const [reassignTo, setReassignTo] = useState('')

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setLoading(true)
    const [usersResult, clientsResult, permissionsResult, defaultsResult, departmentsResult] = await Promise.all([
      supabase.from('users').select('*').order('full_name'),
      supabase.from('clients').select('*').order('name'),
      supabase.from('user_permissions').select('user_id, section_key, allowed'),
      supabase.from('role_permissions').select('role, section_key, allowed'),
      supabase.from('team_departments').select('id, name').eq('active', true).order('name'),
    ])
    setUsers((usersResult.data as User[]) || [])
    setClients((clientsResult.data as Client[]) || [])
    if (departmentsResult.data?.length) setDepartments(departmentsResult.data as WorkDepartment[])
    setPermissions((permissionsResult.data as Permission[]) || [])
    const defaults: Record<string, boolean> = {}
    ;(defaultsResult.data || []).forEach((row) => {
      defaults[`${row.role}:${row.section_key}`] = row.allowed
    })
    setRoleDefaults(defaults)
    if (usersResult.error || clientsResult.error || permissionsResult.error) setError('No fue posible cargar todos los usuarios y permisos.')
    setLoading(false)
  }

  const people = useMemo<Person[]>(() => {
    if (tab === 'client')
      return clients.filter(client => !client.directory_hidden).map((client) => {
        const linked = users.find((item) => item.id === client.user_id)
        return {
          id: client.id,
          userId: linked?.id,
          name: client.name,
          email: linked?.email || 'Invitación pendiente',
          role: 'client',
          subtitle: client.company || 'Cliente',
          active: client.active !== false && linked?.active !== false,
          avatarUrl: linked?.avatar_url || client.avatar_url,
        }
      })
    return users
      .filter((item) => item.role === tab && !item.directory_hidden)
      .map((item) => ({
        id: item.id,
        userId: item.id,
        name: item.full_name,
        email: item.email,
        role: tab,
        subtitle: departments.find((department) => department.id === item.department)?.name || item.department || (tab === 'admin' ? 'Administrador' : 'Sin departamento'),
        active: item.active !== false,
        avatarUrl: item.avatar_url,
        isSuperAdmin: item.is_super_admin,
      }))
  }, [tab, users, clients, departments])

  const visiblePeople = people.filter((person) => `${person.name} ${person.email}`.toLowerCase().includes(search.toLowerCase()))
  const groupedTeamPeople = useMemo(() => {
    const groups = new Map<string, Person[]>()
    visiblePeople.forEach((person) => {
      const key = person.subtitle || 'Sin departamento'
      groups.set(key, [...(groups.get(key) || []), person])
    })
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'es'))
  }, [visiblePeople])
  const selected = people.find((person) => person.id === selectedId) || visiblePeople[0]

  function allowed(sectionKey: string) {
    if (selected?.isSuperAdmin) return true
    const specific = permissions.find((row) => row.user_id === selected?.userId && row.section_key === sectionKey)
    if (specific) return specific.allowed
    return roleDefaults[`${tab}:${sectionKey}`] !== false
  }

  async function toggle(sectionKey: string) {
    if (!selected?.userId || selected.isSuperAdmin) return
    const next = !allowed(sectionKey)
    setSaving(sectionKey)
    const { error: saveError } = await supabase.from('user_permissions').upsert({ user_id: selected.userId, section_key: sectionKey, allowed: next }, { onConflict: 'user_id,section_key' })
    if (saveError) setError('No se pudo guardar el permiso individual.')
    else
      setPermissions((previous) => [
        ...previous.filter((row) => !(row.user_id === selected.userId && row.section_key === sectionKey)),
        { user_id: selected.userId!, section_key: sectionKey, allowed: next },
      ])
    setSaving('')
  }

  async function toggleAll() {
    if (!selected?.userId || selected.isSuperAdmin) return
    const sections = SECTIONS[tab]
    const next = !sections.every((section) => allowed(section.key))
    setSaving('all')
    const payload = sections.map((section) => ({
      user_id: selected.userId!,
      section_key: section.key,
      allowed: next,
    }))
    const { error: saveError } = await supabase.from('user_permissions').upsert(payload, { onConflict: 'user_id,section_key' })
    if (saveError) setError('No se pudieron guardar los permisos.')
    else {
      setPermissions((previous) => [...previous.filter((row) => row.user_id !== selected.userId), ...payload])
    }
    setSaving('')
  }

  async function updateDepartment(department: string) {
    if (!selected?.userId || (selected.role !== 'team' && selected.role !== 'admin')) return
    setSaving('department')
    setError('')
    const { error: saveError } = await supabase.from('users').update({ department: department || null }).eq('id', selected.userId)
    if (saveError) setError('No se pudo cambiar el departamento de esta persona.')
    else await load()
    setSaving('')
  }

  async function updateWorkSchedule(schedule: WorkSchedule) {
    if (!selected?.userId || (selected.role !== 'team' && selected.role !== 'admin')) return
    if (Object.values(schedule).some(day => day.enabled && (day.end <= day.start || day.start < 0 || day.end > 23))) {
      setError('En cada día activo, la hora de salida debe ser posterior a la entrada.')
      return
    }
    setSaving('work-schedule')
    setError('')
    const { error: saveError } = await supabase.from('users').update({ work_schedule: schedule }).eq('id', selected.userId)
    if (saveError) setError('No se pudo guardar la jornada laboral de esta persona.')
    else await load()
    setSaving('')
  }

  async function promoteToAdministrator() {
    if (!selected?.userId || selected.role !== 'team') return
    if (!window.confirm(`¿Asignar a ${selected.name} como administrador?\n\nConservará sus tareas e historial. Después podrás decidir exactamente qué secciones administrativas puede usar.`)) return
    setSaving('promote-admin')
    setError('')

    const { data: promoted, error: promoteError } = await supabase.rpc('set_user_access_role', {
      p_user_id: selected.userId,
      p_role: 'admin',
    })

    if (promoteError || !promoted) {
      setError(promoteError?.message ? `No se pudo asignar como administrador: ${promoteError.message}` : 'No se pudo cambiar el rol de esta persona.')
      setSaving('')
      return
    }

    // Los permisos anteriores pertenecían al rol Equipo. El nuevo administrador
    // inicia con la configuración general del rol y después puede personalizarse.
    const { error: permissionError } = await supabase.from('user_permissions').delete().eq('user_id', selected.userId)
    if (permissionError) setError('La persona ya es administradora, pero no se pudieron reiniciar sus permisos anteriores. Revísalos en la pestaña Administradores.')

    const promotedUserId = selected.userId
    await load()
    setTab('admin')
    setSelectedId(promotedUserId)
    setSearch('')
    setSaving('')
  }

  async function returnToTeam() {
    if (!selected?.userId || selected.role !== 'admin' || selected.isSuperAdmin || selected.userId === currentUser?.id) return
    if (!window.confirm(`¿Regresar a ${selected.name} al Equipo?\n\nConservará sus tareas, historial y archivos. Dejará de tener acceso administrativo.`)) return
    setSaving('return-team')
    setError('')
    const { data: updated, error: updateError } = await supabase.rpc('set_user_access_role', {
      p_user_id: selected.userId,
      p_role: 'team',
    })
    if (updateError || !updated) {
      setError(updateError?.message ? `No se pudo regresar al Equipo: ${updateError.message}` : 'No se pudo cambiar el rol de esta persona.')
      setSaving('')
      return
    }
    await supabase.from('user_permissions').delete().eq('user_id', selected.userId)
    const userId = selected.userId
    await load()
    setTab('team')
    setSelectedId(userId)
    setSearch('')
    setSaving('')
  }

  async function createDepartment() {
    const name = newDepartment.trim()
    if (!name) return
    const id = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    if (!id) return
    setSaving('new-department')
    setError('')
    const { error: saveError } = await supabase.from('team_departments').upsert({ id, name, active: true }, { onConflict: 'id' })
    if (saveError) {
      setError('No se pudo crear el departamento.')
      setSaving('')
      return
    }
    setNewDepartment('')
    setDepartmentOpen(false)
    await load()
    setSaving('')
  }

  async function toggleAccess() {
    if (!selected || selected.isSuperAdmin || selected.userId === currentUser?.id) return
    const nextActive = !selected.active
    if (!window.confirm(nextActive ? `¿Reactivar el acceso de ${selected.name}?` : `¿Desactivar el acceso de ${selected.name}? El historial se conservará.`)) return
    setSaving('delete')
    if (selected.role === 'client') {
      await supabase.from('clients').update({ active: nextActive }).eq('id', selected.id)
      if (selected.userId) await supabase.from('users').update({ active: nextActive }).eq('id', selected.userId)
    } else if (selected.userId) await supabase.from('users').update({ active: nextActive }).eq('id', selected.userId)
    await load()
    setSaving('')
  }

  async function prepareRemoval() {
    if (!selected || selected.isSuperAdmin || selected.userId === currentUser?.id) return
    setSaving('inspect-remove')
    setError('')
    setReassignTo('')
    let count = 0
    if (selected.userId) {
      const { count: taskCount, error: taskError } = await supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('assigned_to', selected.userId)
        .neq('status', 'completada')
        .is('archived_at', null)
      if (taskError) {
        setError('No fue posible revisar las tareas activas de esta persona.')
        setSaving('')
        return
      }
      count = taskCount || 0
    }
    setActiveTaskCount(count)
    setRemoveOpen(true)
    setSaving('')
  }

  async function removePerson() {
    if (!selected || selected.isSuperAdmin || selected.userId === currentUser?.id) return
    if (activeTaskCount > 0 && !reassignTo) {
      setError('Selecciona a quién se reasignarán las tareas activas antes de eliminar a la persona.')
      return
    }

    setSaving('remove')
    setError('')
    if (selected.userId && activeTaskCount > 0) {
      const { error: taskError } = await supabase
        .from('tasks')
        .update({ assigned_to: reassignTo })
        .eq('assigned_to', selected.userId)
        .neq('status', 'completada')
        .is('archived_at', null)
      if (taskError) {
        setError('No se pudieron reasignar las tareas activas. La persona no fue eliminada.')
        setSaving('')
        return
      }
    }
    if (selected.role === 'client') {
      const { error: clientError } = await supabase.from('clients').update({ active: false, directory_hidden: true }).eq('id', selected.id)
      if (clientError) { setError('No se pudo eliminar al cliente de la lista.'); setSaving(''); return }
      if (selected.userId) {
        const { error: userError } = await supabase.from('users').update({ active: false, directory_hidden: true }).eq('id', selected.userId)
        if (userError) { setError('El cliente se ocultó, pero no fue posible actualizar su cuenta de acceso.'); setSaving(''); return }
      }
    } else if (selected.userId) {
      const { error: userError } = await supabase.from('users').update({ active: false, directory_hidden: true }).eq('id', selected.userId)
      if (userError) { setError('No se pudo eliminar a la persona de la lista.'); setSaving(''); return }
    }
    setRemoveOpen(false)
    setSelectedId('')
    await load()
    setSaving('')
  }

  function resetInvite() {
    setInvite({ full_name: '', email: '', company: '', department: '' })
    setInvitePermissions(Object.fromEntries(SECTIONS[tab].map((section) => [section.key, roleDefaults[`${tab}:${section.key}`] !== false])))
    setInviteLink('')
    setInviteStatus('')
    setError('')
  }

  async function createInvitation(event: React.FormEvent) {
    event.preventDefault()
    if (!invite.full_name.trim() || !invite.email.trim()) return
    setSaving('invite')
    setInviteStatus('')
    let url: string
    const permissionPreset = Object.fromEntries(SECTIONS[tab].map((section) => [section.key, invitePermissions[section.key] !== false]))
    if (tab === 'client') {
      const { data: client, error: clientError } = await supabase
        .from('clients')
        .insert({
          name: invite.full_name.trim(),
          company: invite.company.trim() || invite.full_name.trim(),
          active: true,
        })
        .select('id')
        .single()
      if (clientError || !client) {
        setError('No se pudo crear el cliente.')
        setSaving('')
        return
      }
      const { data, error: invitationError } = await supabase
        .from('client_invitations')
        .insert({
          client_id: client.id,
          email: invite.email.trim(),
          permissions: permissionPreset,
        })
        .select('id')
        .single()
      if (invitationError || !data) {
        setError('No se pudo crear la invitación.')
        setSaving('')
        return
      }
      url = `https://agencia.sinertegia.com?invite=${data.id}`
    } else {
      const { data, error: invitationError } = await supabase
        .from('team_invitations')
        .insert({
          email: invite.email.trim(),
          full_name: invite.full_name.trim(),
          role: tab,
          department: invite.department || null,
          permissions: permissionPreset,
        })
        .select('id')
        .single()
      if (invitationError || !data) {
        setError('No se pudo crear la invitación.')
        setSaving('')
        return
      }
      url = `https://agencia.sinertegia.com?team_invite=${data.id}`
    }
    setInviteLink(url)
    const roleLabel = tab === 'admin' ? 'administrador' : tab === 'team' ? 'integrante del equipo' : 'cliente'
    const { error: mailError } = await supabase.functions.invoke('send-user-invitation', {
      body: {
        email: invite.email.trim(),
        fullName: invite.full_name.trim(),
        roleLabel,
        inviteUrl: url,
      },
    })
    setInviteStatus(mailError ? 'Invitación creada. Configura la función de correo o comparte el enlace.' : 'Invitación enviada por correo correctamente.')
    setSaving('')
    await load()
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(inviteLink)
    setInviteStatus('Enlace copiado.')
  }

  function personRow(person: Person) {
    return (
      <button
        key={person.id}
        onClick={() => setSelectedId(person.id)}
        className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${selected?.id === person.id ? 'border-blue-300 bg-blue-50' : 'border-transparent bg-white hover:border-gray-200'}`}
      >
        <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size={40} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 truncate text-sm font-bold text-gray-800">{person.name}{person.isSuperAdmin && <ShieldCheck size={14} className="text-amber-500" />}</span>
          <span className="block truncate text-xs text-gray-400">{person.email}</span>
        </span>
        <span className={`h-2.5 w-2.5 rounded-full ${person.active ? 'bg-green-500' : 'bg-gray-300'}`} />
      </button>
    )
  }

  if (loading)
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-sm text-gray-400">
        <LoaderCircle className="animate-spin" size={18} /> Cargando usuarios y permisos...
      </div>
    )

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-blue-600">
            <KeyRound size={14} /> Administración
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Usuarios y permisos</h1>
          <p className="mt-1 text-sm text-gray-500">Administra el acceso individual de clientes, equipo y administradores.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            resetInvite()
            setInviteOpen(true)
          }}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700"
        >
          <Plus size={17} /> Agregar persona
        </button>
      </header>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
        {(
          [
            ['client', 'Clientes'],
            ['team', 'Equipo'],
            ['admin', 'Administradores'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => {
              setTab(value)
              setSearch('')
            }}
            className={`rounded-lg px-5 py-2 text-sm font-semibold ${tab === value ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            {label} <span className="ml-1 opacity-70">{value === tab ? people.length : ''}</span>
          </button>
        ))}
      </div>

      <div className="grid min-h-[620px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm lg:grid-cols-[340px_1fr]">
        <aside className="border-r border-gray-200 bg-gray-50/60 p-4">
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
            <Search size={15} className="text-gray-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar persona..." className="w-full bg-transparent text-sm outline-none" />
          </div>
          <div className="space-y-4">
            {tab === 'team'
              ? groupedTeamPeople.map(([department, members]) => (
                <section key={department}>
                  <div className="mb-1.5 flex items-center justify-between px-1 text-[11px] font-bold uppercase tracking-wider text-gray-500"><span>{department}</span><span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] text-gray-600">{members.length}</span></div>
                  <div className="space-y-2">{members.map(personRow)}</div>
                </section>
              ))
              : <div className="space-y-2">{visiblePeople.map(personRow)}</div>}
          </div>
          {visiblePeople.length === 0 && <p className="py-12 text-center text-sm text-gray-400">No hay personas en esta sección.</p>}
        </aside>

        <main className="p-5 lg:p-7">
          {!selected ? (
            <div className="grid h-full place-items-center text-sm text-gray-400">Selecciona o agrega una persona.</div>
          ) : (
            <>
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-5">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold text-gray-900">{selected.name}</h2>
                    {selected.isSuperAdmin && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-700">Superadmin</span>}
                  </div>
                  <p className="mt-1 text-sm text-gray-500">
                    {selected.subtitle} · {selected.email}
                  </p>
                </div>
                {!selected.isSuperAdmin && (
                  <div className="flex flex-wrap gap-2">
                    {selected.role === 'team' && (
                      <button
                        onClick={promoteToAdministrator}
                        disabled={!!saving || !selected.active}
                        className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {saving === 'promote-admin' ? <LoaderCircle className="animate-spin" size={14} /> : <ShieldCheck size={14} />} Asignar administrador
                      </button>
                    )}
                    {selected.role === 'admin' && (
                      <button
                        onClick={returnToTeam}
                        disabled={!!saving}
                        className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {saving === 'return-team' ? <LoaderCircle className="animate-spin" size={14} /> : <UserX size={14} />} Regresar a Equipo
                      </button>
                    )}
                    <button
                      onClick={toggleAccess}
                      disabled={saving === 'delete'}
                      className="flex items-center gap-2 rounded-lg border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving === 'delete' ? <LoaderCircle className="animate-spin" size={14} /> : <UserX size={14} />} {selected.active ? 'Desactivar acceso' : 'Reactivar acceso'}
                    </button>
                    <button
                      onClick={prepareRemoval}
                      disabled={saving === 'remove' || saving === 'inspect-remove'}
                      className="flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      {saving === 'remove' || saving === 'inspect-remove' ? <LoaderCircle className="animate-spin" size={14} /> : <Trash2 size={14} />} Eliminar persona
                    </button>
                  </div>
                )}
              </div>
              {(selected.role === 'team' || selected.role === 'admin') && selected.userId && (
                <div className="mb-5 rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="min-w-[240px] flex-1 text-xs font-bold text-gray-700">
                      Rol operativo de {selected.name}
                      <select value={users.find((user) => user.id === selected.userId)?.department || ''} onChange={(event) => void updateDepartment(event.target.value)} disabled={saving === 'department'} className="mt-1.5 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm font-medium outline-none focus:border-blue-500">
                        <option value="">Sin rol operativo</option>
                        {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                      </select>
                    </label>
                    <button type="button" onClick={() => setDepartmentOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-2.5 text-xs font-bold text-blue-600 hover:bg-blue-50"><Plus size={14} /> Nuevo rol operativo</button>
                  </div>
                  <p className="mt-2 text-xs text-indigo-600">Este rol es independiente de sus permisos de administrador y se mostrará en Tareas del equipo.</p>
                  <WeeklyScheduleEditor key={`${selected.userId}-${JSON.stringify(users.find(user => user.id === selected.userId)?.work_schedule)}`} user={users.find(user => user.id === selected.userId)} saving={saving === 'work-schedule'} onSave={updateWorkSchedule} />
                </div>
              )}
              {!selected.userId ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  Este cliente todavía no ha aceptado su invitación. Podrás personalizar sus permisos cuando cree su cuenta.
                </div>
              ) : (
                <>
                  <div className="mb-3 flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
                    <div>
                      <p className="text-sm font-bold text-blue-900">Acceso a todas las secciones</p>
                      <p className="text-xs text-blue-600">Control individual para esta persona</p>
                    </div>
                    <button
                      onClick={toggleAll}
                      disabled={selected.isSuperAdmin || !!saving}
                      className={`relative h-7 w-12 rounded-full ${SECTIONS[tab].every((section) => allowed(section.key)) ? 'bg-blue-600' : 'bg-gray-300'} disabled:opacity-60`}
                    >
                      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${SECTIONS[tab].every((section) => allowed(section.key)) ? 'left-6' : 'left-1'}`} />
                    </button>
                  </div>
                  <div className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                    {SECTIONS[tab].map((section) => {
                      const enabled = allowed(section.key)
                      return (
                        <div key={section.key} className="flex items-center gap-3 px-4 py-3.5">
                          <span className={`grid h-9 w-9 place-items-center rounded-lg ${enabled ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
                            <Check size={16} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-gray-800">{section.label}</span>
                            <span className="block truncate text-xs text-gray-400">{section.description}</span>
                          </span>
                          <button
                            onClick={() => toggle(section.key)}
                            disabled={selected.isSuperAdmin || !!saving}
                            className={`relative h-6 w-11 rounded-full ${enabled ? 'bg-blue-600' : 'bg-gray-300'} disabled:opacity-60`}
                          >
                            <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${enabled ? 'left-6' : 'left-1'}`} />
                            {saving === section.key && <LoaderCircle className="absolute left-3.5 top-1.5 animate-spin text-white" size={11} />}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  {selected.isSuperAdmin && (
                    <div className="mt-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      <ShieldCheck size={18} className="shrink-0" />
                      El superadmin siempre conserva acceso completo.
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </main>
      </div>

      {inviteOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
          <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 p-5">
              <div>
                <h2 className="font-bold text-gray-900">Agregar {tab === 'admin' ? 'administrador' : tab === 'team' ? 'integrante del equipo' : 'cliente'}</h2>
                <p className="text-xs text-gray-400">Se enviará una invitación para crear su acceso.</p>
              </div>
              <button onClick={() => setInviteOpen(false)}>
                <X size={19} />
              </button>
            </div>
            <form onSubmit={createInvitation} className="space-y-4 overflow-y-auto p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-gray-600">
                  Nombre completo
                  <input
                    value={invite.full_name}
                    onChange={(event) =>
                      setInvite((value) => ({
                        ...value,
                        full_name: event.target.value,
                      }))
                    }
                    required
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-xs font-semibold text-gray-600">
                  Correo
                  <input
                    type="email"
                    value={invite.email}
                    onChange={(event) =>
                      setInvite((value) => ({
                        ...value,
                        email: event.target.value,
                      }))
                    }
                    required
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>
              {tab === 'client' ? (
                <label className="block text-xs font-semibold text-gray-600">
                  Empresa
                  <input
                    value={invite.company}
                    onChange={(event) =>
                      setInvite((value) => ({
                        ...value,
                        company: event.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                </label>
              ) : (
                <label className="block text-xs font-semibold text-gray-600">
                  Departamento
                  <select
                    value={invite.department}
                    onChange={(event) =>
                      setInvite((value) => ({
                        ...value,
                        department: event.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="">Sin departamento</option>
                    {departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </select>
                  {tab === 'team' && <button type="button" onClick={() => setDepartmentOpen(true)} className="mt-2 flex items-center gap-1 text-xs font-bold text-blue-600"><Plus size={13} /> Crear nuevo departamento</button>}
                </label>
              )}
              <section>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-gray-800">Accesos iniciales</p>
                    <p className="text-xs text-gray-400">Elige qué podrá ver esta persona al entrar.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const all = SECTIONS[tab].every((section) => invitePermissions[section.key] !== false)
                      setInvitePermissions(Object.fromEntries(SECTIONS[tab].map((section) => [section.key, !all])))
                    }}
                    className="shrink-0 text-xs font-bold text-blue-600"
                  >
                    {SECTIONS[tab].every((section) => invitePermissions[section.key] !== false) ? 'Quitar todos' : 'Permitir todos'}
                  </button>
                </div>
                <div className="divide-y divide-gray-100 rounded-xl border border-gray-200">
                  {SECTIONS[tab].map((section) => {
                    const enabled = invitePermissions[section.key] !== false
                    return (
                      <label key={section.key} className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={() =>
                            setInvitePermissions((previous) => ({
                              ...previous,
                              [section.key]: !enabled,
                            }))
                          }
                          className="h-4 w-4 rounded border-gray-300 text-blue-600"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-gray-700">{section.label}</span>
                          <span className="block truncate text-xs text-gray-400">{section.description}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </section>
              {inviteStatus && <p className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">{inviteStatus}</p>}
              {inviteLink && (
                <div className="flex gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
                  <input readOnly value={inviteLink} className="min-w-0 flex-1 bg-transparent text-xs text-gray-500 outline-none" />
                  <button type="button" onClick={copyInvite} className="flex items-center gap-1 text-xs font-bold text-blue-600">
                    <Copy size={13} /> Copiar
                  </button>
                </div>
              )}
              <button disabled={saving === 'invite'} className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2.5 text-sm font-bold text-white disabled:opacity-60">
                {saving === 'invite' ? <LoaderCircle className="animate-spin" size={16} /> : <Mail size={16} />} Crear y enviar invitación
              </button>
            </form>
          </div>
        </div>
      )}
      {departmentOpen && (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-black/50 p-4" onMouseDown={() => setDepartmentOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div><h3 className="text-lg font-bold text-gray-900">Nuevo rol operativo</h3><p className="mt-1 text-sm text-gray-500">Se agregará a la organización y al formulario de invitación.</p></div>
              <button type="button" onClick={() => setDepartmentOpen(false)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
            </div>
            <label className="mt-5 block text-xs font-bold text-gray-700">Nombre del rol operativo *
              <input value={newDepartment} onChange={(event) => setNewDepartment(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createDepartment() }} autoFocus placeholder="Ej. Community Manager" className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            </label>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setDepartmentOpen(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600">Cancelar</button>
              <button type="button" onClick={() => void createDepartment()} disabled={!newDepartment.trim() || saving === 'new-department'} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving === 'new-department' ? <LoaderCircle className="animate-spin" size={16} /> : <Plus size={16} />} Crear rol</button>
            </div>
          </div>
        </div>
      )}
      {removeOpen && selected && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-4" onMouseDown={() => saving !== 'remove' && setRemoveOpen(false)}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Eliminar a {selected.name}</h3>
                <p className="mt-1 text-sm text-gray-500">Perderá el acceso y dejará de aparecer en el directorio.</p>
              </div>
              <button type="button" onClick={() => setRemoveOpen(false)} disabled={saving === 'remove'} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
            </div>

            {activeTaskCount > 0 ? (
              <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-bold text-amber-900">Tiene {activeTaskCount} {activeTaskCount === 1 ? 'tarea activa' : 'tareas activas'}</p>
                <p className="mt-1 text-xs text-amber-700">Debes elegir quién continuará estas actividades. Las tareas completadas conservarán a {selected.name} como responsable histórico.</p>
                <label className="mt-4 block text-xs font-bold text-gray-700">
                  Reasignar tareas activas a *
                  <select value={reassignTo} onChange={(event) => setReassignTo(event.target.value)} className="mt-1.5 w-full rounded-lg border border-amber-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500">
                    <option value="">Selecciona una persona</option>
                    {users.filter((user) => user.id !== selected.userId && user.active !== false && !user.directory_hidden && (user.role === 'team' || user.role === 'admin')).map((user) => (
                      <option key={user.id} value={user.id}>{user.full_name}{user.department ? ` · ${user.department}` : ''}</option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <div className="mt-5 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">Esta persona no tiene tareas activas pendientes de reasignación.</div>
            )}

            <p className="mt-4 text-xs text-gray-500">Sus proyectos, comentarios, entregables, tiempos y reportes anteriores no se borrarán.</p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setRemoveOpen(false)} disabled={saving === 'remove'} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancelar</button>
              <button type="button" onClick={removePerson} disabled={saving === 'remove' || (activeTaskCount > 0 && !reassignTo)} className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">
                {saving === 'remove' ? <LoaderCircle className="animate-spin" size={16} /> : <Trash2 size={16} />} {activeTaskCount > 0 ? 'Reasignar y eliminar' : 'Eliminar persona'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function WeeklyScheduleEditor({ user, saving, onSave }: { user?: User; saving: boolean; onSave: (schedule: WorkSchedule) => Promise<void> }) {
  const [schedule, setSchedule] = useState<WorkSchedule>(() => user ? resolvedWorkSchedule(user) : defaultWorkSchedule())
  const hours = Array.from({ length: 24 }, (_, hour) => hour)

  function updateDay(day: string, patch: Partial<WorkSchedule[string]>) {
    setSchedule(current => ({ ...current, [day]: { ...current[day], ...patch } }))
  }

  return <div className="mt-4 border-t border-indigo-100 pt-4">
    <div className="mb-1 flex items-center gap-2 text-sm font-bold text-gray-800"><Clock3 size={16} className="text-blue-600" /> Jornada laboral semanal</div>
    <p className="mb-3 text-xs text-indigo-600">Activa los días laborables y define una entrada y salida diferente para cada uno.</p>
    <div className="space-y-2">
      {WEEK_DAYS.map(day => {
        const value = schedule[day.key]
        return <div key={day.key} className={`grid items-center gap-2 rounded-lg border px-3 py-2 sm:grid-cols-[120px_1fr_1fr] ${value.enabled ? 'border-blue-100 bg-white' : 'border-gray-200 bg-gray-50'}`}>
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-gray-700"><input type="checkbox" checked={value.enabled} onChange={event => updateDay(day.key, { enabled: event.target.checked })} className="h-4 w-4 accent-blue-600" />{day.label}</label>
          <label className="text-[11px] font-semibold text-gray-500">Entrada<select value={value.start} disabled={!value.enabled} onChange={event => updateDay(day.key, { start: Number(event.target.value) })} className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs disabled:opacity-50">{hours.map(hour => <option key={hour} value={hour}>{formatHour(hour)}</option>)}</select></label>
          <label className="text-[11px] font-semibold text-gray-500">Salida<select value={value.end} disabled={!value.enabled} onChange={event => updateDay(day.key, { end: Number(event.target.value) })} className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs disabled:opacity-50">{hours.map(hour => <option key={hour} value={hour}>{formatHour(hour)}</option>)}</select></label>
        </div>
      })}
    </div>
    <button type="button" onClick={() => void onSave(schedule)} disabled={saving} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">{saving && <LoaderCircle size={14} className="animate-spin" />} Guardar jornada semanal</button>
    <p className="mt-2 text-xs text-indigo-600">Al terminar la jornada configurada de cada día, el tiempo adicional se registrará como horas extra.</p>
  </div>
}
