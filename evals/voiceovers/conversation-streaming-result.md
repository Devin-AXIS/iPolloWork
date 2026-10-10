# Conversation streaming: stable final answer

1. Send a request that makes the assistant explain what it is doing, run a command, and then answer. The live explanation and running command appear in order beneath the process heading; the raw command remains optional, with only the current tool state pulsing. The process folds when the answer is complete.

2. When the assistant starts its final answer, the answer appears below the progress area and grows in place as text streams in. While text is still streaming, the process row says it is responding and keeps counting time.

3. After the run completes, the elapsed time freezes beside the processed command count and the process details fold away. The final answer remains visible, and a follow-up entered while the run is busy stays queued for the next run.

4. When the assistant says a document is ready, the text streams first. The file card appears only after the run finishes. The card names the document clearly and opens the saved file when selected.

5. A tall user image stays compact. When the assistant sends an image while still responding, the inline image is labeled as a preview that is still generating.

6. Once the image is saved but the assistant is still responding, the status says it is saved and still being wrapped up. Opening and downloading the saved image are already available.

7. While browsing above the latest message, a labeled new-content control offers a way back without taking the user's scroll position away.

8. After completion, the assistant image is labeled as generated. When it matches a saved image, its open and download actions sit beside the image instead of repeating it in a file card.

9. A tall inline image can expand to show its full height when selected.

10. The same image can return to its compact preview, so the conversation remains readable.

11. If the user stops the run, its elapsed time freezes with a stopped label. The image remains visible and is labeled as possibly incomplete.

12. If image generation fails, its elapsed time freezes with an incomplete label. The image remains visible and is labeled as possibly incomplete alongside the error.

13. When an inline preview cannot be matched to a saved output, the preview stays labeled as a preview and the separate saved-file card remains available.

14. If one tool step fails while the assistant continues, the current process state still says it is thinking. It does not show a separate failed-step notice or raw tool output in the main conversation.

15. During an automatic retry, the conversation shows a calm retry status and countdown. The transport error remains in collapsed technical details.

16. When retries end in a terminal error, the reason appears as ordinary text at the end of that response, without a separate error card.

17. If an image was saved before the run fails, its open action and generated status remain available; the reason appears in the same response text.

18. After an interrupted run is loaded from history, its partial answer remains visible and the interruption reason appears once as plain response text.

19. If the selected model is unsupported by this account, the reason appears as ordinary text in the conversation, without an error card.

20. Expanding a completed run shows icon-labeled action groups for file inspection and command execution. Each group starts closed, opens to reveal its original steps, and can be folded again without hiding the final answer.

21. OpenCode keeps only one thinking label while continuing after an earlier answer, then shows thinking before its first assistant part. During reasoning and tools, only the current state pulses.

22. OpenCode text streams in stable body nodes while tools appear in the process area. Later tools and completion preserve those text nodes; completion folds the process.

23. After the model finishes generating the video source, the process still says it is in progress while the iPolloWork app exports the MP4, instead of reporting the task as complete too early.

24. Returning to the conversation input, two typed lines and the placeholder use shared 13-pixel text with 20-pixel line spacing as ordinary conversation text.

25. 文件卡片左对齐，宽度最多360px，使用56px紧凑横排，纸张图标配合文件类型，文件名与已保存状态分成两行。

26. 图片文件保留52×36px小缩略图，下面的类型与保存状态清晰可见。

27. 缩窄窗口后，长文件名保持单行省略，悬停查看完整名称，右侧操作始终独立占位。

28. 下载与更多采用轻量按钮，菜单仍能打开，操作不会遮挡文件名。

29. 悬停文件卡片，背景保持白色，仅边框变为 primary 青色，内容保持原位。

30. 按下卡片，背景进一步加深，尺寸与位置不变。

31. 使用键盘聚焦文件卡片，可以看到清晰的焦点环。

32. 下载时按钮转圈并避免重复点击，文件卡片仍然可以打开。

文件卡片的键盘焦点使用 primary 青色。图片状态复用共享 Badge 的语义色与前置图标，只有仍在处理时显示动画；已保存文件与整个任务的执行结果分开表达。

33. 中断图片任务时，图片的共享 Badge 已表达停止状态，不再额外出现相同任务提示；中断文字任务仍显示一条共享 Warning Alert，保留继续发送消息的说明，历史图片状态不影响当前文字任务。
