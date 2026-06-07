import type { Command } from '../../commands.js'

const traffic = {
  type: 'local',
  name: 'traffic',
  description: 'View or toggle nonessential network traffic',
  argumentHint: '[status|on|off]',
  immediate: true,
  supportsNonInteractive: false,
  load: () => import('./traffic.js'),
} satisfies Command

export default traffic
