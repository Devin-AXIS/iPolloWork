# Excel 编辑

从对话或项目文件树打开表格，在右侧工作区点击「编辑」。可以连续滚动，拖选区域或用 Shift 加方向键选区，成块复制粘贴，按 Delete 清空，以及在保存前撤销和重做。双击单元格或按 F2 编辑，可按地址跳转，也可查找单元格内容。

XLSX、CSV 和 TSV 保存到原文件。XLSX 网格显示格式化值和已有的公式结果，输入栏显示原始值或公式。已有公式受保护，由表格软件重新计算。XLS 和 ODS 可打开编辑，再点「另存为 XLSX」，原文件保留。部分旧格式的图表或样式可能无法转换。

CSV 和 TSV 的解析逻辑移植自 iPolloWork 多引擎分支的 `05f917145cd320a93e514dbd01178133891bc4c6`。Excel Host 内置 SheetJS CE 0.20.3（Apache-2.0）处理旧格式导入和数字格式化，插件包附带其许可证。

安装 `plugins/workspace-tools` 的构建依赖后，在仓库根目录运行 `npm run package:workspace-market -- excel-editor` 构建并打包。
