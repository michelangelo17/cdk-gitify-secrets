import {
  GetSecretValueCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager'
import { Command } from 'commander'
import type { CliConfig } from '../auth'
import { requireConfig, apiRequest } from '../auth'
import { createSmClient, resolveSecretPrefix } from '../aws'
import {
  RED, GREEN, YELLOW, DIM, RESET,
  printChangeSummary,
} from '../formatting'

export interface ReviewResult {
  readonly changeId: string
  readonly project: string
  readonly env: string
  readonly status: string
  readonly proposedBy: string
  readonly reason: string
  readonly createdAt: string
  readonly diff: DiffEntry[]
  readonly added: Record<string, string>
  readonly removed: Record<string, string>
  readonly modified: Record<string, { old: string; new: string }>
  readonly unchanged: Record<string, string>
}

interface DiffEntry {
  readonly type: 'added' | 'removed' | 'modified'
  readonly key: string
}

export const reviewChange = async (
  changeId: string,
  config: CliConfig,
): Promise<ReviewResult | undefined> => {
  const meta = await apiRequest('GET', `/changes/${changeId}/diff`, config)
  if (meta.error) {
    console.error(`Error: ${meta.error}`)
    return undefined
  }

  const prefix = resolveSecretPrefix(config)
  const smClient = createSmClient(config)

  const stagingSecretName = `${prefix}pending/${changeId}`
  let proposed: Record<string, string> = {}
  try {
    const staging = await smClient.send(
      new GetSecretValueCommand({ SecretId: stagingSecretName }),
    )
    if (staging.SecretString) {
      const parsed = JSON.parse(staging.SecretString) as {
        proposed?: Record<string, string>
      }
      proposed = parsed.proposed ?? {}
    }
  } catch (e) {
    if (e instanceof ResourceNotFoundException) {
      console.error('Staging secret not found. The change may have expired.')
      return undefined
    }
    throw e
  }

  const project = String(meta.project)
  const env = String(meta.env)
  const realSecretName = `${prefix}${project}/${env}`
  let live: Record<string, string> = {}
  try {
    const current = await smClient.send(
      new GetSecretValueCommand({ SecretId: realSecretName }),
    )
    if (current.SecretString) {
      live = JSON.parse(current.SecretString)
    }
  } catch (e) {
    if (!(e instanceof ResourceNotFoundException)) throw e
  }

  const allKeys = new Set([...Object.keys(proposed), ...Object.keys(live)])
  const added: Record<string, string> = {}
  const removed: Record<string, string> = {}
  const modified: Record<string, { old: string; new: string }> = {}
  const unchanged: Record<string, string> = {}

  for (const key of [...allKeys].sort()) {
    const inProposed = key in proposed
    const inLive = key in live
    if (inProposed && !inLive) {
      added[key] = proposed[key]
    } else if (!inProposed && inLive) {
      removed[key] = live[key]
    } else if (proposed[key] !== live[key]) {
      modified[key] = { old: live[key], new: proposed[key] }
    } else {
      unchanged[key] = proposed[key]
    }
  }

  return {
    changeId: String(meta.changeId),
    project,
    env,
    status: String(meta.status),
    proposedBy: String(meta.proposedBy),
    reason: String(meta.reason),
    createdAt: String(meta.createdAt),
    diff: (meta.diff as DiffEntry[]) ?? [],
    added,
    removed,
    modified,
    unchanged,
  }
}

export const printReview = (
  result: ReviewResult,
  opts: { showAll?: boolean; json?: boolean } = {},
): void => {
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  printChangeSummary(result)

  const addedKeys = Object.keys(result.added)
  const removedKeys = Object.keys(result.removed)
  const modifiedKeys = Object.keys(result.modified)
  const unchangedKeys = Object.keys(result.unchanged)

  const changeCount = addedKeys.length + removedKeys.length + modifiedKeys.length
  if (changeCount === 0) {
    console.log('\n  No differences detected.')
    return
  }

  console.log(
    `\n  ${changeCount} change(s): ` +
    `${GREEN}+${addedKeys.length}${RESET} ` +
    `${RED}-${removedKeys.length}${RESET} ` +
    `${YELLOW}~${modifiedKeys.length}${RESET}\n`,
  )

  for (const key of addedKeys) {
    console.log(`  ${GREEN}+ ${key}=${result.added[key]}${RESET}`)
  }
  for (const key of removedKeys) {
    console.log(`  ${RED}- ${key}=${result.removed[key]}${RESET}`)
  }
  for (const key of modifiedKeys) {
    const { old: oldVal, new: newVal } = result.modified[key]
    console.log(`  ${YELLOW}~ ${key}: ${oldVal} → ${newVal}${RESET}`)
  }

  if (opts.showAll && unchangedKeys.length > 0) {
    console.log(`\n  ${DIM}Unchanged (${unchangedKeys.length}):${RESET}`)
    for (const key of unchangedKeys) {
      console.log(`  ${DIM}  ${key}=${result.unchanged[key]}${RESET}`)
    }
  }

  console.log()
}

export const registerReviewCommand = (program: Command): void => {
  program
    .command('review')
    .description('Review a proposed change with full value-level diff')
    .requiredOption('--change-id <id>', 'Change ID to review')
    .option('--show-all', 'Show unchanged keys too')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const config = requireConfig(['apiUrl', 'clientId', 'region'])
      const result = await reviewChange(opts.changeId, config)
      if (result) {
        printReview(result, opts)
      }
    })
}
