# Progressive video generation

The user approved this journey and its continued first-segment optimization: play each generated segment immediately and guide the remaining content while generation continues. The first scene uses the production host opening assembler and local scaffold; later video generation and Jev provider responses are simulated. Playback, the Jev client and decision core, routing, and native instruction dispatch use production code. This does not benchmark real model latency or judgment accuracy. The Node runner requires the server build (`pnpm --filter ipollowork-server build`); Bun can use source directly.

1. Jev 辅助选择首段制作方式，第一段视频就绪后立即播放，后续场景继续生成。

2. 播到已生成内容的末尾时保留最后画面，下一段就绪后从原位置自动续播。

3. 生成过程中输入新的方向，Jev 判断需要调整后续场景，指令交给当前任务并保留已发布的内容。

4. Jev 未配置时，仍然可以引导后续内容，输入的指令照常交给当前任务。

5. 手动暂停后，新场景到达也不会擅自继续播放；生成完成后可以正常回看整条视频。
