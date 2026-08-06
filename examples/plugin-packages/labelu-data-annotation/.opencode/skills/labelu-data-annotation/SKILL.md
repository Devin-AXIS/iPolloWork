---
name: labelu-data-annotation
description: Open the independent Data Annotation Training Cloud workbench and read saved project status when explicitly requested.
---

# Data Annotation Training Cloud

Use this plugin when the user wants to open 数据标注实训云, annotate an image, video, audio, or text, or inspect annotations already saved there.

## Open the training workbench

1. Do not search the workspace for media, ask for a file path, inspect an attachment, or create an annotation project from chat.
2. Call `ipollowork_extension_call` with `extensionId: "labelu-data-annotation"`, `action: "open-workbench"`, and empty `args`.
3. Immediately call `ipollowork_browser_open_url` with the exact returned `url` so the workbench opens in the built-in browser on the right.
4. Do not paste, repeat, summarize, or ask the user to click the signed local URL in chat.
5. Tell the user only that the workbench is open. The user either uploads their own image, video, or audio, enters text, imports a text-layer PDF, or selects a bundled training project with prepared media and labels, then annotates and saves it inside the visual workbench.

## Help through conversation

1. Only use these actions after the user explicitly asks to list, read, summarize, or count saved projects. Do not use them merely to open the workbench.
2. If the user did not identify a project, call `list-projects` and use the returned modality, title, counts, and timestamps to resolve the intended saved project. Do not guess when multiple projects are plausible.
3. Call `get-project` before reasoning about one project. Treat its `revision` as the saved version.
4. Answer only from saved annotations. The conversational side is read-only in this version and must never alter, upload, replace, or automate annotations in the right-side page.

## Boundaries

- The chat side never selects or uploads media and never creates a project. It may only read saved project status when the user explicitly asks.
- Do not use browser automation after opening the page unless the user explicitly asks for it.
- The workbench supports user-driven image, video, audio, and text annotation, text-layer PDF import, bundled training projects, and saved-project continuation. PDF import extracts text only; scanned PDFs require OCR first. Do not claim review, assignment, automatic AI annotation, or multi-user workflow support.
