---
title: "{{ replace .File.ContentBaseName "-" " " | title }}"
date: {{ now.Format "2006-01-02" }}
lastmod: {{ now.Format "2006-01-02" }}
description: "" # [推荐] 文章摘要，用于首页卡片列表、社交分享及 SEO
summary: "" # [可选] 列表展示摘要（若留空则自动回退至 description）
tags: [] # [可选] 标签列表，如 ["Linux", "网络优化"]
categories: [] # [可选] 分类目录，如 ["技术实战"]
# series: [] # [可选] 系列专栏名称，如 ["嵌入式开发实战"]
# series_order: 1 # [可选] 本篇在系列专栏中的序号
draft: true # [重要] 草稿标记（本地预览为 true，正式发布请改为 false）
showTableOfContents: true # [推荐] 是否在右侧显示大纲目录
showZenMode: true # [推荐] 是否开启标题旁专注阅读模式按钮
showComments: true # [推荐] 是否开启文末评论区
# featureimage: "https://img.woruo03.com/posts/example/cover.webp" # [可选] R2 封面图外链（有图则显、无图不显，不经构建期压缩）
# featureimagecaption: "插画来源：[画师名 / Pixiv](https://www.pixiv.net/)" # [可选] 在「设置」切换为「大图」前景封面时显示图注
# featureimageAspect: "16 / 9" # [可选] 大图模式纵横比占位（防 CLS，默认 16 / 9）
# imagePosition: "50% 20%" # [可选] 封面裁剪焦点（二次元人物推荐 50% 20% 或 top，防止裁掉头部）
# imagePositionMobile: "70% 20%" # [可选] 手机窄屏（<768px）单独的封面焦点，未填时沿用 imagePosition
# imagePositionFeature: "50% 20%" # [可选] 前景横幅（及开启卡片缩略图时）的裁剪焦点，未填时自动继承 imagePosition
# showCardFeatureImage: false # [可选] 全站卡片默认不显示封面缩略图（list.showCardFeatureImage = false），如需单篇显示可设为 true
# showHero: false # [可选] 单篇关闭顶部封面
# slug: "" # [可选] 自定义文章 URL 网址后缀
---

<!-- 若本篇包含数学公式，请取消下一行注释以引入 KaTeX 渲染引擎 -->
<!-- {{ printf "{{< katex >}}" }} -->

## 1. 概述与背景

简要介绍本文讨论的核心问题、应用场景或设计目标。

---

## 2. 核心方案与实践

### 2.1 步骤与要点

详细记录具体的实施步骤、代码示例或配置文件。

```bash
# 示例命令
```

---

## 3. 总结与延伸

归纳关键要点、注意事项、排障经验或后续探索方向。
