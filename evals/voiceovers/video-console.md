# Video Console

Approved by the user: Seedance 2.5 reuses Ark authorization; MiniMax H3 uses RunningHub standard model APIs. This is a separate plugin, with model-aware generation/editing and persistent session outputs.

1. 打开视频控制台，模型列表只显示已绑定的服务；没有绑定时，会提示到授权中心配置。

2. 选择生成或编辑，再切换模型和方式，右侧只保留对应模型支持的参数；不兼容的选项会重置并提示。

3. 提交后可以切换会话或关闭控制台，回来仍能查看任务状态，失败时会显示原因，不会自动重复扣费提交。

4. 生成的视频在中间预览，也保存在发起任务的会话产出中；编辑另存新文件，不覆盖原视频，也不自动发送对话消息。
