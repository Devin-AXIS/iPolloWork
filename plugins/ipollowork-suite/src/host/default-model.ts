/** Account defaults use public DSH model, settings and credential services. */
import { brandString } from '@deepseek-ai/dsh-brand';
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-agent-default-model';
import type {} from '@deepseek-ai/dsh-api-session-controller';
import type {} from '@deepseek-ai/dsh-settings';
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol';

/** Services used without extending the official Session Controller. */
export interface DefaultModelServices {
  llm: Pick<Context['llm'], 'listConfigurableProviders'>;
  credentials: Pick<Context['credentials'], 'describe'>;
  settings: Pick<Context['settings'], 'describe'>;
  agentDefaultModel: Pick<Context['agentDefaultModel'], 'currentSelection' | 'saveSelection'>;
  sessionController: Pick<Context['sessionController'], 'modelCatalog'>;
}

/** Keep personal API keys and existing account selections; otherwise save the first account model.
 * @param services - The current scoped official DSH services.
 * @param providers - Ordered account providers registered by the suite.
 * @returns After the official default-model service persists a selection, or no change is needed.
 */
export async function initializeAccountModel(services: DefaultModelServices, providers: readonly string[], cloudOnly = false): Promise<void> {
  if (providers.includes(services.agentDefaultModel.currentSelection().provider)) return;
  const provider = providers[0];
  if (provider === undefined) return;
  const namespaces = services.settings.describe({ redactSecrets: true });
  for (const configurable of cloudOnly ? [] : services.llm.listConfigurableProviders()) {
    if (configurable.provider === 'deepseek-account') continue;
    let value: unknown = namespaces.find(namespace => namespace.ns === configurable.settingsNs)?.value;
    for (const key of configurable.settingsPath) {
      value = typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
    }
    if (typeof value !== 'object' || value === null) continue;
    const ref: unknown = Reflect.get(value, 'apiKeyEnv');
    if (typeof ref === 'string' && ref.length > 0 && (await services.credentials.describe(credentialRef(ref))).configured) return;
  }
  const model = (await services.sessionController.modelCatalog()).groups.find(group => group.id === provider)?.models[0];
  if (model === undefined) throw new RemoteError('session/provider-models-unavailable',
    `provider "${provider}" has no available models`, { provider });
  await services.agentDefaultModel.saveSelection({ provider, model: model.id,
    ...(model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: brandString<ReasoningEffortId>(model.reasoning.defaultEffort) }),
  });
}
