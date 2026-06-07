import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import {
  getApiKeyProviderForModel,
  getApiKeyProviderModelName,
  isApiKeyProviderModel,
} from '../../services/api/providerCatalog.js'
import { isEnvTruthy } from '../envUtils.js'

export type APIProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry'

const OPENAI_CODEX_PROVIDER_PREFIX = 'openai-codex/'
const LEGACY_OPENAI_CODEX_PROVIDER_PREFIX = 'codex-cli/'

export function getDefaultOpenAICodexModel(): string {
  return `${OPENAI_CODEX_PROVIDER_PREFIX}gpt-5.5`
}

export function getAPIProvider(): APIProvider {
  return isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)
    ? 'bedrock'
    : isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)
      ? 'vertex'
      : isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)
        ? 'foundry'
        : 'firstParty'
}

export function isOpenAICodexModel(model: string | null | undefined): boolean {
  const value = normalizeOpenAICodexModel(model).toLowerCase()
  return value.startsWith(OPENAI_CODEX_PROVIDER_PREFIX)
}

export function normalizeOpenAICodexModel(
  model: string | null | undefined,
): string {
  const value = String(model || '').trim()
  if (!value) {
    return ''
  }
  if (
    value.toLowerCase().startsWith(LEGACY_OPENAI_CODEX_PROVIDER_PREFIX)
  ) {
    return `${OPENAI_CODEX_PROVIDER_PREFIX}${value.slice(LEGACY_OPENAI_CODEX_PROVIDER_PREFIX.length)}`
  }
  return value
}

export function getOpenAICodexModelName(
  model: string | null | undefined,
): string | null {
  const value = normalizeOpenAICodexModel(model)
  if (!isOpenAICodexModel(value)) {
    return null
  }
  const resolved = value.slice(OPENAI_CODEX_PROVIDER_PREFIX.length).trim()
  return resolved.length > 0 ? resolved : null
}

export {
  isApiKeyProviderModel,
  getApiKeyProviderForModel,
  getApiKeyProviderModelName,
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Check if ANTHROPIC_BASE_URL is a first-party Anthropic API URL.
 * Returns true if not set (default API) or points to api.anthropic.com
 * (or api-staging.anthropic.com for ant users).
 */
export function isFirstPartyAnthropicBaseUrl(): boolean {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  if (!baseUrl) {
    return true
  }
  try {
    const host = new URL(baseUrl).host
    const allowedHosts = ['api.anthropic.com']
    if (process.env.USER_TYPE === 'ant') {
      allowedHosts.push('api-staging.anthropic.com')
    }
    return allowedHosts.includes(host)
  } catch {
    return false
  }
}
