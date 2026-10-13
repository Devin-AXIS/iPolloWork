# Progressive video generation

The user approved progressive playback and mid-generation guidance, then explicitly requested restoration of all quality-reducing shortcuts. Normal storyboard, visual design, media, narration and acceptance stages are retained. This proof uses authored scene fixtures to validate production playback, the Jev client/decision core and native steering; scene production and Jev provider responses are simulated. It does not measure real generation latency or certify the visual quality of model-generated films. Incremental speech streaming is covered independently by Media Center tests.

1. 完成正常分镜和视觉规划后，第一段完整场景就绪即播放，后续场景继续制作。

2. 播到已生成内容的末尾时保留最后画面，下一段就绪后从原位置自动续播。

3. 生成过程中输入新的方向，Jev 判断需要调整后续场景，指令交给当前任务并保留已发布的内容。

4. Jev 未配置时，仍然可以引导后续内容，输入的指令照常交给当前任务。

5. 手动暂停后，新场景到达也不会擅自继续播放；生成完成后可以正常回看整条视频。
