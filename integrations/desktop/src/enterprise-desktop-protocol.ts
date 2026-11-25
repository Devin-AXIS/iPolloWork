import { z } from 'zod'

export const enterpriseDesktopMessage = z.object({
  type: z.literal('ipollo-enterprise-desktop'),
  id: z.uuid(),
  operation: z.enum(['seal', 'unseal', 'open', 'close', 'clear']),
  value: z.unknown().optional(),
})
export type EnterpriseDesktopMessage = z.infer<typeof enterpriseDesktopMessage>
