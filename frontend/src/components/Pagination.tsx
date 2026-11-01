import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatNumber } from '../utils/numberFormat'

interface PaginationProps {
  page: number
  pageSize: number
  totalItems: number
  onPageChange: (page: number) => void
}

export default function Pagination({ page, pageSize, totalItems, onPageChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const safePage = Math.min(page, totalPages)
  if (totalItems <= pageSize) return null
  const start = (safePage - 1) * pageSize + 1
  const end = Math.min(safePage * pageSize, totalItems)
  const buttons: number[] = []
  const first = Math.max(1, Math.min(safePage - 2, totalPages - 4))
  for (let value = first; value <= Math.min(totalPages, first + 4); value += 1) buttons.push(value)

  return (
    <nav className="pagination" aria-label="Pagination du classement">
      <span className="pagination__count">{formatNumber(start)}–{formatNumber(end)} sur {formatNumber(totalItems)}</span>
      <div className="pagination__controls">
        <button type="button" aria-label="Page précédente" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)}><ChevronLeft size={16} /> Précédent</button>
        {buttons.map((value) => (
          <button type="button" key={value} className={value === safePage ? 'is-current' : ''} aria-current={value === safePage ? 'page' : undefined} onClick={() => onPageChange(value)}>{formatNumber(value)}</button>
        ))}
        <button type="button" aria-label="Page suivante" disabled={safePage >= totalPages} onClick={() => onPageChange(safePage + 1)}>Suivant <ChevronRight size={16} /></button>
      </div>
    </nav>
  )
}
