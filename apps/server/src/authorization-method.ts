import { createHash } from "node:crypto";

import type { PluginAuthorizationMethod } from "./plugin-package-manifest.js";

export function authorizationMethodFingerprint(method: PluginAuthorizationMethod): string {
  const protocol = method.kind === "secret-form"
    ? { kind: method.kind, fields: method.fields.map((field) => ({ id: field.id, secret: field.secret, required: field.required })) }
    : method.kind === "oauth-pkce"
      ? { kind: method.kind, clientId: method.clientId, authorizationUrl: method.authorizationUrl, tokenUrl: method.tokenUrl, scopes: method.scopes, audience: method.audience }
      : method.kind === "device-code"
        ? { kind: method.kind, clientId: method.clientId, deviceAuthorizationUrl: method.deviceAuthorizationUrl, tokenUrl: method.tokenUrl, scopes: method.scopes }
        : { kind: method.kind, startUrl: method.startUrl, callbackOrigin: method.callbackOrigin, exchangeUrl: method.exchangeUrl, refreshUrl: method.refreshUrl };
  return createHash("sha256").update(JSON.stringify(protocol)).digest("base64url");
}
