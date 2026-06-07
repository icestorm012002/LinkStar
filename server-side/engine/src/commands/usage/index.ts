import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'usage',
  description: 'Show Claude subscription plan usage limits when available',
  availability: ['Claude-ai'],
  load: () => import('./usage.js'),
} satisfies Command
