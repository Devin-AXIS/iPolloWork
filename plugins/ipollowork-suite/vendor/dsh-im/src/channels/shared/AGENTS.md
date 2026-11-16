# Translating host-side text

Host-side user-facing text is written inline in Chinese and passed to `t()` from
`i18n.mjs`. Chinese is the identity language, so the source literal itself is
the dictionary key: `t('中文')` renders that Chinese string unless a dictionary
carries the very same string.

- A new source string must be added to EVERY dictionary that exists here: each
  `i18n-<lang>/` area module and the `i18n-<lang>.mjs` module that merges them.
  A language added later inherits the same rule, no code change needed.
- The key must be the exact literal, byte for byte, including `\n` and the
  names of `{placeholders}`.
- Placeholders stay byte-identical in the translation. Never rename, translate
  or drop one.
- Product and channel names (DSH, Cordis, Feishu, Telegram, Slack, Discord,
  WeCom, QQ, Weixin, WhatsApp, Matrix, DingTalk, email) are never translated.
- `test/channels/shared/i18n-coverage.test.mjs` enforces this rule: a literal
  with no entry in a dictionary fails the build and names the file that added
  it. A prose rule alone would not.
