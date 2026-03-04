import * as fs from 'node:fs'
import * as path from 'node:path'
import type { CliConfig } from './auth'

const LOCAL_CONFIG_FILE = '.sr.json'

export interface ProjectEnv {
  readonly project: string
  readonly env: string
}

interface LocalConfig {
  readonly project?: string
  readonly env?: string
}

export const loadLocalConfig = (cwd = process.cwd()): LocalConfig => {
  const filePath = path.join(cwd, LOCAL_CONFIG_FILE)
  if (!fs.existsSync(filePath)) return {}
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as LocalConfig
  } catch {
    return {}
  }
}

export const saveLocalConfig = (
  config: LocalConfig,
  cwd = process.cwd(),
): string => {
  const filePath = path.join(cwd, LOCAL_CONFIG_FILE)
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n')
  return filePath
}

/**
 * Resolve project and env using the priority chain:
 *   1. CLI flags
 *   2. Local .sr.json in cwd
 *   3. Global config defaults
 *
 * Exits with a helpful message when resolution fails.
 */
export const resolveProjectEnv = (
  opts: { project?: string; env?: string },
  config: CliConfig,
  cwd?: string,
): ProjectEnv => {
  const local = loadLocalConfig(cwd)

  const project = opts.project ?? local.project ?? config.defaultProject
  const env = opts.env ?? local.env ?? config.defaultEnv

  const missing: string[] = []
  if (!project) missing.push('project')
  if (!env) missing.push('env')

  if (missing.length > 0) {
    console.error(`Missing ${missing.join(' and ')}. Provide via:`)
    console.error('  Flag:    sr <command> -p <project> -e <env>')
    console.error('  Local:   echo \'{"project":"x","env":"y"}\' > .sr.json')
    console.error('  Global:  sr configure --default-project x --default-env y')
    console.error('  Wizard:  sr init')
    process.exit(1)
  }

  return { project: project!, env: env! }
}
