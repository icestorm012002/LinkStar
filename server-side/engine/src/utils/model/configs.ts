import type { ModelName } from './model.js'
import type { APIProvider } from './providers.js'

export type ModelConfig = Record<APIProvider, ModelName>

// @[MODEL LAUNCH]: Add a new Claude_*_CONFIG constant here. Double check the correct model strings
// here since the pattern may change.

export const CLAUDE_ = {
  firstParty: 'Claude-3-7-sonnet-20250219',
  bedrock: 'us.anthropic.Claude-3-7-sonnet-20250219-v1:0',
  vertex: 'Claude-3-7-sonnet@20250219',
  foundry: 'Claude-3-7-sonnet',
} as const satisfies ModelConfig

export const CLAUDE_ = {
  firstParty: 'Claude-3-5-sonnet-20241022',
  bedrock: 'anthropic.Claude-3-5-sonnet-20241022-v2:0',
  vertex: 'Claude-3-5-sonnet-v2@20241022',
  foundry: 'Claude-3-5-sonnet',
} as const satisfies ModelConfig

export const CLAUDE_ = {
  firstParty: 'Claude-3-5-haiku-20241022',
  bedrock: 'us.anthropic.Claude-3-5-haiku-20241022-v1:0',
  vertex: 'Claude-3-5-haiku@20241022',
  foundry: 'Claude-3-5-haiku',
} as const satisfies ModelConfig

export const CLAUDE_ = {
  firstParty: 'Claude-haiku-4-5-20251001',
  bedrock: 'us.anthropic.Claude-haiku-4-5-20251001-v1:0',
  vertex: 'Claude-haiku-4-5@20251001',
  foundry: 'Claude-haiku-4-5',
} as const satisfies ModelConfig

export const CLAUDE_ = {
  firstParty: 'Claude-sonnet-4-20250514',
  bedrock: 'us.anthropic.Claude-sonnet-4-20250514-v1:0',
  vertex: 'Claude-sonnet-4@20250514',
  foundry: 'Claude-sonnet-4',
} as const satisfies ModelConfig

export const CLAUDE_ = {
  firstParty: 'Claude-sonnet-4-5-20250929',
  bedrock: 'us.anthropic.Claude-sonnet-4-5-20250929-v1:0',
  vertex: 'Claude-sonnet-4-5@20250929',
  foundry: 'Claude-sonnet-4-5',
} as const satisfies ModelConfig

export const CLAUDE_ = {
  firstParty: 'Claude-opus-4-20250514',
  bedrock: 'us.anthropic.Claude-opus-4-20250514-v1:0',
  vertex: 'Claude-opus-4@20250514',
  foundry: 'Claude-opus-4',
} as const satisfies ModelConfig

export const CLAUDE_ = {
  firstParty: 'Claude-opus-4-1-20250805',
  bedrock: 'us.anthropic.Claude-opus-4-1-20250805-v1:0',
  vertex: 'Claude-opus-4-1@20250805',
  foundry: 'Claude-opus-4-1',
} as const satisfies ModelConfig

export const CLAUDE_ = {
  firstParty: 'Claude-opus-4-5-20251101',
  bedrock: 'us.anthropic.Claude-opus-4-5-20251101-v1:0',
  vertex: 'Claude-opus-4-5@20251101',
  foundry: 'Claude-opus-4-5',
} as const satisfies ModelConfig

export const CLAUDE_ = {
  firstParty: 'Claude-opus-4-6',
  bedrock: 'us.anthropic.Claude-opus-4-6-v1',
  vertex: 'Claude-opus-4-6',
  foundry: 'Claude-opus-4-6',
} as const satisfies ModelConfig

export const CLAUDE_ = {
  firstParty: 'Claude-opus-4-7',
  bedrock: 'us.anthropic.Claude-opus-4-7-v1',
  vertex: 'Claude-opus-4-7',
  foundry: 'Claude-opus-4-7',
} as const satisfies ModelConfig

export const CLAUDE_ = {
  firstParty: 'Claude-sonnet-4-6',
  bedrock: 'us.anthropic.Claude-sonnet-4-6',
  vertex: 'Claude-sonnet-4-6',
  foundry: 'Claude-sonnet-4-6',
} as const satisfies ModelConfig

// @[MODEL LAUNCH]: Register the new config here.
export const ALL_MODEL_CONFIGS = {
  haiku35: CLAUDE_,
  haiku45: CLAUDE_,
  sonnet35: CLAUDE_,
  sonnet37: CLAUDE_,
  sonnet40: CLAUDE_,
  sonnet45: CLAUDE_,
  sonnet46: CLAUDE_,
  opus40: CLAUDE_,
  opus41: CLAUDE_,
  opus45: CLAUDE_,
  opus46: CLAUDE_,
  opus47: CLAUDE_,
} as const satisfies Record<string, ModelConfig>

export type ModelKey = keyof typeof ALL_MODEL_CONFIGS

/** Union of all canonical first-party model IDs, e.g. 'Claude-opus-4-6' | 'Claude-sonnet-4-5-20250929' | … */
export type CanonicalModelId =
  (typeof ALL_MODEL_CONFIGS)[ModelKey]['firstParty']

/** Runtime list of canonical model IDs — used by comprehensiveness tests. */
export const CANONICAL_MODEL_IDS = Object.values(ALL_MODEL_CONFIGS).map(
  c => c.firstParty,
) as [CanonicalModelId, ...CanonicalModelId[]]

/** Map canonical ID → internal short key. Used to apply settings-based modelOverrides. */
export const CANONICAL_ID_TO_KEY: Record<CanonicalModelId, ModelKey> =
  Object.fromEntries(
    (Object.entries(ALL_MODEL_CONFIGS) as [ModelKey, ModelConfig][]).map(
      ([key, cfg]) => [cfg.firstParty, key],
    ),
  ) as Record<CanonicalModelId, ModelKey>
