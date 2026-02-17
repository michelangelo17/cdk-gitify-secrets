import * as fs from 'fs';

export function parseEnvFile(filepath: string): Record<string, string> {
  const content = fs.readFileSync(filepath, 'utf-8');
  const variables: Record<string, string> = {};

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (!line.includes('=')) continue;

    const eqIndex = line.indexOf('=');
    const key = line.substring(0, eqIndex).trim();
    let value = line.substring(eqIndex + 1).trim();

    // Strip surrounding quotes
    if (
      value.length >= 2 &&
      value[0] === value[value.length - 1] &&
      (value[0] === '"' || value[0] === "'")
    ) {
      value = value.substring(1, value.length - 1);
    }

    variables[key] = value;
  }

  return variables;
}

export function writeEnvFile(
  variables: Record<string, string>,
  filepath: string,
): void {
  const lines: string[] = [];

  for (const key of Object.keys(variables).sort()) {
    let value = variables[key];
    // Quote values with spaces or special chars
    if (/[\s"'#]/.test(value)) {
      value = `"${value}"`;
    }
    lines.push(`${key}=${value}`);
  }

  fs.writeFileSync(filepath, lines.join('\n') + '\n', 'utf-8');
}
