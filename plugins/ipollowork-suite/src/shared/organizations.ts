import type {} from '@deepseek-ai/cordis'

export interface OrganizationContext {
  organizations: Array<{ id: string; name: string; role: 'owner' | 'admin' | 'member' }>
  activeOrganizationId: string | null
}

/** All results are scoped to the signed-in iPolloWork account's active memberships. */
export interface OrganizationGateway {
  context(activeOrganizationId?: string | null, signal?: AbortSignal): Promise<OrganizationContext>
  websites(organizationId: string, signal?: AbortSignal): Promise<Array<{ id: string; label: string }>>
  exchange(organizationId: string, websiteId: string, signal?: AbortSignal): Promise<{ ticket: string; expiresIn: number }>
}
export type OrganizationContextSource = (signal?: AbortSignal) => Promise<OrganizationContext>

declare module '@deepseek-ai/cordis' {
  interface Context {
    ipolloOrganizations: OrganizationGateway
    ipolloOrganizationContext: OrganizationContextSource
  }
}
