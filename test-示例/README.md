# 测试示例 CSV

这里保留一个**完整压力测试大表格**，直接在 VS Code / Cursor / Windsurf 里双击打开即可体验。

- [`ultimate-50mb-完整压力测试.csv`](ultimate-50mb-%E5%AE%8C%E6%95%B4%E5%8E%8B%E5%8A%9B%E6%B5%8B%E8%AF%95.csv)（约 50 MiB，64 列）
  - 覆盖长文本、中文 / 日文 / emoji、URL、日期时间、数字、布尔值、空值、引号、逗号、制表符、JSON、HTML / Markdown 片段、路径，以及少量多行单元格。
  - 用来集中测试大文件加载、分块渲染、横向滚动、列宽估算、排序、过滤、查找替换、折行、链接点击和编辑保存。

> 自动化测试（`npm test`）使用的是 [`src-源码/test/super_example.csv`](../src-源码/test/super_example.csv) 与 [`src-源码/test/complex_test.csv`](../src-源码/test/complex_test.csv)（严格断言，不建议改动）。
> 本目录只放手工试用的大样例，不作为自动化测试断言基线。
