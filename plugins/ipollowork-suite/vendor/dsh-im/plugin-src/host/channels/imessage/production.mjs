import { IMessageConfigStore } from '../../../../src/channels/imessage/config-store.mjs';
import { IMessageController } from '../../../../src/channels/imessage/controller.mjs';
import { IMessageHarnessClient } from '../../../../src/channels/imessage/harness-client.mjs';
import { IMessageRuntime } from '../../../../src/channels/imessage/runtime.mjs';
import { IMessageStateStore } from '../../../../src/channels/imessage/state-store.mjs';
import { createTokenProductionController } from '../shared/production.mjs';

export function createProductionController(ctx, config = {}, internals = {}) {
  return createTokenProductionController(ctx, config, internals, {
    channel: 'imessage', ConfigStore: IMessageConfigStore, StateStore: IMessageStateStore,
    HarnessClient: IMessageHarnessClient, Controller: IMessageController, Runtime: IMessageRuntime,
  });
}
