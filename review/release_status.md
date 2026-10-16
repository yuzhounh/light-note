# LightNote 当前正式版本发布

正式版本：2.2.20，已于 2026-10-16 11:29（Asia/Shanghai）发布。整理 2.2.19 之后已实现的图片清晰度与尺寸、表格列宽、后台保存同步、回车跟随、底部留白和软件来源名称清理；源码与发布范围见 docs/CHANGELOG.md 的 V2.2.20。

## 验证

- Windows Core 1 项、Integration 97 项、桌面编辑器 41 项、Web 33 项测试通过。
- 7 组独立原生宿主检查通过：提示框、侧栏、窗口按钮、标题编辑、图片粘贴、表格尺寸、光标滚动。图片检查使用自动生成的宽图和竖图，支持额外提供本地真实截图；CI 已包含新增三组检查。
- 光标底部距离在编辑前后均为 28px；25 次 Enter、10 次 Shift+Enter、输入、撤销重做及手动阅读保持通过。
- Windows Release 自包含构建通过；保留既有 SkiaSharp 过时 API 警告。Android assembleRelease/lintRelease 通过，v2 签名有效、原证书保持，版本 2.2.20 / code 25。
- 发布时未安装手机 APK；随后按用户明确要求，于 2026-10-16 11:39 在 REDMI K80 Pro（1999ffe8）用 adb install -r 覆盖升级 2.2.19/code 24 → 2.2.20/code 25。新 APK SHA-256 与正式发布清单一致，实际旧 APK 与新 APK 的签名证书相同；升级后 appId=10385、数据目录 /data/user/0/com.lightnote.app、首次安装时间 2026-10-07 18:33:08 均保持，未卸载或清除数据。已启动应用并确认 MainActivity 在前台、进程正常；未执行真实登录及跨设备同步验收。安装前后包信息、签名核对和回执位于 tmp/device-upgrade-2.2.20/。

## 发布结果

- 源码已推送 main；正式标签 v2.2.20 指向 74c3338d5457f6cd207cb3ff59e98b31325eed5a。[GitHub Release](https://github.com/yuzhounh/light-note/releases/tag/v2.2.20) 已公开并设为 latest，包含 Windows 便携 ZIP、安装 EXE、Android APK 和 SHA256SUMS-2.2.20.txt；四个远端资产的大小及 SHA-256 与本地一致。便携包内 629 个文件与最终发布目录逐项一致，APK 内嵌 69 个网页资源与构建一致。
- [Windows CI](https://github.com/yuzhounh/light-note/actions/runs/38845217398) 与 [GitHub Pages](https://github.com/yuzhounh/light-note/actions/runs/38845217332) 均成功。首次 Pages 检查发现 Web 表格测试依赖桌面目录中的 jsdom，现改为 Web 自己声明依赖并正常导入，33 项 Web 测试复验通过；没有改变生产功能。
- [GitHub Pages](https://yuzhounh.github.io/light-note/)、[Cloudflare Pages](https://light-note.pages.dev/) 与 [Firebase Hosting](https://light-note.web.app/) 均为 2.2.20。Cloudflare 部署 3187e141，Firebase 项目 lightnote-sync、站点 light-note。首页、主 JS/CSS、PWA 清单及 service worker 已核对；Pages 的 HTML 空行和 precache 条目顺序按 Windows/Linux 构建差异规范化，67 个缓存条目及其资源一致。
- 本地当前程序及桌面快捷入口继续位于 artifacts/development/current/win-x64，629 个文件与正式发布目录一致，版本 2.2.20+74c3338。更新前确认窗口已隐藏、恢复草稿为空，更新后按原状态在托盘后台启动成功；原用户数据及快捷方式参数保持。
- “LightNote 开发记录”笔记本已新增“V2.2.20：图片、表格与编辑可靠性更新”（lightnote-dev-v2-2-20），并向原 2.2.19 后续开发条目追加已汇总发布说明，原内容保留。文字同步 Uploaded=2、Downloaded=0、Conflicts=0；新条目 Version=1、旧条目 Version=7，均为 Clean、outbox=0。记录中包含各平台实际范围和已有笔记来源文字的一次性维护。
- 本地交付位于 artifacts/installers/，Windows 可执行目录为 artifacts/releases/2.2.20/win-x64/；构建日志、包校验、线上校验及开发记录回执位于 tmp/release-2.2.20/。本版本所需发布工作已完成，无剩余实施项。
- Vercel 原名属于第三方，不部署。Netlify 不调用：暂停至 2026-10-21 15:00，且 LightNote 原名属于第三方。
- 不创建项目快照，不修改数据库规则或用户账号配置。已有笔记来源文字的 4 篇/5 处维护已于本次发布前独立完成，不作为安装升级时自动运行的数据迁移。

## 当前发布：2.2.21 笔记本数量（2026-10-16，执行中）

- 桌面网页版、手机网页版和 Android 共用 Sidebar：每个笔记本右侧显示与名称同字号的浅色胶囊数字，空本显示 0，保留完整位数；浅色、深色及选中状态分别适配。长名称省略，数量不压缩。
- Windows 原生侧栏采用相同布局，普通笔记本及分组内笔记本均显示数量。仅统计未删除且未永久清除的笔记，独立于搜索条件及分页；新建、移动、删除、恢复、同步和导入后刷新。Web/Android 通过 Dexie liveQuery 订阅本地数据库，Windows 在现有列表刷新入口更新计数并通知绑定。
- 按用户确认移除网页版笔记本行上的悬停删除按钮，数字直接靠右；右键菜单及手机长按菜单中的“删除笔记本”保留。笔记列表的批量选择删除属于后续独立事项，本次未新增。
- 验证：Web 34 项测试通过，Windows 笔记本计数、分组及删除相关 8 项测试通过，包含超过一页的数量、零数量、回收站/永久删除排除、生命周期刷新、搜索独立及同步写入。Windows Release 自包含发布构建通过；Android assembleRelease/lintRelease 通过，v2 签名有效，证书与已发布 2.2.20 相同。保留既有 SkiaSharp 过时 API、Vite 大包及 Gradle 弃用提示；未做浏览器或真机视觉验收。
- 用户已授权推送 GitHub、部署网页版、更新本地桌面程序及覆盖安装手机 APK，并要求保留现有数据。版本统一提升为 2.2.21 / Android code 26；沿用原签名和数据目录，不卸载、不清除应用数据。
- 计划从同一提交构建 `artifacts/releases/2.2.21/win-x64/` 和 `artifacts/android/2.2.21/LightNote-2.2.21.apk`，更新原桌面入口 `artifacts/development/current/win-x64/LightNote.exe`；网页部署到 GitHub Pages、Cloudflare Pages 与 Firebase Hosting。Netlify 和第三方 Vercel 入口不部署。
- 当前为发布执行阶段，构建、线上部署、桌面替换和设备覆盖安装的最终结果以随后本地回执为准。原 2.2.20 发布结果保留在上文；本次证据目录为 `tmp/release-2.2.21/`。不创建项目快照或额外 GitHub Release。
