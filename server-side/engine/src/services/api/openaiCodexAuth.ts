import { chmod, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { existsSync, readFileSync as readFileSyncNow } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import {
  getClaudeAuthNamespaceFileSuffix,
  getClaudeConfigHomeDir,
} from '../../utils/envUtils.js'
import { getErrnoCode } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import {
  getOpenAICodexAuthIssuer,
  getOpenAICodexClientId,
  refreshOpenAICodexTokens,
} from './openaiCodexProtocol.js'

type JwtPayload = Record<string, unknown> & {
  exp?: number
  email?: string
  ['https://api.openai.com/auth']?: Record<string, unknown>
  ['https://api.openai.com/profile']?: { email?: string }
}

type InternalAuthRecord = {
  provider: 'openai-codex'
  issuer: string
  clientId: string
  tokens: {
    idToken: string
    accessToken: string
    refreshToken?: string
    accountId?: string
  }
  lastRefresh?: string
}

type ExternalAuthRecord = {
  tokens?: {
    id_token?: string
    access_token?: string
    refresh_token?: string
    account_id?: string
  }
  last_refresh?: string
}

export type CodexAuthStatus =
  | 'ok'
  | 'missing_auth'
  | 'invalid_auth'
  | 'missing_access_token'
  | 'token_expired'
  | 'refresh_failed'

export type OpenAICodexAuthInfo = {
  status: CodexAuthStatus
  source: 'internal' | 'external' | 'none'
  authPath: string
  accessToken?: string
  refreshToken?: string
  accountId?: string
  email?: string
  planType?: string
  expiresAt?: number
  lastRefresh?: string
}

type NormalizedAuthRecord = {
  source: 'internal' | 'external'
  path: string
  issuer: string
  clientId: string
  tokens: {
    idToken?: string
    accessToken?: string
    refreshToken?: string
    accountId?: string
  }
  lastRefresh?: string
}

function decodeJwtPayload(token: string | null | undefined): JwtPayload {
  const raw = String(token || '').trim()
  if (raw.split('.').length < 3) return {}
  try {
    const payload = raw.split('.')[1] ?? ''
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
    return JSON.parse(Buffer.from(padded, 'base64url').toString('utf8'))
  } catch {
    return {}
  }
}

function getAuthClaims(token: string | undefined): Record<string, unknown> {
  const payload = decodeJwtPayload(token)
  const nested = payload['https://api.openai.com/auth']
  return nested && typeof nested === 'object' ? nested : {}
}

function buildAuthInfo(
  record: NormalizedAuthRecord,
  status: CodexAuthStatus,
  accessToken?: string,
): OpenAICodexAuthInfo {
  const claims = getAuthClaims(record.tokens.idToken)
  const payload = decodeJwtPayload(accessToken || record.tokens.accessToken)
  const expiresAt = Number(payload.exp || 0) || undefined
  return {
    status,
    source: record.source,
    authPath: record.path,
    accessToken,
    refreshToken: record.tokens.refreshToken,
    accountId:
      String(
        record.tokens.accountId || claims.chatgpt_account_id || '',
      ).trim() || undefined,
    email:
      String(
        decodeJwtPayload(record.tokens.idToken).email ||
          payload['https://api.openai.com/profile']?.email ||
          '',
      ).trim() || undefined,
    planType: String(claims.chatgpt_plan_type || '').trim() || undefined,
    expiresAt,
    lastRefresh: record.lastRefresh,
  }
}

function getInternalAuthPath(): string {
  return join(
    getClaudeConfigHomeDir(),
    `openai-codex-auth${getClaudeAuthNamespaceFileSuffix()}.json`,
  )
}

function getExternalAuthPath(): string {
  const configured = String(process.env.CODEX_HOME || '').trim()
  return join(
    configured.length > 0 ? configured : join(homedir(), '.codex'),
    'auth.json',
  )
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as T) : null
  } catch {
    return null
  }
}

function readJsonSync<T>(path: string): T | null {
  try {
    const raw = readFileSyncNow(path, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as T) : null
  } catch (e) {
    const code = getErrnoCode(e)
    if (code && code !== 'ENOENT') {
      logError(e)
    }
    return null
  }
}

export function hasStoredOpenAICodexAuth(): boolean {
  const internalPath = getInternalAuthPath()
  if (existsSync(internalPath)) {
    const internal = readJsonSync<InternalAuthRecord>(internalPath)
    const tokens = internal?.tokens
    if (
      String(tokens?.accessToken || '').trim() ||
      String(tokens?.refreshToken || '').trim() ||
      String(tokens?.idToken || '').trim()
    ) {
      return true
    }
  }

  const externalPath = getExternalAuthPath()
  if (existsSync(externalPath)) {
    const external = readJsonSync<ExternalAuthRecord>(externalPath)
    const tokens = external?.tokens
    if (
      String(tokens?.access_token || '').trim() ||
      String(tokens?.refresh_token || '').trim() ||
      String(tokens?.id_token || '').trim()
    ) {
      return true
    }
  }

  return false
}

async function readInternalAuth(): Promise<NormalizedAuthRecord | null> {
  const data = await readJson<InternalAuthRecord>(getInternalAuthPath())
  if (!data?.tokens) return null
  return {
    source: 'internal',
    path: getInternalAuthPath(),
    issuer: data.issuer || getOpenAICodexAuthIssuer(),
    clientId: data.clientId || getOpenAICodexClientId(),
    tokens: data.tokens,
    lastRefresh: data.lastRefresh,
  }
}

async function readExternalAuth(): Promise<NormalizedAuthRecord | null> {
  const path = getExternalAuthPath()
  const data = await readJson<ExternalAuthRecord>(path)
  if (!data?.tokens) return null
  return {
    source: 'external',
    path,
    issuer: getOpenAICodexAuthIssuer(),
    clientId: getOpenAICodexClientId(),
    tokens: {
      idToken: data.tokens.id_token,
      accessToken: data.tokens.access_token,
      refreshToken: data.tokens.refresh_token,
      accountId: data.tokens.account_id,
    },
    lastRefresh: data.last_refresh,
  }
}

async function saveInternalAuth(record: NormalizedAuthRecord): Promise<void> {
  const path = getInternalAuthPath()
  const idToken = String(record.tokens.idToken || '').trim()
  const accessToken = String(record.tokens.accessToken || '').trim()
  if (!idToken) {
    throw new Error('OpenAI Codex auth cannot be persisted without idToken')
  }
  if (!accessToken) {
    throw new Error('OpenAI Codex auth cannot be persisted without accessToken')
  }
  await mkdir(getClaudeConfigHomeDir(), { recursive: true })
  await writeFile(
    path,
    JSON.stringify(
      {
        provider: 'openai-codex',
        issuer: record.issuer,
        clientId: record.clientId,
        tokens: { ...record.tokens, idToken, accessToken },
        lastRefresh: record.lastRefresh,
      } satisfies InternalAuthRecord,
      null,
      2,
    ),
    'utf8',
  )
  await chmod(path, 0o600).catch(() => {})
}

async function normalizeAuthInfo(
  record: NormalizedAuthRecord | null,
): Promise<OpenAICodexAuthInfo | null> {
  if (!record) return null
  const accessToken = String(record.tokens.accessToken || '').trim()
  if (!accessToken) {
    return {
      status: 'missing_access_token',
      source: record.source,
      authPath: record.path,
    }
  }
  const expiresAt = Number(decodeJwtPayload(accessToken).exp || 0)
  if (record.source === 'internal' && expiresAt > 0 && Date.now() >= expiresAt * 1000) {
    const refreshToken = String(record.tokens.refreshToken || '').trim()
    if (!refreshToken) return buildAuthInfo(record, 'token_expired')
    try {
      const refreshed = await refreshOpenAICodexTokens(refreshToken)
      const nextRecord: NormalizedAuthRecord = {
        ...record,
        tokens: {
          idToken: refreshed.idToken || record.tokens.idToken,
          accessToken: refreshed.accessToken || record.tokens.accessToken,
          refreshToken: refreshed.refreshToken || record.tokens.refreshToken,
          accountId:
            String(
              record.tokens.accountId ||
                getAuthClaims(refreshed.idToken || record.tokens.idToken)
                  .chatgpt_account_id ||
                '',
            ).trim() || undefined,
        },
        lastRefresh: new Date().toISOString(),
      }
      await saveInternalAuth(nextRecord)
      return buildAuthInfo(nextRecord, 'ok', nextRecord.tokens.accessToken)
    } catch {
      return buildAuthInfo(record, 'refresh_failed')
    }
  }
  if (expiresAt > 0 && Date.now() >= expiresAt * 1000) {
    return buildAuthInfo(record, 'token_expired')
  }
  return buildAuthInfo(record, 'ok', accessToken)
}

export async function persistOpenAICodexTokens(input: {
  idToken: string
  accessToken: string
  refreshToken: string
}): Promise<OpenAICodexAuthInfo> {
  const claims = getAuthClaims(input.idToken)
  const record: NormalizedAuthRecord = {
    source: 'internal',
    path: getInternalAuthPath(),
    issuer: getOpenAICodexAuthIssuer(),
    clientId: getOpenAICodexClientId(),
    tokens: {
      idToken: input.idToken,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      accountId: String(claims.chatgpt_account_id || '').trim() || undefined,
    },
    lastRefresh: new Date().toISOString(),
  }
  await saveInternalAuth(record)
  return buildAuthInfo(record, 'ok', input.accessToken)
}

export async function clearStoredOpenAICodexAuth(): Promise<boolean> {
  const existing = await readJson<InternalAuthRecord>(getInternalAuthPath())
  if (!existing) {
    return false
  }
  try {
    await rm(getInternalAuthPath(), { force: true })
    return true
  } catch {
    return false
  }
}

export async function getOpenAICodexAuthInfo(): Promise<OpenAICodexAuthInfo> {
  const internal = await normalizeAuthInfo(await readInternalAuth())
  if (internal) return internal
  const external = await normalizeAuthInfo(await readExternalAuth())
  if (external) return external
  return {
    status: 'missing_auth',
    source: 'none',
    authPath: getInternalAuthPath(),
  }
}

export async function resolveOpenAICodexAccessToken(): Promise<string> {
  const envToken = process.env.CODEX_API_KEY || process.env.OPENAI_CODEX_API_KEY
  if (envToken && envToken.trim()) {
    return envToken.trim()
  }
  const auth = await getOpenAICodexAuthInfo()
  if (auth.status !== 'ok' || !auth.accessToken) {
    throw new Error(
      `OpenAI Codex login is not available (${auth.status}). Expected auth at ${auth.authPath}`,
    )
  }
  return auth.accessToken
}
