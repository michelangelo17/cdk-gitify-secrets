export const RED = '\x1b[31m'
export const GREEN = '\x1b[32m'
export const YELLOW = '\x1b[33m'
export const DIM = '\x1b[2m'
export const BOLD = '\x1b[1m'
export const RESET = '\x1b[0m'

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
    console.log(`${BOLD}Date:${RESET}    ${meta.createdAt}`)
  }
}
