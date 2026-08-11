import * as p from '@clack/prompts'

export async function pickItems(registry) {
  const options = registry.items.map((item) => ({
    value: item.id,
    label: `${item.name} (${item.type})`,
    hint: item.description.slice(0, 60),
  }))

  const selected = await p.multiselect({
    message: `Select items from the ${registry.kit} kit`,
    options,
    initialValues: options.map((o) => o.value),
    required: false,
  })

  if (p.isCancel(selected)) return null
  return selected
}
