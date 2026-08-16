export const ALLOWED_LICENSES = [
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'CC0-1.0',
]
export const ITEM_TYPES = ['agent', 'skill', 'command']
export const KIT_NAMES = ['engineering', 'marketing', 'mobile', 'games']

const PATH_SHAPES = {
  agent: 'agents/<id>.md',
  command: 'commands/<id>.md',
  skill: 'skills/<id>/SKILL.md',
}
const WINDOWS_DEVICE_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const ITEM_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function expectedPath(type, id) {
  if (type === 'agent') return `agents/${id}.md`
  if (type === 'command') return `commands/${id}.md`
  if (type === 'skill') return `skills/${id}/SKILL.md`
  return null
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
  if (typeof item.id === 'string' && item.id.trim() !== '') {
    if (!ITEM_ID.test(item.id)) {
      errors.push(`${at}: "id" must be lowercase kebab-case (got "${item.id}")`)
    } else if (WINDOWS_DEVICE_NAMES.test(item.id)) {
      errors.push(`${at}: "id" is reserved on Windows (got "${item.id}")`)
    }
  }
  if (item.tags !== undefined && !Array.isArray(item.tags)) {
    errors.push(`${at}: "tags" must be an array`)
  }

  // Registry paths are both a source boundary and an installation-layout
  // contract. Keep them in one canonical POSIX form. In particular, a skill
  // registered at the kit root would make the installer recursively copy the
  // entire kit into the buyer's project.
  if (typeof item.path === 'string' && item.path.trim() !== '') {
    if (item.path.startsWith('/') || /^[A-Za-z]:/.test(item.path)) {
      errors.push(`${at}: "path" must be relative to the kit root (got "${item.path}")`)
    }
    if (item.path.includes('\\')) {
      errors.push(`${at}: "path" must use forward slashes, not backslashes (got "${item.path}")`)
    }
    if (item.path.split('/').includes('..')) {
      errors.push(`${at}: "path" must not contain ".." segments (got "${item.path}")`)
    }
    const expected =
      ITEM_TYPES.includes(item.type) && typeof item.id === 'string'
        ? expectedPath(item.type, item.id)
        : null
    if (expected && item.path !== expected) {
      errors.push(
        `${at}: "path" for type "${item.type}" must match ` +
          `${PATH_SHAPES[item.type]} exactly and use the item id ` +
          `(expected "${expected}", got "${item.path}")`
      )
    }
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
    // Trim before comparing so "MIT " is accepted rather than reported as an
    // impermissible license, which would send the author hunting the wrong bug.
    const license = typeof p.license === 'string' ? p.license.trim() : p.license
    if (typeof license === 'string' && !ALLOWED_LICENSES.includes(license)) {
      errors.push(
        `${at}: license "${license}" is not permitted. Allowed: ${ALLOWED_LICENSES.join(', ')}`
      )
    }
  } else {
    // origin === 'original'. Attribution fields here are contradictory: the
    // realistic cause is cloning a derived entry as a template and flipping
    // origin without clearing the old fields, which would silently ship
    // third-party code as original work and skip the license gate entirely.
    for (const field of ['source', 'license', 'copyright']) {
      if (p[field] !== undefined && String(p[field]).trim() !== '') {
        errors.push(
          `${at}: provenance.origin is "original" but provenance.${field} is set. ` +
            `Original items carry no third-party attribution — if this item is derived, ` +
            `set origin to "derived".`
        )
      }
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

  const seenIds = new Set()
  const seenPaths = new Set()
  for (const item of registry.items) {
    if (!isPlainObject(item)) continue
    if (typeof item.id === 'string') {
      if (seenIds.has(item.id)) errors.push(`duplicate item id "${item.id}"`)
      seenIds.add(item.id)
    }
    if (typeof item.path === 'string') {
      if (seenPaths.has(item.path)) errors.push(`duplicate item path "${item.path}"`)
      seenPaths.add(item.path)
    }
  }

  return errors
}
