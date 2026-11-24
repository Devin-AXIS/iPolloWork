// The idle pre-warm exists to move the first structural edit's memo population off the
// keystroke, so what matters is its scheduling contract: one step per task, input outranks
// warming, an edit or view mode stops it, cancel stops it, and a failing step forfeits the
// head start instead of throwing into the timer.

import { describe, expect, test } from 'bun:test';
import { createDerivationPrewarmSteps, scheduleDerivationPrewarm } from '../derivation-prewarm.ts';
import { readOoxmlPart, usedParaIds, type OoxmlPart } from '../../store/index.ts';

/** Manual scheduler: tasks run only when the test pumps, so ordering is explicit. */
function manualScheduler(): {
  schedule: (run: () => void, delayMs: number) => () => void;
  pump: () => boolean;
  pending: () => number;
  delays: number[];
} {
  const queue: (() => void)[] = [];
  const delays: number[] = [];
  return {
    schedule(run, delayMs) {
      queue.push(run);
      delays.push(delayMs);
      return () => {
        const at = queue.indexOf(run);
        if (at >= 0) queue.splice(at, 1);
      };
    },
    pump() {
      const next = queue.shift();
      if (!next) return false;
      next();
      return true;
    },
    pending: () => queue.length,
    delays,
  };
}

describe('scheduleDerivationPrewarm', () => {
  test('runs every step, one per scheduled task', () => {
    const timer = manualScheduler();
    const ran: number[] = [];
    scheduleDerivationPrewarm({
      steps: [() => ran.push(0), () => ran.push(1), () => ran.push(2)],
      shouldRun: () => true,
      hasPendingInput: () => false,
      schedule: timer.schedule,
    });
    expect(ran).toEqual([]);
    while (timer.pump()) {
      // At most one new step lands per pumped task.
    }
    expect(ran).toEqual([0, 1, 2]);
    expect(timer.pending()).toBe(0);
  });

  test('stops between steps the moment shouldRun answers no', () => {
    const timer = manualScheduler();
    const ran: number[] = [];
    let allowed = true;
    scheduleDerivationPrewarm({
      steps: [() => ran.push(0), () => ran.push(1)],
      shouldRun: () => allowed,
      hasPendingInput: () => false,
      schedule: timer.schedule,
    });
    timer.pump();
    expect(ran).toEqual([0]);
    allowed = false;
    while (timer.pump()) {
      // The re-check happens inside the task, so the queue drains without running step 1.
    }
    expect(ran).toEqual([0]);
  });

  test('pending input defers the step and the deferral waits a frame, not zero', () => {
    const timer = manualScheduler();
    const ran: number[] = [];
    let busy = true;
    scheduleDerivationPrewarm({
      steps: [() => ran.push(0)],
      shouldRun: () => true,
      hasPendingInput: () => busy,
      schedule: timer.schedule,
    });
    timer.pump();
    expect(ran).toEqual([]);
    expect(timer.delays.at(-1)).toBeGreaterThan(0);
    busy = false;
    timer.pump();
    expect(ran).toEqual([0]);
  });

  test('gives up after sustained input pressure instead of spinning forever', () => {
    const timer = manualScheduler();
    const ran: number[] = [];
    scheduleDerivationPrewarm({
      steps: [() => ran.push(0)],
      shouldRun: () => true,
      hasPendingInput: () => true,
      schedule: timer.schedule,
    });
    let pumps = 0;
    while (timer.pump()) {
      pumps += 1;
      if (pumps > 200) throw new Error('the warm must stop re-arming under constant input');
    }
    expect(ran).toEqual([]);
  });

  test('cancel stops the chain', () => {
    const timer = manualScheduler();
    const ran: number[] = [];
    const cancel = scheduleDerivationPrewarm({
      steps: [() => ran.push(0), () => ran.push(1)],
      shouldRun: () => true,
      hasPendingInput: () => false,
      schedule: timer.schedule,
    });
    timer.pump();
    cancel();
    while (timer.pump()) {
      // Nothing scheduled after cancel may run a step.
    }
    expect(ran).toEqual([0]);
  });

  test('a throwing step ends the warm without throwing into the scheduler', () => {
    const timer = manualScheduler();
    const ran: number[] = [];
    scheduleDerivationPrewarm({
      steps: [
        () => {
          throw new Error('derivation failed');
        },
        () => ran.push(1),
      ],
      shouldRun: () => true,
      hasPendingInput: () => false,
      schedule: timer.schedule,
    });
    expect(() => {
      while (timer.pump()) {
        // The failure must stay inside the task.
      }
    }).not.toThrow();
    expect(ran).toEqual([]);
  });
});

describe('createDerivationPrewarmSteps', () => {
  const XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:p w14:paraId="1A2B3C4D"><w:r><w:t>alpha</w:t></w:r></w:p>
    <w:p w14:paraId="2B3C4D5E"><w:r><w:t>beta</w:t></w:r></w:p>
  </w:body>
</w:document>`;

  function loadPart(): OoxmlPart {
    const result = readOoxmlPart(XML, { name: '/word/document.xml', contentType: 'app/xml' });
    if (!result.ok) throw new Error(result.reason);
    return result.part;
  }

  test('the steps run the real derivations and warm the same memo a mint reads', () => {
    const part = loadPart();
    const steps = createDerivationPrewarmSteps(() => part);
    expect(steps.length).toBeGreaterThanOrEqual(3);
    for (const step of steps) step();
    // Warmed means: the set the first split will mint against is already derived, and a
    // repeat read hands back the identical object instead of re-walking.
    expect(usedParaIds(part.root)).toBe(usedParaIds(part.root));
    expect([...usedParaIds(part.root)].sort()).toEqual(['1A2B3C4D', '2B3C4D5E']);
  });
});
