export const GOOGLE_GEMINI_CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com'
export const GOOGLE_GEMINI_CODE_ASSIST_API_VERSION = 'v1internal'
const FREE_TIER = 'free-tier'
const LEGACY_TIER = 'legacy-tier'

type AllowedTier = { id?: string; isDefault?: boolean }
type LoadCodeAssistResponse = {
  currentTier?: { id?: string }
  cloudaicompanionProject?: string | { id?: string }
  allowedTiers?: AllowedTier[]
}

type OperationResponse = {
  done?: boolean
  name?: string
  response?: { cloudaicompanionProject?: { id?: string } }
}

function getEnvProjectId(): string | null {
  const value = String(
    process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT_ID ||
      '',
  ).trim()
  return value || null
}

export function createGoogleGeminiCodeAssistHeaders(
  accessToken: string,
): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'User-Agent': 'claudex/google-gemini-auth',
    'X-Goog-Api-Client': 'gl-node/claudex',
  }
}

export function getGoogleGeminiCodeAssistBaseUrl(): string {
  return `${GOOGLE_GEMINI_CODE_ASSIST_ENDPOINT}/${GOOGLE_GEMINI_CODE_ASSIST_API_VERSION}`
}

function getProjectId(value: string | { id?: string } | undefined): string | null {
  if (typeof value === 'string') return value.trim() || null
  const nested = String(value?.id || '').trim()
  return nested || null
}

function getDefaultTier(allowedTiers?: AllowedTier[]): string {
  if (!allowedTiers?.length) return LEGACY_TIER
  return allowedTiers.find(tier => tier.isDefault)?.id || LEGACY_TIER
}

async function pollOperation(
  operationName: string,
  headers: Record<string, string>,
): Promise<OperationResponse> {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 5000))
    const response = await fetch(
      `${getGoogleGeminiCodeAssistBaseUrl()}/${operationName}`,
      { headers },
    )
    if (!response.ok) continue
    const data = (await response.json()) as OperationResponse
    if (data.done) return data
  }
  throw new Error('Timed out waiting for Google Gemini project provisioning')
}

export async function discoverGoogleGeminiProjectId(
  accessToken: string,
): Promise<string | null> {
  const envProject = getEnvProjectId()
  const headers = createGoogleGeminiCodeAssistHeaders(accessToken)
  const metadata = {
    ideType: 'IDE_UNSPECIFIED',
    platform: 'PLATFORM_UNSPECIFIED',
    pluginType: 'GEMINI',
    ...(envProject ? { duetProject: envProject } : {}),
  }
  const loadResponse = await fetch(
    `${getGoogleGeminiCodeAssistBaseUrl()}:loadCodeAssist`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...(envProject ? { cloudaicompanionProject: envProject } : {}),
        metadata,
      }),
    },
  )
  if (loadResponse.ok) {
    const data = (await loadResponse.json()) as LoadCodeAssistResponse
    const existingProject = getProjectId(data.cloudaicompanionProject)
    if (existingProject) return existingProject
    if (data.currentTier && envProject) return envProject
    const tierId = getDefaultTier(data.allowedTiers)
    const onboardResponse = await fetch(
      `${getGoogleGeminiCodeAssistBaseUrl()}:onboardUser`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tierId,
          ...(tierId !== FREE_TIER && envProject
            ? { cloudaicompanionProject: envProject }
            : {}),
          metadata,
        }),
      },
    )
    if (!onboardResponse.ok) {
      if (envProject) return envProject
      throw new Error(
        `Google Gemini onboarding failed with ${onboardResponse.status}`,
      )
    }
    let operation = (await onboardResponse.json()) as OperationResponse
    if (!operation.done && operation.name) {
      operation = await pollOperation(operation.name, headers)
    }
    return getProjectId(operation.response?.cloudaicompanionProject) || envProject
  }
  return envProject
}
