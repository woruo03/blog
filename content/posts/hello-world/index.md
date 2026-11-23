---
title: "Markdown 语法与博客功能展示大全"
date: 2026-11-13
lastmod: 2026-11-13
description: "本文涵盖 Markdown 标准排版语法与 Blowfish 主题扩展组件，可作为日常撰写博文的查阅手册与模板字典。"
summary: "包含标题、排版、列表、表格、代码块、KaTeX 公式、Mermaid 图表、GitHub Alerts 及 Blowfish 短代码等全功能展示。"
tags: ["Markdown", "语法手册", "Hugo", "Blowfish"]
categories: ["使用教程"]
series: ["博客指南"]
slug: "syntax-showcase"
aliases: ["/posts/hello-world/"]
showTableOfContents: true
---

{{< katex >}}

欢迎阅读本篇**语法展示大全**！本页面收录了博客支持的全部 Markdown 标准排版以及 Blowfish 进阶组件，方便你在平时撰写博文时随时查阅、复制和参考。

---

## 1. 标题分级体系

Markdown 支持 6 级标题，本博客会自动在右侧大纲（TOC）中索引 2 级到 4 级标题：

# 一级标题 (H1)

## 二级标题 (H2)

### 三级标题 (H3)

#### 四级标题 (H4)

##### 五级标题 (H5)

###### 六级标题 (H6)

---

## 2. 文本基本排版

- **粗体强调**：`**这里是粗体**` 显示为 **这里是粗体**
- _斜体强调_：`*这里是斜体*` 显示为 _这里是斜体_
- _**粗斜体**_：`***粗斜体混合***` 显示为 _**粗斜体混合**_
- ~~删除线~~：`~~这段内容已过时~~` 显示为 ~~这段内容已过时~~
- `行内代码`：`` `int a = 10;` `` 显示为 `int a = 10;`
- <mark>文本高亮</mark>：`<mark>关键要点高亮</mark>` 显示为 <mark>关键要点高亮</mark>
- 键盘快捷键：`<kbd>Ctrl</kbd> + <kbd>C</kbd>` 显示为 <kbd>Ctrl</kbd> + <kbd>C</kbd>
- 上标与下标：X<sup>2</sup> 与 H<sub>2</sub>O （使用 `<sup>` 和 `<sub>` 标签）

---

## 3. 列表形式

### 3.1 无序列表

- 操作系统
    - Linux
        - Ubuntu / Debian
        - Fedora / Arch
    - macOS
- 编程语言
    - C / C++
    - Python
    - Rust

### 3.2 有序列表

1. 打开终端
2. 克隆博客仓库
3. 运行 `hugo server -D`
4. 在浏览器预览效果

### 3.3 交互式任务清单 (Task Lists)

- [x] 安装 Hugo Extended 引擎
- [x] 配置 Blowfish 模块化配置
- [x] 开启优雅的右侧大纲目录（TOC）
- [ ] 撰写你的第一篇原创学习笔记
- [ ] 享受沉浸式写作的乐趣

---

## 4. 表格排版 (对齐方式)

Markdown 表格支持冒号 `:` 定义内容对齐方式：

| 命令名称 (左对齐) | 常用参数 (居中)  |  默认端口/作用 (右对齐) | 说明                 |
| :---------------- | :--------------: | ----------------------: | :------------------- |
| `hugo server`     |  `-D` (含草稿)   | `http://localhost:1313` | 本地实时热更新预览   |
| `hugo`            | `--gc --minify`  |        输出至 `public/` | 生产环境全量编译打包 |
| `git status`      |        无        |          显示工作区状态 | 检查修改或新增的文件 |
| `git push`        | `-u origin main` |         GitHub / Remote | 推送代码触发自动部署 |

---

## 5. 引用与折叠块

### 5.1 标准引用

> “好记性不如烂笔头，记录是思维深化的最好方式。”
>
> —— 无名技术人

### 5.2 嵌套引用

> 第一层引用内容
>
> > > 第二层嵌套引用内容

### 5.3 原生折叠内容块 (Details / Summary)

<details>
<summary>👉 点击展开查看隐藏的代码解析或长文本</summary>

这里是默认折叠的内容区域。适合放置很长的日志输出、备选方案说明或者参考答案，避免影响页面整体排版。

```bash
# 例如很长的系统诊断输出
uname -a
dmesg | head -n 10
```

</details>

---

## 6. 彩色提示框 (GitHub 风格 Alerts)

Blowfish 主题原生深度集成 GitHub 风格 Admonition 提示框，支持标准展示与可折叠模式：

> [!NOTE]
> **提示 (Note)**：这是基础信息提示框，适合补充背景说明或注意事项。

> [!TIP]
> **技巧 (Tip)**：按下键盘快捷键 `⌘K`（Windows / Linux 为 `Ctrl+K`）可以随时呼出全局即时搜索。

> [!IMPORTANT]
> **重要 (Important)**：日常写作中，若图片只属于某一篇文章，推荐将图片直接存放在该文章的文件夹中。

> [!WARNING]
> **警告 (Warning)**：操作硬件寄存器或修改系统配置前，请务必核对地址映射并做好备份。

> [!CAUTION]
> **危险 (Caution)**：执行 `rm -rf` 等破坏性命令时必须反复确认路径，避免误删重要数据。

### 可折叠的提示框

带有 `+` 或 `-` 的标识可以让提示框支持折叠收起：

> [!NOTE]+ 可折叠提示框（默认展开）
> 这是一个默认展开的折叠提示框，读者点击标题栏可以将其收起。

> [!TIP]- 可折叠技巧框（默认收起）
> 这是一个默认收起的折叠框，点击右侧小箭头即可展开查看内部技巧。

---

## 7. 代码语法高亮 (Chroma + Tailwind)

所有代码块右上角均自带**一键复制**按钮：

### 7.1 C 语言示例

```c
#include <stdio.h>
#include <stdlib.h>

// 经典 Hello World
int main(void) {
    printf("Hello, Linux and Embedded World!\n");
    return EXIT_SUCCESS;
}
```

### 7.2 Python 示例

```python
def fibonacci(n: int) -> list[int]:
    """生成前 n 个斐波那契数"""
    if n <= 0:
        return []
    fibs = [0, 1]
    while len(fibs) < n:
        fibs.append(fibs[-1] + fibs[-2])
    return fibs[:n]

if __name__ == "__main__":
    print(fibonacci(8))
```

### 7.3 Bash 脚本示例

```bash
#!/usr/bin/env bash
# 查看系统基本资源状态
echo "=== 系统内核 ==="
uname -srm
echo "=== 内存占用 ==="
free -h
```

### 7.4 配置文件 (TOML / JSON)

```toml
# config/_default/params.toml 示例
colorScheme = "ocean"
defaultAppearance = "dark"
enableSearch = true
```

---

## 8. 数学公式排版 (KaTeX)

通过引入 `{{</* katex */>}}`，页面即可自动解析数学公式。

### 8.1 行内公式

欧拉恒等式 \(e^{i\pi} + 1 = 0\) 被誉为数学界最优雅的方程。

二次方程求根公式为 \(x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}\)。

### 8.2 块级居中公式

高斯正态分布密度函数：

$$
f(x) = \frac{1}{\sigma \sqrt{2\pi}} \exp\left( -\frac{(x - \mu)^2}{2\sigma^2} \right)
$$

定积分与级数求和：

$$
\int_{-\infty}^{+\infty} e^{-x^2} \, dx = \sqrt{\pi}, \quad \sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
$$

线性代数矩阵表示：

$$
\mathbf{R}(\theta) = \begin{bmatrix}
\cos\theta & -\sin\theta \\
\sin\theta & \cos\theta
\end{bmatrix}
$$

---

## 9. 架构与流程图 (Mermaid)

无需安装任何插件，使用 `{{</* mermaid */>}} ... {{</* /mermaid */>}}` 短代码即可直接绘制动态矢量图：

### 9.1 流程图 (Flowchart)
{{< mermaid >}}
graph TD
A["本地写文章 (Markdown)"] --> B["hugo server -D 本地实时预览"]
B -->|检查排版满意| C["git commit -m '新文章'"]
C --> D["git push 推送到 GitHub"]
D --> E["Cloudflare Pages 自动构建"]
E --> F["全球 CDN 访问 blog.woruo03.com"]
{{< /mermaid >}}

### 9.2 时序图 (Sequence Diagram)
{{< mermaid >}}
sequenceDiagram
autonumber
actor User as 读者
participant Browser as 浏览器
participant CF as Cloudflare Pages
participant Giscus as Giscus 评论服务

    User->>Browser: 打开博文页面
    Browser->>CF: 请求静态资源 (HTML/CSS/JS)
    CF-->>Browser: 返回极速缓存页面
    Browser->>Giscus: 异步加载 GitHub Discussions
    Giscus-->>Browser: 渲染评论列表与表情反应
{{< /mermaid >}}

### 9.3 状态机图 (State Diagram)
{{< mermaid >}}
stateDiagram-v2
    [*] --> Draft : 撰写初稿 (draft: true)
    Draft --> Review : 本地预览排版
    Review --> Published : 去掉 draft 标签并发布
    Published --> [*]
{{< /mermaid >}}

---

## 10. Blowfish 主题扩展组件 (Shortcodes)

Blowfish 提供了一系列优雅的前端组件，丰富你的文章表达：

### 10.1 徽章组件 (Badge)

你可以使用徽章标记版本或分类：

- 状态徽章：{{< badge >}}Stable v1.0{{< /badge >}}
- 分类标签：{{< badge >}}Linux 笔记{{< /badge >}} {{< badge >}}嵌入式{{< /badge >}}

### 10.2 自定义提示框 (Alert Shortcode)

除了 GitHub 风格外，主题自带的标准 Alert：
{{< alert icon="fire" >}}
这是一个使用 alert 短代码（`icon="fire"`）创建的高亮警示框，带有火焰图标。
{{< /alert >}}

### 10.3 按钮链接 (Button)

为文章中的外部下载或跳转创建醒目的按钮：

{{< button href="https://github.com/woruo03/blog" target="_blank" >}}
前往 GitHub 查看本站源码
{{< /button >}}

### 10.4 多平台标签页 (Tabs)

撰写跨发行版或不同协议对比教程时，可用 `tabs` + `tab` 精简篇幅：

{{< tabs >}}
{{< tab label="Fedora" >}}
```bash
sudo dnf install hugo
```
{{< /tab >}}
{{< tab label="Ubuntu / Debian" >}}
```bash
sudo apt install hugo
```
{{< /tab >}}
{{< tab label="Arch Linux" >}}
```bash
sudo pacman -S hugo
```
{{< /tab >}}
{{< /tabs >}}

### 10.5 分步时间线 (Steps)

用 `steps` + `step` 直观串联有先后顺序的编译、部署或排障步骤：

{{< steps >}}
{{< step number="1" title="创建文章目录" >}}
运行 `hugo new posts/my-post/index.md` 创建独立 Page Bundle。
{{< /step >}}
{{< step number="2" title="本地实时预览" >}}
执行 `hugo server -D` 在浏览器检查排版与数学公式渲染。
{{< /step >}}
{{< step number="3" title="推送自动发布" >}}
将 `draft` 设为 `false` 后提交推送，Cloudflare Pages 自动完成构建上线。
{{< /step >}}
{{< /steps >}}

### 10.6 折叠问答与可折叠提示框 (Accordion & Collapsible Admonition)

长段排障 FAQ 可使用原生互斥折叠组件 `accordion`：

{{< accordion mode="collapse" separated="true" >}}
{{< accordionItem title="什么时候使用可折叠区域？" open="true" >}}
适合收纳冗长的 `dmesg` 内核日志、完整配置文件或常见问题解答，保持正文主线紧凑。
{{< /accordionItem >}}
{{< accordionItem title="能否使用纯 Markdown 语法实现折叠提示框？" >}}
可以！在 GitHub Alert 语法后追加 `-`（默认折叠）或 `+`（默认展开）即可，例如 `> [!TIP]- 标题`。
{{< /accordionItem >}}
{{< /accordion >}}

也可以直接使用纯 Markdown 的可折叠提示框语法（基于原生 `<details>`，零 JS 开销）：

> [!TIP]- 点击展开完整调试日志示例
> ```text
> [    2.418902] usb 1-3: new high-speed USB device number 4 using xhci_hcd
> [    2.561034] aic_load_fw: firmware loaded successfully
> ```

### 10.7 站内文章引用卡片与防爬虫邮箱 (Article & Email)

在正文内通过 `article` 短代码嵌入另一篇站内文章卡片：

{{< article link="/posts/gcp-always-free-dual-stack-reality/" showSummary=true >}}

使用 `email` 短代码输出 Base64 保护的邮箱链接（防止静态页面被爬虫抓取明文邮箱）：
{{< email email="woruo03@gmail.com" text="通过保护链接联系博主" subject="来自博客语法手册的反馈" >}}

### 10.8 外部仓库卡片与视频延迟加载语法参考

撰写开源工具推荐或附带视频演示时，Blowfish 原生还支持 `github`（构建期拉取仓库 Star/Fork 状态）与 `youtubeLite`（点击前仅加载缩略图，避免首屏加载第三方 iframe）：

```markdown
<!-- GitHub 开源仓库卡片（注意：构建期会请求 api.github.com，离线或触发 API 限流时注意按需使用） -->
{{</* github repo="nunocoracao/blowfish" showThumbnail=true */>}}

<!-- YouTube 延迟加载播放器（零首屏 iframe 阻塞） -->
{{</* youtubeLite id="视频ID" */>}}
```

---

## 11. 脚注与参考链接

在正文中加入参考说明可以在行尾添加脚注引用[^1]，读者点击后会自动跳转至文末参考区域[^2]。

---

## 总结

当你需要写新文章时，可以随时将本篇文章的内容作为“小抄”，直接复制对应的代码片段或短代码使用。祝你写作愉快 🎉

[^1]: 这里是第一条脚注的详细补充说明，适合放置参考资料或延伸文献链接。

[^2]: 脚注会自动按顺序编号并生成返回正文的双向跳转链接。
