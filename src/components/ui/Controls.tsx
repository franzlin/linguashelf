import type { ReactNode } from 'react'

export function OptionSegment<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
  ariaLabel?: string
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button key={option.value} type="button" className={value === option.value ? 'active' : ''} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Segmented({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: string[]
  value: string
  onChange: (value: string) => void
  ariaLabel?: string
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button key={option} type="button" className={value === option ? 'active' : ''} onClick={() => onChange(option)}>
          {option}
        </button>
      ))}
    </div>
  )
}

export function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="setting-row">
      <h2>{title}</h2>
      <div>{children}</div>
    </article>
  )
}

export function StatusItem({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className={ok ? 'status-item ok' : 'status-item'}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
