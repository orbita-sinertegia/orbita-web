import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import UserAvatar from './UserAvatar'

export default function BirthdayCelebration() {
  const { user, session } = useAuth()
  const [visible, setVisible] = useState(false)
  const birthDate = session?.user?.user_metadata?.birth_date as string | undefined
  const todayKey = new Date().toLocaleDateString('en-CA')
  const isBirthday = useMemo(() => {
    if (!birthDate) return false
    const [, month, day] = birthDate.split('-').map(Number)
    const today = new Date()
    return today.getMonth() + 1 === month && today.getDate() === day
  }, [birthDate, todayKey])

  useEffect(() => {
    if (isBirthday && localStorage.getItem(`birthday-seen-${user?.id}`) !== todayKey) setVisible(true)
  }, [isBirthday, todayKey, user?.id])
  if (!visible || !user) return null
  const close = () => { localStorage.setItem(`birthday-seen-${user.id}`, todayKey); setVisible(false) }
  return <div className="birthday-layer"><div className="birthday-confetti">{Array.from({ length: 56 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 14) * .09}s` }} />)}</div><div className="birthday-balloon left">🎈</div><div className="birthday-balloon right">🎈</div><section className="birthday-card"><div className="birthday-card-top"><UserAvatar name={user.full_name} avatarUrl={user.avatar_url} size={92} /></div><div className="birthday-card-body"><div className="text-3xl">🎉 🎂 🎉</div><h2>¡Feliz cumpleaños, {session?.user?.user_metadata?.first_names?.split(' ')[0] || user.full_name.split(' ')[0]}!</h2><p>Todo el equipo de Sinertegia te desea un excelente día y muchos proyectos increíbles.</p><button onClick={close}>¡Gracias! 🎂</button></div></section></div>
}
