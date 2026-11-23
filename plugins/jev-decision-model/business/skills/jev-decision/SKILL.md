---
name: jev-decision
description: Use Jev to select among available tools, skills or agents, or evaluate outputs against explicit rubrics. Use when the user requests Jev or a bounded decision would help; not for open-ended writing or research.
---

# Jev DSH 决策引擎

Jev returns structured judgments. The current Agent retains planning, parameter construction, execution and native subagent collaboration.

## Call through the current host

- In iPolloWork, discover `jev-decision-model` with `ipollowork_extension_list_actions`, then use `ipollowork_extension_call` with action `evaluate` and the payload below in `args`.
- In standalone DSH, use `jev_evaluate` with the same payload. `jev_status` checks local configuration; `jev_check_connection` verifies the key with a small billable request.
- Work also exposes `status` and `check-connection`. A configured key is not proof of a successful API connection. If missing or invalid, direct the user to plugin authorization (Work) or the `TYPESAFE_API_KEY` credential (DSH); do not request the key in chat.

## Choose and prepare

Discover actual candidates from the host or the visible tool/skill catalog. Respect the user's explicit selections. Include only available, permitted candidates and their stable IDs, short descriptions and relevant constraints. Jev does not discover tools, install plugins, grant permissions or invoke another Agent by itself.

Send the task and minimal relevant context as `state`; do not send credentials, entire transcripts or complete files unnecessarily. Each question contains `type`, a complete `instructions` question, and the appropriate `criteria`. Question IDs identify results; they are not instructions to the model.

- `choice`: choose one of 2–255 keyed candidates; include an `other` / `none` candidate when needed.
- `score`: grade against 2–10 ordered levels, indexed from zero. Several independent scores can rank candidates.
- `noul`: estimate the probability of a clearly stated yes/no condition. To select multiple complementary skills, batch one relevance question per candidate instead of forcing a single Choice. A value near 0.5 means uncertainty, not medium skill.

Batch independent questions sharing a state; use a later request if a question depends on an earlier result. Plugin bounds are 64 questions and 256 KiB per request. These are plugin limits, not claims about the provider's limits.

```json
{
  "state": { "task": "整理已收集的竞品资料，制作汇报 PPT", "available": ["research", "slides"] },
  "questions": {
    "use_research": { "type": "noul", "instructions": "这项任务是否需要分析竞品资料？" },
    "use_slides": { "type": "noul", "instructions": "这项任务是否需要制作演示文稿？" }
  }
}
```

## Use the result

Preserve the returned probabilities, confidence, model and usage when reporting. Jev does not return written reasoning: distinguish your explanation from its structured result. Check current availability again before execution. Read the selected Skill and construct tool arguments using the current host's schemas.

Thresholds and weights come from the user's task or application policy, not universal magic numbers. Low confidence, missing options, or API failure calls for ordinary Agent reasoning or clarification; say when Jev was unavailable instead of inventing its result. A recommendation does not authorize external actions, override the user's choice or bypass approval. No automatic global routing or self-training is installed by this plugin.

Reference: https://docs.typesafe.ai/api
