export const RED = '\x1b[31m'
export const GREEN = '\x1b[32m'
export const YELLOW = '\x1b[33m'
export const DIM = '\x1b[2m'
export const BOLD = '\x1b[1m'
export const RESET = '\x1b[0m'

export const formatRelativeTime = (iso: string): string => {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso

  const diffMs = Date.now() - d.getTime()
  if (diffMs < 0) return 'just now'

  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`

  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`

  const years = Math.floor(months / 12)
  return `${years}y ago`
}

export const formatTimestamp = (iso: string): string => {
  return formatRelativeTime(iso)
}

/** Truncate text to maxLen, appending \u2026 (ellipsis) if it exceeds the limit */
export const truncate = (text: string, maxLen: number): string => {
  if (maxLen <= 0) return ''
  if (text.length <= maxLen) return text
  if (maxLen <= 1) return '\u2026'
  return text.substring(0, maxLen - 1) + '\u2026'
}

/**
 * Compute available width for the last (flex) column in a table.
 * Falls back to fallbackWidth when terminal width is unavailable (piped output, CI).
 */
export const getFlexColumnWidth = (
  fixedColumnsWidth: number,
  minWidth = 15,
  fallbackWidth = 30,
): number => {
  const termWidth = process.stdout.columns
  if (!termWidth) return fallbackWidth
  const available = termWidth - fixedColumnsWidth - 2 // 2 for leading indent
  return Math.max(available, minWidth)
}

/** Colorize a status string (pending=yellow, approved=green, rejected=red). Pads before wrapping to avoid ANSI length issues with padEnd. */
export const colorizeStatus = (status: string, padWidth = 0): string => {
  const padded = padWidth > 0 ? status.padEnd(padWidth) : status
  switch (status) {
    case 'pending':
      return `${YELLOW}${padded}${RESET}`
    case 'approved':
      return `${GREEN}${padded}${RESET}`
    case 'rejected':
      return `${RED}${padded}${RESET}`
    default:
      return padded
  }
}

export const printChangeSummary = (meta: {
  changeId?: unknown
  status?: unknown
  project?: unknown
  env?: unknown
  proposedBy?: unknown
  reason?: unknown
  createdAt?: unknown
}): void => {
  console.log(`\n${BOLD}Change:${RESET}  ${meta.changeId}`)
  console.log(`${BOLD}Status:${RESET}  ${meta.status}`)
  console.log(`${BOLD}Project:${RESET} ${meta.project}/${meta.env}`)
  console.log(`${BOLD}By:${RESET}      ${meta.proposedBy}`)
  console.log(`${BOLD}Reason:${RESET}  ${meta.reason}`)
  if (meta.createdAt) {
    console.log(`${BOLD}Date:${RESET}    ${formatRelativeTime(String(meta.createdAt))}`)
  }
}
