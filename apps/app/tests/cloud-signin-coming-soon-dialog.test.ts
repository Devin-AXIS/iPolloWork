import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(import.meta.dir, "..");
const sessionPage = readFileSync(
  resolve(appRoot, "src/react-app/domains/session/chat/session-page.tsx"),
  "utf8",
);
const welcomeRoute = readFileSync(
  resolve(appRoot, "src/react-app/shell/welcome-route.tsx"),
  "utf8",
);
const dialog = readFileSync(
  resolve(appRoot, "src/react-app/domains/cloud/cloud-signin-coming-soon-dialog.tsx"),
  "utf8",
);

test("each optional Cloud sign-in entry opens the local coming-soon dialog", () => {
  expect(sessionPage).toContain('setCloudSignInComingSoonOpen(true)');
  expect(sessionPage).toContain("<CloudSignInComingSoonDialog");
  expect(sessionPage).not.toContain("buildDenAuthUrl");
  expect(welcomeRoute).toContain('setCloudSignInComingSoonOpen(true)');
  expect(welcomeRoute).toContain("<CloudSignInComingSoonDialog");
  expect(welcomeRoute).not.toContain("buildDenAuthUrl");
  expect(dialog).toContain('t("den.signin_coming_soon_title")');
  expect(dialog).toContain('t("den.signin_coming_soon_action")');
});
