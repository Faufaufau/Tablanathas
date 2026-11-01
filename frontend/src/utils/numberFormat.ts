export interface NumberDisplayOptions {
  minimumFractionDigits?: number
  maximumFractionDigits?: number
}

const EXACT_NUMBER_PATTERN = /^([+-]?)(\d+)(?:[.,](\d+))?$/

/**
 * Formate un nombre pour l'interface : apostrophe ASCII pour les milliers
 * et virgule pour les décimales. Les chaînes numériques exactes sont traitées
 * sans conversion en Number afin de préserver les très grands scores.
 */
export function formatNumber(
  value: string | number | null | undefined,
  options?: NumberDisplayOptions,
): string {
  if (value === null || value === undefined || value === '') return '—'

  const source = String(value).trim()
  if (!source) return '—'

  if (!options) {
    const exactMatch = source.match(EXACT_NUMBER_PATTERN)
    if (exactMatch) {
      const [, sign, integerPart, decimalPart] = exactMatch
      const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, "'")
      return `${sign}${groupedInteger}${decimalPart === undefined ? '' : `,${decimalPart}`}`
    }
  }

  const parsed = typeof value === 'number' ? value : Number(source.replace(',', '.'))
  if (!Number.isFinite(parsed)) return source

  const formatter = new Intl.NumberFormat('fr-FR', {
    useGrouping: true,
    maximumFractionDigits: 3,
    ...options,
  })

  return formatter.formatToParts(parsed)
    .map((part) => part.type === 'group' ? "'" : part.value)
    .join('')
}

export function formatFixedNumber(
  value: string | number | null | undefined,
  fractionDigits = 1,
): string {
  if (value === null || value === undefined || value === '') return '—'
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
  if (!Number.isFinite(parsed)) return String(value)
  return formatNumber(parsed, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
}
