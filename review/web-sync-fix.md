# LightNote 网页同步修复记录

日期：2026-10-02。状态：修复已推送 GitHub main，并部署至 Firebase Hosting 和 Cloudflare Pages；本地回归、GitHub CI 和线上静态资源校验通过。

## 已确认并修复

1. **待上传草稿会被覆盖。** 手动拉取计算了待上传笔记 ID，却没有用于合并判断；实时拉取只在本地时间较新时跳过覆盖，并直接处理物理删除。现在两条路径使用同一事务合并逻辑：存在待上传变更或编辑器草稿时保留本地记录。较旧的实时更新也不会覆盖较新的已保存记录。
2. **网页编辑会清空桌面标签。** 上传原本固定写入 `tags: []`，下载没有保留标签。现在下载、编辑、上传保留已知标签；旧缓存中的未知标签省略上传，以保留云端已有值。
3. **删除传播协议不同。** 网页原本永久删除 Firestore 文档，桌面使用 `deletedAt` / `purgedAt` 墓碑。现在网页软删除、恢复、永久删除、清空回收站和笔记本删除均使用相应墓碑字段；永久删除内容清空且不出现在列表或回收站。旧版尚未上传的物理删除队列会转为墓碑；单独的 Firestore `removed` 通知不再删除网页本地记录。
4. **同步与保存期间的新编辑可能丢失。** 本地写入与队列更新现在在同一事务中完成；每次变更获得新的队列 ID，旧请求仅确认其对应及更早的队列项。上传串行执行，失败保留队列并显示错误，遗留变更会继续上传。自动保存按笔记独立防抖；同步刷新保留编辑器草稿；正文同步同时更新 JSON、HTML 和纯文本。

同步期间取消了仅凭同名合并笔记本的操作，避免合并引入的旧正文上传阻止真正的远端正文更新。启动时的旧笔记本整理保留待同步记录及删除墓碑。

## 验证

- `cd web; npm test`：18 / 18 通过。覆盖待上传和防抖草稿、上传及保存期间再次编辑、快速切换笔记、失败重试、标签及正文保留、双向删除字段、清空回收站、旧删除队列、事务回滚和并发上传。
- `dotnet test tests/LightNote.IntegrationTests/LightNote.IntegrationTests.csproj --filter FullyQualifiedName~FirebaseSyncTests --verbosity minimal`：9 / 9 通过。包括桌面读取网页标签和删除字段，以及桌面上传标签。
- `cd web; npm run build`：成功，包含 PWA 静态资源生成。保留已有的单个资源包体积提示。
- `git diff --check`：通过。

## 验证范围与后续

自动化验证使用模拟 IndexedDB 和 Firebase HTTP/上传传输；线上检查仅核对静态资源，未读写真实用户笔记，也未进行真实双设备在线验收。本次未重新打包 Android APK。已被旧版本清空的云端标签、已上传的无墓碑物理删除不在本次自动恢复范围内；需要原始本地数据或备份才能恢复。

后续可用独立测试笔记验收桌面加标签 → 网页改正文 → 桌面同步，以及两端软删除、恢复、永久删除和网页离线编辑后重连。

## 发布记录

- 修复源码提交：[cd7f4ea](https://github.com/yuzhounh/light-note/commit/cd7f4ea)，已推送 `main`；此前本地已有的 4 个提交同时推送。
- [GitHub CI](https://github.com/yuzhounh/light-note/actions/runs/37006262087)：成功。
- Firebase Hosting：[light-note.web.app](https://light-note.web.app)，项目 `lightnote-sync`，站点 `light-note`。
- Cloudflare Pages：[light-note.pages.dev](https://light-note.pages.dev)，生产环境 `main`，部署 ID `067e2152-8073-4432-abce-5c8304c85c19`；[该次部署](https://067e2152.light-note.pages.dev)。
- 两个正式域名均返回本次入口脚本 `assets/index-bPN6PZpb.js`；脚本与 `sw.js` 的 SHA-256 均与本地生产构建一致。
