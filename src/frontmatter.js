const DELIM = '---'

export function parseFrontmatter(text) {
  const lines = text.split('\n')
  if (lines[0]?.trim() !== DELIM) return { data: {}, body: text }

  const closeIdx = lines.indexOf(DELIM, 1)
  if (closeIdx === -1) return { data: {}, body: text }

  const data = {}
  for (const line of lines.slice(1, closeIdx)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const sep = trimmed.indexOf(':')
    if (sep === -1) continue
    const key = trimmed.slice(0, sep).trim()
    let value = trimmed.slice(sep + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1)
    }
    if (key) data[key] = value
  }

  return { data, body: lines.slice(closeIdx + 1).join('\n') }
}
