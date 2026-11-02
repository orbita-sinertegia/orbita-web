interface Props {
  name: string
  avatarUrl?: string | null
  size?: number
  isOnline?: boolean
}

export default function UserAvatar({ name, avatarUrl, size = 32, isOnline }: Props) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase()

  const dotSize = Math.max(8, Math.round(size * 0.28))

  const avatar = avatarUrl ? (
    <img
      src={avatarUrl}
      alt={name}
      style={{ width: size, height: size }}
      className="rounded-full object-cover shrink-0 border border-gray-200"
    />
  ) : (() => {
    const colors = [
      'bg-blue-500', 'bg-purple-500', 'bg-pink-500',
      'bg-green-500', 'bg-orange-500', 'bg-indigo-500',
    ]
    const color = colors[name.charCodeAt(0) % colors.length]
    return (
      <div
        style={{ width: size, height: size, fontSize: size * 0.38 }}
        className={`${color} rounded-full flex items-center justify-center text-white font-bold shrink-0`}
      >
        {initials}
      </div>
    )
  })()

  if (!isOnline) return avatar

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {avatar}
      <span
        style={{ width: dotSize, height: dotSize, bottom: 0, right: 0 }}
        className="absolute bg-green-500 border-2 border-white rounded-full"
      />
    </div>
  )
}
