import {
  configuredSessionSyncTargets,
  sessionSyncTarget,
} from './delivery-adapter.mjs';
import { deliverySwitchesOff } from '../../src/channels/shared/delivery-sync-settings.mjs';
import { getDeliverySyncSettingsStore } from '../../src/channels/shared/delivery-sync-settings-store.mjs';

/**
 * Which synced chats of one channel currently mirror `sessionId`.
 *
 * This is the channel's own view of its targets — the Feishu bridge asks it
 * before it draws a process card — and it therefore has to honour the same
 * delivery switches as the coordinator's target path. Both consult
 * `deliverySwitchesOff`, so "both switches off" silences the card and the text
 * together instead of leaving one of the two paths alive.
 *
 * @param options.workspaces - the channel's workspace store.
 * @param options.stateForBotId - async bot state getter, used to read the
 *   persisted conversation → Session map.
 * @param options.loadSettings - async settings getter. A document that cannot
 *   be read is not a reason to silence the existing mirror, so a failure here
 *   keeps the previous behaviour.
 */
export function createSessionSyncTargetsFor({
  channel,
  workspaces,
  config = {},
  stateForBotId,
  deliveryService = config.deliveryService,
  loadSettings = () => getDeliverySyncSettingsStore(config).get(),
} = {}) {
  if (typeof channel !== 'string' || !channel) {
    throw new TypeError('a Session sync target resolver needs a channel name');
  }

  const switchesOff = async () => {
    try {
      return deliverySwitchesOff(await loadSettings());
    } catch {
      return false;
    }
  };

  return async function sessionSyncTargetsFor(sessionId) {
    if (typeof workspaces?.listSessionSyncTargets !== 'function') return [];
    if (typeof sessionId !== 'string' || !sessionId) return [];
    if (await switchesOff()) return [];
    const matches = [];
    for (const entry of configuredSessionSyncTargets(workspaces)) {
      let state;
      try {
        state = await stateForBotId(entry.botId);
      } catch {
        continue;
      }
      let bound;
      try {
        bound = entry.dsBotId
          ? (await deliveryService?.dsBot?.resolve(entry.dsBotId))?.sessionId
          : state?.snapshot?.().sessions?.[entry.conversationKey];
      } catch {
        continue;
      }
      if (bound !== sessionId) continue;
      const target = sessionSyncTarget(channel, workspaces, entry);
      const openId = target?.route?.openId;
      if (openId) matches.push({ openId, botId: entry.botId, targetId: entry.targetId });
    }
    return matches;
  };
}
