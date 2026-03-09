import * as fs from 'node:fs'

const DIFF_SYMBOLS: Record<string, string> = { added: '+', removed: '-', modified: '~' }

export const formatDiffSymbol = (type: string): string =>
  DIFF_SYMBOLS[type] ?? '?'

export const parseEnvFile = (filepath: string): Record<string, string> => {
  const content = fs.readFileSync(filepath, 'utf-8')
  return parseEnvContent(content)
}

export const parseEnvContent = (content: string): Record<string, string> => {
  const variables: Record<string, string> = {}
  const lines = content.split('\n')
  let i = 0

  while (i < lines.length) {
    const rawLine = lines[i]
    const trimmed = rawLine.trim()

    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      i++
      continue
    }

    const eqIndex = trimmed.indexOf('=')
    const key = trimmed.substring(0, eqIndex).trim()
    const rawValue = trimmed.substring(eqIndex + 1)
    const valueStart = rawValue.trimStart()

    if (valueStart.startsWith('"')) {
      // Double-quoted value — may span multiple lines and contain escapes
      let value = rawValue.substring(rawValue.indexOf('"') + 1)
      let complete = false

      while (!complete) {
        let j = 0
        while (j < value.length) {
          if (value[j] === '\\' && j + 1 < value.length) {
            j += 2 // skip escaped char
          } else if (value[j] === '"') {
            // Found closing quote
            const parsed = value.substring(0, j)
            variables[key] = unescape(parsed)
            complete = true
            break
          } else {
            j++
          }
        }
        if (!complete) {
          i++
          if (i >= lines.length) {
            // Unterminated quote — take what we have
            variables[key] = unescape(value)
            complete = true
          } else {
            value += '\n' + lines[i]
          }
        }
      }
    } else if (valueStart.startsWith("'")) {
      // Single-quoted value — no escapes, no multiline
      const inner = rawValue.substring(rawValue.indexOf("'") + 1)
      const closeIdx = inner.indexOf("'")
      variables[key] = closeIdx >= 0 ? inner.substring(0, closeIdx) : inner
    } else {
      // Unquoted value — strip inline comments
      let value = valueStart
      const commentIdx = value.indexOf(' #')
      if (commentIdx >= 0) value = value.substring(0, commentIdx)
      variables[key] = value.trim()
    }

    i++
  }

  return variables
}

const unescape = (s: string): string =>
  s.replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')


export const writeEnvFile = (
  variables: Record<string, string>,
  filepath: string,
): void => {
  const lines: string[] = []

  for (const key of Object.keys(variables).sort()) {
    let value = variables[key]
    if (/[\s"'#]/.test(value)) {
      value = `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    }
    lines.push(`${key}=${value}`)
  }

  fs.writeFileSync(filepath, lines.join('\n') + '\n', 'utf-8')
}
