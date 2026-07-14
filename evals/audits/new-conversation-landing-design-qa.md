# New conversation landing — design QA

Date: 2026-07-13

## Scope

This audit covers the desktop empty-conversation surface only. The existing root
`design-qa.md` covers a different review and was intentionally left unchanged.

## Reference and implementation

- Reference: `/Users/devin/Library/Group Containers/7D498F54KM.com.yinxiang.Mac/Evernote/quick-note/22991999-personal-app.yinxiang.com/quick-note-Sum1lI/attachment--kKqOap/screenshot.png`
- Implementation: `/tmp/ipollowork-empty-conversation-compact.png`
- Comparison: `/tmp/ipollowork-empty-conversation-comparison.png`
- Viewport: desktop Electron, 1440 × 820

## Checks

| Area | Result | Notes |
| --- | --- | --- |
| Empty state hierarchy | Pass | Brand, focused headline, modes, quick actions, then composer follow the reference order. |
| Scale and density | Pass | Hero typography, segmented controls, chips, and icons were reduced after visual review to keep the page light and compact. |
| Mode interaction | Pass | All four modes update the selected state, starter actions, and composer placeholder. The selected treatment is a light primary surface, not a black pill. |
| Creative entry | Pass | Creative mode exposes only `做网站` and `做 PPT`, both with compact task icons. |
| Website templates | Pass | Selecting `做网站` opens a compact horizontal strip above the composer. It reads the real workspace template catalog and verified the installed `SaaS Landing` cover and use action. |
| Video entry | Pass | `打开视频工作台` creates the existing video session type instead of introducing a parallel flow. |
| Sidebar new conversation | Pass | A single click now creates a work conversation; the previous type menu is not exposed in the sidebar. |
| Conversation transition | Pass | The centered composer is used only with zero messages; the existing docked composer is retained once a conversation has content. |
| Localization | Pass | Labels, actions, generated starter prompts, placeholders, and website-template copy have direct strings in all 10 supported locales. |

## Intentional differences

- The product identity remains iPolloWork rather than copying the reference product name or mascot.
- Existing iPolloWork sidebar, workspace selectors, and model controls are preserved so the new landing remains part of the real client flow.

## Result

Passed. No P0–P2 visual or interaction issues found in the reviewed desktop empty-conversation flow.
