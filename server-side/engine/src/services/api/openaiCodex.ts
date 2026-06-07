import type { BetaContentBlock, BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { Tool } from 'src/Tool.js'
import type { AssistantMessage, Message, StreamEvent, SystemAPIErrorMessage } from 'src/types/message.js'
import { findToolByName, type Tools } from '../../Tool.js'
import { toolToAPISchema, normalizeToolInputForAPI } from '../../utils/api.js'
import { errorMessage } from '../../utils/errors.js'
import { logForDebugging } from '../../utils/debug.js'
import { getUserAgent } from '../../utils/http.js'
import { safeParseJSON } from '../../utils/json.js'
import {
  createAssistantAPIErrorMessage,
  createAssistantMessage,
  normalizeMessagesForAPI,
} from '../../utils/messages.js'
import { getOpenAICodexModelName } from '../../utils/model/providers.js'
import { getProxyFetchOptions } from '../../utils/proxy.js'
import { endQueryProfile, queryCheckpoint } from '../../utils/queryProfiler.js'
import { getOpenAICodexAuthInfo } from './openaiCodexAuth.js'
import type { Options } from './claude.js'

type OpenAICodexTool = {
  type: 'function'
  name: string
  description?: string
  strict?: boolean
  parameters: Record<string, unknown>
}

type OpenAICodexMessageContent = Array<
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string }
  | { type: 'output_text'; text: string }
>

type OpenAICodexInputItem =
  | {
      type: 'message'
      role: 'user' | 'assistant'
      content: OpenAICodexMessageContent
    }
  | {
      type: 'function_call'
      call_id: string
      name: string
      arguments: string
    }
  | {
      type: 'function_call_output'
      call_id: string
      output: string
    }

type StreamingFunctionCall = {
  index: number
  itemId: string
  callId: string
  name: string
  arguments: string
  started: boolean
}

function getOpenAICodexBaseUrl(): string {
  return String(process.env.OPENAI_CODEX_BASE_URL || 'https://chatgpt.com/backend-api')
    .trim()
    .replace(/\/+$/, '')
}

function getOpenAICodexResponsesUrl(): string {
  return `${getOpenAICodexBaseUrl()}/codex/responses`
}

function getOpenAICodexOrigin(): string {
  return new URL(getOpenAICodexBaseUrl()).origin
}

function formatOpenAICodexFetchError(error: unknown): string {
  const message = errorMessage(error)
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined
  return cause instanceof Error && cause.message !== message
    ? `OpenAI Codex fetch failed: ${message}; cause=${cause.message}; endpoint=${getOpenAICodexResponsesUrl()}`
    : `OpenAI Codex fetch failed: ${message}; endpoint=${getOpenAICodexResponsesUrl()}`
}

function mapEffortValue(value: Options['effortValue']): string {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (
    normalized === 'none' ||
    normalized === 'minimal' ||
    normalized === 'low' ||
    normalized === 'medium' ||
    normalized === 'high' ||
    normalized === 'xhigh'
  ) {
    return normalized
  }
  if (normalized === 'max') {
    return 'xhigh'
  }
  return 'medium'
}

function blockToText(block: ContentBlockParam): string {
  if (block.type === 'text') {
    return block.text
  }
  if (block.type === 'tool_result') {
    if (typeof block.content === 'string') {
      return block.content
    }
    if (Array.isArray(block.content)) {
      return block.content
        .map(item => ('text' in item && typeof item.text === 'string' ? item.text : JSON.stringify(item)))
        .join('\n')
    }
    return JSON.stringify(block.content ?? {})
  }
  if (block.type === 'document') {
    return JSON.stringify(block)
  }
  return JSON.stringify(block)
}

function blockToImageUrl(
  block: Extract<ContentBlockParam, { type: 'image' }>,
): string {
  const source = block.source
  if ('data' in source && 'media_type' in source) {
    return `data:${source.media_type};base64,${source.data}`
  }
  if ('url' in source && typeof source.url === 'string') {
    return source.url
  }
  throw new Error('Unsupported OpenAI Codex image source')
}

function blockToMessageItems(
  block: ContentBlockParam,
  role: 'user' | 'assistant',
): OpenAICodexMessageContent {
  if (block.type === 'image') {
    return [{ type: 'input_image', image_url: blockToImageUrl(block) }]
  }
  const text = blockToText(block).trim()
  if (!text) {
    return []
  }
  return [
    role === 'assistant'
      ? { type: 'output_text' as const, text }
      : { type: 'input_text' as const, text },
  ]
}

function flushMessageItem(
  items: OpenAICodexInputItem[],
  role: 'user' | 'assistant',
  content: OpenAICodexMessageContent,
): void {
  if (content.length > 0) {
    items.push({ type: 'message', role, content: [...content] })
    content.length = 0
  }
}

function buildOpenAICodexInput(
  messages: Message[],
  tools: Tools,
): OpenAICodexInputItem[] {
  const items: OpenAICodexInputItem[] = []
  for (const message of normalizeMessagesForAPI(messages, tools)) {
    const role = message.type === 'assistant' ? 'assistant' : 'user'
    const content = message.message?.content
    if (!Array.isArray(content)) {
      const text = typeof content === 'string' ? content.trim() : ''
      if (text) {
        items.push({
          type: 'message',
          role,
          content: [
            role === 'assistant'
              ? { type: 'output_text', text }
              : { type: 'input_text', text },
          ],
        })
      }
      continue
    }

    const pending: OpenAICodexMessageContent = []
    for (const block of content) {
      if (role === 'assistant' && block.type === 'tool_use') {
        flushMessageItem(items, role, pending)
        const tool = findToolByName(tools, block.name)
        const normalizedInput =
          tool && typeof block.input === 'object' && block.input !== null
            ? normalizeToolInputForAPI(tool as Tool, block.input as never)
            : block.input
        items.push({
          type: 'function_call',
          call_id: block.id,
          name: block.name,
          arguments: JSON.stringify(normalizedInput ?? {}),
        })
        continue
      }
      if (role === 'user' && block.type === 'tool_result') {
        flushMessageItem(items, role, pending)
        const output = blockToText(block)
        items.push({
          type: 'function_call_output',
          call_id: block.tool_use_id,
          output,
        })
        continue
      }
      pending.push(...blockToMessageItems(block, role))
    }
    flushMessageItem(items, role, pending)
  }
  return items
}

async function buildOpenAICodexTools(
  tools: Tools,
  options: Options,
): Promise<OpenAICodexTool[]> {
  const schemas = await Promise.all(
    tools.map(tool =>
      toolToAPISchema(tool, {
        getToolPermissionContext: options.getToolPermissionContext,
        tools,
        agents: options.agents,
        allowedAgentTypes: options.allowedAgentTypes,
        model: options.model,
      }),
    ),
  )
  const allSchemas = [...schemas, ...(options.extraToolSchemas ?? [])]
  return allSchemas.flatMap(schema => {
    const candidate = schema as BetaToolUnion & {
      name?: string
      description?: string
      strict?: boolean
      input_schema?: Record<string, unknown>
    }
    if (!candidate.name || !candidate.input_schema) {
      return []
    }
    return [{
      type: 'function' as const,
      name: candidate.name,
      description: candidate.description,
      ...(candidate.strict ? { strict: true } : {}),
      parameters: candidate.input_schema,
    }]
  })
}

function createAssistantMessageFromItems(
  completedItems: Array<Record<string, unknown>>,
  fallbackText: string,
): AssistantMessage {
  const blocks: BetaContentBlock[] = []
  for (const item of completedItems) {
    if (item.type === 'message' && item.role === 'assistant' && Array.isArray(item.content)) {
      for (const contentItem of item.content as Array<Record<string, unknown>>) {
        if (
          (contentItem.type === 'output_text' || contentItem.type === 'input_text') &&
          typeof contentItem.text === 'string' &&
          contentItem.text.length > 0
        ) {
          blocks.push({ type: 'text', text: contentItem.text } as BetaContentBlock)
        }
      }
      continue
    }
    if (
      item.type === 'function_call' &&
      typeof item.call_id === 'string' &&
      typeof item.name === 'string'
    ) {
      blocks.push({
        type: 'tool_use',
        id: item.call_id,
        name: item.name,
        input: safeParseJSON(String(item.arguments || '')) ?? {},
      } as BetaContentBlock)
    }
  }
  if (blocks.length === 0 && fallbackText.trim()) {
    blocks.push({ type: 'text', text: fallbackText.trim() } as BetaContentBlock)
  }
  if (blocks.length === 0) {
    throw new Error('OpenAI Codex response did not include assistant content')
  }
  return createAssistantMessage({ content: blocks })
}

function parseSSEFrames(buffer: string): {
  frames: Array<{ event?: string; data?: string }>
  remaining: string
} {
  const frames: Array<{ event?: string; data?: string }> = []
  let pos = 0
  const normalized = buffer.replace(/\r\n/g, '\n')
  let idx = normalized.indexOf('\n\n', pos)
  while (idx !== -1) {
    const rawFrame = normalized.slice(pos, idx)
    pos = idx + 2
    if (rawFrame.trim()) {
      const frame: { event?: string; data?: string } = {}
      for (const line of rawFrame.split('\n')) {
        if (line.startsWith(':')) {
          continue
        }
        const colon = line.indexOf(':')
        if (colon === -1) {
          continue
        }
        const field = line.slice(0, colon)
        const value = line[colon + 1] === ' ' ? line.slice(colon + 2) : line.slice(colon + 1)
        if (field === 'event') {
          frame.event = value
        } else if (field === 'data') {
          frame.data = frame.data ? `${frame.data}\n${value}` : value
        }
      }
      if (frame.data) {
        frames.push(frame)
      }
    }
    idx = normalized.indexOf('\n\n', pos)
  }
  return { frames, remaining: normalized.slice(pos) }
}

function isAssistantMessage(
  value: StreamEvent | AssistantMessage,
): value is AssistantMessage {
  return value.type === 'assistant' && 'uuid' in value
}

async function* streamOpenAICodex(input: {
  messages: Message[]
  systemPrompt: string[]
  tools: Tools
  signal: AbortSignal
  options: Options
}): AsyncGenerator<StreamEvent | AssistantMessage, AssistantMessage> {
  const model = getOpenAICodexModelName(input.options.model)
  if (!model) {
    throw new Error(`Invalid OpenAI Codex model: ${input.options.model}`)
  }
  const auth = await getOpenAICodexAuthInfo()
  if (auth.status !== 'ok' || !auth.accessToken) {
    throw new Error(`OpenAI Codex login is not available (${auth.status})`)
  }

  const instructions = input.systemPrompt.filter(Boolean).join('\n\n').trim()
  queryCheckpoint('query_tool_schema_build_start')
  const requestTools = await buildOpenAICodexTools(input.tools, input.options)
  queryCheckpoint('query_tool_schema_build_end')
  queryCheckpoint('query_message_normalization_start')
  const requestInput = buildOpenAICodexInput(input.messages, input.tools)
  queryCheckpoint('query_message_normalization_end')

  const requestStartedAt = Date.now()
  let response: Response
  try {
    queryCheckpoint('query_api_request_sent')
    response = await (input.options.fetchOverride ?? fetch)(getOpenAICodexResponsesUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Origin: getOpenAICodexOrigin(),
        Referer: `${getOpenAICodexOrigin()}/`,
        'User-Agent': process.env.OPENAI_CODEX_USER_AGENT || getUserAgent(),
        ...(auth.accountId ? { 'ChatGPT-Account-Id': auth.accountId } : {}),
      },
      body: JSON.stringify({
        model,
        instructions,
        input: requestInput,
        tools: requestTools,
        tool_choice: 'auto',
        parallel_tool_calls: false,
        reasoning: { effort: mapEffortValue(input.options.effortValue) },
        store: false,
        stream: true,
      }),
      signal: input.signal,
      ...getProxyFetchOptions(),
    })
    queryCheckpoint('query_response_headers_received')
    logForDebugging(
      `[OpenAI Codex] response headers received in ${Date.now() - requestStartedAt}ms`,
    )
  } catch (error) {
    throw new Error(formatOpenAICodexFetchError(error))
  }

  if (!response.ok) {
    const rawText = await response.text()
    const parsed = safeParseJSON(rawText) as { error?: { message?: string } } | null
    throw new Error(
      parsed?.error?.message ||
        rawText ||
        `OpenAI Codex request failed with ${response.status}`,
    )
  }
  if (!response.body) {
    throw new Error('OpenAI Codex response stream was empty')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let textStarted = false
  let reasoningStarted = false
  let fallbackText = ''
  let firstFrameSeen = false
  let firstTextSeen = false
  const completedItems: Array<Record<string, unknown>> = []
  const functionCalls = new Map<string, StreamingFunctionCall>()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      buffer += decoder.decode(value, { stream: true })
      const parsed = parseSSEFrames(buffer)
      buffer = parsed.remaining
      for (const frame of parsed.frames) {
        if (!frame.data) {
          continue
        }
        const data = safeParseJSON(frame.data) as Record<string, unknown> | null
        if (!data) {
          continue
        }
        if (!firstFrameSeen) {
          firstFrameSeen = true
          queryCheckpoint('query_first_chunk_received')
          endQueryProfile()
          logForDebugging(
            `[OpenAI Codex] first SSE event ${String(frame.event || data.type || 'unknown')} after ${Date.now() - requestStartedAt}ms`,
          )
        }
        if (
          frame.event === 'response.reasoning_summary_text.delta' &&
          typeof data.delta === 'string'
        ) {
          if (!reasoningStarted) {
            reasoningStarted = true
            yield {
              type: 'stream_event',
              event: {
                type: 'content_block_start',
                index: 0,
                content_block: {
                  type: 'thinking',
                  thinking: '',
                  signature: '',
                },
              },
            } as StreamEvent
          }
          yield {
            type: 'stream_event',
            event: {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'thinking_delta', thinking: data.delta },
            },
          } as StreamEvent
          continue
        }
        if (frame.event === 'response.output_item.added' && data.item && typeof data.item === 'object') {
          const item = data.item as Record<string, unknown>
          if (item.type === 'function_call' && typeof item.name === 'string') {
            if (reasoningStarted) {
              reasoningStarted = false
              yield {
                type: 'stream_event',
                event: {
                  type: 'content_block_stop',
                  index: 0,
                },
              } as StreamEvent
            }
            const itemId = String(item.id || data.item_id || '').trim()
            const callId = String(item.call_id || item.id || data.item_id || '').trim()
            if (itemId && callId) {
              const index = Number(data.output_index)
              const toolCall: StreamingFunctionCall = {
                index: Number.isFinite(index) ? index : functionCalls.size,
                itemId,
                callId,
                name: item.name,
                arguments: typeof item.arguments === 'string' ? item.arguments : '',
                started: true,
              }
              functionCalls.set(itemId, toolCall)
              yield {
                type: 'stream_event',
                event: {
                  type: 'content_block_start',
                  index: toolCall.index,
                  content_block: {
                    type: 'tool_use',
                    id: toolCall.callId,
                    name: toolCall.name,
                    input: {},
                  },
                },
              } as StreamEvent
            }
          }
          continue
        }
        if (
          frame.event === 'response.function_call_arguments.delta' &&
          typeof data.delta === 'string'
        ) {
          const itemId = String(data.item_id || '').trim()
          const toolCall = itemId ? functionCalls.get(itemId) : undefined
          if (toolCall?.started) {
            toolCall.arguments += data.delta
            yield {
              type: 'stream_event',
              event: {
                type: 'content_block_delta',
                index: toolCall.index,
                delta: { type: 'input_json_delta', partial_json: data.delta },
              },
            } as StreamEvent
          }
          continue
        }
        if (
          frame.event === 'response.function_call_arguments.done' &&
          typeof data.name === 'string'
        ) {
          const itemId = String(data.item_id || '').trim()
          const index = Number(data.output_index)
          const callId = String(data.call_id || itemId).trim()
          const finalArguments = String(data.arguments || '')
          let toolCall = itemId ? functionCalls.get(itemId) : undefined
          if (!toolCall && itemId && callId) {
            if (reasoningStarted) {
              reasoningStarted = false
              yield {
                type: 'stream_event',
                event: {
                  type: 'content_block_stop',
                  index: 0,
                },
              } as StreamEvent
            }
            toolCall = {
              index: Number.isFinite(index) ? index : functionCalls.size,
              itemId,
              callId,
              name: data.name,
              arguments: '',
              started: true,
            }
            functionCalls.set(itemId, toolCall)
            yield {
              type: 'stream_event',
              event: {
                type: 'content_block_start',
                index: toolCall.index,
                content_block: {
                  type: 'tool_use',
                  id: toolCall.callId,
                  name: toolCall.name,
                  input: {},
                },
              },
            } as StreamEvent
          }
          if (toolCall) {
            const missingArguments = finalArguments.startsWith(toolCall.arguments)
              ? finalArguments.slice(toolCall.arguments.length)
              : finalArguments
            if (missingArguments) {
              yield {
                type: 'stream_event',
                event: {
                  type: 'content_block_delta',
                  index: toolCall.index,
                  delta: { type: 'input_json_delta', partial_json: missingArguments },
                },
              } as StreamEvent
            }
            yield {
              type: 'stream_event',
              event: {
                type: 'content_block_stop',
                index: toolCall.index,
              },
            } as StreamEvent
          }
          continue
        }
        if (frame.event === 'response.output_text.delta' && typeof data.delta === 'string') {
          if (!firstTextSeen) {
            firstTextSeen = true
            logForDebugging(
              `[OpenAI Codex] first text delta after ${Date.now() - requestStartedAt}ms`,
            )
          }
          if (reasoningStarted) {
            reasoningStarted = false
            yield {
              type: 'stream_event',
              event: {
                type: 'content_block_stop',
                index: 0,
              },
            } as StreamEvent
          }
          if (!textStarted) {
            textStarted = true
            yield {
              type: 'stream_event',
              event: {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' },
              },
            } as StreamEvent
          }
          fallbackText += data.delta
          yield {
            type: 'stream_event',
            event: {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: data.delta },
            },
          } as StreamEvent
          continue
        }
        if (frame.event === 'response.output_item.done' && data.item && typeof data.item === 'object') {
          completedItems.push(data.item as Record<string, unknown>)
          continue
        }
        if (
          (frame.event === 'response.failed' || frame.event === 'error') &&
          data.error &&
          typeof data.error === 'object'
        ) {
          throw new Error(String((data.error as { message?: unknown }).message || 'OpenAI Codex request failed'))
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  if (textStarted) {
    yield {
      type: 'stream_event',
      event: {
        type: 'content_block_stop',
        index: 0,
      },
    } as StreamEvent
  } else if (reasoningStarted) {
    yield {
      type: 'stream_event',
      event: {
        type: 'content_block_stop',
        index: 0,
      },
    } as StreamEvent
  }

  const assistantMessage = createAssistantMessageFromItems(completedItems, fallbackText)
  yield assistantMessage
  return assistantMessage
}

export async function queryOpenAICodexWithoutStreaming(input: {
  messages: Message[]
  systemPrompt: string[]
  tools: Tools
  signal: AbortSignal
  options: Options
}): Promise<AssistantMessage> {
  let assistantMessage: AssistantMessage | undefined
  for await (const event of streamOpenAICodex(input)) {
    if (isAssistantMessage(event)) {
      assistantMessage = event
    }
  }
  if (!assistantMessage) {
    throw new Error('OpenAI Codex response did not include an assistant message')
  }
  return assistantMessage
}

export async function* queryOpenAICodexWithStreaming(input: {
  messages: Message[]
  systemPrompt: string[]
  tools: Tools
  signal: AbortSignal
  options: Options
}): AsyncGenerator<StreamEvent | AssistantMessage | SystemAPIErrorMessage, void> {
  try {
    yield* streamOpenAICodex(input)
  } catch (error) {
    yield createAssistantAPIErrorMessage({
      content: errorMessage(error),
    })
  }
}
