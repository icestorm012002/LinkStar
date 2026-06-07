import { logError } from '../../utils/log.js'
import { openBrowser } from '../../utils/browser.js'
import { AuthCodeListener } from '../oauth/auth-code-listener.js'
import {
  type OpenAICodexAuthInfo,
  persistOpenAICodexTokens,
} from './openaiCodexAuth.js'
import {
  buildOpenAICodexAuthorizeUrl,
  createOpenAICodexOAuthSession,
  exchangeOpenAICodexCodeForTokens,
  getOpenAICodexAuthPort,
  getOpenAICodexCallbackPath,
} from './openaiCodexProtocol.js'

const SUCCESS_HTML =
  '<!doctype html><html><body style="font-family:sans-serif;padding:24px"><h2>Codex login complete</h2><p>You can return to Claude.</p></body></html>'
const ERROR_HTML =
  '<!doctype html><html><body style="font-family:sans-serif;padding:24px"><h2>Codex login failed</h2><p>You can close this tab and retry in Claude.</p></body></html>'

export class OpenAICodexOAuthService {
  private authCodeListener: AuthCodeListener | null = null
  private port: number | null = null

  async startOAuthFlow(
    authURLHandler: (url: string) => Promise<void>,
  ): Promise<OpenAICodexAuthInfo> {
    this.authCodeListener = new AuthCodeListener(getOpenAICodexCallbackPath())
    this.port = await this.authCodeListener.start(getOpenAICodexAuthPort())
    const session = createOpenAICodexOAuthSession(this.port)
    const authUrl = buildOpenAICodexAuthorizeUrl({
      port: this.port,
      codeChallenge: session.codeChallenge,
      state: session.state,
      workspaceId:
        String(process.env.OPENAI_CODEX_ALLOWED_WORKSPACE_ID || '').trim() ||
        undefined,
    })
    const authorizationCode = await this.authCodeListener.waitForAuthorization(
      session.state,
      async () => {
        await authURLHandler(authUrl)
        await openBrowser(authUrl)
      },
    )
    try {
      const tokens = await exchangeOpenAICodexCodeForTokens({
        code: authorizationCode,
        codeVerifier: session.codeVerifier,
        port: this.port,
      })
      const auth = await persistOpenAICodexTokens(tokens)
      this.authCodeListener.handleSuccessRedirect([], res => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(SUCCESS_HTML)
      })
      return auth
    } catch (error) {
      this.authCodeListener.handleErrorRedirect(res => {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(ERROR_HTML)
      })
      throw error
    }
  }

  cleanup(): void {
    try {
      this.authCodeListener?.close()
    } catch (error) {
      logError(error)
    } finally {
      this.authCodeListener = null
      this.port = null
    }
  }
}
