# Progressive video generation

The user approved this journey in the request: play each generated segment immediately and guide the remaining content while generation continues. Provider generation is simulated with deterministic scene publications; playback and instruction dispatch use the production components.

1. 第一段视频生成后立即开始播放，后续场景继续生成。

2. 播到已生成内容的末尾时保留最后画面，下一段就绪后从原位置自动续播。

3. 生成过程中输入新的方向，指令立即交给当前任务，并保留已经播放的内容。

4. 手动暂停后，新场景到达也不会擅自继续播放；生成完成后可以正常回看整条视频。
