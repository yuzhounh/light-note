# LightNote Firebase 配置

V0.5 在没有 Firebase 配置时仍保持完整的本地笔记能力。配置完成并重启应用后，顶部“同步未配置”按钮会变为“登录同步”。

## 需要提供的信息

从 Firebase 项目设置的 Web 应用配置中取得：

- `projectId`
- `apiKey`
- `storageBucket`
- 非默认 Firestore 数据库才需要修改 `databaseId`

复制 `docs/firebase.example.json` 为：

```text
%UserProfile%\.lightnote\firebase.json
```

不要把真实配置、登录密码或本机生成的 `firebase-session.dat` 提交到版本库。Firebase Web API Key 用于标识项目，实际数据访问仍必须由 Authentication 和 Security Rules 限制。

## Firebase 控制台设置

1. Authentication → Sign-in method：启用“电子邮件/密码”。
2. Firestore Database：创建数据库，并发布 `docs/firestore.rules`。
3. Storage：创建存储桶，并发布 `docs/storage.rules`。
4. 为实际使用者创建邮箱密码账户，或允许应用登录页使用已有账户。

所有 Firestore 文档和 Storage 图片均写入 `users/{uid}` 私有路径；规则会验证登录用户的 UID 与路径一致。

## 本机安全与重试

- 登录密码只用于换取 Firebase token，不写入磁盘。
- refresh token 和短期 ID token 使用 Windows 当前用户 DPAPI 加密。
- 本地修改与 outbox 在同一 SQLite 事务中提交。
- 网络失败采用指数退避，应用保持离线可编辑。
- 拉取到较新的远端内容时，本地未同步内容会先写入标记为“同步冲突副本”的历史版本。

## 联调清单

配置提供后，需要在真实 Firebase 项目上验证：

1. 登录、token 刷新和注销。
2. A 设备离线编辑后上线，B 设备收到笔记、标签和图片。
3. 两台设备同时修改同一笔记时产生可恢复的冲突副本。
4. Storage 上传、下载和 20 MB/图片类型规则。
5. Firestore 与 Storage 中其他 UID 的路径不可访问。
