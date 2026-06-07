import * as React from 'react'
import { Box, Text } from '../ink.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import TextInput from './TextInput.js'
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js'
import {
  getApiKeyProviderDefinition,
  type ApiKeyProviderId,
} from '../services/api/providerCatalog.js'
import {
  getProviderApiKeyStatus,
  setProviderApiKey,
} from '../services/api/providerAuth.js'

export function ProviderApiKeyFlow(props: {
  providerId: ApiKeyProviderId
  onDone(success: boolean): void
}): React.ReactNode {
  const provider = getApiKeyProviderDefinition(props.providerId)
  const [value, setValue] = React.useState('')
  const [cursorOffset, setCursorOffset] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const [warning, setWarning] = React.useState<string | null>(null)
  const { columns } = useTerminalSize()

  if (!provider) {
    props.onDone(false)
    return null
  }

  const handleSubmit = (input: string) => {
    try {
      const result = setProviderApiKey(provider.id, input)
      setWarning(result.warning ?? null)
      setError(null)
      props.onDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const currentStatus = getProviderApiKeyStatus(provider.id)
  const inputColumns = Math.max(40, Math.min(columns - 4, 100))

  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>{provider.label}</Text>
      <Text dimColor>
        Enter your {provider.apiKeyLabel}. The key will be stored in Claude
        Code&apos;s secure credential store and used by the internal provider.
      </Text>
      <Text dimColor>
        Endpoint: <Text bold>{provider.baseUrl}</Text>
      </Text>
      <Text>
        Current status:{' '}
        <Text color={currentStatus === 'configured' ? 'green' : 'yellow'}>
          {currentStatus === 'configured' ? 'configured' : 'not configured'}
        </Text>
      </Text>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        onPaste={setValue}
        focus
        mask="*"
        showCursor
        placeholder={`Paste ${provider.apiKeyLabel}…`}
        columns={inputColumns}
        cursorOffset={cursorOffset}
        onChangeCursorOffset={setCursorOffset}
      />
      {error ? (
        <Text color="red">{error}</Text>
      ) : warning ? (
        <Text color="yellow">{warning}</Text>
      ) : (
        <Text dimColor>
          Press Enter to save. Existing key will be replaced for this provider.
        </Text>
      )}
      <ConfigurableShortcutHint
        action="confirm:no"
        context="Confirmation"
        fallback="Esc"
        description="cancel"
      />
    </Box>
  )
}
