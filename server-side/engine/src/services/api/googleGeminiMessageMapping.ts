import type { BetaContentBlock, BetaToolUnion, BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { randomUUID } from 'node:crypto'
import type { Tool } from 'src/Tool.js'
import { findToolByName, type Tools } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { normalizeToolInputForAPI, toolToAPISchema } from '../../utils/api.js'
import { safeParseJSON } from '../../utils/json.js'
import { normalizeMessagesForAPI } from '../../utils/messages.js'
import type { Options } from './claude.js'
import { projectToolDeclarationsForGoogleGemini } from './googleGeminiTools.js'

type GeminiPart =
  | { text: string; thought?: boolean; thoughtSignature?: string }
  | { functionCall: { id?: string; name: string; args?: Record<string, unknown> }; thoughtSignature?: string }
  | { functionResponse: { id?: string; name: string; response: Record<string, unknown> } }

export type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] }
export type GeminiTool = { functionDeclarations: Array<{ name: string; description?: string; parameters: Record<string, unknown> }> }

const SYNTHETIC_THOUGHT_SIGNATURE = 'skip_thought_signature_validator'
const GEMINI_UNSUPPORTED_SCHEMA_KEYS = new Set(['$schema', '$id', 'propertyNames', 'exclusiveMinimum', 'exclusiveMaximum', 'unevaluatedProperties'])

function blockToText(block: ContentBlockParam): string {
  if (block.type === 'text') return block.text
  if (block.type === 'tool_result') {
    if (typeof block.content === 'string') return block.content
    if (Array.isArray(block.content)) {
      return block.content.map(item => ('text' in item ? item.text : JSON.stringify(item))).join('\n')
    }
    return JSON.stringify(block.content ?? {})
  }
  return JSON.stringify(block)
}

function sanitizeSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSchema)
  if (!value || typeof value !== 'object') return value
  const output: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (key === 'const') {
      output.enum = [sanitizeSchema(nested)]
    } else if (!GEMINI_UNSUPPORTED_SCHEMA_KEYS.has(key)) {
      output[key] = sanitizeSchema(nested)
    }
  }
  return output
}

function getThoughtSignature(block: unknown): string | undefined {
  const record = block && typeof block === 'object' ? block as Record<string, unknown> : {}
  if (typeof record.thoughtSignature === 'string') return record.thoughtSignature
  return typeof record.thought_signature === 'string' ? record.thought_signature : undefined
}

export function buildGoogleGeminiContents(messages: Message[], tools: Tools): GeminiContent[] {
  const output: GeminiContent[] = []
  const toolNames = new Map<string, string>()
  for (const message of normalizeMessagesForAPI(messages, tools)) {
    const role = message.type === 'assistant' ? 'model' : 'user'
    const content = message.message?.content
    const blocks = Array.isArray(content) ? content : [{ type: 'text' as const, text: String(content || '') }]
    const parts: GeminiPart[] = []
    for (const block of blocks) {
      if (role === 'model' && block.type === 'tool_use') {
        const tool = findToolByName(tools, block.name)
        const normalizedInput = tool && typeof block.input === 'object' && block.input !== null
          ? normalizeToolInputForAPI(tool as Tool, block.input as never)
          : block.input
        toolNames.set(block.id, block.name)
        parts.push({
          functionCall: {
            id: block.id,
            name: block.name,
            args: normalizedInput && typeof normalizedInput === 'object' ? normalizedInput as Record<string, unknown> : {},
          },
          ...(getThoughtSignature(block) ? { thoughtSignature: getThoughtSignature(block) } : {}),
        })
      } else if (role === 'user' && block.type === 'tool_result') {
        parts.push({
          functionResponse: {
            id: block.tool_use_id,
            name: toolNames.get(block.tool_use_id) || 'tool_result',
            response: { output: blockToText(block) },
          },
        })
      } else if (block.type === 'text' && block.text.trim()) {
        parts.push({
          text: block.text.trim(),
          ...(getThoughtSignature(block) ? { thoughtSignature: getThoughtSignature(block) } : {}),
        })
      }
    }
    if (parts.length > 0) output.push({ role, parts })
  }
  return ensureActiveLoopHasThoughtSignatures(output)
}

function ensureActiveLoopHasThoughtSignatures(contents: GeminiContent[]): GeminiContent[] {
  let start = -1
  for (let i = contents.length - 1; i >= 0; i--) {
    if (contents[i]!.role === 'user' && contents[i]!.parts.some(part => 'text' in part)) {
      start = i
      break
    }
  }
  if (start < 0) return contents
  return contents.map((content, index) => {
    if (index < start || content.role !== 'model') return content
    let patched = false
    const parts = content.parts.map(part => {
      if (!patched && 'functionCall' in part && !part.thoughtSignature) {
        patched = true
        return { ...part, thoughtSignature: SYNTHETIC_THOUGHT_SIGNATURE }
      }
      return part
    })
    return patched ? { ...content, parts } : content
  })
}

export async function buildGoogleGeminiTools(tools: Tools, options: Options): Promise<GeminiTool[]> {
  const schemas = await Promise.all(tools.map(tool => toolToAPISchema(tool, {
    getToolPermissionContext: options.getToolPermissionContext,
    tools,
    agents: options.agents,
    allowedAgentTypes: options.allowedAgentTypes,
    model: options.model,
  })))
  const declarations = [...schemas, ...(options.extraToolSchemas ?? [])].flatMap(schema => {
    const candidate = schema as BetaToolUnion & { name?: string; description?: string; input_schema?: Record<string, unknown> }
    if (!candidate.name || !candidate.input_schema) return []
    return [{
      name: candidate.name,
      ...(candidate.description ? { description: candidate.description } : {}),
      parameters: sanitizeSchema(candidate.input_schema) as Record<string, unknown>,
    }]
  })
  return declarations.length ? [{ functionDeclarations: projectToolDeclarationsForGoogleGemini(declarations) }] : []
}

function createUsage(inputTokens?: number, outputTokens?: number): Usage {
  return {
    input_tokens: inputTokens ?? 0,
    output_tokens: outputTokens ?? 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
  } as Usage
}

export function appendGoogleGeminiResponseBlocks(data: Record<string, unknown>, tools: Tools, blocks: BetaContentBlock[]): Usage | undefined {
  const payload = data.response && typeof data.response === 'object' ? data.response as Record<string, unknown> : data
  const candidate = Array.isArray(payload.candidates) ? payload.candidates[0] as { content?: { parts?: Array<Record<string, unknown>> } } | undefined : undefined
  for (const part of candidate?.content?.parts ?? []) {
    if (typeof part.text === 'string' && part.text.trim() && !part.thought) {
      blocks.push({ type: 'text', text: part.text } as BetaContentBlock)
    }
    const call = part.functionCall && typeof part.functionCall === 'object'
      ? part.functionCall as { id?: unknown; name?: unknown; args?: unknown }
      : null
    if (call && typeof call.name === 'string') {
      const name = findToolByName(tools, call.name) ? call.name : call.name.slice(call.name.lastIndexOf(':') + 1)
      blocks.push({
        type: 'tool_use',
        id: typeof call.id === 'string' && call.id ? call.id : `gemini-${name}-${randomUUID()}`,
        name,
        input: call.args && typeof call.args === 'object' ? call.args as Record<string, unknown> : {},
        ...(getThoughtSignature(part) ? { thoughtSignature: getThoughtSignature(part) } : {}),
      } as BetaContentBlock)
    }
  }
  const metadata = payload.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined
  return metadata ? createUsage(metadata.promptTokenCount, metadata.candidatesTokenCount) : undefined
}
