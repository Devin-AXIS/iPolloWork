# Embedded DSH IM runtime

This directory contains MIT-licensed source from [xmanrui/dsh-im](https://github.com/xmanrui/dsh-im), pinned to commit `fc2ceab217309f8973afa03c58cdd8ff3e900130`. That checkout declares version 5.10.0 but differs from the npm 5.10.0 tarball. `LICENSE` preserves the author's notice; `THIRD_PARTY_NOTICES.md` preserves bundled dependency and artwork notices.

The runtime is compiled into `@ipollo/dsh-suite/im`; it is not published or installed as another bundle. No upstream executable is included. The suite owns release updates. Existing channel configuration paths and credential references remain unchanged, so switching from the standalone bundle does not require recreating bot accounts. The standalone bundle must be disabled first; the suite refuses duplicate activation.

## Local changes

- `plugin-src/host/index.mjs` and `plugin-src/client/index.js`: remove standalone update handlers and controls. The client uses the suite's package metadata and navigation IDs.
- `plugin-src/host/harness-session-coordinator.mjs`: retain received media with native DSH file uploads and reuse the optional native speech service through `src/host/im-media.ts` in the suite. Provider or converter errors retain recordings and publish only a safe status.
- `src/channels/shared/inbound-file.mjs`: carry platform transcripts, emit native file receipt parts, and omit receipt IDs from model text. Images use normal native image input, or a retained file when the selected model refuses images.
- DingTalk, Feishu, WeCom, and WeCom application adapters: preserve available audio download references and transcripts. WeCom intelligent-bot callbacks normally supply a transcript without the recording; the adapter does not manufacture missing audio.
- `plugin-src/client/plugin-page.js`: use suite-owned navigation IDs.
- `plugin-src/client/styles.js`: keep channel selection in a horizontally scrolling row on small screens so the selected settings remain visible.
- `plugin-src/client/credential-binding.js` and `plugin-src/client/channels/shared/token-channel.js`: present shared and channel-specific credential forms in the native modal instead of expanding secret fields inside the channel page. Existing submission callbacks and storage remain unchanged.

Other source remains upstream code. Selected upstream media-delivery and image-input tests accompany the source. Review these changes explicitly when advancing the pinned commit; the Lark SDK build patch fails if its expected SDK source changes.

## Menu integration

The local `menu-introduction.mjs` helper adds one-time, access-checked private-chat guidance using the existing channel state. Channel state readers preserve its optional `menuIntroductions` field. The DingTalk, WeCom, WeChat, QQ, and Feishu bridges reuse their existing command handlers; their first input is not replaced by the guide. Native Feishu and Telegram command panels retain their upstream registration logic.

`wecom-app/menu.mjs` and the application's API/runtime add native bottom-menu registration, preserve foreign menus, and dispatch a fixed whitelist of click keys. Missing registration uses the same first-chat guide. WeCom intelligent-bot entry callbacks use the SDK's welcome-reply API without waiting for model or workspace catalogs.

## Main assistant entry

Channel configuration carries the suite's effective `entryAgentPreset` into the shared workspace store. Its runtime override preserves stored defaults and existing bound Sessions, while new QR/automatic connections create coordinator Sessions. The native preset catalog remains unchanged outside IM; IM displays the coordinator as its fixed entry. The shared client completion hook waits for native coordinator descendants and returns the final root answer, preserving cancellation and errors. These changes add no persisted fields. Recheck this hook, each production constructor, and the preset editor when updating the vendor source.
