import { describe, expect, test } from "bun:test";
import { SerializedActionQueue } from "../src/react-app/shell/control/serialized-action-queue";

describe("serialized control actions", () => {
  test("runs concurrent callers in arrival order and continues after a failure", async () => {
    const queue = new SerializedActionQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = queue.run(async () => {
      events.push("first:start");
      await firstGate;
      events.push("first:end");
      return "first";
    });
    const failed = queue.run(async () => {
      events.push("failed:start");
      throw new Error("expected");
    });
    const last = queue.run(async () => {
      events.push("last:start");
      return "last";
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    releaseFirst();
    expect(await first).toBe("first");
    await expect(failed).rejects.toThrow("expected");
    expect(await last).toBe("last");
    expect(events).toEqual(["first:start", "first:end", "failed:start", "last:start"]);
  });
});
