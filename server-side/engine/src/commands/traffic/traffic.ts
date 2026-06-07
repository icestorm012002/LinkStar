import type { LocalCommandCall } from '../../types/command.js'
import { errorMessage } from '../../utils/errors.js'
import { applyConfigEnvironmentVariables } from '../../utils/managedEnv.js'
import {
  getPrivacyLevel,
  getPrivacyLevelSource,
} from '../../utils/privacyLevel.js'
import { settingsChangeDetector } from '../../utils/settings/changeDetector.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'

const NONESSENTIAL_TRAFFIC_ENV = 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'

function getStatusText(): string {
  const level = getPrivacyLevel()
  const source = getPrivacyLevelSource()
  if (level === 'essential-traffic') {
    return `Nonessential traffic is disabled. Current mode: ${level}. Source: ${source}.`
  }
  if (level === 'no-telemetry') {
    return `Telemetry is disabled, but nonessential traffic is still enabled. Current mode: ${level}. Source: ${source}.`
  }
  return `Nonessential traffic is enabled. Current mode: ${level}. Source: ${source}.`
}

function applyRuntimeOverride(enabled: boolean): void {
  process.env[NONESSENTIAL_TRAFFIC_ENV] = enabled ? '1' : '0'
}

async function updateTrafficSetting(enabled: boolean) {
  const envUpdate = enabled
    ? {
        [NONESSENTIAL_TRAFFIC_ENV]: undefined,
      }
    : {
        [NONESSENTIAL_TRAFFIC_ENV]: '0',
      }

  const result = updateSettingsForSource('userSettings', { env: envUpdate })
  if (result.error) {
    return {
      type: 'text' as const,
      value:
        'Failed to update settings. Check your user settings file for syntax errors.',
    }
  }

  try {
    settingsChangeDetector.notifyChange('userSettings')
    applyConfigEnvironmentVariables()
    applyRuntimeOverride(enabled)
  } catch (error) {
    return {
      type: 'text' as const,
      value: `Traffic setting was written but could not be applied in the current session: ${errorMessage(error)}`,
    }
  }

  return {
    type: 'text' as const,
    value: enabled
      ? 'Nonessential traffic disabled by default. Current session updated.'
      : 'Nonessential traffic restored to the previous unrestricted behavior for this user profile and current session.',
  }
}

export const call: LocalCommandCall = async args => {
  const action = args.trim().toLowerCase()

  if (action === '' || action === 'status') {
    return { type: 'text', value: getStatusText() }
  }

  if (action === 'on') {
    return updateTrafficSetting(true)
  }

  if (action === 'off') {
    return updateTrafficSetting(false)
  }

  return {
    type: 'text',
    value:
      'Usage: /traffic status | /traffic on | /traffic off. `on` keeps nonessential traffic disabled by default; `off` restores the previous behavior.',
  }
}
