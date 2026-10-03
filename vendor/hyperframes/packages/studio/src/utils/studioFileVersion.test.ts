import { expect, it } from "vitest";
import {
  studioExpectedFileVersion,
  studioFileContentVersion,
} from "./studioFileVersion";

it("uses the explicit script revision even when the shared file cache has changed", async () => {
  const versions = new Map([["STORYBOARD.md", '"newer"']]);
  expect(
    await studioExpectedFileVersion(versions, "STORYBOARD.md", "original"),
  ).toBe(await studioFileContentVersion("original"));
  expect(
    await studioExpectedFileVersion(versions, "STORYBOARD.md", null),
  ).toBeNull();
  expect(await studioExpectedFileVersion(versions, "STORYBOARD.md")).toBe(
    '"newer"',
  );
});
