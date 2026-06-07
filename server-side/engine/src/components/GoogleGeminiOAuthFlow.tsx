import React, { useEffect, useState } from 'react'
import { Box, Text } from '../ink.js'
import { useKeybinding } from '../keybindings/useKeybinding.js'
import {
  getGoogleGeminiAuthInfo,
  type GoogleGeminiAuthInfo,
} from '../services/api/googleGeminiAuth.js'
import { Spinner } from './Spinner.js'

type Props = {
  onDone(): void
  startingMessage?: string
}

type LoginState =
  | { state: 'checking' }
  | { state: 'success'; auth: GoogleGeminiAuthInfo }
  | { state: 'error'; message: string }

export function GoogleGeminiOAuthFlow({
  onDone,
  startingMessage,
}: Props): React.ReactNode {
  const [loginState, setLoginState] = useState<LoginState>({ state: 'checking' })

  useKeybinding(
    'confirm:yes',
    () => {
      if (loginState.state === 'success') onDone()
    },
    { context: 'Confirmation', isActive: loginState.state === 'success' },
  )

  useEffect(() => {
    let cancelled = false
    void getGoogleGeminiAuthInfo()
      .then(auth => {
        if (cancelled) return
        if (auth.status === 'ok') {
          setLoginState({ state: 'success', auth })
          return
        }
        setLoginState({
          state: 'error',
          message:
            'Gemini CLI login was not found. Install Gemini CLI and complete its Google login first, then retry /login here.',
        })
      })
      .catch(error => {
        if (cancelled) return
        setLoginState({
          state: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (loginState.state === 'success') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>
          {startingMessage ||
            'Detected an existing Gemini CLI login on this machine.'}
        </Text>
        {loginState.auth.email ? (
          <Text dimColor>Logged in as {loginState.auth.email}</Text>
        ) : null}
        <Text dimColor>
          Source: {loginState.auth.source} auth at {loginState.auth.authPath}
        </Text>
        <Text color="success">
          Gemini login is available. Press <Text bold>Enter</Text> to continue…
        </Text>
      </Box>
    )
  }

  if (loginState.state === 'error') {
    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>
          {startingMessage ||
            'Claude Code uses the Gemini CLI login already present on this machine.'}
        </Text>
        <Text color="error">Gemini login failed: {loginState.message}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>
        {startingMessage ||
          'Checking for an existing Gemini CLI login on this machine…'}
      </Text>
      <Box>
        <Spinner />
        <Text>Checking Gemini authentication…</Text>
      </Box>
    </Box>
  )
}
