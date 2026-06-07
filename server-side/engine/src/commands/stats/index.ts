import type { Command } from '../../commands.js'

const stats = {
  type: 'local-jsx',
  name: 'stats',
  description: 'Show current session usage and local activity statistics',
  load: () => import('./stats.js'),
} satisfies Command

export default stats
