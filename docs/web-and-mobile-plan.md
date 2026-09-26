# LightNote Web & 移动端（PWA + 安卓）技术方案与实施规划

## 1. 架构定位与设计哲学

LightNote 网页端与移动端的核心目标是**打破平台边界**，使用户在非 Windows 设备（Mac、Linux、iPad、iPhone、Android 手机）上也能无缝访问和记录笔记。

### 核心设计原则
- **One Codebase, Multiple Targets**：一套前端代码工程，编译后同时输出：
  1. 现代浏览器 SPA（桌面与移动网页）
  2. PWA（支持免商店直接添加到主屏幕/桌面，离线全屏运行）
  3. 原生 Android APK（基于 Capacitor 轻量封装，具备原生拍照、状态栏沉浸、物理返回键捕获等能力）
- **Local-First（本地优先）**：离线完全可用。所有笔记先落本地 IndexedDB 存储，毫秒级响应，网络恢复后再增量同步至 Firebase。
- **100% 协议与资产复用**：完全兼容 Windows 桌面端的 Firebase 同步协议与数据字段（Firestore 集合和 Storage 目录完全一致），复用桌面端 WebView2 中成熟的 Tiptap + KaTeX 富文本与公式渲染引擎。

## 2. 技术栈选型

- **构建系统与框架**：`Vite 6` + `React 19`
- **样式与设计系统**：`Tailwind CSS` + 桌面端同款深浅色设计 Tokens（延续现有 `#1e1e1e` / `#ffffff` / 中性圆角风格）
- **图标系统**：`Lucide React`（极轻量矢量图标）
- **本地存储与数据库**：`Dexie.js`（基于浏览器 IndexedDB 的强类型封装，支持游标、索引与批量事务）
- **富文本与数学公式**：`@tiptap/react` 3.x + `katex` + `markdown-it`（从 `editor/src/main.jsx` 模块化重构）
- **客户端全文检索**：`MiniSearch`（纯客户端倒排索引，支持拼音、中英文分词与前缀即时检索）
- **云端服务**：`Firebase Modular SDK v11`（`firebase/auth`, `firebase/firestore`, `firebase/storage`）
- **PWA 支持**：`vite-plugin-pwa`（基于 Workbox 的资源预缓存与运行时缓存策略）
- **安卓原生容器**：`@capacitor/core` + `@capacitor/android` + 原生系统插件（键盘、状态栏、返回键、文件/相册选择）

## 3. 目录与工程结构规划

在项目根目录下新建 `web/` 独立工程：

```text
LightNote/
├── editor/                   # 现有供 Windows WebView2 使用的编辑器构建目录
├── src/                      # 现有 .NET 10 WPF 客户端
├── docs/
│   ├── web-and-mobile-plan.md# 本规划方案
│   └── ...
└── web/                      # [新建] Web / PWA / Android 统一工程
    ├── package.json
    ├── vite.config.js
    ├── capacitor.config.json # Capacitor 安卓打包配置
    ├── android/              # 生成的 Android Studio 原生工程骨架
    ├── public/
    │   ├── icons/            # PWA & App 各尺寸启动图标与 SVG 图标
    │   ├── manifest.webmanifest
    │   └── favicon.ico
    └── src/
        ├── core/             # 数据与逻辑层
        │   ├── db/           # Dexie.js 本地库与表定义 (notebooks, notes, tags, outbox)
        │   ├── sync/         # Firebase 同步引擎 (Pull/Push、冲突检测、游标管理)
        │   ├── search/       # MiniSearch 索引建立与检索服务
        │   └── auth/         # Firebase 登录会话与状态监听
        ├── editor/           # Tiptap 富文本组件层
        │   ├── extensions/   # 公式插件 (KaTeX)、图片扩展、格式扩展
        │   ├── components/   # 浮动工具栏、公式编辑弹窗、链接输入框
        │   └── LightEditor.jsx
        ├── components/       # 通用 UI 组件
        │   ├── layout/       # 响应式三栏/单栏容器、移动端抽屉
        │   ├── navigation/   # 笔记本树、标签筛选、回收站
        │   ├── notelist/     # 笔记卡片、置顶指示、批量操作栏
        │   └── modals/       # 登录弹窗、移动分组、设置弹窗
        ├── hooks/            # 移动端适配与系统交互 Hooks
        │   ├── useResponsive.js    # 屏幕断点检测 (Desktop, Tablet, Mobile)
        │   ├── useVirtualKeyboard.js# 软键盘高度与视口调整
        │   └── useBackButton.js    # Android 物理返回键路由拦截
        ├── styles/
        ├── App.jsx
        └── main.jsx
```

## 4. 响应式布局与移动端专项交互设计

### 4.1 屏幕断点与布局策略

| 设备类型 | 屏幕宽度 | 布局表现 |
| :--- | :--- | :--- |
| **PC / 桌面宽屏** | `>= 1024px` | **经典三栏式**：左侧导航树 (240px) ⇄ 笔记列表 (320px) ⇄ 主编辑区 (自适应) |
| **iPad / 平板横竖屏** | `768px ~ 1023px`| **抽屉折叠双栏**：左侧导航作为侧滑抽屉 ⇄ 笔记列表 (340px) ⇄ 主编辑区 |
| **手机 / 安卓客户端** | `< 768px` | **单屏页面栈导航（Navigation Stack）**：列表页 ⇄ 编辑页（点击笔记平滑右滑进入） |

### 4.2 手机/安卓三大核心交互细节

1. **软键盘与编辑工具栏吸顶/吸底（Keyboard Accessory Bar）**：
   - 移动端输入法弹出后，利用 `window.visualViewport.height` 监听真实可见视口变化。
   - 格式快捷栏（B、I、H2、代码、公式、拍照插入）自动浮动吸附在软键盘正上方，光标输入点始终自动滚动至可视区，绝不被键盘遮挡。
2. **Android 物理/手势返回键智能劫持（Hardware Back Button）**：
   - 统一由 `useBackButton` 接管返回键事件：
     - 若当前处于公式弹窗/设置弹窗 -> 优先关闭弹窗；
     - 若当前展开了左侧笔记本抽屉 -> 关闭抽屉；
     - 若当前处于笔记编辑页面 -> 自动保存草稿并平滑返回笔记列表；
     - 若已在首页列表 -> 连续按两次提示“再次点击退出应用”。
3. **触控 Ergonomics（符合人体工程学的手势）**：
   - 列表项支持左滑快捷删除/置顶；
   - 列表顶部支持下拉刷新（Pull to Refresh）触发 Firebase 手动同步；
   - 底部常驻悬浮新建按钮（FAB，Floating Action Button），单手大拇指轻松新建笔记。

## 5. 本地持久化与多端同步机制

### 5.1 本地 IndexedDB 设计 (Dexie.js)
- `notebooks`: `id, name, group_id, sort_order, created_at, updated_at, deleted_at`
- `notes`: `id, notebook_id, title, body_html, body_text, is_pinned, is_deleted, sort_order, created_at, updated_at, deleted_at`
- `tags`: `id, name, color`
- `note_tags`: `note_id, tag_id`
- `attachments`: `sha256, filename, mime_type, byte_size, blob_data, remote_url`
- `sync_outbox`: `id, entity_type, entity_id, action, payload, created_at, retry_count`

### 5.2 云端协同与冲突处理
- **完全对齐 Windows 端路径**：
  - Firestore 路径：`users/{userId}/notebooks/{notebookId}` 与 `users/{userId}/notes/{noteId}`
  - Storage 路径：`users/{userId}/attachments/{sha256}/{filename}`
- **离线与断网策略**：本地新建/编辑立即落表并追加到 `sync_outbox`，界面无需等待网络；联网后自动静默重试同步。
- **冲突策略**：以云端最新时间戳为基准。若本地与远端同时修改，当前编辑内容自动作为本地版本保留，远端内容作为冲突历史副本存档。

## 6. 实施路线图（分步里程碑）

### 里程碑 1：工程搭建与本地数据内核（Web 原型）
- 创建 `web/` 工程（Vite + React 19 + Tailwind）。
- 搭建 Dexie.js 数据仓库与 Mock/本地 CRUD 逻辑。
- 完成响应式三栏/单栏自适应框架，实现列表浏览与新建笔记。

### 里程碑 2：集成 Tiptap 富文本与 KaTeX 数学公式
- 迁移并重构 `editor/` 中的 Tiptap 核心插件。
- 适配桌面端与移动端双模态工具栏（桌面常驻顶栏，移动端键盘吸附栏）。
- 实现行内公式与独立块级公式编辑弹窗，支持即时预览。

### 里程碑 3：Firebase 云端双向同步与附件上传
- 接入 Firebase Auth（支持邮箱密码与 Google 一键登录）。
- 实现增量推拉同步机制（Firestore 监听与游标查询）。
- 接入 Firebase Storage，实现图片拖拽、粘贴与本地缓存/云端上传。

### 里程碑 4：PWA 离线套件与极速全文搜索
- 配置 `vite-plugin-pwa`，生成 Web App 清单与 Service Worker 离线缓存。
- 接入 MiniSearch 引擎，实现毫秒级拼音与关键词全文检索。
- 添加深色模式/浅色模式自适应切换。

### 里程碑 5：Capacitor 安卓原生封装与真机调优
- 初始化 `@capacitor/core` 与 `@capacitor/android`。
- 配置沉浸式透明状态栏（StatusBar）与软键盘行为（Keyboard）。
- 接入 Android 物理返回键监听与相机/相册原生直接调用。
- 输出最终 Debug/Release APK 并完成真机测试。
