import { useEffect, useState } from 'react'
import {
  type claudeAILimits,
  currentLimits,
  statusListeners,
} from './claudeAiLimits.js'

export function useClaudeAiLimits(): claudeAILimits {
  const [limits, setLimits] = useState<claudeAILimits>({ ...currentLimits })

  useEffect(() => {
    const listener = (newLimits: claudeAILimits) => {
      setLimits({ ...newLimits })
    }
    statusListeners.add(listener)

    return () => {
      statusListeners.delete(listener)
    }
  }, [])

  return limits
}
