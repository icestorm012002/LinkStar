import { generateCodeChallenge, generateCodeVerifier, generateState } from '../oauth/crypto.js'

const DEFAULT_OPENAI_CODEX_AUTH_ISSUER = 'https://auth.openai.com'
const DEFAULT_OPENAI_CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const DEFAULT_OPENAI_CODEX_AUTH_PORT = 1455
const DEFAULT_OPENAI_CODEX_ORIGINATOR = 'codex_cli_rs'
const OPENAI_CODEX_CALLBACK_PATH = '/auth/callback'

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  id_token?: string
}

function trimOrDefault(value: string | undefined, fallback: string): string {
  const normalized = String(value || '').trim()
  return normalized.length > 0 ? normalized : fallback
}

export function getOpenAICodexAuthIssuer(): string {
  return trimOrDefault(
    process.env.OPENAI_CODEX_AUTH_ISSUER,
    DEFAULT_OPENAI_CODEX_AUTH_ISSUER,
  )
}

export function getOpenAICodexClientId(): string {
  return trimOrDefault(
    process.env.OPENAI_CODEX_AUTH_CLIENT_ID,
    DEFAULT_OPENAI_CODEX_CLIENT_ID,
  )
}

export function getOpenAICodexOriginator(): string {
  return trimOrDefault(
    process.env.OPENAI_CODEX_ORIGINATOR,
    DEFAULT_OPENAI_CODEX_ORIGINATOR,
  )
}

export function getOpenAICodexAuthPort(): number {
  const raw = Number(process.env.OPENAI_CODEX_AUTH_PORT)
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_OPENAI_CODEX_AUTH_PORT
}

export function getOpenAICodexCallbackPath(): string {
  return OPENAI_CODEX_CALLBACK_PATH
}

export function buildOpenAICodexRedirectUri(port: number): string {
  return `http://localhost:${port}${OPENAI_CODEX_CALLBACK_PATH}`
}

export function createOpenAICodexOAuthSession(port: number): {
  codeVerifier: string
  codeChallenge: string
  state: string
  redirectUri: string
} {
  const codeVerifier = generateCodeVerifier()
  return {
    codeVerifier,
    codeChallenge: generateCodeChallenge(codeVerifier),
    state: generateState(),
    redirectUri: buildOpenAICodexRedirectUri(port),
  }
}

export function buildOpenAICodexAuthorizeUrl(input: {
  port: number
  codeChallenge: string
  state: string
  workspaceId?: string
}): string {
  const url = new URL(`${getOpenAICodexAuthIssuer()}/oauth/authorize`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', getOpenAICodexClientId())
  url.searchParams.set('redirect_uri', buildOpenAICodexRedirectUri(input.port))
  url.searchParams.set('scope', 'openid profile email offline_access')
  url.searchParams.set('code_challenge', input.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('id_token_add_organizations', 'true')
  url.searchParams.set('codex_cli_simplified_flow', 'true')
  url.searchParams.set('state', input.state)
  url.searchParams.set('originator', getOpenAICodexOriginator())
  if (input.workspaceId) {
    url.searchParams.set('allowed_workspace_id', input.workspaceId)
  }
  return url.toString()
}

export async function exchangeOpenAICodexCodeForTokens(input: {
  code: string
  codeVerifier: string
  port: number
}): Promise<{ accessToken: string; refreshToken: string; idToken: string }> {
  const response = await fetch(`${getOpenAICodexAuthIssuer()}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: buildOpenAICodexRedirectUri(input.port),
      client_id: getOpenAICodexClientId(),
      code_verifier: input.codeVerifier,
    }).toString(),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `OpenAI Codex auth failed with ${response.status}`)
  }
  const data = (await response.json()) as TokenResponse
  if (!data.access_token || !data.refresh_token || !data.id_token) {
    throw new Error('OpenAI Codex auth response was missing token fields')
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    idToken: data.id_token,
  }
}

export async function refreshOpenAICodexTokens(refreshToken: string): Promise<{
  accessToken?: string
  refreshToken?: string
  idToken?: string
}> {
  const response = await fetch(`${getOpenAICodexAuthIssuer()}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: getOpenAICodexClientId(),
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: 'openid profile email',
    }),
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `OpenAI Codex token refresh failed with ${response.status}`)
  }
  const data = (await response.json()) as TokenResponse
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    idToken: data.id_token,
  }
}
