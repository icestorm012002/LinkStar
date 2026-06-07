import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { discoverGoogleGeminiProjectId } from './googleGeminiProject.js'
import { getProviderOAuthClientConfig } from './providerAuth.js'

const CLIENT_ID_KEYS = [
  'GOOGLE_GEMINI_OAUTH_CLIENT_ID',
]
const CLIENT_SECRET_KEYS = [
  'GOOGLE_GEMINI_OAUTH_CLIENT_SECRET',
]
const CALLBACK_PATH = '/oauth2callback'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json'
const SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

type ExternalGeminiCliAuthRecord = {
  access_token?: string
  refresh_token?: string
  id_token?: string
  expiry_date?: number
}

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
}

type OAuthClientConfig = { clientId: string; clientSecret?: string }

function resolveEnv(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim()
    if (value) return value
  }
}

function findInPath(name: string): string | null {
  const exts = process.platform === 'win32' ? ['.cmd', '.bat', '.exe', ''] : ['']
  for (const dir of String(process.env.PATH || '').split(delimiter)) {
    for (const ext of exts) {
      const path = join(dir, name + ext)
      if (existsSync(path)) return path
    }
  }
  return null
}

function findFile(dir: string, name: string, depth: number): string | null {
  if (depth <= 0) return null
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isFile() && entry.name === name) return path
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const nested = findFile(path, name, depth - 1)
        if (nested) return nested
      }
    }
  } catch {}
  return null
}

function extractGeminiCliCredentials(): OAuthClientConfig | null {
  const geminiPath = findInPath('gemini')
  if (!geminiPath) return null
  try {
    const resolvedPath = realpathSync(geminiPath)
    const wrapperDir = dirname(resolvedPath)
    const npmPrefixDir = wrapperDir
    const candidates = [
      join(npmPrefixDir, 'node_modules', '@google', 'gemini-cli-core', 'dist', 'src', 'code_assist', 'oauth2.js'),
      join(npmPrefixDir, 'node_modules', '@google', 'gemini-cli-core', 'dist', 'code_assist', 'oauth2.js'),
      join(npmPrefixDir, 'node_modules', '@google', 'gemini-cli', 'node_modules', '@google', 'gemini-cli-core', 'dist', 'src', 'code_assist', 'oauth2.js'),
      join(npmPrefixDir, 'node_modules', '@google', 'gemini-cli', 'node_modules', '@google', 'gemini-cli-core', 'dist', 'code_assist', 'oauth2.js'),
      findFile(join(npmPrefixDir, 'node_modules', '@google', 'gemini-cli'), 'oauth2.js', 10),
    ].filter(Boolean) as string[]
    const candidate = candidates.find(path => existsSync(path))
    if (!candidate) return null
    const content = readFileSync(candidate, 'utf8')
    const clientId = content.match(/(\d+-[a-z0-9]+\.apps\.googleusercontent\.com)/)?.[1]
    const clientSecret = content.match(/(GOCSPX-[A-Za-z0-9_-]+)/)?.[1]
    return clientId ? { clientId, clientSecret } : null
  } catch {
    return null
  }
}

function resolveOAuthClientConfig(): OAuthClientConfig {
  const stored = getProviderOAuthClientConfig('google-gemini')
  if (stored) return stored
  const clientId = resolveEnv(CLIENT_ID_KEYS)
  const clientSecret = resolveEnv(CLIENT_SECRET_KEYS)
  if (clientId) return { clientId, clientSecret }
  const extracted = extractGeminiCliCredentials()
  if (extracted) return extracted
  throw new Error(
    'Google Gemini OAuth client is not configured. Install and log in to Gemini CLI first, or set GOOGLE_GEMINI_OAUTH_CLIENT_ID/SECRET.',
  )
}

export function getGoogleGeminiAuthPort(): number | undefined {
  const value = Number(process.env.GOOGLE_GEMINI_AUTH_PORT)
  return Number.isInteger(value) && value > 0 ? value : undefined
}

export function getExternalGoogleGeminiAuthPath(): string {
  return join(
    String(process.env.GEMINI_CONFIG_DIR || '').trim() || join(homedir(), '.gemini'),
    'oauth_creds.json',
  )
}

export function readExternalGoogleGeminiAuth():
  | ExternalGeminiCliAuthRecord
  | null {
  try {
    const raw = readFileSync(getExternalGoogleGeminiAuthPath(), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object'
      ? (parsed as ExternalGeminiCliAuthRecord)
      : null
  } catch {
    return null
  }
}

export function getGoogleGeminiCallbackPath(): string {
  return CALLBACK_PATH
}

export function createGoogleGeminiOAuthSession(port: number) {
  const codeVerifier = randomBytes(32).toString('hex')
  return {
    codeVerifier,
    codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url'),
    state: randomBytes(16).toString('hex'),
    redirectUri: `http://localhost:${port}${CALLBACK_PATH}`,
  }
}

export function buildGoogleGeminiAuthorizeUrl(input: {
  port: number
  codeChallenge: string
  state: string
}): string {
  const { clientId } = resolveOAuthClientConfig()
  const url = new URL(AUTH_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', `http://localhost:${input.port}${CALLBACK_PATH}`)
  url.searchParams.set('scope', SCOPES.join(' '))
  url.searchParams.set('code_challenge', input.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', input.state)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  return url.toString()
}

async function getGoogleGeminiUserEmail(accessToken: string): Promise<string | undefined> {
  const response = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) return undefined
  const data = (await response.json()) as { email?: string }
  return String(data.email || '').trim() || undefined
}

export async function exchangeGoogleGeminiCodeForTokens(input: {
  code: string
  codeVerifier: string
  port: number
}): Promise<{
  accessToken: string
  refreshToken: string
  expiresAt: number
  email?: string
  projectId?: string
  clientId: string
}> {
  const client = resolveOAuthClientConfig()
  const body = new URLSearchParams({
    client_id: client.clientId,
    code: input.code,
    grant_type: 'authorization_code',
    redirect_uri: `http://localhost:${input.port}${CALLBACK_PATH}`,
    code_verifier: input.codeVerifier,
  })
  if (client.clientSecret) body.set('client_secret', client.clientSecret)
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) {
    throw new Error(await response.text() || `Google Gemini auth failed with ${response.status}`)
  }
  const data = (await response.json()) as TokenResponse
  if (!data.access_token || !data.refresh_token || !data.expires_in) {
    throw new Error('Google Gemini auth response was missing token fields')
  }
  const email = await getGoogleGeminiUserEmail(data.access_token)
  const projectId = await discoverGoogleGeminiProjectId(data.access_token)
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    email,
    projectId: projectId || undefined,
    clientId: client.clientId,
  }
}

export async function refreshGoogleGeminiTokens(input: {
  refreshToken: string
  clientId: string
}): Promise<{ accessToken?: string; refreshToken?: string; expiresAt?: number }> {
  const client = resolveOAuthClientConfig()
  const body = new URLSearchParams({
    client_id: input.clientId || client.clientId,
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
  })
  if (client.clientSecret) body.set('client_secret', client.clientSecret)
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!response.ok) {
    throw new Error(await response.text() || `Google Gemini token refresh failed with ${response.status}`)
  }
  const data = (await response.json()) as TokenResponse
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  }
}
