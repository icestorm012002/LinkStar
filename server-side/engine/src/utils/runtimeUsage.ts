import type { ModelUsage } from 'src/entrypoints/agentSdkTypes.js'
import { getModelUsage } from '../cost-tracker.js'
import { getApiKeyProviderForModel, isApiKeyProviderModel, isOpenAICodexModel } from './model/providers.js'
import { getRuntimeBackendInfo } from './status.js'

export type RuntimeProviderUsageSummary = {
  providerLabel: string
  selectedModelId: string
  runtimeModelId: string
  modelLabel: string
  currentUsage: ModelUsage
  providerUsage: ModelUsage
  sessionUsage: Record<string, ModelUsage>
}

export function createEmptyModelUsage(): ModelUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    webSearchRequests: 0,
    costUSD: 0,
    contextWindow: 0,
    maxOutputTokens: 0,
  }
}

function addUsage(target: ModelUsage, usage: ModelUsage): ModelUsage {
  target.inputTokens += usage.inputTokens
  target.outputTokens += usage.outputTokens
  target.cacheReadInputTokens += usage.cacheReadInputTokens
  target.cacheCreationInputTokens += usage.cacheCreationInputTokens
  target.webSearchRequests += usage.webSearchRequests
  target.costUSD += usage.costUSD
  target.contextWindow = Math.max(target.contextWindow, usage.contextWindow)
  target.maxOutputTokens = Math.max(target.maxOutputTokens, usage.maxOutputTokens)
  return target
}

function getRuntimeUsageKey(
  mainLoopModel: string | null,
  runtimeTranscriptModel: string | null,
  sessionUsage: Record<string, ModelUsage>,
  fallbackSelectedModelId: string,
): string {
  let runtimeUsageKey: string | null = null
  if (mainLoopModel && runtimeTranscriptModel && isApiKeyProviderModel(mainLoopModel)) {
    const provider = getApiKeyProviderForModel(mainLoopModel)
    if (provider) {
      runtimeUsageKey = `${provider.prefix}${runtimeTranscriptModel}`
    }
  }
  const selectedUsageKey = mainLoopModel ?? fallbackSelectedModelId
  return runtimeUsageKey && sessionUsage[runtimeUsageKey]
    ? runtimeUsageKey
    : sessionUsage[selectedUsageKey]
      ? selectedUsageKey
      : runtimeUsageKey ?? selectedUsageKey
}

function getProviderUsage(
  mainLoopModel: string | null,
  sessionUsage: Record<string, ModelUsage>,
  selectedUsageKey: string,
): ModelUsage {
  const aggregate = createEmptyModelUsage()
  let matched = false
  const providerPrefix = isOpenAICodexModel(mainLoopModel)
    ? 'openai-codex/'
    : mainLoopModel && isApiKeyProviderModel(mainLoopModel)
      ? getApiKeyProviderForModel(mainLoopModel)?.prefix ?? null
      : null

  for (const [model, usage] of Object.entries(sessionUsage)) {
    const belongsToProvider = providerPrefix
      ? model.startsWith(providerPrefix)
      : model === selectedUsageKey
    if (!belongsToProvider) continue
    matched = true
    addUsage(aggregate, usage)
  }

  if (!matched && sessionUsage[selectedUsageKey]) {
    addUsage(aggregate, sessionUsage[selectedUsageKey]!)
  }

  return aggregate
}

export function getRuntimeProviderSummary(
  mainLoopModel: string | null,
  runtimeTranscriptModel: string | null,
): RuntimeProviderUsageSummary | null {
  const runtimeInfo = getRuntimeBackendInfo(mainLoopModel)
  if (!runtimeInfo) {
    return null
  }

  const sessionUsage = { ...getModelUsage() }
  const usageKey = getRuntimeUsageKey(
    mainLoopModel,
    runtimeTranscriptModel,
    sessionUsage,
    runtimeInfo.selectedModelId,
  )

  if (!sessionUsage[usageKey]) {
    sessionUsage[usageKey] = createEmptyModelUsage()
  }

  return {
    providerLabel: runtimeInfo.providerLabel,
    selectedModelId: runtimeInfo.selectedModelId,
    runtimeModelId: runtimeTranscriptModel ?? runtimeInfo.selectedModelId,
    modelLabel: runtimeTranscriptModel ?? runtimeInfo.modelLabel,
    currentUsage: sessionUsage[usageKey] ?? createEmptyModelUsage(),
    providerUsage: getProviderUsage(mainLoopModel, sessionUsage, usageKey),
    sessionUsage,
  }
}
