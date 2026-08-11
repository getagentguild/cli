export const ALLOWED_LICENSES = [
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'CC0-1.0',
]
export const ITEM_TYPES = ['agent', 'skill', 'command']
export const KIT_NAMES = ['engineering', 'marketing', 'mobile']

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateItem(item, index, errors) {
  const at = `items[${index}]`
  if (!isPlainObject(item)) {
    errors.push(`${at}: must be an object`)
    return
  }
  for (const field of ['id', 'type', 'path', 'name', 'description']) {
    if (typeof item[field] !== 'string' || item[field].trim() === '') {
      errors.push(`${at}: "${field}" must be a non-empty string`)
    }
  }
  if (item.type !== undefined && !ITEM_TYPES.includes(item.type)) {
    errors.push(`${at}: "type" must be one of ${ITEM_TYPES.join(', ')} (got "${item.type}")`)
  }
  if (item.tags !== undefined && !Array.isArray(item.tags)) {
    errors.push(`${at}: "tags" must be an array`)
  }

  const p = item.provenance
  if (!isPlainObject(p)) {
    errors.push(`${at}: "provenance" must be an object`)
    return
  }
  if (p.origin !== 'original' && p.origin !== 'derived') {
    errors.push(`${at}: provenance.origin must be "original" or "derived"`)
    return
  }
  if (p.origin === 'derived') {
    for (const field of ['source', 'license', 'copyright']) {
      if (typeof p[field] !== 'string' || p[field].trim() === '') {
        errors.push(`${at}: derived items require provenance.${field}`)
      }
    }
    if (typeof p.license === 'string' && !ALLOWED_LICENSES.includes(p.license)) {
      errors.push(
        `${at}: license "${p.license}" is not permitted. Allowed: ${ALLOWED_LICENSES.join(', ')}`
      )
    }
  }
}

export function validateRegistry(registry) {
  const errors = []
  if (!isPlainObject(registry)) return ['registry must be a JSON object']

  if (!KIT_NAMES.includes(registry.kit)) {
    errors.push(`"kit" must be one of ${KIT_NAMES.join(', ')} (got "${registry.kit}")`)
  }
  if (typeof registry.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(registry.version)) {
    errors.push('"version" must be a semver string like "1.0.0"')
  }
  if (!Array.isArray(registry.items)) {
    errors.push('"items" must be an array')
    return errors
  }

  registry.items.forEach((item, i) => validateItem(item, i, errors))

  const seen = new Set()
  for (const item of registry.items) {
    if (!isPlainObject(item) || typeof item.id !== 'string') continue
    if (seen.has(item.id)) errors.push(`duplicate item id "${item.id}"`)
    seen.add(item.id)
  }

  return errors
}
