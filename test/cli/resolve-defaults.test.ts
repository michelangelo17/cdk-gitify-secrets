import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { CliConfig } from '../../src/cli/auth'
import { resolveProjectEnv, loadLocalConfig, saveLocalConfig } from '../../src/cli/resolve-defaults'

describe('resolveProjectEnv', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('CLI flags take highest priority', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.sr.json'),
      JSON.stringify({ project: 'local-proj', env: 'local-env' }),
    )

    const config: CliConfig = {
      defaultProject: 'global-proj',
      defaultEnv: 'global-env',
    }

    const result = resolveProjectEnv(
      { project: 'flag-proj', env: 'flag-env' },
      config,
      tmpDir,
    )

    expect(result).toEqual({ project: 'flag-proj', env: 'flag-env' })
  })

  test('falls back to local .sr.json when flags omitted', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.sr.json'),
      JSON.stringify({ project: 'local-proj', env: 'local-env' }),
    )

    const config: CliConfig = {
      defaultProject: 'global-proj',
      defaultEnv: 'global-env',
    }

    const result = resolveProjectEnv({}, config, tmpDir)

    expect(result).toEqual({ project: 'local-proj', env: 'local-env' })
  })

  test('falls back to global config when no .sr.json', () => {
    const config: CliConfig = {
      defaultProject: 'global-proj',
      defaultEnv: 'global-env',
    }

    const result = resolveProjectEnv({}, config, tmpDir)

    expect(result).toEqual({ project: 'global-proj', env: 'global-env' })
  })

  test('mixes sources: flag project + local env', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.sr.json'),
      JSON.stringify({ project: 'local-proj', env: 'local-env' }),
    )

    const result = resolveProjectEnv(
      { project: 'flag-proj' },
      {},
      tmpDir,
    )

    expect(result).toEqual({ project: 'flag-proj', env: 'local-env' })
  })

  test('exits with helpful message when nothing configured', () => {
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(
      (() => { throw new Error('process.exit') }) as never,
    )
    const mockError = jest.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => resolveProjectEnv({}, {}, tmpDir)).toThrow('process.exit')

    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining('Missing project and env'),
    )
    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining('.sr.json'),
    )

    mockExit.mockRestore()
    mockError.mockRestore()
  })

  test('exits when only project is missing', () => {
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(
      (() => { throw new Error('process.exit') }) as never,
    )
    const mockError = jest.spyOn(console, 'error').mockImplementation(() => {})

    expect(() =>
      resolveProjectEnv({ env: 'dev' }, {}, tmpDir),
    ).toThrow('process.exit')

    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining('Missing project'),
    )

    mockExit.mockRestore()
    mockError.mockRestore()
  })
})

describe('loadLocalConfig', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('returns empty object when .sr.json does not exist', () => {
    expect(loadLocalConfig(tmpDir)).toEqual({})
  })

  test('returns parsed config when .sr.json exists', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.sr.json'),
      JSON.stringify({ project: 'test', env: 'staging' }),
    )

    expect(loadLocalConfig(tmpDir)).toEqual({ project: 'test', env: 'staging' })
  })

  test('returns empty object on malformed JSON', () => {
    fs.writeFileSync(path.join(tmpDir, '.sr.json'), 'not json')

    expect(loadLocalConfig(tmpDir)).toEqual({})
  })
})

describe('saveLocalConfig', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('writes .sr.json and returns path', () => {
    const filePath = saveLocalConfig({ project: 'my-app', env: 'prod' }, tmpDir)

    expect(filePath).toBe(path.join(tmpDir, '.sr.json'))
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    expect(content).toEqual({ project: 'my-app', env: 'prod' })
  })
})
