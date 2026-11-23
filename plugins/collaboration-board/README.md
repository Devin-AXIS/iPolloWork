# iPolloWork Project Board

English | [中文](README.zh.md)

Install the iPolloWork DSH suite, open a conversation in a project, and select **Project board** in the conversation tab bar. Select a card to open the detail sheet. Add a task from **New task** or directly in a status column. Search by task name, description or assignee, and change status from the card. On narrow screens, switch columns with the status controls. In task details, search for people, AI agents or predecessors and select them through the corresponding picker. Set the title, description, priority, status, start date, deadline, and predecessors. The board shows the remaining time until each open task's deadline. Board, list, calendar and timeline share the same tasks. Cards for existing project conversations can be edited into tasks and still link back to the original conversation.

## Organization projects

Tasks load in pages of 100. Search and progress totals cover all matching tasks in the selected scope, including unloaded pages. Dependency choices and the four views show loaded tasks; use **Load more** to include the rest. Automatic refresh updates all loaded pages. Failed refreshes retain the last loaded data, and refresh success does not dismiss a failed write. Account and ownership changes cancel pending board requests and clear the previous scope. Older account services show an upgrade hint and retain their loaded-task behavior until the service is upgraded.

Use the scope picker for current tasks, archived tasks and the recycle bin. Archived and recycled tasks are read-only until restored. **Batch actions** handles up to 100 selected tasks, reports partial failures and retains failed selections for retry. Removing a task moves it to the recycle bin; an active dependent must be removed first. Restore prerequisites before their dependents. Restoring a task whose prerequisites are unfinished resets it to **To do**. Archiving or recycling cancels its future AI start.

In a local workspace linked to an iPolloWork organization project, connect the account through the iPolloWork Suite bridge. The board displays its organization and reads people from the Suite account service. Search the assignee or participants picker by name or account email. The directory includes current organization members with access to the specific project. An organization manager can select **Invite members** to open the Suite project invitation form and generate an email-bound link. The person becomes selectable after accepting with the invited account. People receive an unread badge under **Task notifications** in their own client. They can open the notification to read the task and update its status while assigned to or participating in it. A task with unfinished predecessors must stay in **To do**. Its assignee and participants receive a second notification when every predecessor is done.

Use **Participants** or **Add AI** to add collaborators to the same list. The people picker shows each name and account email with a small project member label. Select **Make lead** on any available collaborator. Replacing a lead keeps the previous lead as a participant. After selecting collaborators, use **Let selected members view this conversation** to grant those people view-only access to the conversation whose tab shows the board. Use **Copy conversation link** to pass along the account-scoped link. The picker marks people with a current named grant from the connected account. Saving people assignments sends task notifications.

When the suite’s [Notification Center](../notification-center/README.md) is installed, board notifications appear in its avatar-area inbox. Selecting one opens the existing task detail and acknowledges it in the organization inbox.

Personal tasks are stored in the DSH profile and work without an account or Suite. With Suite installed, use **Set project ownership** to attach a local workspace to an organization. The organization board uses the shared project task store while existing personal tasks remain in the local profile. These shared lifecycle actions, global search and deadline notifications require the updated Suite Host bridge and account service schema 22. Project-bound cloud runtime credentials do not support the organization board in this version.

Overdue open tasks generate one notice per recipient and deadline. Personal notices are checked every 15 seconds while the Host runs; organization notices are checked every 30 seconds while the account service runs. Human leads and participants receive organization reminders, as do the assigning accounts for AI collaborators; an unassigned task goes to the project owner. Completion, archiving, recycling or a changed deadline hides the old notice. Read state survives restart. Delivery checks current project membership and permissions.

## AI and automations

Enable the official **Codex subagent** or **Claude Code subagent** bundle in the DSH profile to add it under **Add AI** once its provider and tool are available. Either can be selected as the lead or a participant. **Send to AI** uses the selected delegate in the project's working directory. The native providers use their own authentication and report sign-in or execution errors.

Choose a person or an AI as task assignee, and combine people and AIs as participants. **Current conversation AI** works in the standalone plugin. For a reusable specialist, create and enable it in iPolloWork's **Agents** panel. The board reads saved and usable specialists from the current DSH profile. Shared boards record the specialist and the assigning account. Executing the specialist requires that account and an available definition in the local profile.

Save a **To do** task with an AI lead and a future start time to create a one-time start in DSH’s native automation. The Host delivers it to the linked conversation, or to the project conversation used for saving. Changing the time replaces the previous start, and clearing the time or the AI lead removes it. AI participants alone do not create a schedule. The DSH Host and the selected AI need to be available to run the task. On delivery, the board checks eligibility and predecessors. A delivered start blocked by predecessors is marked deferred. The 15-second maintenance check re-arms it only after its original schedule has ended and its prerequisites are complete, with the original assigning account and AI still available. Manually paused schedules and reminders still queued for delivery are not re-armed.

Use **Send to AI** to start a ready task manually. For custom recurrence, use **Copy automation instructions** and confirm the repeat timing in the project conversation. The project conversation uses the selected tools and returns their results. A human lead reviews the results. Scheduled and interactive turns use `ipollo_project_tasks` to read and update tasks in their own project. When all predecessors complete, organization recipients also receive an account inbox notification.

## Build and verify

Run `npm run setup:build` from the repository root to prepare the pinned DSH source and type declarations. In this directory run:

```sh
npm ci --workspaces=false
npm run check
npm run pack:check
npm pack
```

Add the generated archive with DSH's plugin manager. For development, install the built directory via the official launcher's `plugin add link:/absolute/path/to/plugins/collaboration-board`. The suite build packages the same source as a native component. The standalone build is kept for development and migration tests.

The local storage domain upgrades from version 2 to 3 without discarding tasks or notification read state. Keep the same DSH home when upgrading; an older plugin cannot reopen a version 3 domain. On a new DSH pin, verify the native conversation tab, chat draft restoration, task editing, lifecycle actions and persistence in a disposable profile. Test organization assignment, deadline delivery, unread receipt, predecessor completion and invalid cycles using two accounts. Select a saved specialist as assignee or participant and verify native delegation and deferred starts in the project session, plus both themes and all four views at desktop and narrow widths.
