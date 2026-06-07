// Content for the Claude-api bundled skill.
// Each .md file is inlined as a string at build time via Bun's text loader.

import csharpClaudeApi from './Claude-api/csharp/Claude-api.md'
import curlExamples from './Claude-api/curl/examples.md'
import goClaudeApi from './Claude-api/go/Claude-api.md'
import javaClaudeApi from './Claude-api/java/Claude-api.md'
import phpClaudeApi from './Claude-api/php/Claude-api.md'
import pythonAgentSdkPatterns from './Claude-api/python/agent-sdk/patterns.md'
import pythonAgentSdkReadme from './Claude-api/python/agent-sdk/README.md'
import pythonClaudeApiBatches from './Claude-api/python/Claude-api/batches.md'
import pythonClaudeApiFilesApi from './Claude-api/python/Claude-api/files-api.md'
import pythonClaudeApiReadme from './Claude-api/python/Claude-api/README.md'
import pythonClaudeApiStreaming from './Claude-api/python/Claude-api/streaming.md'
import pythonClaudeApiToolUse from './Claude-api/python/Claude-api/tool-use.md'
import rubyClaudeApi from './Claude-api/ruby/Claude-api.md'
import skillPrompt from './Claude-api/SKILL.md'
import sharedErrorCodes from './Claude-api/shared/error-codes.md'
import sharedLiveSources from './Claude-api/shared/live-sources.md'
import sharedModels from './Claude-api/shared/models.md'
import sharedPromptCaching from './Claude-api/shared/prompt-caching.md'
import sharedToolUseConcepts from './Claude-api/shared/tool-use-concepts.md'
import typescriptAgentSdkPatterns from './Claude-api/typescript/agent-sdk/patterns.md'
import typescriptAgentSdkReadme from './Claude-api/typescript/agent-sdk/README.md'
import typescriptClaudeApiBatches from './Claude-api/typescript/Claude-api/batches.md'
import typescriptClaudeApiFilesApi from './Claude-api/typescript/Claude-api/files-api.md'
import typescriptClaudeApiReadme from './Claude-api/typescript/Claude-api/README.md'
import typescriptClaudeApiStreaming from './Claude-api/typescript/Claude-api/streaming.md'
import typescriptClaudeApiToolUse from './Claude-api/typescript/Claude-api/tool-use.md'

// @[MODEL LAUNCH]: Update the model IDs/names below. These are substituted into {{VAR}}
// placeholders in the .md files at runtime before the skill prompt is sent.
// After updating these constants, manually update the two files that still hardcode models:
//   - Claude-api/SKILL.md (Current Models pricing table)
//   - Claude-api/shared/models.md (full model catalog with legacy versions and alias mappings)
export const SKILL_MODEL_VARS = {
  OPUS_ID: 'Claude-opus-4-6',
  OPUS_NAME: 'Claude Opus 4.6',
  SONNET_ID: 'Claude-sonnet-4-6',
  SONNET_NAME: 'Claude Sonnet 4.6',
  HAIKU_ID: 'Claude-haiku-4-5',
  HAIKU_NAME: 'Claude Haiku 4.5',
  // Previous Sonnet ID — used in "do not append date suffixes" example in SKILL.md.
  PREV_SONNET_ID: 'Claude-sonnet-4-5',
} satisfies Record<string, string>

export const SKILL_PROMPT: string = skillPrompt

export const SKILL_FILES: Record<string, string> = {
  'csharp/Claude-api.md': csharpClaudeApi,
  'curl/examples.md': curlExamples,
  'go/Claude-api.md': goClaudeApi,
  'java/Claude-api.md': javaClaudeApi,
  'php/Claude-api.md': phpClaudeApi,
  'python/agent-sdk/README.md': pythonAgentSdkReadme,
  'python/agent-sdk/patterns.md': pythonAgentSdkPatterns,
  'python/Claude-api/README.md': pythonClaudeApiReadme,
  'python/Claude-api/batches.md': pythonClaudeApiBatches,
  'python/Claude-api/files-api.md': pythonClaudeApiFilesApi,
  'python/Claude-api/streaming.md': pythonClaudeApiStreaming,
  'python/Claude-api/tool-use.md': pythonClaudeApiToolUse,
  'ruby/Claude-api.md': rubyClaudeApi,
  'shared/error-codes.md': sharedErrorCodes,
  'shared/live-sources.md': sharedLiveSources,
  'shared/models.md': sharedModels,
  'shared/prompt-caching.md': sharedPromptCaching,
  'shared/tool-use-concepts.md': sharedToolUseConcepts,
  'typescript/agent-sdk/README.md': typescriptAgentSdkReadme,
  'typescript/agent-sdk/patterns.md': typescriptAgentSdkPatterns,
  'typescript/Claude-api/README.md': typescriptClaudeApiReadme,
  'typescript/Claude-api/batches.md': typescriptClaudeApiBatches,
  'typescript/Claude-api/files-api.md': typescriptClaudeApiFilesApi,
  'typescript/Claude-api/streaming.md': typescriptClaudeApiStreaming,
  'typescript/Claude-api/tool-use.md': typescriptClaudeApiToolUse,
}
