import { isEnvDefinedFalsy, isEnvTruthy } from './envUtils.js'

/**
 * Privacy level controls how much nonessential network traffic and telemetry
 * Claude generates.
 *
 * Levels are ordered by restrictiveness:
 *   default < no-telemetry < essential-traffic
 *
 * - default:            Everything enabled.
 * - no-telemetry:       Analytics/telemetry disabled (Datadog, 1P events, feedback survey).
 * - essential-traffic:  ALL nonessential network traffic disabled
 *                       (telemetry + auto-updates, grove, release notes, model capabilities, etc.).
 *
 * The resolved level is the most restrictive signal from:
 *   Claude_CODE_DISABLE_NONESSENTIAL_TRAFFIC  →  essential-traffic
 *   DISABLE_TELEMETRY                         →  no-telemetry
 */

export type PrivacyLevel = 'default' | 'no-telemetry' | 'essential-traffic'
export type PrivacyLevelSource =
  | 'Claude_CODE_DISABLE_NONESSENTIAL_TRAFFIC'
  | 'DISABLE_TELEMETRY'
  | 'built-in-default'
  | 'explicit-opt-out'

function isEssentialTrafficEnabled(): boolean {
  return isEnvTruthy(process.env.Claude_CODE_DISABLE_NONESSENTIAL_TRAFFIC)
}

function isEssentialTrafficExplicitlyDisabled(): boolean {
  return isEnvDefinedFalsy(process.env.Claude_CODE_DISABLE_NONESSENTIAL_TRAFFIC)
}

export function getPrivacyLevel(): PrivacyLevel {
  if (isEssentialTrafficEnabled()) {
    return 'essential-traffic'
  }
  if (isEssentialTrafficExplicitlyDisabled()) {
    if (isEnvTruthy(process.env.DISABLE_TELEMETRY)) {
      return 'no-telemetry'
    }
    return 'default'
  }
  if (isEnvTruthy(process.env.DISABLE_TELEMETRY)) {
    return 'no-telemetry'
  }
  return 'essential-traffic'
}

export function getPrivacyLevelSource(): PrivacyLevelSource {
  if (isEssentialTrafficEnabled()) {
    return 'Claude_CODE_DISABLE_NONESSENTIAL_TRAFFIC'
  }
  if (isEssentialTrafficExplicitlyDisabled()) {
    return 'explicit-opt-out'
  }
  if (isEnvTruthy(process.env.DISABLE_TELEMETRY)) {
    return 'DISABLE_TELEMETRY'
  }
  return 'built-in-default'
}

/**
 * True when all nonessential network traffic should be suppressed.
 * Equivalent to the old `process.env.Claude_CODE_DISABLE_NONESSENTIAL_TRAFFIC` check.
 */
export function isEssentialTrafficOnly(): boolean {
  return getPrivacyLevel() === 'essential-traffic'
}

/**
 * True when telemetry/analytics should be suppressed.
 * True at both `no-telemetry` and `essential-traffic` levels.
 */
export function isTelemetryDisabled(): boolean {
  return getPrivacyLevel() !== 'default'
}

/**
 * Returns the env var name responsible for the current essential-traffic restriction,
 * or null if unrestricted. Used for user-facing "unset X to re-enable" messages.
 */
export function getEssentialTrafficOnlyReason(): string | null {
  if (isEssentialTrafficEnabled()) {
    return 'Claude_CODE_DISABLE_NONESSENTIAL_TRAFFIC'
  }
  return null
}
