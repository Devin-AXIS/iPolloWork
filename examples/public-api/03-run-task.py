#!/usr/bin/env python3
"""Submit a goal and block until it finishes.

The task API is the one-shot surface: hand it a goal, get back a result. Everything
underneath — creating a session, prompting, answering tool permissions, detecting
completion — is handled server-side.

Run:
    export IPOLLOWORK_BASE_URL=http://127.0.0.1:8787
    export IPOLLOWORK_TOKEN=<client token>
    python3 examples/public-api/03-run-task.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "packages", "ipollowork-api-sdk-python"))

from ipollowork_api import IPolloWorkApiError, IPolloWorkClient


def main() -> int:
    client = IPolloWorkClient(
        os.environ.get("IPOLLOWORK_BASE_URL", "http://127.0.0.1:8787"),
        token=os.environ.get("IPOLLOWORK_TOKEN"),
    )

    workspaces = client.list_workspaces()["items"]
    if not workspaces:
        print("No workspace configured on this server", file=sys.stderr)
        return 1

    workspace_id = workspaces[0]["id"]
    print(f"workspace: {workspace_id}")

    def on_event(name: str, data: object) -> None:
        if isinstance(data, dict) and data.get("state"):
            print(f"  [{name}] {data['state']}")
        else:
            print(f"  [{name}]")

    try:
        task = client.run_task(
            workspace_id,
            goal="Read README.md and write a one-paragraph summary of what this project does.",
            # "auto" approves tool use without a human. For anything that writes, prefer a
            # token-scoped approval policy so the blast radius stays bounded.
            approval_policy="auto",
            timeout_ms=600_000,
            on_event=on_event,
        )
    except IPolloWorkApiError as error:
        print(f"API error [{error.code}]: {error.message}", file=sys.stderr)
        return 1

    print(f"\nstate: {task['state']}")
    if task.get("summary"):
        print(f"\n{task['summary']}")
    if task.get("error"):
        print(f"\nerror: {task['error'].get('message')}", file=sys.stderr)

    return 0 if task["state"] == "done" else 1


if __name__ == "__main__":
    raise SystemExit(main())
