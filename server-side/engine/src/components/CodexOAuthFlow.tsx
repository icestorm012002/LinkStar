import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Link, Text } from '../ink.js'
import { useKeybinding } from '../keybindings/useKeybinding.js'
import {
  OpenAICodexOAuthService,
} from '../services/api/openaiCodexLogin.js'
import type { OpenAICodexAuthInfo } from '../services/api/openaiCodexAuth.js'
import { logError } from '../utils/log.js'
import { Spinner } from './Spinner.js'

type Props = {
  onDone(): void
  startingMessage?: string
}

type LoginState =
  | { state: 'ready' }
  | { state: 'waiting'; url: string }
  | { state: 'success'; auth: OpenAICodexAuthInfo }
  | { state: 'error'; message: string }

export function CodexOAuthFlow({
  onDone,
  startingMessage,
}: Props): React.ReactNode {
  const [service] = useState(() => new OpenAICodexOAuthService())
  const [loginState, setLoginState] = useState<LoginState>({ state: 'ready' })
  const pendingStartRef = useRef(false)

  useKeybinding(
    'confirm:yes',
    () => {
      if (loginState.state === 'success') onDone()
    },
    {
      context: 'Confirmation',
      isActive: loginState.state === 'success',
    },
  )

  const startLogin = useCallback(async () => {
    try {
      const auth = await service.startOAuthFlow(async url => {
        setLoginState({ state: 'waiting', url })
      })
      setLoginState({ state: 'success', auth })
    } catch (error) {
      logError(error)
      setLoginState({
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }, [service])

  useEffect(() => {
    if (loginState.state === 'ready' && !pendingStartRef.current) {
      pendingStartRef.current = true
      process.nextTick(() => {
        void startLogin().finally(() => {
          pendingStartRef.current = false
        })
      })
    }
  }, [loginState.state, startLogin])

  useEffect(() => () => service.cleanup(), [service])

  if (loginState.state === 'success') {
    return (
      <Box flexDirection="column" gap={1}>
        {loginState.auth.email ? (
          <Text dimColor>Logged in as {loginState.auth.email}</Text>
        ) : null}
        <Text color="success">
          Codex login successful. Press <Text bold>Enter</Text> to continue…
        </Text>
      </Box>
    )
  }

  if (loginState.state === 'error') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color="error">Codex login failed: {loginState.message}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>
        {startingMessage ||
          'Claude Code will open a browser and sign in to your Codex/ChatGPT account.'}
      </Text>
      {loginState.state === 'waiting' ? (
        <>
          <Box>
            <Spinner />
            <Text>Opening browser to sign in…</Text>
          </Box>
          <Text dimColor>If the browser did not open, visit:</Text>
          <Link url={loginState.url}>
            <Text dimColor>{loginState.url}</Text>
          </Link>
        </>
      ) : (
        <Box>
          <Spinner />
          <Text>Preparing Codex login…</Text>
        </Box>
      )}
    </Box>
  )
}
