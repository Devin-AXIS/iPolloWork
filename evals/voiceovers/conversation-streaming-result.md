# Conversation streaming: stable final answer

1. Send a request that makes the assistant explain what it is doing, run a tool, and then answer. The compact process row shows elapsed time, and the user can open it to inspect the explanation and tool activity without losing that choice between commands.

2. When the assistant starts its final answer, the answer appears below the progress area and grows in place as text streams in. Once the text is done but the run is still ending, the process row says it is finishing and keeps counting time.

3. After the run completes, the elapsed time freezes above the answer. The user's choice to expand the process remains, and a follow-up entered while the run is busy stays queued for the next run.

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

14. If one tool step fails while the assistant continues, the progress area states that one step did not succeed. Raw tool output stays out of the main conversation.

15. During an automatic retry, the conversation shows a calm retry status and countdown. The transport error remains in collapsed technical details.

16. When retries end in a terminal error, the conversation gives a short reason and next action. Technical detail can be expanded and copied for support.

17. If an image was saved before the run fails, its open action and generated status remain available; the separate run notice explains that the overall task did not finish.

18. After an interrupted run is loaded from history, its partial answer remains visible and the interruption appears once as a neutral status instead of a raw engine error.

19. If the selected model is unsupported by this account, the notice says that the model is unavailable and asks the user to choose another model. The provider's raw error remains in collapsed details.

20. Returning to the conversation input, two typed lines and the placeholder use 13-pixel text with the same one-and-a-half line spacing as ordinary conversation text.
