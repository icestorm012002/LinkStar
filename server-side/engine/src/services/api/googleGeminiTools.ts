type GeminiFunctionDeclaration = {
  name: string
  description?: string
  parameters: Record<string, unknown>
}

const GEMINI_SCHEMA_DROP_KEYS = new Set([
  'title',
  '$comment',
  'markdownDescription',
  'examples',
  'default',
])

const GEMINI_DESCRIPTION_MAX_CHARS = 320

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function compactDescription(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = normalizeText(value)
  if (!normalized) return undefined

  const firstParagraph = normalized.split(/\n\s*\n/)[0] || normalized
  const sentenceMatch = firstParagraph.match(/^(.+?[.!?。！？])(?:\s|$)/)
  const candidate = sentenceMatch?.[1] || firstParagraph

  if (candidate.length <= GEMINI_DESCRIPTION_MAX_CHARS) {
    return candidate
  }

  return `${candidate.slice(0, GEMINI_DESCRIPTION_MAX_CHARS).trimEnd()}...`
}

function projectSchema(
  value: unknown,
  options: { insidePropertiesMap?: boolean } = {},
): unknown {
  if (Array.isArray(value)) {
    return value.map(item => projectSchema(item, options))
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  const input = value as Record<string, unknown>
  const output: Record<string, unknown> = {}

  for (const [key, nested] of Object.entries(input)) {
    if (!options.insidePropertiesMap && GEMINI_SCHEMA_DROP_KEYS.has(key)) {
      continue
    }

    if (!options.insidePropertiesMap && key === 'description') {
      const description = compactDescription(nested)
      if (description) {
        output.description = description
      }
      continue
    }

    output[key] = projectSchema(nested, {
      insidePropertiesMap: !options.insidePropertiesMap && key === 'properties',
    })
  }

  return output
}

export function projectToolDeclarationsForGoogleGemini(
  declarations: GeminiFunctionDeclaration[],
): GeminiFunctionDeclaration[] {
  return declarations.map(declaration => {
    const description = compactDescription(declaration.description)
    return {
      name: declaration.name,
      ...(description ? { description } : {}),
      parameters: projectSchema(declaration.parameters) as Record<string, unknown>,
    }
  })
}
