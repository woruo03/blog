# woruo03's Blog — 个人技术博客

欢迎来到我的个人博客项目！本站主要记录 Linux、嵌入式硬件及计算机日常学习笔记。

🔗 **线上访问地址**：[https://blog.woruo03.com](https://blog.woruo03.com)

---

## 🛠 技术架构速览

本博客采用现代化的静态网站架构，零服务器维护成本，极速且安全：

```mermaid
flowchart LR
    A["1. 本地撰写<br/>Markdown 文章"] --> B["2. 本地实时预览<br/>hugo server -D"]
    B --> C["3. 提交推送<br/>git push origin main"]
    C --> D["4. GitHub 仓库<br/>woruo03/blog"]
    D -->|自动触发构建| E["5. Cloudflare Pages<br/>全球 CDN 分发"]
    E --> F["6. 读者访问<br/>blog.woruo03.com"]
```

- **生成引擎**：[Hugo](https://gohugo.io/) Extended (极速静态构建)
- **前端主题**：[Blowfish](https://blowfish.page/) (Tailwind CSS，支持深色模式、智能大纲目录、专注阅读模式、KaTeX 公式与代码复制)
- **部署平台**：[Cloudflare Pages](https://pages.cloudflare.com/) (免费自动化 CI/CD，自动配置 HTTPS)
- **统计与点赞**：[Cloudflare D1](https://developers.cloudflare.com/d1/) (Serverless SQLite 边缘数据库，每日 10 万次写 / 500 万次读免费额度)
- **评论系统**：[Giscus](https://giscus.app/) (基于 GitHub Discussions，免数据库)

---

## 📖 新手日常写作与发布全流程（保姆级教程）

平时写博客只需记住 **“写文章 ➔ 本地看效果 ➔ 推送上线”** 三步！

### 第一步：新建一篇文章

推荐采用 **Page Bundle（独立文件夹）** 形式存放文章，这样每篇文章的文字和图片都收纳在一起，非常干净。

在博客根目录下打开终端，执行：

```bash
# 例如新建一篇关于 Linux 常用命令的文章（文件夹名建议用英文/拼音）
hugo new posts/linux-basic-commands/index.md
```

此时会在 `content/posts/linux-basic-commands/` 下生成一个 `index.md` 文件。

> **提示**：你也可以不用命令，直接在 `content/posts/` 目录下手动新建一个文件夹（如 `my-post`），然后在里面新建一个 `index.md` 文件。

---

### 第二步：编辑文章与插入图片

#### 1. 文章头部信息（Front Matter）详解

打开刚创建的 `index.md`，文件最顶部由两条三连横线 `---` 包裹的内容称为 **Front Matter（文章元数据）**。它是 Hugo 识别文章标题、发布日期、分类、大纲和草稿状态的“身份证”。

##### ① 极简常用模板（日常写作 90% 场景，直接复制即用）

```yaml
---
title: "我的 Linux 常用命令学习笔记" # [必填] 文章标题
date: 2026-11-13 # [必填] 发布日期 (YYYY-MM-DD)
description: "记录日常使用最频繁的 Linux 命令" # [推荐] 文章摘要，用于首页列表展示与搜索
tags: ["Linux", "学习笔记"] # [可选] 标签（支持多个）
categories: ["技术笔记"] # [可选] 分类目录
draft: false # [重要] 是否为草稿（正式发布必须为 false！）
showTableOfContents: true # [推荐] 是否在右侧显示大纲目录（推荐 true）
---
```

##### ② 全功能进阶模板（支持系列专栏连载、封面图与排版调控）

```yaml
---
title: "从零开始搭建嵌入式 Linux 开发环境"
date: 2026-11-13
lastmod: 2026-11-14 # 文章最后更新时间（网页上会标注“更新于某天”）
description: "详细记录交叉编译工具链配置与 QEMU 模拟踩坑记录"
tags: ["Linux", "嵌入式", "QEMU"]
categories: ["嵌入式实战"]
series: ["嵌入式开发实战"] # 系列专栏名称（同系列文章会自动串联）
series_order: 1 # 本篇在系列专栏中的第几篇
draft: false # 正式发布
showTableOfContents: true # 开启右侧大纲
showZenMode: true # 开启专注模式按钮（点击可折叠大纲加宽正文）
showComments: true # 是否开启文末评论区（默认 true）
featureimage: "cover.png" # 封面特色图（直接存放在同文件夹即可）
slug: "embedded-linux-setup" # 自定义文章 URL 网址后缀
---
```

##### ③ Front Matter 常用参数速查表

| 参数名                |  类型  | 推荐设置 | 说明                                                                              |
| :-------------------- | :----: | :------: | :-------------------------------------------------------------------------------- |
| `title`               | 字符串 |   必填   | 文章标题，展示在文章页面最顶部、首页卡片及浏览器标签栏。                          |
| `date`                |  日期  |   必填   | 初始创建与发布日期，推荐格式：`YYYY-MM-DD`。                                      |
| `lastmod`             |  日期  |   可选   | 最后修改日期。若修改了旧文章，加上此项会在标题下显示“更新于...”。                 |
| `description`         | 字符串 | 推荐填写 | 文章简短介绍，在文章卡片列表、社交分享卡片以及搜索结果中展示。                    |
| `tags`                |  数组  |   可选   | 标签列表，如 `["Linux", "C语言"]`，读者点击标签可查阅同主题文章。                 |
| `categories`          |  数组  |   可选   | 分类目录，如 `["学习笔记"]`。                                                     |
| `draft`               |  布尔  | `false`  | **草稿标记**。`true` 仅本地可见，`false` 才会正式推送到公网上线。                 |
| `showTableOfContents` |  布尔  |  `true`  | **右侧大纲目录开关**。长文建议 `true`；若文章简短想让正文直接居中，设为 `false`。 |
| `showZenMode`         |  布尔  |  `true`  | **专注阅读模式开关**。标题旁显示“全屏展开”按钮，读者点击可折叠大纲并加宽正文。    |
| `showComments`        |  布尔  |  `true`  | **评论区开关**。设为 `false` 可单独关闭本篇文章底部的评论区。                     |
| `series`              |  数组  |   可选   | 系列专栏名称，如 `series: ["Linux 基础系列"]`。同系列文章会自动串联展示前后篇章。 |
| `series_order`        |  数字  |   可选   | 本篇在系列专栏中的序号（如 `1`、`2`）。                                           |
| `featureimage`        | 字符串 |   可选   | 文章封面大图文件名（如 `cover.png`，直接放在文章文件夹内即可）。                  |
| `slug`                | 字符串 |   可选   | 自定义当前文章的网页链接后缀（如 `slug: "my-first-post"`）。                      |

##### ④ 核心机制深度解析

> [!IMPORTANT]
> **`draft: false` 与 `draft: true` 的本质区别**：
>
> - `draft` 即英文的 **“草稿”**。
> - 当 `draft: true` 时：文章被视为未完工草稿。Cloudflare Pages 在云端执行正式打包时会**严格忽略**所有草稿，因此哪怕你提交并推送到了 GitHub，全球访客也**绝对无法**在公网上看到这篇内容。只有在本地终端运行 `hugo server -D`（带有 `-D` 即 `--buildDrafts` 允许预览草稿）时，你自己的浏览器才能看到它。
> - 当 `draft: false` 时：文章被视为**正式定稿**。推送到 GitHub 后 Cloudflare Pages 会立即部署上线。**写完文章准备发布时，务必将 `draft` 改为 `false`！**

> [!TIP]
> **如何折叠大纲，为正文腾出更多阅读空间？**
>
> - **方式一（动态折叠与扩展）**：本博客已全局开启 **原生专注模式 (Zen Mode)**。读者阅读文章时，点击标题下方元数据栏的 **全屏展开图标（开启专注阅读）**，右侧大纲会自动折叠隐藏，且正文排版宽度会自动舒展加宽，极其适合阅读宽屏长代码和复杂表格！再次点击即可复原大纲和默认宽度。
> - **方式二（完全关闭大纲）**：如果你写的是一篇很短的随笔，不需要右侧大纲侧栏，直接在文章开头设置 `showTableOfContents: false`，右侧大纲栏将彻底消失，正文独占居中排版！

> **数学公式提示**：如果文章中包含数学公式，请在正文第一行加上这一行短代码：
> `{{</* katex */>}}`（实际写时去掉 `/* */`，写作 `{{< katex >}}`）。

---

#### 2. 如何插入本地图片

若文章需要配图：

1. 将你的图片（例如 `screenshot.png`）直接放到该文章的文件夹里（与 `index.md` 在同一层）。
2. 在 Markdown 正文里直接引用：
    ```markdown
    ![命令运行截图](screenshot.png)
    ```

图片会自动被 Hugo 识别和优化，不需要复杂的路径！

#### 3. 语法速查（不知道怎么写时）

本博客自带一篇详尽的语法展示字典，遇到想用的排版（如公式、流程图、彩色提示框等），直接查看：
📄 `content/posts/hello-world/index.md`，复制里面的语法即可。

---

### 第三步：本地实时预览（看效果）

写完文章或正在写的时候，可以在本地打开网页实时查看排版效果：

```bash
# 在博客根目录下运行
hugo server -D
```

终端会输出如下提示：

```
Web Server is available at http://localhost:1313/ (bind address 127.0.0.1)
Press Ctrl+C to stop
```

1. 打开浏览器访问：`http://localhost:1313`。
2. **实时热更新**：你每次在编辑器里按 <kbd>Ctrl</kbd> + <kbd>S</kbd> 保存文章，浏览器页面都会在 0.1 秒内**自动刷新**！
3. 预览满意后，在终端按 <kbd>Ctrl</kbd> + <kbd>C</kbd> 即可退出本地预览服务。

---

### 第四步：一键推送到网页（发布上线）

确认文章排版没有问题后，只需三条 Git 命令即可发布到全球公网：

```bash
# 1. 保存并暂存所有修改
git add .

# 2. 记录本次更新内容（写清楚这次更新了什么）
git commit -m "发布新文章：Linux 常用命令学习笔记"

# 3. 推送到 GitHub 仓库
git push
```

**推送后发生了什么？**

- GitHub 收到你的最新代码后，会自动通知 Cloudflare Pages。
- Cloudflare Pages 会在 1 分钟左右自动完成重新编译和 CDN 缓存刷新。
- 打开你的博客网址 **[https://blog.woruo03.com](https://blog.woruo03.com)**，刷新一下就能看到新文章已上线！🎉

---

## ⚙️ 常见操作与修改指南

### 1. 如何更换头像并同步所有图标？

1. 准备一张正方形的图片，重命名为 `avatar.png`。
2. 替换掉 `assets/img/avatar.png`。
3. 在终端运行以下一键脚本，会自动将你的新头像缩放为全套浏览器 Favicon、苹果图标和 Android Chrome 图标：
    ```bash
    python3 -c "
    import os; from PIL import Image
    with Image.open('assets/img/avatar.png') as img:
        img = img.convert('RGBA')
        img.resize((512, 512), Image.Resampling.LANCZOS).save('static/android-chrome-512x512.png')
        img.resize((192, 192), Image.Resampling.LANCZOS).save('static/android-chrome-192x192.png')
        img.resize((180, 180), Image.Resampling.LANCZOS).save('static/apple-touch-icon.png')
        img.resize((32, 32), Image.Resampling.LANCZOS).save('static/favicon-32x32.png')
        img.resize((16, 16), Image.Resampling.LANCZOS).save('static/favicon-16x16.png')
        img.resize((48, 48), Image.Resampling.LANCZOS).save('static/favicon.ico', sizes=[(16,16),(32,32),(48,48)])
    print('✓ 所有图标同步更新完毕！')
    "
    ```
4. 提交并推送到 GitHub 即可。

### 2. 如何修改“关于我”页面？

打开 `content/about/index.md`，直接修改里面的 Markdown 文字即可。

### 3. 如何修改首页作者简介与社交链接？

打开 `config/_default/languages.zh-cn.toml`：

- `headline`：头像下方的短标语。
- `bio`：自我介绍描述。
- `links`：可自由添加或修改 GitHub、邮箱、B站等链接。

### 4. 如何使用 Giscus 评论区？

博客已在 `layouts/partials/comments.html` 中配置好你的仓库 ID 和讨论区参数。若要在网页上正常接收评论，只需确保在 GitHub 开启了 Discussions：

1. 访问 GitHub 仓库页面：`https://github.com/woruo03/blog`。
2. 进入 **Settings** → 滚动到 **Features** 区域。
3. 勾选 **Discussions**。
4. 在 [GitHub Giscus App](https://github.com/apps/giscus) 安装并授权访问 `woruo03/blog` 仓库。
   开启后，读者即可在每篇文章底部通过 GitHub 账号登录留言互动！

### 5. 如何激活文章浏览量（Views）与点赞（Likes）？

博客已内置基于 **Cloudflare Pages Functions + D1 数据库** 的高性能边缘交互系统（具备防跳出真实阅读门禁、乐观 UI、跨标签页实时同步、边缘内存防刷与 WAI-ARIA 无障碍支持）。代码推送后只需在 Cloudflare 控制台进行一次性极简绑定（约 2 分钟）：

1. **新建 D1 数据库**：
    - 登录 [Cloudflare 控制台](https://dash.cloudflare.com/) → **Storage & Databases** → **D1**。
    - 点击 **Create database**，输入数据库名（如 `blog-db`），点击确认。
2. **初始化数据表**：
    - 点击进入刚创建的 `blog-db`，进入 **Console**（控制台）标签页。
    - 执行仓库中 `functions/schema.sql` 中的建表语句（程序在首次部署访问时也会自动检查并自愈创建）：
        ```sql
        CREATE TABLE IF NOT EXISTS stats (
          id TEXT PRIMARY KEY,
          views INTEGER NOT NULL DEFAULT 0,
          likes INTEGER NOT NULL DEFAULT 0,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_stats_updated_at ON stats(updated_at);

        CREATE TABLE IF NOT EXISTS stats_views_log (
          post_id TEXT NOT NULL,
          client_hash TEXT NOT NULL,
          viewed_at INTEGER NOT NULL,
          PRIMARY KEY (post_id, client_hash)
        );
        CREATE INDEX IF NOT EXISTS idx_views_log_time ON stats_views_log(viewed_at);

        CREATE TABLE IF NOT EXISTS stats_likes_log (
          post_id TEXT NOT NULL,
          client_hash TEXT NOT NULL,
          liked_at INTEGER NOT NULL,
          PRIMARY KEY (post_id, client_hash)
        );
        ```
3. **绑定到 Pages 项目**：
    - 进入 **Compute (Workers) & Pages** → 点击你的博客项目 `blog`。
    - 进入 **Settings** → **Functions** → 下滑到 **D1 database bindings**。
    - 点击 **Add binding**：
        - **Variable name（变量名）**：输入 `DB`
        - **D1 database（数据库）**：选择刚才创建的 `blog-db`
    - 保存即可。全站浏览量统计、防刷去重与点赞交互即刻全网生效！

4. **高级特性与设计亮点**：
    - **极速冷启动与 0 冗余 DDL**：运行时采用自愈式惰性捕获，生产环境 0 额外 DDL 耗时，冷启动 TTFB 降低 50~200ms。
    - **边缘内存级限流**：Worker 内存滑动窗口拦截暴击脚本，0 磁盘写入开销，节省 50% 以上 D1 每日写配额。
    - **真实阅读行为门禁**：停留达 2.5 秒且可见或滚动超 150px 才计为有效浏览，杜绝爬虫与秒关跳出虚增。
    - **乐观更新与确定性回滚**：点赞 0ms 视觉呈现、250ms 防抖归位去重、网络异常精确回退、关窗/锁屏通过 `keepalive` 同步送出。
    - **WAI-ARIA 无障碍与 0 布局抖动**：读屏活动区独立外挂、等宽数字排版（`tabular-nums`）与骨架屏保护，累积布局偏移（CLS）为 0。

---

## ❓ 常见新手排坑

1. **写了新文章在网页上找不到？**
    - 检查文章开头的 `draft:` 是否为 `true`。草稿状态下文章不会公开展示，需要改为 `draft: false`。
2. **数学公式没有渲染成漂亮的排版？**
    - 检查文章正文中是否加入了 `{{< katex >}}` 短代码声明。
3. **本地启动提示端口被占用？**
    - 运行 `hugo server -p 1314` 可以指定其他端口预览。
4. **大纲（目录）没有显示？**
    - 检查文章头部是否设置了 `showTableOfContents: true`，且文章正文至少包含两个 `## 二级标题`。

---

## 📄 许可证

- 博客文字内容采用 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh) 协议。
