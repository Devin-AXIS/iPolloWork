/** DS Bot's ask_user ends its turn and stores a card, bypassing user-questions/request.
 * Read that card through DS Bot's route and reuse normal bound-chat question delivery.
 * DS Bot's answer route atomically claims it and queues the follow-up itself. */
export function installDsBotQuestionSync(ctx, deliveryService, { logger = console } = {}) {
  const pending = new Map();
  let closed = false;
  let queue = Promise.resolve();

  const refresh = (sessionId) => {
    queue = queue.then(async () => {
      if (closed) return;
      const sessions = await deliveryService.listDsBotSessions();
      const bound = new Set(sessions.map((entry) => entry.sessionId));
      for (const [id, entry] of pending) if (!bound.has(id)) entry.finish();
      for (const id of bound) {
        if (sessionId && id !== sessionId) continue;
        const question = await deliveryService.dsBot.question(id);
        if (closed) return;
        const previous = pending.get(id);
        if (previous?.id === question?.id) continue;
        previous?.finish();
        if (!question) continue;
        const controller = new AbortController();
        let complete;
        const completion = new Promise((resolve) => { complete = resolve; });
        const entry = { id: question.id, responding: false, finish() {
          if (pending.get(id) === entry) pending.delete(id);
          controller.abort();
          complete();
        } };
        pending.set(id, entry);
        const interaction = {
          kind: 'question', interactionId: `ds-bot-${question.id}`, rpcId: `ds-bot-${question.id}`, sessionId: id,
          payload: { sessionId: id, questions: [question] },
          withdraw: () => entry.finish(),
          respond: async (response) => {
            if (controller.signal.aborted || entry.responding) {
              throw Object.assign(new Error('Question is no longer open'), { code: 'interaction-not-pending' });
            }
            const answer = response?.value?.answer?.answers?.[0];
            if (response?.ok !== true || response.value.sessionId !== id || answer?.id !== question.id) {
              throw new Error('Invalid DS Bot question answer');
            }
            entry.responding = true;
            try {
              await deliveryService.dsBot.answerQuestion(id, question.id, answer);
              entry.finish();
            } catch (error) {
              entry.responding = false;
              if (error?.code === 'interaction-not-pending') entry.finish();
              throw error;
            }
          },
        };
        if (!await deliveryService.presentSessionSyncQuestion(id, interaction, {
          signal: controller.signal, completion,
        })) entry.finish();
      }
    }).catch((error) => logger.warn?.('[dsh-im] DS Bot question sync failed:', error?.code ?? error?.name));
    return queue;
  };
  const dispose = ctx.on('session/event', (session, event) => {
    // Turn completion covers desktop, IM, scheduled and automatic Bot turns.
    // A desktop answer also publishes a user message; retire the old IM pending.
    if (event?.type === 'turn/end' || (pending.has(session?.id) && event?.type === 'user/message')) {
      void refresh(session?.id);
    }
  }, { global: true });
  const close = () => {
    closed = true;
    dispose?.();
    for (const entry of pending.values()) entry.finish();
  };
  ctx.effect?.(() => close, 'dsh-im: DS Bot question sync');
  // Recover an unanswered card after the Host/plugin restarts.
  const ready = refresh();
  return { ready, refresh, close };
}
