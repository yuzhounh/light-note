# LightNote 当前正式版本发布

## V2.2.24：链接、笔记本切换与手机同步状态（2026-10-20）

- 统一 Windows、Web 与 Android 版本为 2.2.24，Android versionCode 36；汇总 2.2.23 正式版之后的 Markdown 链接修复、笔记本切换修复及手机同步状态改进，范围见 CHANGELOG。
- 验证：Core 1 项、Integration 100 项、桌面编辑器 41 项、Web 41 项测试通过；Windows 自包含发布与 Inno Setup 安装包生成成功；Android assembleRelease/lintRelease 通过，APK v2 签名有效。
- 交付位于 `artifacts/installers/`（安装 EXE、便携 ZIP、APK、SHA256SUMS-2.2.24.txt），Windows 发布目录为 `artifacts/releases/2.2.24/win-x64/`，APK 副本为 `artifacts/android/2.2.24/LightNote-2.2.24-code36.apk`；构建日志和说明在 `tmp/release-2.2.24/`。
- 本次未替换日常 Windows 程序，也未安装手机 APK。

## 2.2.23 日常增量：链接、笔记本切换与手机同步（2026-10-20）

- 正式 GitHub v2.2.23 标签及资产保持原样。后续增量源码为 `3ac297de59e032a322574a9396d3142147875a29`，Windows 日常构建为 `2.2.23+bfe3f9058fe78ca572abbc38ef0bc35e917c422e`；不将日常增量误记为新的正式 Release。
- Markdown 导入解析安全链接并保持代码片段原样；修正切换笔记本后桌面详情仍保留旧笔记的问题。4 篇开发记录的 10 处旧链接已修正并同步，云端两条代表记录复读确认无原样 Markdown 链接。导入相关 11 项、笔记本选择相关 2 项检查通过；Web 既有 40 项及后续同步 23 项检查通过。
- Windows 完整程序于 18:26 在没有运行进程时安装到原 `artifacts/development/current/win-x64`；629 个程序文件、62 个编辑器资源验证通过，数据库、附件、设置、登录及恢复数据校验保持。既有桌面快捷方式和 `scripts/run-dev.ps1` 继续使用原日常入口；用户随后确认桌面链接问题已解决。本次没有再次重启或替换 Windows。
- 手机与手机网页的同步状态位于主界面 LightNote 右侧；移除汉堡菜单中的同步信息。主列表顶部下拉触发同步，编辑区不触发；同步异常可点击查看原因。完整同步必须取得服务器记录，缓存结果不能显示“已同步”；Android 使用长轮询兼容连接。保留原有笔记本手动排序及 `sortOrder` 同步，没有强制字母排序。
- Android 已覆盖安装 2.2.23/code 35，APK：`artifacts/android/2.2.23/LightNote-2.2.23-code35.apk`，SHA-256 `9619e2f45072e5abe72c6e1840089bca3f555acd4ac4d25baea4d75b0d4f1ceb`。构建、lint 和同签名检查通过，设备实际包哈希一致；appId=10385、数据目录及首次安装时间保持，账号仍登录，未卸载或清除数据。
- **手机链接问题已确认解决（19:24 复核）**：用户确认手机可同步；实机顶部显示“已同步”，列表已出现 V2.2.23，相关开发记录更新为 17:55。打开原截图中的 V2.2.22 条目，实见蓝色、带下划线的“GitHub 正式发布页”，不再显示原样 Markdown 链接。此前 `Failed to get documents from server` 和 Chrome `ERR_TIMED_OUT` 仅是当时的失败记录，不能推断手机持续无法同步，也未据此确定 DNS、节点或线路原因。本次未更改手机代理、账号或笔记内容，未清除缓存/应用数据，临时日志采集已停止。
- GitHub Pages 工作流 `39412162739`、Cloudflare Pages 部署 `a76e6f53` 和 Firebase Hosting 已发布增量。三个原网页入口的首页、主 JS/CSS、PWA 均与各自根路径或子路径构建核对一致；手机同步及原问题链接另经上述实机核对确认。继续跳过第三方 Vercel/Netlify。安装、云端复读及线上核对见 `tmp/link-navigation-update/`、`tmp/sync-header-update/`。本次状态更正仅修改文档，不另行构建或安装。

## V2.2.23：表格宽度快捷操作（2026-10-20，Windows / Web / Android 已更新）

[GitHub v2.2.23 正式版](https://github.com/yuzhounh/light-note/releases/tag/v2.2.23) 已于 2026-10-20 13:53（Asia/Shanghai）公开并设为 latest，非预发布；标签指向完整源码 `fc448b3f9500c58f107d0892772f625a2fdb8e15`。[Windows CI](https://github.com/yuzhounh/light-note/actions/runs/39376874730) 与 [Pages](https://github.com/yuzhounh/light-note/actions/runs/39376874742) 成功。Core 1 项、Integration 99 项、编辑器 41 项及更新后的原生表格检查通过；CI 同时完成既有七组原生宿主检查。安装 EXE、便携 ZIP、Android code 30 APK 和 SHA256SUMS-2.2.23.txt 均已上传，GitHub 计算的四个资产 SHA-256 及大小与本地一致；便携 ZIP 内 629 个文件与正式发布目录逐项匹配，不含笔记数据库、设置或登录数据。交付位于 `artifacts/installers/`，Windows 发布目录为 `artifacts/releases/2.2.23/win-x64/`，核验回执见 `tmp/release-2.2.23/`。

- 将本次表格更新升级为 2.2.23，Android 构建号提升到 30；共享项目版本及 Web package/lock 元数据同步对齐。功能源码沿用下节已经通过 36 项 Web 测试的实现，不新增数据迁移或修改同步配置。
- 提交 `4ed198890857538991496b37c10bd045cf11dd49` 已推送 main，包含 `[skip netlify]`。[GitHub Pages](https://github.com/yuzhounh/light-note/actions/runs/39374966025) 成功；Cloudflare Pages 部署 `05c2886b`、Firebase Hosting `lightnote-sync/light-note` 完成。三个原入口的首页、主 JS/CSS、2.2.23 版本标记及 PWA 清单/缓存均与相应构建一致。
- Android assembleRelease/lintRelease 通过，APK v2 签名有效且与原安装证书相同，69 个内嵌网页文件与本版根路径构建一致。REDMI K80 Pro（1999ffe8）已通过 `adb install -r` 从 2.2.22/code 29 覆盖升级为 2.2.23/code 30，启动 Status=ok；已安装 APK 哈希与交付包一致，原 appId、数据目录和首次安装时间保持，未卸载或清除笔记、设置。
- APK：`artifacts/android/2.2.23/LightNote-2.2.23.apk`，SHA-256：`e23e74cca3a1e4357f099175a0be3ab9c9b212e4199c88a1125913fc68c6f9a9`。构建与线上、设备核对回执位于 `tmp/version-2.2.23/`。
- LightNote 开发记录已新增“V2.2.23：表格宽度快捷操作”（lightnote-dev-v2-2-23），并在原 V2.2.22 条目末尾追加已更新说明，原正文保留。文字同步 Uploaded=2、Downloaded=0、Conflicts=0；新条目 Version=1、旧条目 Version=18，均为 Clean、pendingOutbox=0。回执见 `tmp/version-2.2.23/dev-record/receipt.json`。
- Windows 日常程序于 2026-10-20 13:35（Asia/Shanghai）升级为 2.2.23，文件版本 2.2.23.0；完整自包含构建通过，629 个安装文件和 62 个编辑器资源校验一致。确认没有运行进程后替换原 `artifacts/development/current/win-x64`，笔记数据库、附件、设置、登录信息和恢复草稿在替换前后校验不变，原快捷入口保持，下次正常启动使用新版。回执见 `tmp/version-2.2.23/windows-update/status.json`。此次正式打包发布未再次替换或重启日常客户端，保留现有笔记和设置；无关本地修改保留。Vercel、Netlify 同名站点属于第三方，不部署；Netlify 暂停及滚动 168 小时规则继续有效。

## 表格宽度操作：Web / Android 增量（2026-10-20，已完成）

- 表格工具栏增加“重置表宽”和“统一列宽”：前者恢复 900px 总宽并保留列宽比例，后者将各列设为操作前总宽的 1/4。移除数值列宽输入入口及悬停提示，保留拖动调整、“平均分配”和原有表格操作。沿用此前已在本地完成的共享编辑器辅助代码。
- Web 36 项测试通过，包含新增操作的撤销、保存重开、内容保持和非四列表格行为。复用已通过的根路径构建，另构建 `/light-note/` 子路径包用于 GitHub Pages 比对；Android assembleRelease/lintRelease 通过，69 个内嵌网页文件与根路径构建一致。
- 源码提交 `dcd4e99bfba23e4a4c24129a1e18d61fd0da237f` 已推送 main，含 `[skip netlify]`。[GitHub Pages 工作流](https://github.com/yuzhounh/light-note/actions/runs/39374180494) 成功；Cloudflare Pages 部署 `51f353bc`、Firebase Hosting `lightnote-sync/light-note` 发布完成。三个原入口的首页、主 JS/CSS、表格按钮及 PWA 清单/缓存均与各自构建一致；未修改域名、数据库结构、账号或存储配置。
- REDMI K80 Pro（1999ffe8）已通过 `adb install -r` 覆盖升级 2.2.22/code 28 → 2.2.22/code 29。新旧 APK 签名证书一致、v2 签名有效；安装后读回 APK 与构建 SHA-256 一致，启动 Status=ok。原 appId=10385、数据目录和首次安装时间保持，未卸载或清除笔记、设置数据；未执行私人笔记逐条比对。
- APK：`artifacts/android/2.2.22/LightNote-2.2.22-code29.apk`，SHA-256：`6191fcff7b3daf34acead5365336146e487797305d821375e6d43e32af2a97b1`。构建、网页和设备核对回执位于 `tmp/table-width-web-android-20261020/`。本次未另建正式版本或 GitHub Release，未重复更新 Windows；其他本地未提交修改保留。
- Vercel、Netlify 同名站点属于第三方，不调用；同时继续遵守 Netlify 暂停至 2026-10-21 15:00（Asia/Shanghai）及滚动 168 小时规则。

## V2.2.22（2026-10-16，已正式发布）

整理 2.2.21 之后的网页卡片对齐、浮动菜单与手机删除入口规则，统一 Windows/Web/Android 版本号为 2.2.22；Android code 28，高于现有本地 code 27。保留笔记本数量标记和既有原生 Windows 界面，不加入新的数据迁移。

- 当前生产功能源码与此前已验证的卡片、菜单版本相同；复用既有隔离浏览器单/双/三栏布局及右键、长按、关闭、防误触检查。本次重新执行的 34 项 Web 测试通过，生产构建、Android assembleRelease/lintRelease 通过。
- [v2.2.22 正式版](https://github.com/yuzhounh/light-note/releases/tag/v2.2.22) 已于 2026-10-16 14:58（Asia/Shanghai）公开并设为 latest，标签指向 27d8f4654c9c8e94ba20d5db7edaf113a59a5211。Windows 安装 EXE、便携 ZIP、Android APK 和 SHA256SUMS-2.2.22.txt 均上传完成，四个远端资产的大小及 SHA-256 与本地一致。
- Windows Release 自包含包构建成功，便携包内 629 个文件与发布目录一致；APK 为 2.2.22/code 28，v2 签名有效、与 code 27 证书相同，内嵌 69 个网页文件与构建一致。保留既有 SkiaSharp 过时 API 警告。2026-10-16 15:49 已按用户要求通过 `adb install -r` 将 REDMI K80 Pro（1999ffe8）从 2.2.21/code 27 覆盖升级到 2.2.22/code 28，应用启动成功；实际安装 APK 哈希匹配正式包，appId、数据目录和首次安装时间保持，未卸载或清除数据。回执位于 `tmp/device-upgrade-2.2.22/receipt.json`。
- [Windows CI](https://github.com/yuzhounh/light-note/actions/runs/38863239157) 和 [GitHub Pages](https://github.com/yuzhounh/light-note/actions/runs/38863239218) 成功。Cloudflare Pages 79fcf99f、Firebase Hosting lightnote-sync/light-note 完成，三个入口的首页、主 JS/CSS、PWA 清单及 service worker 均与 2.2.22 构建核对一致，旧底部面板已移除。
- 本地当前 Windows 程序已通过 Restart Manager 正常退出后更新，629 个文件与正式目录一致，版本 2.2.22+27d8f46，恢复原后台托盘状态。升级前后 110 篇笔记、3 个笔记本、27 条附件记录、附件文件清单及登录会话哈希一致；原快捷入口和数据目录保留。
- 部署仅面向 GitHub Pages、Cloudflare Pages light-note 和 Firebase Hosting lightnote-sync/light-note。Vercel/Netlify 原名属于第三方；不调用 Netlify，继续遵守暂停及每项目滚动 168 小时限制。
- 开发记录已新增“V2.2.22：卡片对齐与浮动菜单统一”（lightnote-dev-v2-2-22），原“V2.2.21 后续网页调整：卡片对齐与浮动菜单”追加正式发布说明，原内容节点保留。JSON/HTML/纯文本核对一致，文字同步 Uploaded=2、Downloaded=0、Conflicts=0；新条目 Version=1、旧条目 Version=2，均为 Clean、outbox=0。
- 发布包位于 artifacts/installers/，Windows 可执行目录为 artifacts/releases/2.2.22/win-x64/。构建、包校验、线上校验、桌面数据保留及开发记录回执位于 tmp/release-2.2.22/。本版发布任务已完成，无剩余实施项。

## 既有版本及客户端更新记录（历史）

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

## 当前发布：2.2.21 笔记本数量（2026-10-16，已完成）

- 桌面网页版、手机网页版和 Android 共用 Sidebar：每个笔记本右侧显示与名称同字号的浅色胶囊数字，空本显示 0，保留完整位数；浅色、深色及选中状态分别适配。长名称省略，数量不压缩。
- Windows 原生侧栏采用相同布局，普通笔记本及分组内笔记本均显示数量。仅统计未删除且未永久清除的笔记，独立于搜索条件及分页；新建、移动、删除、恢复、同步和导入后刷新。Web/Android 通过 Dexie liveQuery 订阅本地数据库，Windows 在现有列表刷新入口更新计数并通知绑定。
- 按用户确认移除网页版笔记本行上的悬停删除按钮，数字直接靠右；右键菜单及手机长按菜单中的“删除笔记本”保留。笔记列表的批量选择删除属于后续独立事项，本次未新增。
- 验证：Web 34 项测试通过，Windows 笔记本计数、分组及删除相关 8 项测试通过，包含超过一页的数量、零数量、回收站/永久删除排除、生命周期刷新、搜索独立及同步写入。Windows Release 自包含发布构建通过；Android assembleRelease/lintRelease 通过，v2 签名有效，证书与已发布 2.2.20 相同。保留既有 SkiaSharp 过时 API、Vite 大包及 Gradle 弃用提示；未做浏览器或真机视觉验收。
- 用户已授权推送 GitHub、部署网页版、更新本地桌面程序及覆盖安装手机 APK，并要求保留现有数据。版本统一提升为 2.2.21 / Android code 26；沿用原签名和数据目录，不卸载、不清除应用数据。
- 源码提交 `5d7a2ef279d3f3d59bab13175571efa9ead2f7ae` 已推送 GitHub main，提交带 `[skip netlify]`。[Windows CI](https://github.com/yuzhounh/light-note/actions/runs/38851693031) 和 [GitHub Pages](https://github.com/yuzhounh/light-note/actions/runs/38851693082) 均成功。本节发布回执随后以仅文档提交同步；该文档提交跳过重复构建，程序源码仍对应 5d7a2ef。
- [GitHub Pages](https://yuzhounh.github.io/light-note/)、[Cloudflare Pages](https://light-note.pages.dev/) 与 [Firebase Hosting](https://light-note.web.app/) 均已更新。Cloudflare 部署 `b030bba0`，Firebase 项目 `lightnote-sync`、站点 `light-note`。三站首页、主 JS/CSS 均可访问，主资源 SHA-256 与各自构建一致；PWA start_url/scope 分别为 `/light-note/`、`/`、`/`，67 个缓存条目经规范化核对。未代用户执行真实账号登录或跨设备编辑同步验收。
- Windows 从同一源码构建到 `artifacts/releases/2.2.21/win-x64/`，已更新原桌面入口 `artifacts/development/current/win-x64/LightNote.exe`。先触发收起保存并确认无恢复草稿，再通过 Windows Restart Manager 的正常关闭请求退出（未使用强制关闭）；更新前后 108 篇笔记、3 个笔记本、26 条附件记录、附件文件清单及登录会话校验一致。新进程 PID 43592，运行版本 `2.2.21+5d7a2ef`，编辑器桥接已就绪；原快捷方式目标、参数和数据目录 `C:\Users\Jing Wang\.lightnote` 保持。
- REDMI K80 Pro（1999ffe8）已通过 `adb install -r` 从 2.2.20 / code 25 覆盖升级至 2.2.21 / code 26。实际旧 APK 与新包证书一致；升级后 appId 10385、数据目录 `/data/user/0/com.lightnote.app`、首次安装时间 2026-10-07 18:33:08 均保持，未卸载或清除数据。安装后的 APK 与本地新包 SHA-256 完全一致；MainActivity 启动成功并在前台，观察到进程 PID 24892。
- APK 为 `artifacts/android/2.2.21/LightNote-2.2.21.apk`，SHA-256：`88289D0D06F1132EFD299DAD787E7523F6725759EEC5B1A7147F46540F1698E1`。本次构建、部署、线上核对、桌面数据及手机安装回执位于 `tmp/release-2.2.21/`。所有本次授权事项已完成；原 2.2.20 发布结果保留在上文。不创建项目快照或额外 GitHub Release。Netlify 仍跳过（暂停至 2026-10-21 15:00，且原名属于第三方），第三方 Vercel 入口不部署。

## 手机笔记删除入口与单篇重复标题（2026-10-16）

- 移除笔记列表的行内删除图标；手机列表长按菜单也不再提供删除，保留详情右上角的删除和确认框。桌面/平板保留右键菜单删除入口。相关代码已随另一聊天的菜单统一提交 `955066d` 推送，本聊天没有重复触发部署。
- 已核对 Firebase 正式网页主脚本 `index-DzSSFGFO.js` 与当前构建 SHA-256 一致，行内删除标记已移除。JSX 语法及详情删除入口保留检查通过。
- `lightnote-dev-v2-2-20` 原有标题字段和正文首个 H1 完全重复。仅移除正文首个重复 H1，同步修正 HTML、JSON 和纯文本；标题、创建时间、笔记本归属及后续 11 个正文块保持。原内容存入历史版本；当前笔记 Version=2、Clean、outbox=0，文字同步 Uploaded=1、Downloaded=0、Conflicts=0。
- 单篇修正及线上核对回执位于 `tmp/fix-note-title/`。这是既有笔记内容修正，没有修改编辑器的通用标题渲染规则；未卸载客户端、清除数据或再次覆盖安装 APK。

## 本地客户端同步（2026-10-16，已完成）

- 用户要求将最近几次网页布局和入口调整同步到本地桌面端及手机端，并覆盖安装 APK、保留数据。仍为 2.2.21 本地增量，Android versionCode 提升到 27；未执行网页部署、GitHub 发布或项目快照。
- Windows 原生列表已经右对齐笔记本标签并使用上下文菜单，本次保留原生行为，重新构建嵌入编辑器和自包含程序，版本 `2.2.21+4dbe24e`。先触发保存、确认没有恢复草稿，再用 Restart Manager 正常关闭（不强制结束）；替换前后 109 篇笔记、3 个笔记本、27 条附件记录、附件文件清单及登录会话哈希一致。
- 原入口 `artifacts/development/current/win-x64/LightNote.exe` 已更新并以 `--background` 恢复托盘后台状态，运行 PID 22816；原快捷方式、参数及数据目录保持。待更新构建源位于 `artifacts/development/pending/client-sync-20261016/win-x64/`。
- REDMI K80 Pro（1999ffe8）已 `adb install -r` 覆盖升级至 2.2.21/code 27，实际旧包与新包证书一致，安装后 APK 读回哈希与构建相同；应用启动 Status=ok，运行 PID 14043。appId=10385、dataDir=/data/user/0/com.lightnote.app、首次安装时间 2026-10-07 18:33:08 均保持，未卸载或清除数据。
- Android APK 内 69 个网页文件与当前构建逐项匹配；Windows 和 Android 构建、Android lint 与 v2 签名检查均通过。APK 位于 `artifacts/android/2.2.21/LightNote-2.2.21-code27.apk`，SHA-256：`73C726BE41BFB0FF577A78D26BC39D790F9419C328D0B02745941C9D9B3E8C32`。详细回执位于 `tmp/client-sync-20261016/`。
