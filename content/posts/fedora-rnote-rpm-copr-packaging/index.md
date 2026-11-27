---
title: "Fedora 45 从零打包 Rnote v0.14.2 并发布到 Copr"
date: 2026-11-27
lastmod: 2026-11-27
description: "记录在 Fedora 45 上从零打包 Rnote v0.14.2 的完整流程：离线 Rust vendor 依赖、rnote.spec 编写、mock 本地沙盒构建、发布到 Fedora Copr，以及相对原教程的几处踩坑修正。"
summary: "在 Fedora 45 上将 Rnote v0.14.2 打包为 RPM 并发布到 Copr 的完整步骤与踩坑记录，方便后续版本升级复用。"
tags: ["Linux", "Fedora", "RPM", "Copr", "Rust", "Rnote"]
categories: ["技术实战"]
slug: "fedora-rnote-rpm-copr-packaging"
draft: false
showTableOfContents: true
showZenMode: true
---

本文记录在 **Fedora 45** 上从零打包 **Rnote v0.14.2**（`0.14.2-1`）并发布到 Fedora Copr 的完整流程，同时整理了参考原教程操作时遇到的几处问题与修正方法，方便后续升级新版本时直接复用。

---

## 一、 完整实战流程

### 1. 准备本地打包环境

首先安装 RPM 打包、隔离构建与 Copr 发布所需的基础工具：

```bash
sudo dnf install -y rpm-build rpmdevtools mock copr-cli curl tar zstd
```

如果本机已经通过 `rustup` 管理工具链，就不需要再用 `dnf` 安装 `rust` 和 `cargo`——在宿主机上多装一套反而多余，还会占用约 300 MiB 空间。如果宿主机还没有安装 Rust 工具链，则在上面的 `dnf install` 命令末尾补上 `rust cargo`（后续宿主机需要运行 `cargo vendor`）。而在 `mock` 或 Copr 的隔离沙盒里编译时，系统会自动安装官方版工具链。

接着在任意目录下初始化 RPM 打包目录树，并为当前用户配置免 `sudo` 运行 `mock` 的权限：

```bash
# 创建标准的 ~/rpmbuild 目录结构（SOURCES、SPECS、SRPMS、RPMS 等）
rpmdev-setuptree

# 将当前用户加入 mock 组，后续才能用 mock 做本地干净测试
sudo usermod -aG mock "$USER"
newgrp mock
```

### 2. 下载源码并生成离线 Rust 依赖

由于 `mock` 和 Copr 构建环境默认断网，Rust 项目的依赖需要提前通过 `cargo vendor` 下载并打包。先下载源码并拉取全部依赖（需要联网）：

```bash
# 下载 v0.14.2 源码包到 ~/rpmbuild/SOURCES/
cd ~/rpmbuild/SOURCES
curl -L -o rnote-0.14.2.tar.gz \
  https://github.com/flxzt/rnote/archive/refs/tags/v0.14.2.tar.gz

# 解压到临时目录并拉取所有 Rust 依赖（需要联网）
mkdir -p /tmp/rnote-vendor-work
tar -xf rnote-0.14.2.tar.gz -C /tmp/rnote-vendor-work
cd /tmp/rnote-vendor-work/rnote-0.14.2

# 生成 vendor 目录（把 crates.io 和 Git 依赖全部下载到本地）
cargo vendor vendor
```

运行完成后，**保存终端末尾输出的完整 `.cargo/config.toml` 片段**。以后升级新版本时，如果 Git 依赖或对应 commit 发生变化，需要以当次输出为准。

随后将 `vendor/` 压缩进 `~/rpmbuild/SOURCES/` 并清理临时工作目录：

```bash
# 将 vendor 目录压缩为 zst 包放进 ~/rpmbuild/SOURCES/
tar --zstd -cf ~/rpmbuild/SOURCES/rnote-0.14.2-vendor.tar.zst vendor

# 清理临时目录
rm -rf /tmp/rnote-vendor-work
```

### 3. 编写 `~/rpmbuild/SPECS/rnote.spec`

打包规则集中在 `~/rpmbuild/SPECS/rnote.spec`，核心结构分为五个部分：

1. **头部元数据与 `BuildRequires`**：声明包名、版本（`0.14.2-1`）、源码与 `vendor` 包来源以及构建依赖。
2. **`%prep`**：解压源码和 `vendor` 依赖包，去掉 `.rs` 文件的可执行权限，并写入 `.cargo/config.toml`。
3. **`%build`**：通过 `meson` 配合 `cargo` 执行离线编译。
4. **`%install`**：安装编译产物与多语言文件。
5. **`%files` 与 `%changelog`**：声明打进 `.rpm` 的所有文件并记录版本变更。

实际编写时，在原教程基础上做了几处关键调整（具体原因见下文对比表）：

- 写入 `.cargo/config.toml` 时，除了 `crates-io`，还需要补上 `cargo vendor` 输出的 `git+https://github.com/LaurenzV/hayro?rev=...` 重定向配置。
- 在 `%prep` 的 `%autosetup` 之后加上权限清理，去除 `vendor` 中 Rust 源码文件的可执行位：

```bash
find vendor -type f -name '*.rs' -exec chmod -x {} +
```

- `%files` 中的桌面图标路径改为通配 `apps/*rnote*`，并补充缩略图生成器配置 `%{_datadir}/thumbnailers/rnote.thumbnailer`。
- `%changelog` 的版本标题行必须以 `*` 开头：

```rpm-spec
* Fri Nov 27 2026 woruo03 <woruo03@gmail.com> - 0.14.2-1
```

### 4. 生成 SRPM 并在本地 `mock` 隔离验证

先生成只包含 `.spec`、源码包和 `vendor` 依赖包的 SRPM：

```bash
rpmbuild -bs ~/rpmbuild/SPECS/rnote.spec
```

命令执行后会在 `~/rpmbuild/SRPMS/` 下生成 `rnote-0.14.2-1.fc45.src.rpm`。随后在 Fedora 45 的 `mock` 沙盒中试编，验证离线构建是否能够顺利通过：

```bash
mock -r fedora-45-x86_64 ~/rpmbuild/SRPMS/rnote-0.14.2-1.*.src.rpm
```

编译通过后，可以直接把产物安装到本机实测能否正常启动与使用：

```bash
sudo dnf install /var/lib/mock/fedora-45-x86_64/result/rnote-0.14.2-1.fc45.x86_64.rpm
```

### 5. 发布到 Fedora Copr 并清理本地缓存

在 Fedora Copr 新建名为 `rnote` 的项目：

- 勾选目标 Chroot（如 `fedora-45-x86_64`）；
- `External Repositories` 以及第 3、4 项保持默认；
- `Instructions` 填入安装说明：

```bash
sudo dnf copr enable woruo03/rnote && sudo dnf install rnote
```

提交构建时只需要上传前面生成的 `.src.rpm` 文件。网页端可通过 **Builds → New Build → Upload** 上传；如果使用命令行，先将 Copr 网页 **API** 页面中的凭证保存到 `~/.config/copr`，再执行：

```bash
copr-cli build --timeout 18000 rnote ~/rpmbuild/SRPMS/rnote-0.14.2-1.*.src.rpm
```

确认不再需要本地构建沙盒后，可以清理 `/var/lib/mock` 和 `/var/cache/mock` 释放磁盘空间（不会影响已经安装的 Rnote 和 `~/rpmbuild/` 目录）：

```bash
mock -r fedora-45-x86_64 --scrub=all
```

---

## 二、 对比原教程的实战修正

这次打包过程中，对照原教程修改了以下几处配置与脚本细节：

| 环节                 | 原教程写法                                       | 实际踩坑 / 原因                                                                                               | 最终改法                                                                          |
| :------------------- | :----------------------------------------------- | :------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------- |
| 安装工具             | `dnf install ... rust cargo`                     | 本地已有 `rustup`，再装 `dnf` 版多余且占 300 MiB                                                              | 跳过 `rust cargo`，宿主机沿用 `rustup`，沙盒由 `mock` 自动装                      |
| `.cargo/config.toml` | 只替换 `crates-io`                               | Rnote v0.14.2 额外依赖了 GitHub 上的 `hayro` 仓库，断网会失败                                                 | 补上 `cargo vendor` 输出的 `git+https://github.com/LaurenzV/hayro?rev=...` 重定向 |
| `%prep` 权限处理     | 无                                               | `vendor/brotli-decompressor/*.rs` 自带 `+x` 权限，触发 `brp-mangle-shebangs` 把 `#![no_std]` 误判为坏 shebang | `%autosetup` 后加 `find vendor -type f -name '*.rs' -exec chmod -x {} +`          |
| `%files` 文件清单    | `apps/com.github.flxzt.rnote*`，且无 thumbnailer | 实际图标名为 `rnote.svg` / `rnote-symbolic.svg`，且多装了缩略图配置                                           | 改为 `apps/*rnote*`，并补上 `%{_datadir}/thumbnailers/rnote.thumbnailer`          |
| `%changelog` 语法    | `- Fri Nov 27 2026 ...`                          | RPM 强制要求版本记录标题行以 `*` 开头                                                                         | 改为 `* Fri Nov 27 2026 woruo03 <woruo03@gmail.com> - 0.14.2-1`                   |

---

## 三、 后续升级新版本

以后 Rnote 发布新版本（例如 v0.15.0）时，基本只要重跑第 2 步更新源码包与 `vendor` 依赖，同步修改 `rnote.spec` 里的 `Version`、`%changelog` 和 `.cargo/config.toml` 片段，再走一遍第 4 步本地 `mock` 验证和第 5 步 Copr 上传即可。
