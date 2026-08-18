#!/usr/bin/env bash
#
# CI code review over the public API, using nothing but curl and jq.
#
# Reviews the diff against a base ref and fails the build when the agent reports a
# blocking issue. Demonstrates the API surface a CI job actually needs: mint a scoped
# token, submit a task, wait for it, read the result.
#
# Usage: bash 04-ci-review.sh [base-ref]

set -euo pipefail

BASE_REF="${1:-origin/main}"
BASE_URL="${IPOLLOWORK_BASE_URL:-http://127.0.0.1:8787}"
TOKEN="${IPOLLOWORK_TOKEN:?IPOLLOWORK_TOKEN is required}"

api() {
  local method="$1" path="$2"
  shift 2
  curl --silent --show-error --fail-with-body \
    -X "$method" "${BASE_URL}${path}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    "$@"
}

echo "==> Checking server"
api GET /api/v1/health | jq -e '.ok == true' >/dev/null

WORKSPACE_ID="$(api GET /api/v1/workspaces | jq -r '.items[0].id')"
if [ -z "$WORKSPACE_ID" ] || [ "$WORKSPACE_ID" = "null" ]; then
  echo "No workspace configured on the server" >&2
  exit 1
fi
echo "    workspace: ${WORKSPACE_ID}"

DIFF="$(git diff "${BASE_REF}"...HEAD)"
if [ -z "$DIFF" ]; then
  echo "==> No changes against ${BASE_REF}; nothing to review"
  exit 0
fi

echo "==> Submitting review task"
# jq --arg does the quoting, so a diff containing quotes or newlines cannot break the JSON.
REQUEST="$(jq -n --arg diff "$DIFF" --arg base "$BASE_REF" '{
  goal: ("Review this diff against \($base) for correctness bugs, security issues, and missing tests. " +
         "End your reply with a line reading exactly VERDICT: PASS or VERDICT: FAIL.\n\n```diff\n" + $diff + "\n```"),
  approvalPolicy: "auto",
  timeoutMs: 900000,
  metadata: { source: "ci", base: $base }
}')"

TASK="$(api POST "/api/v1/workspaces/${WORKSPACE_ID}/tasks" -d "$REQUEST")"
TASK_ID="$(jq -r '.id' <<<"$TASK")"
echo "    task: ${TASK_ID}"

echo "==> Waiting for completion"
# The event stream ends when the task reaches a terminal state, so following it to EOF
# is the wait — no polling loop, no arbitrary sleep.
curl --silent --show-error --no-buffer \
  "${BASE_URL}/api/v1/workspaces/${WORKSPACE_ID}/tasks/${TASK_ID}/events" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Accept: text/event-stream" \
  | while IFS= read -r line; do
      case "$line" in
        data:*) jq -r '.state // empty' <<<"${line#data:}" 2>/dev/null | sed 's/^/    state: /' ;;
      esac
    done

RESULT="$(api GET "/api/v1/workspaces/${WORKSPACE_ID}/tasks/${TASK_ID}")"
STATE="$(jq -r '.state' <<<"$RESULT")"
SUMMARY="$(jq -r '.summary // ""' <<<"$RESULT")"

echo
echo "==> Review complete (${STATE})"
echo "$SUMMARY"
echo

if [ "$STATE" != "done" ]; then
  echo "Task did not complete: ${STATE}" >&2
  jq -r '.error.message // empty' <<<"$RESULT" >&2
  exit 1
fi

if grep -qi "VERDICT: FAIL" <<<"$SUMMARY"; then
  echo "Review found blocking issues." >&2
  exit 1
fi

echo "Review passed."
