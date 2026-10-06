# 书单入库台浏览器扩展 2.0

在 Edge / Chrome 扩展管理页，加载此文件夹。点击工具栏图标即打开当前网页旁的侧栏，没有本地服务或跳转页面。

读取书单 → 可在侧栏加载全部 → 搜索/全选/清洗 → 选择父目录 → 设置间隔 → 下载并生成 Excel。

所有文件保存到“父目录 / 书单名称”。书籍使用“书名 - 作者.格式”，同名同大小文件跳过，大小不同保留两份。Excel 离线生成；已有同名 Excel 保留，新导出加编号。

下载期间保持侧栏打开。支持暂停、继续与停止，失败原因可在侧栏展开查看。登录、验证码及网站限额在原网页处理。

权限：activeTab、scripting、downloads、storage、sidePanel；可选网站访问只在下载动作时精确申请，没有 cookies 权限。`z-library.website` 当前文件服务器是 `dln1.ncdn.ec`。

JSZip 3.10.1（MIT）位于 vendor，许可证随包附带。无需 Python、Node、本地服务器或运行时依赖下载。

完整说明与验证范围见 [项目 README](https://github.com/Arthur-Miyano/booklist-extension#readme)。
