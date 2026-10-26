# Firebase 客户端密钥告警处理

完成时间：2026-10-16 13:22（Asia/Shanghai）。

## 结论

GitHub 告警 [#1](https://github.com/yuzhounh/light-note/security/secret-scanning/1) 和 [#2](https://github.com/yuzhounh/light-note/security/secret-scanning/2) 已核实为预期公开的 Firebase 客户端 API key，均以 `false_positive` 关闭；关闭后通过 API 再读确认 `state=resolved`。

| 告警 | 当前配置 | 云端 key UID | SHA-256 前 12 位 | 关闭时间（北京时间） |
|---|---|---|---|---|
| #1 | `web/src/core/auth/firebaseAuth.js` | `c355b793-403e-4d62-96e1-0ac50fecc60d` | `44e88a1bb9f0` | 2026-10-16 13:22:05 |
| #2 | `web/android/app/google-services.json` | `25abc3f7-5b8b-49b1-b8f1-131e9070626c` | `36c80658a0c6` | 2026-10-16 13:22:03 |

## 核实依据

- 使用已有 Firebase CLI 登录，通过 Google Cloud API Keys API 读取项目 `lightnote-sync` 的实际密钥配置；密钥值仅在进程内与 GitHub 告警及上述源码匹配，不保存到报告或日志。
- 两把 key 都启用了 Firebase 自动创建的 27 项 API 服务白名单，均未允许 `generativelanguage.googleapis.com`，不是不限制 API 的 key。本次保留已有白名单，没有扩展其权限。
- 实际 `browserKeyRestrictions`、`androidKeyRestrictions` 均为空对象，不声称已配置来源域名或 Android 包/证书绑定。网页、Windows REST 客户端等使用方式需一并考虑，不能仅为隐藏告警盲目加域名限制。
- 读取线上发布的 Firestore 规则：`/users/{userId}/{document=**}` 的读写必须同时满足已认证和 `request.auth.uid == userId`。
- 读取线上 Storage 规则：仅允许所属用户访问 `/users/{userId}/attachments/**`；创建/更新还受图片类型及小于 20 MiB 限制。
- 使用每把 key、无用户令牌，对专用不存在的探测文档路径执行 GET，均返回 `403 PERMISSION_DENIED / Missing or insufficient permissions`。没有读取真实用户文档，也没有执行写入。

[Firebase 官方说明](https://firebase.google.com/docs/projects/api-keys)明确区分客户端 API key 与访问授权；在满足其要求时可以将 Firebase 客户端 key 放入公开代码。因此本次以误报关闭，未使用“已撤销”或“仅测试使用”等不符合事实的原因。

本次只处理指定两条告警；没有轮换/删除 key、改变云端限制或数据规则、修改客户端源码、重新部署或更改通知设置。没有审计历史用量，不将上述核实表述为不存在任何历史滥用的证明。
