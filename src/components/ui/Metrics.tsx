import type { LucideIcon } from 'lucide-react'

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export function MetricCard({ icon: Icon, label, value, detail }: { icon: LucideIcon; label: string; value: string; detail: string }) {
  return (
    <div className="metric-card">
      <div className="metric-icon">
        <Icon size={18} />
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  )
}

export function SmallEmpty({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="small-empty">
      <Icon size={24} />
      <p>{text}</p>
    </div>
  )
}
