import { getSecureStorage } from '../../utils/secureStorage/index.js'
import { hasStoredGoogleGeminiAuth } from './googleGeminiAuth.js'
import type { ApiKeyProviderId } from './providerCatalog.js'

type ProviderSecretStore = {
  providerApiKeys?: Partial<Record<ApiKeyProviderId, string>>
  providerOAuthClients?: Partial<
    Record<
      ApiKeyProviderId,
      {
        clientId: string
        clientSecret?: string
      }
    >
  >
}

export type ProviderApiKeyStatus =
  | 'configured'
  | 'missing_api_key'

let cachedStore: ProviderSecretStore | null = null
let lastCacheTime = 0
const CACHE_TTL = 60000 // 60 seconds

function readStore(): ProviderSecretStore {
  const now = Date.now()
  if (cachedStore && now - lastCacheTime < CACHE_TTL) {
    return cachedStore
  }
  const storage = getSecureStorage()
  const current = storage.read()
  cachedStore = current && typeof current === 'object'
    ? (current as ProviderSecretStore)
    : {}
  lastCacheTime = now
  return cachedStore
}

function writeStore(next: ProviderSecretStore): { success: boolean; warning?: string } {
  cachedStore = next
  lastCacheTime = Date.now()
  return getSecureStorage().update(next as Record<string, unknown>)
}

export function getProviderApiKey(providerId: ApiKeyProviderId): string | null {
  const value = readStore().providerApiKeys?.[providerId]
  const normalized = String(value || '').trim()
  if (normalized.length > 0) return normalized

  // Fallback to environment variables for multi-tenant envOverrides injection
  const envKey = providerId === 'google-gemini'
    ? (process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY)
    : providerId === 'deepseek'
      ? process.env.DEEPSEEK_API_KEY
      : providerId === 'openai'
        ? process.env.OPENAI_API_KEY
        : providerId === 'moonshot-kimi'
          ? process.env.MOONSHOT_API_KEY
          : providerId === 'aliyun-qwen'
            ? (process.env.DASHSCOPE_API_KEY || process.env.ALIYUN_QWEN_API_KEY)
            : providerId === 'volcengine-doubao'
              ? process.env.VOLCENGINE_DOUBAO_API_KEY
              : providerId === 'zhipu-glm'
                ? process.env.ZHIPU_GLM_API_KEY
                : undefined;

  const envNormalized = String(envKey || '').trim()
  return envNormalized.length > 0 ? envNormalized : null
}

export function hasProviderApiKey(providerId: ApiKeyProviderId): boolean {
  return getProviderApiKey(providerId) !== null
}

export function setProviderApiKey(
  providerId: ApiKeyProviderId,
  apiKey: string,
): { success: boolean; warning?: string } {
  const normalized = String(apiKey || '').trim()
  if (!normalized) {
    throw new Error('API key cannot be empty')
  }
  const current = readStore()
  const next: ProviderSecretStore = {
    ...current,
    providerApiKeys: {
      ...(current.providerApiKeys ?? {}),
      [providerId]: normalized,
    },
  }
  return writeStore(next)
}

export function clearProviderApiKey(providerId: ApiKeyProviderId): boolean {
  const current = readStore()
  if (!current.providerApiKeys?.[providerId]) {
    return true
  }
  const nextKeys = { ...(current.providerApiKeys ?? {}) }
  delete nextKeys[providerId]
  return writeStore({
    ...current,
    providerApiKeys: nextKeys,
  }).success
}

export function getProviderApiKeyStatus(
  providerId: ApiKeyProviderId,
): ProviderApiKeyStatus {
  return hasProviderApiKey(providerId) ? 'configured' : 'missing_api_key'
}

export function getProviderOAuthClientConfig(providerId: ApiKeyProviderId): {
  clientId: string
  clientSecret?: string
} | null {
  const value = readStore().providerOAuthClients?.[providerId]
  const clientId = String(value?.clientId || '').trim()
  const clientSecret = String(value?.clientSecret || '').trim()
  if (!clientId) return null
  return {
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
  }
}

export function setProviderOAuthClientConfig(
  providerId: ApiKeyProviderId,
  input: { clientId: string; clientSecret?: string },
): { success: boolean; warning?: string } {
  const clientId = String(input.clientId || '').trim()
  const clientSecret = String(input.clientSecret || '').trim()
  if (!clientId) {
    throw new Error('OAuth client ID cannot be empty')
  }
  const current = readStore()
  const next: ProviderSecretStore = {
    ...current,
    providerOAuthClients: {
      ...(current.providerOAuthClients ?? {}),
      [providerId]: {
        clientId,
        ...(clientSecret ? { clientSecret } : {}),
      },
    },
  }
  return writeStore(next)
}

export function hasConfiguredProviderAuth(providerId: ApiKeyProviderId): boolean {
  return providerId === 'google-gemini'
    ? hasStoredGoogleGeminiAuth() || hasProviderApiKey(providerId)
    : hasProviderApiKey(providerId)
}
