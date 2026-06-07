import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'usage',
  description: 'Show claude subscription plan usage limits when available',
  availability: ['claude-ai'],
  load: () => import('./usage.js'),
} satisfies Command
