import logoImg from '../../assets/logo.png'

export default function Logo({ size = 40 }: { size?: number }) {
  return (
    <img
      src={logoImg}
      alt="Sinertegia Logo"
      width={size}
      height={size}
      style={{ objectFit: 'contain' }}
    />
  )
}
