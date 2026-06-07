import { feature } from 'bun:bundle'
import * as React from 'react'
import { resetCostState } from '../../bootstrap/state.js'
import {
  clearTrustedDeviceToken,
  enrollTrustedDevice,
} from '../../bridge/trustedDevice.js'
import type { LocalJSXCommandContext } from '../../commands.js'
import { CodexOAuthFlow } from '../../components/CodexOAuthFlow.js'
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js'
import { ConsoleOAuthFlow } from '../../components/ConsoleOAuthFlow.js'
import { GoogleGeminiOAuthFlow } from '../../components/GoogleGeminiOAuthFlow.js'
import { ProviderApiKeyFlow } from '../../components/ProviderApiKeyFlow.js'
import { Select } from '../../components/CustomSelect/select.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js'
import { Box, Text } from '../../ink.js'
import { useKeybinding } from '../../keybindings/useKeybinding.js'
import { refreshGrowthBookAfterAuthChange } from '../../services/analytics/growthbook.js'
import { refreshPolicyLimits } from '../../services/policyLimits/index.js'
import { getDefaultApiKeyProviderModel } from '../../services/api/providerCatalog.js'
import { refreshRemoteManagedSettings } from '../../services/remoteManagedSettings/index.js'
import { useSetAppState } from '../../state/AppState.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { stripSignatureBlocks } from '../../utils/messages.js'
import {
  getApiKeyProviderForModel,
  getDefaultOpenAICodexModel,
  isApiKeyProviderModel,
  isOpenAICodexModel,
} from '../../utils/model/providers.js'
import {
  checkAndDisableAutoModeIfNeeded,
  checkAndDisableBypassPermissionsIfNeeded,
  resetAutoModeGateCheck,
  resetBypassPermissionsCheck,
} from '../../utils/permissions/bypassPermissionsKillswitch.js'
import { resetUserCache } from '../../utils/user.js'

type LoginProvider =
  | 'claude'
  | 'codex'
  | 'google-gemini'
  | 'moonshot-kimi'
  | 'aliyun-qwen'
  | 'volcengine-doubao'
  | 'zhipu-glm'
  | 'zhipu-glm-coding-plan'

function isLoginProvider(value: string | null | undefined): value is LoginProvider {
  return (
    value === 'claude' ||
    value === 'codex' ||
    value === 'google-gemini' ||
    value === 'moonshot-kimi' ||
    value === 'aliyun-qwen' ||
    value === 'volcengine-doubao' ||
    value === 'zhipu-glm' ||
    value === 'zhipu-glm-coding-plan'
  )
}

function getPreferredLoginProvider(mainLoopModel: string): LoginProvider {
  const saved = getGlobalConfig().lastLoginProvider
  if (isLoginProvider(saved)) {
    return saved
  }
  if (isOpenAICodexModel(mainLoopModel)) {
    return 'codex'
  }
  if (isApiKeyProviderModel(mainLoopModel)) {
    const provider = getApiKeyProviderForModel(mainLoopModel)?.id
    if (isLoginProvider(provider)) {
      return provider
    }
  }
  return 'claude'
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
): Promise<React.ReactNode> {
  return (
    <Login
      onDone={async success => {
        context.onChangeAPIKey()
        context.setMessages(stripSignatureBlocks)
        if (success) {
          resetCostState()
          void refreshRemoteManagedSettings()
          void refreshPolicyLimits()
          resetUserCache()
          refreshGrowthBookAfterAuthChange()
          clearTrustedDeviceToken()
          void enrollTrustedDevice()
          resetBypassPermissionsCheck()
          const appState = context.getAppState()
          void checkAndDisableBypassPermissionsIfNeeded(
            appState.toolPermissionContext,
            context.setAppState,
          )
          if (feature('TRANSCRIPT_CLASSIFIER')) {
            resetAutoModeGateCheck()
            void checkAndDisableAutoModeIfNeeded(
              appState.toolPermissionContext,
              context.setAppState,
              appState.fastMode,
            )
          }
          context.setAppState(prev => ({
            ...prev,
            authVersion: prev.authVersion + 1,
          }))
        }
        onDone(success ? 'Login successful' : 'Login interrupted')
      }}
    />
  )
}

export function Login(props: {
  onDone(success: boolean, mainLoopModel: string): void
  startingMessage?: string
  embedded?: boolean
}): React.ReactNode {
  const mainLoopModel = useMainLoopModel()
  const setAppState = useSetAppState()
  const preferredProvider = React.useMemo(
    () => getPreferredLoginProvider(mainLoopModel),
    [mainLoopModel],
  )
  const [provider, setProvider] = React.useState<LoginProvider | null>(null)
  const handleCancel = React.useCallback(
    () => props.onDone(false, mainLoopModel),
    [mainLoopModel, props],
  )
  const handleSuccess = React.useCallback(
    () => {
      const nextModel =
        provider === 'claude'
          ? null
          : provider === 'codex'
            ? getDefaultOpenAICodexModel()
            : provider
              ? getDefaultApiKeyProviderModel(provider)
              : mainLoopModel

      setAppState(prev => ({
        ...prev,
        mainLoopModel: nextModel,
        mainLoopModelForSession: null,
      }))
      if (provider) {
        saveGlobalConfig(current => ({
          ...current,
          lastLoginProvider: provider,
        }))
      }
      props.onDone(true, nextModel ?? mainLoopModel)
    },
    [mainLoopModel, props, provider, setAppState],
  )

  useKeybinding(
    'confirm:no',
    () => {
      if (props.embedded && provider) {
        setProvider(null)
      }
    },
    {
      context: 'Confirmation',
      isActive: Boolean(props.embedded && provider),
    },
  )

  const content =
    provider === 'codex' ? (
      <CodexOAuthFlow
        onDone={handleSuccess}
        startingMessage={props.startingMessage}
      />
    ) : provider === 'google-gemini' ? (
      <GoogleGeminiOAuthFlow
        onDone={handleSuccess}
        startingMessage={props.startingMessage}
      />
    ) : provider === 'claude' ? (
      <ConsoleOAuthFlow
        onDone={handleSuccess}
        startingMessage={props.startingMessage}
      />
    ) : provider ? (
      <ProviderApiKeyFlow providerId={provider} onDone={handleSuccess} />
    ) : (
      <Box flexDirection="column" gap={1}>
        <Text bold>
          {props.startingMessage ||
            'Choose which provider account you want to connect.'}
        </Text>
        <Text>Select login provider:</Text>
        <Box>
          <Select
            defaultValue={preferredProvider}
            defaultFocusValue={preferredProvider}
            options={[
              {
                label: (
                  <Text>
                    Claude account ·{' '}
                    <Text dimColor>Subscription or Console billing</Text>
                  </Text>
                ),
                value: 'claude',
              },
              {
                label: (
                  <Text>
                    Codex account ·{' '}
                    <Text dimColor>ChatGPT / Codex browser login</Text>
                  </Text>
                ),
                value: 'codex',
              },
              {
                label: (
                  <Text>
                    Gemini account ·{' '}
                    <Text dimColor>Google browser login</Text>
                  </Text>
                ),
                value: 'google-gemini',
              },
              {
                label: (
                  <Text>
                    Kimi API key ·{' '}
                    <Text dimColor>internal Moonshot provider</Text>
                  </Text>
                ),
                value: 'moonshot-kimi',
              },
              {
                label: (
                  <Text>
                    Qwen API key ·{' '}
                    <Text dimColor>internal DashScope provider</Text>
                  </Text>
                ),
                value: 'aliyun-qwen',
              },
              {
                label: (
                  <Text>
                    Doubao API key ·{' '}
                    <Text dimColor>internal Volcengine provider</Text>
                  </Text>
                ),
                value: 'volcengine-doubao',
              },
              {
                label: (
                  <Text>
                    GLM API key ·{' '}
                    <Text dimColor>internal Zhipu provider</Text>
                  </Text>
                ),
                value: 'zhipu-glm',
              },
              {
                label: (
                  <Text>
                    GLM Coding Plan ·{' '}
                    <Text dimColor>dedicated Coding Plan endpoint</Text>
                  </Text>
                ),
                value: 'zhipu-glm-coding-plan',
              },
            ]}
            onChange={value => setProvider(value as LoginProvider)}
          />
        </Box>
      </Box>
    )

  if (props.embedded) {
    return (
      <Box flexDirection="column" gap={1}>
        {content}
        {provider ? (
          <ConfigurableShortcutHint
            action="confirm:no"
            context="Confirmation"
            fallback="Esc"
            description="back"
          />
        ) : null}
      </Box>
    )
  }

  return (
    <Dialog
      title="Login"
      onCancel={handleCancel}
      color="permission"
      inputGuide={_temp}
    >
      {content}
    </Dialog>
  )
}

function _temp(exitState: { pending: boolean; keyName: string }): React.ReactNode {
  return exitState.pending ? (
    <Text>Press {exitState.keyName} again to exit</Text>
  ) : (
    <ConfigurableShortcutHint
      action="confirm:no"
      context="Confirmation"
      fallback="Esc"
      description="cancel"
    />
  )
}
