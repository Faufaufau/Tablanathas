
import { formatNumber } from '../utils/numberFormat'

interface StatCardProps {
  label: string
  value: string | number
  description?: string
}

export default function StatCard({
  label,
  value,
  description,
}: StatCardProps) {
  return (
    <article className="stat-card">
      <p className="stat-card__label">{label}</p>
      <p className="stat-card__value">{typeof value === 'number' ? formatNumber(value) : value}</p>
      {description && (
        <p className="stat-card__description">{description}</p>
      )}
    </article>
  )
}
