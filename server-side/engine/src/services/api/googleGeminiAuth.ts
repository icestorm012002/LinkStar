import { chmod, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { existsSync, readFileSync as readFileSyncNow } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import {
  getClaudeAuthNamespaceFileSuffix,
  getClaudeConfigHomeDir,
} from '../../utils/envUtils.js'
import {
  getExternalGoogleGeminiAuthPath,
  readExternalGoogleGeminiAuth,
  refreshGoogleGeminiTokens,
} from './googleGeminiProtocol.js'

type InternalAuthRecord = {
  provider: 'google-gemini'
  clientId: string
  tokens: { accessToken: string; refreshToken: string; projectId?: string; email?: string }
  expiresAt: number
  lastRefresh?: string
}

export type GoogleGeminiAuthStatus =
  | 'ok'
  | 'missing_auth'
  | 'missing_access_token'
  | 'token_expired'
  | 'refresh_failed'

export type GoogleGeminiAuthInfo = {
  status: GoogleGeminiAuthStatus
  source: 'internal' | 'external' | 'none'
  authPath: string
  accessToken?: string
  refreshToken?: string
  email?: string
  projectId?: string
  expiresAt?: number
  lastRefresh?: string
  clientId?: string
}

function getAuthPath(): string {
  return join(
    getClaudeConfigHomeDir(),
    `google-gemini-auth${getClaudeAuthNamespaceFileSuffix()}.json`,
  )
}

function buildAuthInfo(
  record: InternalAuthRecord | null,
  status: GoogleGeminiAuthStatus,
  source: 'internal' | 'external' | 'none' = record ? 'internal' : 'none',
  authPath: string = getAuthPath(),
): GoogleGeminiAuthInfo {
  return {
    status,
    source,
    authPath,
    accessToken: record?.tokens.accessToken,
    refreshToken: record?.tokens.refreshToken,
    email: record?.tokens.email,
    projectId: record?.tokens.projectId,
    expiresAt: record?.expiresAt,
    lastRefresh: record?.lastRefresh,
    clientId: record?.clientId,
  }
}

async function readRecord(): Promise<InternalAuthRecord | null> {
  try {
    const raw = await readFile(getAuthPath(), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as InternalAuthRecord) : null
  } catch {
    return null
  }
}

function readRecordSync(): InternalAuthRecord | null {
  try {
    const raw = readFileSyncNow(getAuthPath(), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as InternalAuthRecord) : null
  } catch {
    return null
  }
}

function decodeJwtPayload(token: string | null | undefined): Record<string, unknown> {
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

function getExternalGeminiRoot(): string {
  return String(process.env.GEMINI_CONFIG_DIR || '').trim() || join(homedir(), '.gemini')
}

function getExternalGeminiEmail(): string | undefined {
  const oauth = readExternalGoogleGeminiAuth()
  const fromIdToken = String(decodeJwtPayload(oauth?.id_token).email || '').trim()
  if (fromIdToken) return fromIdToken
  try {
    const raw = readFileSyncNow(join(getExternalGeminiRoot(), 'google_accounts.json'), 'utf8')
    const parsed = JSON.parse(raw) as { active?: string }
    return String(parsed.active || '').trim() || undefined
  } catch {
    return undefined
  }
}

async function saveRecord(record: InternalAuthRecord): Promise<void> {
  await mkdir(getClaudeConfigHomeDir(), { recursive: true })
  await writeFile(getAuthPath(), JSON.stringify(record, null, 2), 'utf8')
  await chmod(getAuthPath(), 0o600).catch(() => {})
}

export function hasStoredGoogleGeminiAuth(): boolean {
  const record = readRecordSync()
  if (String(record?.tokens?.refreshToken || record?.tokens?.accessToken || '').trim()) {
    return true
  }
  const external = readExternalGoogleGeminiAuth()
  return !!String(external?.refresh_token || external?.access_token || '').trim()
}

export async function persistGoogleGeminiTokens(input: {
  accessToken: string
  refreshToken: string
  expiresAt: number
  email?: string
  projectId?: string
  clientId: string
}): Promise<GoogleGeminiAuthInfo> {
  const record: InternalAuthRecord = {
    provider: 'google-gemini',
    clientId: input.clientId,
    tokens: {
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      email: input.email,
      projectId: input.projectId,
    },
    expiresAt: input.expiresAt,
    lastRefresh: new Date().toISOString(),
  }
  await saveRecord(record)
  return buildAuthInfo(record, 'ok')
}

export async function clearStoredGoogleGeminiAuth(): Promise<boolean> {
  if (!existsSync(getAuthPath())) return false
  try {
    await rm(getAuthPath(), { force: true })
    return true
  } catch {
    return false
  }
}

export async function getGoogleGeminiAuthInfo(): Promise<GoogleGeminiAuthInfo> {
  const record = await readRecord()
  const resolvedInternal = await resolveRecord(record, 'internal', getAuthPath())
  if (resolvedInternal) return resolvedInternal
  const external = readExternalGoogleGeminiAuth()
  const externalRecord: InternalAuthRecord | null = external
    ? {
        provider: 'google-gemini',
        clientId: '',
        tokens: {
          accessToken: String(external.access_token || '').trim(),
          refreshToken: String(external.refresh_token || '').trim(),
          email: getExternalGeminiEmail(),
        },
        expiresAt: Number(external.expiry_date || 0),
      }
    : null
  const resolvedExternal = await resolveRecord(
    externalRecord,
    'external',
    getExternalGoogleGeminiAuthPath(),
  )
  if (resolvedExternal) return resolvedExternal
  return buildAuthInfo(null, 'missing_auth')
}

async function resolveRecord(
  record: InternalAuthRecord | null,
  source: 'internal' | 'external',
  authPath: string,
): Promise<GoogleGeminiAuthInfo | null> {
  if (!record) return null
  if (!String(record.tokens.accessToken || '').trim()) {
    return buildAuthInfo(record, 'missing_access_token', source, authPath)
  }
  if (record.expiresAt > Date.now() + 60_000) {
    return buildAuthInfo(record, 'ok', source, authPath)
  }
  try {
    const refreshed = await refreshGoogleGeminiTokens({
      refreshToken: record.tokens.refreshToken,
      clientId: record.clientId,
    })
    const nextRecord: InternalAuthRecord = {
      ...record,
      clientId: record.clientId || '',
      tokens: {
        ...record.tokens,
        accessToken: refreshed.accessToken || record.tokens.accessToken,
        refreshToken: refreshed.refreshToken || record.tokens.refreshToken,
      },
      expiresAt: refreshed.expiresAt || record.expiresAt,
      lastRefresh: new Date().toISOString(),
    }
    if (source === 'internal') {
      await saveRecord(nextRecord)
    }
    return buildAuthInfo(nextRecord, 'ok', source, authPath)
  } catch {
    return buildAuthInfo(record, 'refresh_failed', source, authPath)
  }
}

export async function resolveGoogleGeminiAccessToken(): Promise<GoogleGeminiAuthInfo> {
  const auth = await getGoogleGeminiAuthInfo()
  if (auth.status !== 'ok' || !auth.accessToken) {
    throw new Error(`Google Gemini login is not available (${auth.status}). Expected auth at ${auth.authPath}`)
  }
  return auth
}
