/**
 * Redact credential-shaped substrings from error bodies before they
 * reach user-facing messages, `--json` output, or logs.
 *
 * Both the `/v3/users/me` client and the OAuth token/revoke endpoints
 * surface upstream error bodies. A misbehaving server or proxy can echo
 * request data (API keys, OAuth `refresh_token` / `code` / `code_verifier`,
 * bearer tokens, JWTs) into those bodies — this scrubber makes sure none
 * of it lands in scrollback or CI logs.
 */

// Both HeyGen key prefixes: legacy `hg_…` and current `sk_V2_…` (plus
// any `sk_<segment>_…` partner format). A bare key echoed inline in an
// error body — without an Authorization:/x-api-key: header anchor —
// must still be redacted, so we match the prefix directly.
const HEYGEN_KEY = /\b(hg|sk)_[A-Za-z0-9_-]{4,}/g;
// Redact the ENTIRE header value to end-of-line. `Authorization: Bearer
// <token>` is two whitespace-separated words, so a `\S+` would stop after
// the scheme and leave the opaque token exposed.
const HEADER_LINE = /(authorization|x-api-key)[ \t]*[:=][ \t]*[^\r\n]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

// Sensitive OAuth/credential field names. Matched both as
// form-encoded (`name=value`) and JSON (`"name":"value"`).
const SECRET_FIELDS = [
  "access_token",
  "refresh_token",
  "code_verifier",
  "client_secret",
  "id_token",
  "token",
  "code",
];

const FORM_FIELD = new RegExp(`\\b(${SECRET_FIELDS.join("|")})=[^&\\s"']+`, "gi");
const JSON_FIELD = new RegExp(`("(?:${SECRET_FIELDS.join("|")})"\\s*:\\s*)"[^"]*"`, "gi");

export function scrubCredentials(s: string): string {
  return s
    .replace(HEYGEN_KEY, "$1_<redacted>")
    .replace(HEADER_LINE, "$1: <redacted>")
    .replace(JWT, "<jwt-redacted>")
    .replace(FORM_FIELD, "$1=<redacted>")
    .replace(JSON_FIELD, '$1"<redacted>"');
}
