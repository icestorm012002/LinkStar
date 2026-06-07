import type { BetaContentBlock, BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { randomUUID } from 'node:crypto'
import { getSessionId } from 'src/bootstrap/state.js'
import { addToTotalSessionCost } from '../../cost-tracker.js'
import type { AssistantMessage, Message, StreamEvent, SystemAPIErrorMessage } from '../../types/message.js'
import { errorMessage } from '../../utils/errors.js'
import { safeParseJSON } from '../../utils/json.js'
import { createAssistantAPIErrorMessage, createAssistantMessage } from '../../utils/messages.js'
import { sleep } from '../../utils/sleep.js'
import type { Tools } from '../../Tool.js'
import type { Options } from './Claude.js'
import {
  appendGoogleGeminiResponseBlocks,
  buildGoogleGeminiContents,
  buildGoogleGeminiTools,
} from './googleGeminiMessageMapping.js'
import { projectSystemPromptForGoogleGemini } from './googleGeminiPrompt.js'
import {
  createGoogleGeminiCodeAssistHeaders,
  discoverGoogleGeminiProjectId,
  getGoogleGeminiCodeAssistBaseUrl,
} from './googleGeminiProject.js'
import {
  getApiKeyProviderModelName,
} from './providerCatalog.js'

export type GoogleGeminiNativeAuth = {
  accessToken?: string
  projectId?: string
  extraHeaders?: Record<string, string>
}
const GEMINI_RESET_AFTER_PATTERN = /reset after\s+(\d+)\s*s/i
export function parseGoogleGeminiSSEFrames(buffer: string): { frames: Record<string, unknown>[]; remaining: string } {
  const frames: Record<string, unknown>[] = []
  let remaining = buffer.replace(/\r\n/g, '\n')
  for (;;) {
    const index = remaining.indexOf('\n\n')
    if (index < 0) break
    const raw = remaining.slice(0, index)
    remaining = remaining.slice(index + 2)
    const data = raw.split('\n').filter(line => line.startsWith('data: ')).map(line => line.slice(6).trim()).join('\n')
    const parsed = data ? safeParseJSON(data) : null
    if (parsed && typeof parsed === 'object') frames.push(parsed as Record<string, unknown>)
  }
  return { frames, remaining }
}
function retryAfterMs(response: Response, message: string): number | null {
  const header = String(response.headers.get('retry-after') || '').trim()
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000)
  const date = Date.parse(header)
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
  const match = GEMINI_RESET_AFTER_PATTERN.exec(message)
  return match ? Number(match[1]) * 1000 : null
}
function formatFetchError(error: unknown): string {
  const message = errorMessage(error)
  const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined
  return cause instanceof Error && cause.message !== message
    ? `Google Gemini fetch failed: ${message}; cause=${cause.message}`
    : `Google Gemini fetch failed: ${message}`
}
async function createRequestBody(input: {
  messages: Message[]
  systemPrompt: string[]
  tools: Tools
  options: Options
}, auth: GoogleGeminiNativeAuth, model: string): Promise<Record<string, unknown>> {
  const accessToken = String(auth.accessToken || '').trim()
  if (!accessToken) throw new Error('Google Gemini OAuth access token is unavailable')
  const projectId = String(auth.projectId || '').trim() || String(await discoverGoogleGeminiProjectId(accessToken) || '').trim()
  const instructions = projectSystemPromptForGoogleGemini(input.systemPrompt).filter(Boolean).join('\n\n').trim()
  const tools = await buildGoogleGeminiTools(input.tools, input.options)
  return {
    model,
    ...(projectId ? { project: projectId } : {}),
    user_prompt_id: randomUUID(),
    request: {
      session_id: getSessionId(),
      contents: buildGoogleGeminiContents(input.messages, input.tools),
      ...(instructions ? { systemInstruction: { role: 'user', parts: [{ text: instructions }] } } : {}),
      ...(tools.length ? { tools } : {}),
      ...(tools.length ? { toolConfig: { functionCallingConfig: { mode: 'AUTO' } } } : {}),
    },
  }
}

async function fetchGemini(input: {
  body: Record<string, unknown>
  auth: GoogleGeminiNativeAuth
  signal: AbortSignal
  fetchOverride?: Options['fetchOverride']
}): Promise<Response> {
  try {
    return await (input.fetchOverride ?? fetch)(
      `${getGoogleGeminiCodeAssistBaseUrl()}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: {
          ...createGoogleGeminiCodeAssistHeaders(String(input.auth.accessToken || '')),
          ...(input.auth.extraHeaders ?? {}),
        },
        body: JSON.stringify(input.body),
        signal: input.signal,
      },
    )
  } catch (error) {
    throw new Error(formatFetchError(error))
  }
}

function finishAssistant(blocks: BetaContentBlock[], usage: Usage | undefined, model: string): AssistantMessage {
  if (blocks.length === 0) throw new Error('Google Gemini response did not include assistant content')
  const assistant = createAssistantMessage({ content: blocks, ...(usage ? { usage } : {}) })
  assistant.message.model = model
  if (assistant.message.usage) addToTotalSessionCost(0, assistant.message.usage as Usage, `google-gemini/${model}`)
  return assistant
}

export async function queryGoogleGeminiNativeWithoutStreaming(input: {
  messages: Message[]
  systemPrompt: string[]
  tools: Tools
  signal: AbortSignal
  options: Options
}, auth: GoogleGeminiNativeAuth): Promise<AssistantMessage> {
  let assistant: AssistantMessage | undefined
  for await (const event of queryGoogleGeminiNativeWithStreaming(input, auth)) {
    if (event.type === 'assistant' && 'message' in event) assistant = event as AssistantMessage
  }
  if (!assistant) throw new Error('Google Gemini response did not include an assistant message')
  return assistant
}

export async function* queryGoogleGeminiNativeWithStreaming(input: {
  messages: Message[]
  systemPrompt: string[]
  tools: Tools
  signal: AbortSignal
  options: Options
}, auth: GoogleGeminiNativeAuth): AsyncGenerator<StreamEvent | AssistantMessage | SystemAPIErrorMessage, void> {
  try {
    const requested = getApiKeyProviderModelName(input.options.model)
    if (!requested) throw new Error(`Invalid provider model: ${input.options.model}`)
    const model = requested
      const body = await createRequestBody(input, auth, model)
      const response = await fetchGemini({ body, auth, signal: input.signal, fetchOverride: input.options.fetchOverride })
      if (!response.ok || !response.body) {
        const text = await response.text()
        const message = (safeParseJSON(text) as { error?: { message?: string } } | null)?.error?.message || text || `Google Gemini request failed with ${response.status}`
        const delay = response.ok ? null : retryAfterMs(response, message)
        if (delay) await sleep(delay, input.signal, { abortError: () => new Error('Google Gemini request aborted during capacity retry') })
        throw new Error(message)
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const blocks: BetaContentBlock[] = []
      let usage: Usage | undefined
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parsed = parseGoogleGeminiSSEFrames(buffer)
          buffer = parsed.remaining
          for (const frame of parsed.frames) usage = appendGoogleGeminiResponseBlocks(frame, input.tools, blocks) || usage
        }
      } finally {
        reader.releaseLock()
      }
      yield finishAssistant(blocks, usage, model)
      return
  } catch (error) {
    yield createAssistantAPIErrorMessage({ content: errorMessage(error) })
  }
}
