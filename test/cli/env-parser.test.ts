import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseEnvContent, writeEnvFile } from '../../src/cli/env-parser'

describe('parseEnvContent', () => {
  test('basic key=value', () => {
    expect(parseEnvContent('FOO=bar\nBAZ=qux')).toEqual({
      FOO: 'bar',
      BAZ: 'qux',
    })
  })

  test('skips comments and empty lines', () => {
    expect(
      parseEnvContent('# comment\n\nFOO=bar\n  # indented comment\nBAZ=qux'),
    ).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  test('skips lines without =', () => {
    expect(parseEnvContent('INVALID\nFOO=bar')).toEqual({ FOO: 'bar' })
  })

  test('double-quoted values', () => {
    expect(parseEnvContent('FOO="hello world"')).toEqual({
      FOO: 'hello world',
    })
  })

  test('single-quoted values', () => {
    expect(parseEnvContent("FOO='hello world'")).toEqual({
      FOO: 'hello world',
    })
  })

  test('escaped double quotes', () => {
    expect(parseEnvContent('FOO="say \\"hello\\""')).toEqual({
      FOO: 'say "hello"',
    })
  })

  test('escaped backslashes', () => {
    expect(parseEnvContent('PATH="C:\\\\Users\\\\me"')).toEqual({
      PATH: 'C:\\Users\\me',
    })
  })

  test('escaped newlines in double quotes', () => {
    expect(parseEnvContent('MSG="line1\\nline2"')).toEqual({
      MSG: 'line1\nline2',
    })
  })

  test('multiline double-quoted values', () => {
    expect(parseEnvContent('MSG="line1\nline2\nline3"')).toEqual({
      MSG: 'line1\nline2\nline3',
    })
  })

  test('unquoted value with inline comment', () => {
    expect(parseEnvContent('FOO=bar # this is a comment')).toEqual({
      FOO: 'bar',
    })
  })

  test('value with equals sign', () => {
    expect(parseEnvContent('URL=postgres://host?opt=1')).toEqual({
      URL: 'postgres://host?opt=1',
    })
  })

  test('empty value', () => {
    expect(parseEnvContent('EMPTY=')).toEqual({ EMPTY: '' })
  })

  test('empty double-quoted value', () => {
    expect(parseEnvContent('EMPTY=""')).toEqual({ EMPTY: '' })
  })
})

describe('round-trip: writeEnvFile then parseEnvContent', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-parser-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true })
  })

  test('simple values round-trip', () => {
    const original = { API_KEY: 'secret123', DB_URL: 'postgres://localhost' }
    const filePath = path.join(tmpDir, '.env')
    writeEnvFile(original, filePath)
    const parsed = parseEnvContent(fs.readFileSync(filePath, 'utf-8'))
    expect(parsed).toEqual(original)
  })

  test('values with spaces round-trip', () => {
    const original = { GREETING: 'hello world', DESC: 'some value here' }
    const filePath = path.join(tmpDir, '.env')
    writeEnvFile(original, filePath)
    const parsed = parseEnvContent(fs.readFileSync(filePath, 'utf-8'))
    expect(parsed).toEqual(original)
  })

  test('values with double quotes round-trip', () => {
    const original = { MSG: 'say "hello"' }
    const filePath = path.join(tmpDir, '.env')
    writeEnvFile(original, filePath)
    const parsed = parseEnvContent(fs.readFileSync(filePath, 'utf-8'))
    expect(parsed).toEqual(original)
  })

  test('values with backslashes round-trip', () => {
    const original = { PATH: 'C:\\Users\\me' }
    const filePath = path.join(tmpDir, '.env')
    writeEnvFile(original, filePath)
    const parsed = parseEnvContent(fs.readFileSync(filePath, 'utf-8'))
    expect(parsed).toEqual(original)
  })

  test('values with hash signs round-trip', () => {
    const original = { COLOR: '#ff0000' }
    const filePath = path.join(tmpDir, '.env')
    writeEnvFile(original, filePath)
    const parsed = parseEnvContent(fs.readFileSync(filePath, 'utf-8'))
    expect(parsed).toEqual(original)
  })
})
