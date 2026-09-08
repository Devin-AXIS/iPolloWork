# Video Console

User-requested flow: Seedance 2.5 reuses Ark authorization; MiniMax H3 uses a public RunningHub ComfyUI workflow with the user's existing workflow key. Both support image-to-video; model-specific controls and persistent session outputs remain in the existing plugin.

1. 打开视频控制台，模型列表只显示已绑定的服务；没有绑定时，会提示到授权中心配置。

2. 选择首帧生视频后，可以添加图片，画幅跟随输入；右侧只显示模型实际支持的参数。H3 工作流提供文生、首帧、首尾帧，不显示未验证的视频编辑入口。

3. 提交后可以切换会话或关闭控制台，回来仍能查看任务状态，失败时会显示原因，不会自动重复扣费提交。

4. 生成的视频在中间预览，也保存在发起任务的会话产出中；编辑另存新文件，不覆盖原视频，也不自动发送对话消息。
