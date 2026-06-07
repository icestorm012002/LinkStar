import { useEffect, useState } from 'react'
import {
  type claudeAiLimits,
  currentLimits,
  statusListeners,
} from './claudeAiLimits.js'

export function useClaudeAiLimits(): claudeAiLimits {
  const [limits, setLimits] = useState<claudeAiLimits>({ ...currentLimits })

  useEffect(() => {
    const listener = (newLimits: claudeAiLimits) => {
      setLimits({ ...newLimits })
    }
    statusListeners.add(listener)

    return () => {
      statusListeners.delete(listener)
    }
  }, [])

  return limits
}
