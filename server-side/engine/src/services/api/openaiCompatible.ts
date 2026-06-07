import type { BetaContentBlock, BetaToolUnion, BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { randomUUID } from 'crypto'
import type { Tool } from 'src/Tool.js'
import type { AssistantMessage, Message, StreamEvent, SystemAPIErrorMessage } from 'src/types/message.js'
import { findToolByName, type Tools } from '../../Tool.js'
import { addToTotalSessionCost } from '../../cost-tracker.js'
import { toolToAPISchema, normalizeToolInputForAPI } from '../../utils/api.js'
import { errorMessage } from '../../utils/errors.js'
import { safeParseJSON } from '../../utils/json.js'
import {
  createAssistantAPIErrorMessage,
  createAssistantMessage,
  normalizeMessagesForAPI,
} from '../../utils/messages.js'
import {
  getApiKeyProviderBaseUrl,
  getApiKeyProviderForModel,
  getApiKeyProviderModelName,
  type ApiKeyProviderId,
} from './providerCatalog.js'
import { getProviderApiKey } from './providerAuth.js'
import { resolveGoogleGeminiAccessToken } from './googleGeminiAuth.js'
import {
  queryGoogleGeminiNativeWithoutStreaming,
  queryGoogleGeminiNativeWithStreaming,
} from './googleGeminiNative.js'
import type { Options } from './claude.js'

type CompatibleTool = {
  type: 'function'
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

type CompatibleMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  reasoning_content?: string
}

function blockToText(block: ContentBlockParam): string {
  if (block.type === 'text') return block.text
  if (block.type === 'tool_result') {
    if (typeof block.content === 'string') return block.content
    if (Array.isArray(block.content)) {
      return block.content
        .map(item => ('text' in item && typeof item.text === 'string' ? item.text : JSON.stringify(item)))
        .join('\n')
    }
  }
  return JSON.stringify(block)
}

function buildImagePart(block: Extract<ContentBlockParam, { type: 'image' }>) {
  const source = block.source
  if ('data' in source && 'media_type' in source) {
    return { type: 'image_url' as const, image_url: { url: `data:${source.media_type};base64,${source.data}` } }
  }
  if ('url' in source && typeof source.url === 'string') {
    return { type: 'image_url' as const, image_url: { url: source.url } }
  }
  throw new Error('Unsupported image source for OpenAI-compatible provider')
}

function buildCompatibleMessages(
  messages: Message[],
  systemPrompt: string[],
  tools: Tools,
): CompatibleMessage[] {
  const output: CompatibleMessage[] = []
  const instructions = systemPrompt.filter(Boolean).join('\n\n').trim()
  if (instructions) {
    output.push({ role: 'system', content: instructions })
  }

  try {
    require('fs').appendFileSync('C:/Users/Administrator/api_debug_raw.log', JSON.stringify(messages, null, 2) + '\n\n')
  } catch (e) {}

  for (const message of normalizeMessagesForAPI(messages, tools)) {
    const role = message.type === 'assistant' ? 'assistant' : 'user'
    const content = message.message?.content
    if (!Array.isArray(content)) {
      const text = typeof content === 'string' ? content.trim() : ''
      if (text) {
        const last = output[output.length - 1]
        if (last && last.role === role && role !== 'tool') {
          if (!last.content) last.content = text
          else if (typeof last.content === 'string') last.content += '\n\n' + text
          else last.content.push({ type: 'text', text })
        } else {
          output.push({ role, content: text })
        }
      }
      continue
    }
    const pending: CompatibleMessage['content'] extends infer T ? T : never = []
    const toolCalls: NonNullable<CompatibleMessage['tool_calls']> = []
    let reasoningContent: string | undefined = undefined
    for (const block of content) {
      if (role === 'assistant' && (block.type === 'thinking' || (block as any).type === 'redacted_thinking')) {
        reasoningContent = (block as any).thinking || (block as any).redacted_thinking || ''
        continue
      }
      if (role === 'assistant' && block.type === 'tool_use') {
        const tool = findToolByName(tools, block.name)
        const normalizedInput =
          tool && typeof block.input === 'object' && block.input !== null
            ? normalizeToolInputForAPI(tool as Tool, block.input as never)
            : block.input
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(normalizedInput ?? {}),
          },
        })
        continue
      }
      if (role === 'user' && block.type === 'tool_result') {
        let isValid = false
        for (let i = output.length - 1; i >= 0; i--) {
          const msg = output[i]
          if (msg.role === 'tool') {
            if (msg.tool_call_id === block.tool_use_id) {
              isValid = false
              break
            }
            continue
          }
          if (msg.role === 'assistant') {
            if (msg.tool_calls && msg.tool_calls.some(tc => tc.id === block.tool_use_id)) {
              isValid = true
            }
            break
          }
          break
        }
        if (isValid) {
          output.push({
            role: 'tool',
            tool_call_id: block.tool_use_id,
            content: blockToText(block),
          })
        } else {
          pending.push({ type: 'text', text: `[System: Tool execution aborted or result detached. Tool output: ${blockToText(block)}]` })
        }
        continue
      }
      if (block.type === 'image') {
        pending.push(buildImagePart(block))
        continue
      }
      const text = blockToText(block).trim()
      if (text) pending.push({ type: 'text', text })
    }
    if (pending.length > 0 || toolCalls.length > 0 || reasoningContent !== undefined) {
      let finalContent: any = undefined
      if (pending.length > 0) {
        if (role === 'assistant' || role === 'system') {
          finalContent = pending.map(p => typeof p === 'string' ? p : (p as any).text).join('\n\n')
        } else {
          finalContent = pending
        }
      } else if (role === 'assistant' && toolCalls.length > 0) {
        finalContent = '' // DeepSeek/OpenAI strict validation workaround
      }

      const last = output[output.length - 1]
      if (last && last.role === role && role !== 'tool') {
        if (finalContent !== undefined) {
          if (!last.content) {
            last.content = finalContent
          } else if (typeof last.content === 'string') {
            if (typeof finalContent === 'string') {
              last.content += '\n\n' + finalContent
            } else {
              last.content = [{ type: 'text', text: last.content }, ...finalContent]
            }
          } else {
            if (typeof finalContent === 'string') {
              last.content.push({ type: 'text', text: finalContent })
            } else {
              last.content.push(...finalContent)
            }
          }
        }
        if (toolCalls.length > 0) {
          if (!last.tool_calls) last.tool_calls = []
          last.tool_calls.push(...toolCalls)
        }
        if (reasoningContent !== undefined) {
          if (!last.reasoning_content) {
            last.reasoning_content = reasoningContent
          } else {
            last.reasoning_content += '\n' + reasoningContent
          }
        }
      } else {
        output.push({
          role,
          ...(finalContent !== undefined ? { content: finalContent } : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          ...(reasoningContent !== undefined ? { reasoning_content: reasoningContent } : {}),
        })
      }
    }
  }

  // Final validation sweep for strict OpenAI API constraints
  for (let i = 0; i < output.length; i++) {
    const msg = output[i]
    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      let allAnswered = true
      const answeredIds = new Set()
      
      for (let j = i + 1; j < output.length; j++) {
        const nextMsg = output[j]
        if (nextMsg.role === 'tool' && nextMsg.tool_call_id) {
          answeredIds.add(nextMsg.tool_call_id)
        } else {
          break
        }
      }
      
      for (const tc of msg.tool_calls) {
        if (!answeredIds.has(tc.id)) {
          allAnswered = false
          break
        }
      }
      
      if (!allAnswered) {
        delete msg.tool_calls
        if (!msg.content) msg.content = ''
        if (typeof msg.content === 'string') {
          msg.content += '\n[System: Tool call interrupted and stripped for API compatibility.]'
        }
        
        for (let j = i + 1; j < output.length; j++) {
          if (output[j].role === 'tool') {
            output[j] = {
              role: 'user',
              content: `[System: Orphaned tool result for ${output[j].tool_call_id}: ${output[j].content}]`
            } as any
          } else {
            break
          }
        }
      }
    }
  }

  try {
    require('fs').appendFileSync('C:/Users/Administrator/api_debug.log', JSON.stringify(output, null, 2) + '\n\n')
  } catch (e) {}

  return output
}

async function buildCompatibleTools(
  tools: Tools,
  options: Options,
): Promise<CompatibleTool[]> {
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
  return schemas.flatMap(schema => {
    const candidate = schema as BetaToolUnion & {
      name?: string
      description?: string
      input_schema?: Record<string, unknown>
    }
    if (!candidate.name || !candidate.input_schema) return []
    return [{
      type: 'function' as const,
      function: {
        name: candidate.name,
        description: candidate.description,
        parameters: candidate.input_schema,
      },
    }]
  })
}

function buildUsage(usage: {
  inputTokens?: number
  outputTokens?: number
}): Usage {
  return {
    input_tokens: usage.inputTokens ?? 0,
    output_tokens: usage.outputTokens ?? 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
  } as Usage
}

function createAssistantMessageFromChoice(choice: Record<string, unknown>): AssistantMessage {
  const blocks: BetaContentBlock[] = []
  const message = (choice.message && typeof choice.message === 'object'
    ? choice.message
    : {}) as {
    content?: unknown
    tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>
    reasoning_content?: string
  }
  if (typeof message.reasoning_content === 'string' && message.reasoning_content.trim()) {
    blocks.push({
      type: 'thinking',
      thinking: message.reasoning_content.trim(),
      signature: 'compatible-reasoning-sig'
    } as unknown as BetaContentBlock)
  }
  if (typeof message.content === 'string' && message.content.trim()) {
    blocks.push({ type: 'text', text: message.content.trim() } as BetaContentBlock)
  }
  for (const toolCall of message.tool_calls ?? []) {
    if (!toolCall?.id || !toolCall.function?.name) continue
    blocks.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.function.name,
      input: safeParseJSON(String(toolCall.function.arguments || '')) ?? {},
    } as BetaContentBlock)
  }
  if (blocks.length === 0) {
    throw new Error('OpenAI-compatible provider response did not include assistant content')
  }
  return createAssistantMessage({ content: blocks })
}

async function queryProvider(providerId: ApiKeyProviderId, input: {
  messages: Message[]
  systemPrompt: string[]
  tools: Tools
  signal: AbortSignal
  options: Options
}): Promise<AssistantMessage> {
  const auth =
    providerId === 'google-gemini'
      ? await resolveGoogleGeminiAuthorization()
      : resolveApiKeyAuthorization(providerId)
  if (!auth.authorization) {
    throw new Error(`Missing credentials for ${providerId}`)
  }
  if (providerId === 'google-gemini' && auth.mode === 'oauth') {
    return queryGoogleGeminiNativeWithoutStreaming(input, auth)
  }
  const model = getApiKeyProviderModelName(input.options.model)
  if (!model) {
    throw new Error(`Invalid provider model: ${input.options.model}`)
  }
  const response = await (input.options.fetchOverride ?? fetch)(
    `${getApiKeyProviderBaseUrl(providerId)}/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: auth.authorization,
        'Content-Type': 'application/json',
        ...(auth.extraHeaders ?? {}),
      },
      body: JSON.stringify({
        model,
        messages: ((() => { try { require('fs').appendFileSync('C:/Users/Administrator/api_debug.log', JSON.stringify(buildCompatibleMessages(input.messages, input.systemPrompt, input.tools), null, 2) + '\n'); } catch (e) {} })(), buildCompatibleMessages(input.messages, input.systemPrompt, input.tools)),
        tools: await buildCompatibleTools(input.tools, input.options),
        tool_choice: 'auto',
        stream: false,
      }),
      signal: input.signal,
    },
  )
  if (!response.ok) {
    const text = await response.text()
    const parsed = safeParseJSON(text) as { error?: { message?: string } } | null
    throw new Error(parsed?.error?.message || text || `Provider request failed with ${response.status}`)
  }
  const data = (await response.json()) as { choices?: Array<Record<string, unknown>> }
  const choice = data.choices?.[0]
  if (!choice) {
    throw new Error('Provider response did not include any choices')
  }
  const usage = (data as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage
  const assistant = createAssistantMessage({
    content: (createAssistantMessageFromChoice(choice).message.content as BetaContentBlock[]),
    ...(usage
      ? {
          usage: buildUsage({
            inputTokens: usage.prompt_tokens,
            outputTokens: usage.completion_tokens,
          }),
        }
      : {}),
  })
  if (assistant.message.usage) {
    addToTotalSessionCost(0, assistant.message.usage as Usage, input.options.model)
  }
  return assistant
}

function resolveApiKeyAuthorization(providerId: ApiKeyProviderId): {
  authorization: string | null
  extraHeaders?: Record<string, string>
  mode: 'api-key'
} {
  const apiKey = getProviderApiKey(providerId)
  return {
    authorization: apiKey ? `Bearer ${apiKey}` : null,
    mode: 'api-key',
  }
}

async function resolveGoogleGeminiAuthorization(): Promise<{
  authorization: string | null
  extraHeaders?: Record<string, string>
  mode: 'oauth' | 'api-key'
  accessToken?: string
  projectId?: string
}> {
  try {
    const auth = await resolveGoogleGeminiAccessToken()
    return {
      authorization: `Bearer ${auth.accessToken}`,
      accessToken: auth.accessToken,
      projectId: auth.projectId,
      extraHeaders: auth.projectId
        ? { 'x-goog-user-project': auth.projectId }
        : undefined,
      mode: 'oauth',
    }
  } catch {
    return {
      ...resolveApiKeyAuthorization('google-gemini'),
      mode: 'api-key',
    }
  }
}

export async function queryApiKeyProviderWithoutStreaming(input: {
  messages: Message[]
  systemPrompt: string[]
  tools: Tools
  signal: AbortSignal
  options: Options
}): Promise<AssistantMessage> {
  const provider = getApiKeyProviderForModel(input.options.model)
  if (!provider) throw new Error(`Unsupported provider model: ${input.options.model}`)
  return queryProvider(provider.id, input)
}

async function* queryApiKeyProviderWithStreamingReal(
  providerId: ApiKeyProviderId,
  input: {
    messages: Message[]
    systemPrompt: string[]
    tools: Tools
    signal: AbortSignal
    options: Options
  }
): AsyncGenerator<AssistantMessage, void> {
  const auth =
    providerId === 'google-gemini'
      ? await resolveGoogleGeminiAuthorization()
      : resolveApiKeyAuthorization(providerId)
  if (!auth.authorization) {
    throw new Error(`Missing credentials for ${providerId}`)
  }
  const model = getApiKeyProviderModelName(input.options.model)
  if (!model) {
    throw new Error(`Invalid provider model: ${input.options.model}`)
  }

  const response = await (input.options.fetchOverride ?? fetch)(
    `${getApiKeyProviderBaseUrl(providerId)}/chat/completions`,
    {
      method: 'POST',
      headers: {
        Authorization: auth.authorization,
        'Content-Type': 'application/json',
        ...(auth.extraHeaders ?? {}),
      },
      body: JSON.stringify({
        model,
        messages: ((() => { try { require('fs').appendFileSync('C:/Users/Administrator/api_debug.log', JSON.stringify(buildCompatibleMessages(input.messages, input.systemPrompt, input.tools), null, 2) + '\n'); } catch (e) {} })(), buildCompatibleMessages(input.messages, input.systemPrompt, input.tools)),
        tools: await buildCompatibleTools(input.tools, input.options),
        tool_choice: 'auto',
        stream: true,
        ...(providerId !== 'google-gemini' ? { stream_options: { include_usage: true } } : {})
      }),
      signal: input.signal,
    },
  )

  if (!response.ok) {
    const text = await response.text()
    try { require('fs').appendFileSync('C:/Users/Administrator/api_debug_resp.log', `[ERROR ${response.status}] ${text}\n`); } catch (e) {}
    const parsed = safeParseJSON(text) as { error?: { message?: string } } | null
    throw new Error(parsed?.error?.message || text || `Provider request failed with ${response.status}`)
  }

  if (!response.body) {
    throw new Error('Response body is null')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const blocks: BetaContentBlock[] = []
  
  let currentBlockIndex = -1
  let reasoningStarted = false
  let textStarted = false
  const functionCalls = new Map<number, { started: boolean, blockIndex: number }>()
  let finalUsage: Usage | undefined = undefined

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try { require('fs').appendFileSync('C:/Users/Administrator/api_debug_resp.log', `[CHUNK] ${trimmed}\n`); } catch (e) {}
        if (trimmed === 'data: [DONE]') continue
        if (trimmed.startsWith('data: ')) {
          const rawJSON = trimmed.slice(6)
          const data = safeParseJSON(rawJSON) as any
          
          if (!data) continue

          const usageData = data.usage
          if (usageData) {
            finalUsage = buildUsage({
              inputTokens: usageData.prompt_tokens,
              outputTokens: usageData.completion_tokens,
            })
            continue
          }

          if (!data.choices?.[0]?.delta) continue
          const delta = data.choices[0].delta
          
          if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
            if (!reasoningStarted) {
              reasoningStarted = true
              currentBlockIndex++
              blocks.push({
                type: 'thinking',
                thinking: '',
                signature: 'compatible-reasoning-sig'
              } as unknown as BetaContentBlock)
              yield {
                type: 'stream_event',
                event: {
                  type: 'content_block_start',
                  index: currentBlockIndex,
                  content_block: { type: 'thinking', thinking: '', signature: 'compatible-reasoning-sig' }
                }
              } as StreamEvent
            }
            const thinkingBlock = blocks[currentBlockIndex] as any
            thinkingBlock.thinking += delta.reasoning_content
            yield {
              type: 'stream_event',
              event: {
                type: 'content_block_delta',
                index: currentBlockIndex,
                delta: { type: 'thinking_delta', thinking: delta.reasoning_content }
              }
            } as StreamEvent
          }
          
          if (typeof delta.content === 'string' && delta.content) {
            if (reasoningStarted) {
              reasoningStarted = false
              yield {
                type: 'stream_event',
                event: { type: 'content_block_stop', index: currentBlockIndex }
              } as StreamEvent
            }
            if (!textStarted) {
              textStarted = true
              currentBlockIndex++
              blocks.push({
                type: 'text',
                text: ''
              } as BetaContentBlock)
              yield {
                type: 'stream_event',
                event: {
                  type: 'content_block_start',
                  index: currentBlockIndex,
                  content_block: { type: 'text', text: '' }
                }
              } as StreamEvent
            }
            const textBlock = blocks[currentBlockIndex] as any
            textBlock.text += delta.content
            yield {
              type: 'stream_event',
              event: {
                type: 'content_block_delta',
                index: currentBlockIndex,
                delta: { type: 'text_delta', text: delta.content }
              }
            } as StreamEvent
          }
          
          if (Array.isArray(delta.tool_calls)) {
            if (reasoningStarted) {
              reasoningStarted = false
              yield { type: 'stream_event', event: { type: 'content_block_stop', index: currentBlockIndex } } as StreamEvent
            }
            if (textStarted) {
              textStarted = false
              yield { type: 'stream_event', event: { type: 'content_block_stop', index: currentBlockIndex } } as StreamEvent
            }

            for (const tc of delta.tool_calls) {
              const tcIndex = tc.index
              let toolState = functionCalls.get(tcIndex)
              
              if (!toolState) {
                currentBlockIndex++
                toolState = { started: true, blockIndex: currentBlockIndex }
                functionCalls.set(tcIndex, toolState)
                
                const toolBlock = {
                  type: 'tool_use',
                  id: tc.id || `tool-${randomUUID()}`,
                  name: tc.function?.name || '',
                  input: {},
                  rawArgs: tc.function?.arguments || ''
                }
                blocks.push(toolBlock as any)
                
                yield {
                  type: 'stream_event',
                  event: {
                    type: 'content_block_start',
                    index: currentBlockIndex,
                    content_block: {
                      type: 'tool_use',
                      id: toolBlock.id,
                      name: toolBlock.name,
                      input: {}
                    }
                  }
                } as StreamEvent
              } else {
                const toolBlock = blocks[toolState.blockIndex] as any
                if (tc.id) toolBlock.id = tc.id
                if (tc.function?.name) toolBlock.name = tc.function.name
                if (tc.function?.arguments) {
                  toolBlock.rawArgs += tc.function.arguments
                  yield {
                    type: 'stream_event',
                    event: {
                      type: 'content_block_delta',
                      index: toolState.blockIndex,
                      delta: { type: 'input_json_delta', partial_json: tc.function.arguments }
                    }
                  } as StreamEvent
                }
              }
            }
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  if (reasoningStarted) {
    yield { type: 'stream_event', event: { type: 'content_block_stop', index: currentBlockIndex } } as StreamEvent
  }
  if (textStarted) {
    yield { type: 'stream_event', event: { type: 'content_block_stop', index: currentBlockIndex } } as StreamEvent
  }
  for (const tc of functionCalls.values()) {
    yield { type: 'stream_event', event: { type: 'content_block_stop', index: tc.blockIndex } } as StreamEvent
  }

  for (const b of blocks) {
    if (b.type === 'tool_use') {
      try {
        (b as any).input = safeParseJSON((b as any).rawArgs) || {}
      } catch (e) {}
      delete (b as any).rawArgs
    }
  }

  if (blocks.length > 0) {
    const lastMsg = createAssistantMessage({
      content: blocks,
      ...(finalUsage ? { usage: finalUsage } : {})
    })
    lastMsg.message.model = model
    if (lastMsg.message.usage) {
      addToTotalSessionCost(0, lastMsg.message.usage as Usage, input.options.model)
    }
    yield lastMsg
  } else {
    throw new Error('Provider response did not include any assistant content blocks')
  }
}

export async function* queryApiKeyProviderWithStreaming(input: {
  messages: Message[]
  systemPrompt: string[]
  tools: Tools
  signal: AbortSignal
  options: Options
}): AsyncGenerator<StreamEvent | AssistantMessage | SystemAPIErrorMessage, void> {
  try {
    const provider = getApiKeyProviderForModel(input.options.model)
    if (!provider) throw new Error(`Unsupported provider model: ${input.options.model}`)
    if (provider.id === 'google-gemini') {
      const auth = await resolveGoogleGeminiAuthorization()
      if (auth.mode === 'oauth') {
        return yield* queryGoogleGeminiNativeWithStreaming(input, auth)
      }
    }
    yield* queryApiKeyProviderWithStreamingReal(provider.id, input)
  } catch (error) {
    yield createAssistantAPIErrorMessage({ content: errorMessage(error) })
  }
}
