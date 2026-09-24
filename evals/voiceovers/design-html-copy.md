# design-html-copy — Copy the selected element HTML in one click

The HTML inspector keeps the copy action next to the content it operates on and confirms repeated copies without blocking the user.

1. 选中设计画布中的元素，右侧编辑面板底部显示 HTML 代码，“HTML”标题右侧出现复制图标。

2. 点击复制图标，当前元素的完整 HTML 被写入剪贴板。

3. 图标变为对勾并显示“已复制”反馈，持续两秒后恢复为复制图标。

4. 反馈期间按钮仍然可用；切换元素或再次点击时，会立即复制当前 HTML，并从最后一次点击重新计算两秒反馈时间。
