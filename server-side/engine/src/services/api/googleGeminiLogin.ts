import { openBrowser } from '../../utils/browser.js'
import { logError } from '../../utils/log.js'
import { AuthCodeListener } from '../oauth/auth-code-listener.js'
import type { GoogleGeminiAuthInfo } from './googleGeminiAuth.js'
import { persistGoogleGeminiTokens } from './googleGeminiAuth.js'
import {
  buildGoogleGeminiAuthorizeUrl,
  createGoogleGeminiOAuthSession,
  exchangeGoogleGeminiCodeForTokens,
  getGoogleGeminiAuthPort,
  getGoogleGeminiCallbackPath,
} from './googleGeminiProtocol.js'

const SUCCESS_HTML =
  '<!doctype html><html><body style="font-family:sans-serif;padding:24px"><h2>Gemini login complete</h2><p>You can return to Claude.</p></body></html>'
const ERROR_HTML =
  '<!doctype html><html><body style="font-family:sans-serif;padding:24px"><h2>Gemini login failed</h2><p>You can close this tab and retry in Claude.</p></body></html>'

export class GoogleGeminiOAuthService {
  private authCodeListener: AuthCodeListener | null = null

  async startOAuthFlow(
    authURLHandler: (url: string) => Promise<void>,
  ): Promise<GoogleGeminiAuthInfo> {
    try {
      this.authCodeListener = new AuthCodeListener(getGoogleGeminiCallbackPath())
      const port = await this.authCodeListener.start(getGoogleGeminiAuthPort())
      const session = createGoogleGeminiOAuthSession(port)
      const authUrl = buildGoogleGeminiAuthorizeUrl({
        port,
        codeChallenge: session.codeChallenge,
        state: session.state,
      })
      const authorizationCode = await this.authCodeListener.waitForAuthorization(
        session.state,
        async () => {
          await authURLHandler(authUrl)
          await openBrowser(authUrl)
        },
      )
      const tokens = await exchangeGoogleGeminiCodeForTokens({
        code: authorizationCode,
        codeVerifier: session.codeVerifier,
        port,
      })
      const auth = await persistGoogleGeminiTokens(tokens)
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
      this.cleanup()
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
    }
  }
}
