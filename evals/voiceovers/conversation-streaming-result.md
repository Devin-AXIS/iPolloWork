# Conversation streaming: stable final answer

1. Send a request that makes the assistant explain what it is doing, run a command, and then answer. The compact process starts closed; expand it to see the explanation and running command in order. the raw command remains optional, with only the current tool state pulsing. A manually expanded process stays open through completion.

2. When the assistant starts its final answer, the answer appears below the progress area and grows in place as text streams in. While text is still streaming, the process row says it is responding and keeps counting time.

3. After the run completes, the elapsed time freezes beside the processed command count and the process keeps the user’s chosen expansion state. The final answer remains visible, and a follow-up entered while the run is busy stays queued for the next run.

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

15. During an automatic retry, the conversation shows why the model is unavailable and when it will try again.

16. 重试仍未成功时，对话说明模型请求过多，可以稍后重试或切换模型。

17. 图片已经保存、但整个任务失败时，图片只展示一次，仍可打开或下载，旁边说明任务尚未全部完成。

18. 重新打开中断的任务，已有内容仍然保留，界面说明可以继续发送消息，不再显示执行中的动画。

19. 当前账号无法使用所选模型时，界面用中文说明模型不可用，并提示选择其他模型后重试。

20. 工具直接显示文件名或具体操作，每条默认收起，点击才展开参数和输出，不再套一层工具分类。

21. 无论模板文件是否已经存在，从等待、思考到工具执行、重试和回复，都在同一个状态入口持续更新，不出现第二个思考或转圈标识。

22. 普通问答直接流式显示；工具任务中没有最终阶段标记的文字保留在可展开的过程和回复草稿里，任务结束后只有最后的回答进入正文。

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
