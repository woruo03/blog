---
title: "Fedora 45 折腾 AIC8800D80 (AX900M) USB 免驱网卡"
date: 2026-11-22
lastmod: 2026-11-22
description: "记录在 Fedora 45（Linux 7.3.4 内核）下驱动 AX900M（爱科微 AIC8800D80）免驱双模 USB 网卡的过程：从默认识别为 U 盘脱壳、设备超时断开时序、DKMS 驱动编译，到 lsusb -t 接口分流与 aic_zlp_quirk 蓝牙补丁验证。"
summary: "详细记录 AX900M（AIC8800D80）双模网卡在 Fedora 45 下从存储态脱壳、DKMS 驱动编译，到 Wi-Fi 与蓝牙正常工作的实战排障记录。"
tags:
    [
        "Linux",
        "Fedora",
        "Kernel",
        "DKMS",
        "Wi-Fi",
        "Bluetooth",
        "驱动编译",
        "硬件排障",
    ]
categories: ["技术实战"]
slug: "fedora-aic8800-wifi-bluetooth-driver-guide"
showTableOfContents: true
showZenMode: true
---

{{< katex >}}

手头这枚 USB 网卡是市面上常见的 **AX900M 双频 Wi-Fi 6 + 蓝牙 5.4 迷你网卡**（内置单天线，标称 2.4G 286Mbps + 5.8G 600Mbps，采用爱科微 AIC8800D80 芯片方案）。这类外设通常标榜“免驱”，是因为内部自带了一颗小容量闪存，插上电脑默认识别为一个只读 U 盘，方便 Windows 用户直接运行里面的安装包。

但在 Linux（以内核 `7.3.4-300.fc45.x86_64` 的 Fedora 45 为例）下插入时，系统只会把它当成 U 盘挂载。因为 AIC8800D80 至今没有合并入 Linux 主线内核，系统里既没有自动脱壳切入网卡模式的 udev 规则，也没有内置固件注入模块与 Wi-Fi 驱动（蓝牙虽能被系统自带的 `btusb` 驱动认领，但缺少固件与补丁同样无法正常通信），网卡完全无法联网。

本文记录在 Fedora 45 环境下从存储态脱壳、DKMS 驱动构建、固件加载时序，到 `lsusb -t` 接口分流（Interface 0/1 蓝牙与 Interface 2 Wi-Fi）以及 `aic_zlp_quirk` 补丁验证的排障过程。

---

## 一、 硬件工作模式与状态流转

要让这枚复合设备在 Linux 下正常工作，需要理清设备在安装驱动前后的硬件形态演变与接口分工。

### 1. 设备工作状态对照

硬件状态跃迁前后对照：

| 阶段 / 状态               | 设备类型识别                  | USB VID:PID                   | 核心交互模块 / 机制            | 系统呈现状态                                                                 |
| :------------------------ | :---------------------------- | :---------------------------- | :----------------------------- | :--------------------------------------------------------------------------- |
| **初始上电 (未装驱动)**   | USB 大容量存储 (Mass Storage) | `a69c:5721` (`Aic MSC`)       | 内核自带 `usb-storage` / SCSI  | 识别只读闪存盘 `sdb`（4.05 MB / 3.86 MiB），分区 `sdb1` 为 3.8 MB            |
| **手动/规则脱壳 (Eject)** | 块设备弹出指令                | `a69c:5721` -> 触发 eject     | `/usr/bin/eject` / SCSI 指令   | 设备注销存储形态，向 USB 总线报告固件下载态                                  |
| **固件下载态 (Firmware)** | 固件加载准备                  | `a69c:8d80` (`AIC Wlan`)      | `aic_load_fw.ko` 驱动          | 向芯片 RAM 写入微码补丁文件与蓝牙配置参数                                    |
| **工作态: 蓝牙接口**      | USB 蓝牙无线类 (Wireless)     | `368b:8d81` (**If 0 & If 1**) | 原生 `btusb` + `aic_zlp_quirk` | If 0 负责 HCI/ACL，If 1 负责 SCO 语音，注册蓝牙控制器（`8C:77:3B:XX:XX:FF`） |
| **工作态: 无线网卡**      | 厂商自定义类 (Vendor)         | `368b:8d81` (**If 2**)        | `aic8800_fdrv.ko`              | 绑定无线网络接口，对接 `cfg80211` 注册 `wlan0` 网卡                          |

### 2. 驱动安装前后的状态变化流程

设备在驱动安装前后的逻辑链路对比如下：

{{< mermaid >}}
flowchart TD
subgraph ScenarioA["场景 1: 未安装驱动（默认挂载存储，超时自动断开）"]
InsertA["网卡插入 USB 端口"] --> Enum5721A["上电枚举为 a69c:5721 (Aic MSC)"]
Enum5721A --> USBStorageA["内核原生 usb-storage 接管"]
USBStorageA --> MountDisk["生成只读磁盘 /dev/sdb (3.86 MiB, 分区 sdb1 为 3.8M)"]
MountDisk -->|手动执行 sudo eject /dev/sdb| Switch8D80["切入 a69c:8d80 (固件下载等待态)"]
Switch8D80 -.->|推测设备侧约 12 秒无握手超时，自主断开| Enum5721A
end

    subgraph ScenarioB["场景 2: 安装驱动与 aic.rules 后（全程 ~4 秒自动完成）"]
        InsertB["网卡插入 USB 端口 (t = 0.0s)"] --> Enum5721B["初始上电识别为 a69c:5721 (虚拟 U 盘存储态)"]
        Enum5721B --> UdevTrigger["usb-storage 生成 /dev/sdb 块设备"]
        UdevTrigger --> RuleAction["aic.rules 匹配 block 子系统，执行 /usr/bin/eject"]
        RuleAction --> Enum8D80["t ≈ +2.8s 脱壳重枚举为 a69c:8d80 (AIC Wlan)"]
        Enum8D80 --> LoadFW["aic_load_fw 立即灌入固件微码 (约 1 秒完成)"]
        LoadFW --> CompositeEnum["t ≈ +3.8s 固件启动，重枚举为最终工作态 368b:8d81"]
        CompositeEnum --> IF01["Interface 0/1 (蓝牙) ──▶ btusb 接管，注册蓝牙控制器并挂接 aic_zlp_quirk"]
        CompositeEnum --> IF2["Interface 2 (无线) ──▶ aic8800_fdrv 接管并注册 wlan0"]
    end
{{< /mermaid >}}

---

## 二、 初始存储态与 12 秒超时分析

### 1. 默认识别为只读存储设备

在 Fedora 45 上插入网卡后，网络和蓝牙设置中没有新设备出现。执行 `lsblk` 检查存储设备：

**插入前系统磁盘拓扑**：

```bash
❯ lsblk
NAME        MAJ:MIN RM   SIZE RO TYPE MOUNTPOINTS
sda           8:0    0 931.5G  0 disk
├─sda1        8:1    0   600M  0 part /boot/efi
├─sda2        8:2    0     2G  0 part /boot
└─sda3        8:3    0 928.9G  0 part /home
                                      /
zram0       251:0    0     8G  0 disk [SWAP]
nvme0n1     259:0    0 476.9G  0 disk
├─nvme0n1p1 259:1    0   100M  0 part
├─nvme0n1p2 259:2    0    16M  0 part
├─nvme0n1p3 259:3    0 299.3G  0 part
└─nvme0n1p4 259:4    0   583M  0 part
```

**插入网卡后**，系统磁盘列表中多出了一个 3.9MB 的只读可移动设备：

```bash
❯ lsblk
NAME        MAJ:MIN RM   SIZE RO TYPE MOUNTPOINTS
sda           8:0    0 931.5G  0 disk
├─sda1        8:1    0   600M  0 part /boot/efi
├─sda2        8:2    0     2G  0 part /boot
└─sda3        8:3    0 928.9G  0 part /home
                                      /
sdb           8:16   1   3.9M  1 disk
└─sdb1        8:17   1   3.8M  1 part
zram0       251:0    0     8G  0 disk [SWAP]
nvme0n1     259:0    0 476.9G  0 disk
├─nvme0n1p1 259:1    0   100M  0 part
├─nvme0n1p2 259:2    0    16M  0 part
├─nvme0n1p3 259:3    0 299.3G  0 part
└─nvme0n1p4 259:4    0   583M  0 part
```

通过 `lsusb` 查看 USB 总线枚举情况：

```bash
❯ lsusb
Bus 001 Device 001: ID 1d6b:0002 Linux Foundation 2.0 root hub
Bus 001 Device 003: ID 258a:010c BY Tech Gaming Keyboard
Bus 001 Device 004: ID 413c:301a Dell Computer Corp. Dell MS116 Optical Mouse
Bus 001 Device 008: ID 0bda:b711 Realtek Semiconductor Corp. RTL8188GU 802.11n WLAN Adapter (After Modeswitch)
Bus 001 Device 011: ID a69c:5721 aicsemi Aic MSC
Bus 002 Device 001: ID 1d6b:0003 Linux Foundation 3.0 root hub
Bus 002 Device 002: ID 174c:2362 ASMedia Technology Inc. ASM2364
```

> [!NOTE]
> **测试环境拓扑说明**：
>
> 1. 初期定位时，系统插有一枚 Realtek RTL8188GU（`0bda:b711`，驱动 `rtl8xxxu`）作为临时网络通信设备；新插入的爱科微网卡即为 Device 011（`a69c:5721`），位于总线 `usb 1-7`（Port 7）。
> 2. 待驱动编译完成后，测试中拔除了临时网卡，并将 AIC8800 迁移至主板直通的 `usb 1-2`（Port 2）端口，独立接管系统的无线网络与蓝牙服务。

设备被识别为 `ID a69c:5721 aicsemi Aic MSC`。内核 SCSI 日志记录了介质容量与厂商信息：

```text
[Sun Nov 22 12:56:24 2026] usb-storage 1-7:1.0: USB Mass Storage device detected
[Sun Nov 22 12:56:24 2026] scsi host4: usb-storage 1-7:1.0
[Sun Nov 22 12:56:25 2026] scsi 4:0:0:0: Direct-Access     AIC      flash            1.0  PQ: 0 ANSI: 4
[Sun Nov 22 12:56:25 2026] sd 4:0:0:0: [sdb] 7904 512-byte logical blocks: (4.05 MB/3.86 MiB)
[Sun Nov 22 12:56:25 2026] sd 4:0:0:0: [sdb] Write Protect is on
[Sun Nov 22 12:56:25 2026] sd 4:0:0:0: [sdb] Attached SCSI removable disk
```

网卡呈现为容量 7904 扇区（4.05 MB / 3.86 MiB）的只读 SCSI 闪存盘（`AIC flash`），分区 `sdb1` 为 3.8 MB。

### 2. 手动弹出与 12 秒超时重置

通过 `dmesg -T` 查看未装驱动时手动弹出与超时退回的过程：

```text
[Sun Nov 22 12:56:24 2026] usb 1-7: New USB device found, idVendor=a69c, idProduct=5721, bcdDevice= 2.00
[Sun Nov 22 12:56:24 2026] usb-storage 1-7:1.0: USB Mass Storage device detected
[Sun Nov 22 12:56:24 2026] scsi host4: usb-storage 1-7:1.0
[Sun Nov 22 12:56:25 2026] sd 4:0:0:0: [sdb] Attached SCSI removable disk
[Sun Nov 22 13:01:40 2026] usb 1-7: USB disconnect, device number 9
[Sun Nov 22 13:01:41 2026] usb 1-7: new high-speed USB device number 10 using xhci_hcd
[Sun Nov 22 13:01:41 2026] usb 1-7: New USB device found, idVendor=a69c, idProduct=8d80, bcdDevice= 1.00
[Sun Nov 22 13:01:53 2026] usb 1-7: USB disconnect, device number 10
[Sun Nov 22 13:02:12 2026] usb 1-7: new high-speed USB device number 11 using xhci_hcd
[Sun Nov 22 13:02:13 2026] usb 1-7: New USB device found, idVendor=a69c, idProduct=5721, bcdDevice= 2.00
[Sun Nov 22 13:02:14 2026] sd 4:0:0:0: [sdb] Attached SCSI removable disk
```

#### 状态流转时序：

1. **12:56:24**：网卡插入，默认以 `a69c:5721` 识别为存储设备，生成 `/dev/sdb`；
2. **13:01:40 ~ 13:01:41**：手动执行 `sudo eject /dev/sdb`，网卡收到 SCSI 弹出指令后断开设备 9，切入 `a69c:8d80`（`AIC Wlan` 固件下载态，枚举为设备 10）；
3. **13:01:53（超时断开）**：切入 `8d80` 约 12 秒后断开。此时系统尚未安装驱动，芯片在 `8d80` 状态下未收到固件，设备侧超时断开 USB 连接（`USB disconnect, device number 10`）；
4. **13:02:12 ~ 13:02:13（复位重挂）**：总线重置后，芯片重新以 `a69c:5721` 存储模式枚举（设备 11），再次挂载 `/dev/sdb`。

这也印证了场景 1 的逻辑：未装驱动时，硬件默认停留在 `5721` 存储态；即使手动弹出切入 `8d80`，也会因未加载固件而在约 12 秒后超时退回 `5721`。

---

## 三、 安装驱动（DKMS 方案）

### 1. 源码编译与安装

选用适配 Linux 7.x 内核的社区驱动仓库 `shenmintao/aic8800d80`。进入源码目录查看结构：

```bash
❯ ll
total 172K
-rw-r--r--. 1 user user 2.0K Nov 22 13:09 AGENTS.md
drwxr-xr-x. 1 user user  100 Nov 22 13:09 aicrf_test/
-rw-r--r--. 1 user user 2.8K Nov 22 13:09 aic.rules
drwxr-xr-x. 1 user user   48 Nov 22 13:09 bazzite/
-rwxr-xr-x. 1 user user 7.1K Nov 22 13:09 diagnose_bt.sh*
-rwxr-xr-x. 1 user user 7.9K Nov 22 13:09 diagnostic_build.sh*
-rw-r--r--. 1 user user  796 Nov 22 13:09 dkms.conf
drwxr-xr-x. 1 user user   14 Nov 22 13:09 drivers/
drwxr-xr-x. 1 user user  118 Nov 22 13:09 fw/
-rw-r--r--. 1 user user 7.7K Nov 22 13:09 INSTALL_ARCH.md
-rw-r--r--. 1 user user 3.0K Nov 22 13:09 INSTALL_SCRIPT.md
-rwxr-xr-x. 1 user user  42K Nov 22 13:09 install.sh*
-rw-r--r--. 1 user user  18K Nov 22 13:09 LICENSE
-rw-r--r--. 1 user user 3.0K Nov 22 13:09 OPENWRT.md
-rw-r--r--. 1 user user  11K Nov 22 13:09 README.md
-rw-r--r--. 1 user user  42K Nov 22 13:09 release_note.txt
drwxr-xr-x. 1 user user  132 Nov 22 13:09 tests/
-rwxr-xr-x. 1 user user 7.8K Nov 22 13:09 uninstall.sh*
drwxr-xr-x. 1 user user   18 Nov 22 13:09 usb_modeswitch/
```

直接以 root 权限运行安装脚本：

```bash
sudo ./install.sh
```

**在 Fedora 45 下的安装输出**：

```text
╔════════════════════════════════════════════════════════════════╗
║ AIC8800D80 WiFi 6 Driver - Universal Installer (DKMS)          ║
║ Version 2.0.4 (Fixed)                                          ║
╚════════════════════════════════════════════════════════════════╝

==> Checking Secure Boot status...
[SUCCESS] Secure Boot is disabled or not present.

==> Detecting package manager and distribution...
[SUCCESS] Detected: Fedora/RHEL (dnf)

==> Installing dependencies...
[INFO] Installing: dkms make gcc mokutil util-linux usb_modeswitch...
Updating and loading repositories:
Last metadata expiration check: 2:20:59 ago on 2026-11-22 02:51:07.
Repositories loaded.
Package "dkms-3.4.4-1.fc45.noarch" is already installed.
Package "make-1:4.4.1-13.fc45.x86_64" is already installed.
Package "gcc-16.2.1-3.fc45.x86_64" is already installed.
Package "mokutil-2:0.7.2-7.fc45.x86_64" is already installed.
Package "util-linux-2.42.4-1.fc45.x86_64" is already installed.
Package "usb_modeswitch-2.6.2-6.fc45.x86_64" is already installed.

Nothing to do.
[INFO] Installing kernel headers for 7.3.4-300.fc45.x86_64 and future kernels...
Updating and loading repositories:
Last metadata expiration check: 2:21:00 ago on 2026-11-22 02:51:07.
Repositories loaded.
Package "kernel-devel-7.3.4-300.fc45.x86_64" is already installed.
Package "kernel-devel-7.3.4-300.fc45.x86_64" is already installed.

Nothing to do.
[SUCCESS] Dependencies installed successfully.

==> Checking DKMS configuration...
[SUCCESS] Using /home/user/codespace/aic8800d80/dkms.conf

==> Test-building the driver for 7.3.4-300.fc45.x86_64 before replacing the existing installation...
[SUCCESS] Test build succeeded.

==> Installing firmware...
[INFO] Installing firmware for all chip variants...
[INFO] Copying aic8800 firmware to /lib/firmware/aic8800...
[INFO] Copying aic8800D80 firmware to /lib/firmware/aic8800D80...
[INFO] Copying aic8800D80N firmware to /lib/firmware/aic8800D80N...
[INFO] Copying aic8800D80X2 firmware to /lib/firmware/aic8800D80X2...
[INFO] Copying aic8800DC firmware to /lib/firmware/aic8800DC...
[INFO] Copying aic8800DLN firmware to /lib/firmware/aic8800DLN...
[SUCCESS] Firmware installed for all supported chip variants.
[INFO] Installing udev rules to /etc/udev/rules.d/aic.rules...
[SUCCESS] Udev rules installed successfully.
[INFO] If an adapter in mass-storage mode is already plugged in, unplug and replug it.
[INFO] Installing usb_modeswitch configuration to /etc/usb_modeswitch.d/1111:1111...
[SUCCESS] USB modeswitch configuration installed successfully.
[SUCCESS] Firmware installed successfully.

==> Installing driver via DKMS...
[INFO] Copying source files to /usr/src/aic8800-1.0.0...
[INFO] Adding module to DKMS...
[INFO] Building module (this may take a few minutes)...
[SUCCESS] Module built successfully.
[INFO] Installing module...
[SUCCESS] Module installed via DKMS.
[INFO] The driver will automatically rebuild after kernel updates.

==> Refreshing initramfs...
[INFO] Running dracut for the current kernel...
[SUCCESS] Initramfs refreshed successfully.

==> Loading kernel modules...
[INFO] Updating module dependencies...
[INFO] Loading aic8800_fdrv...
[SUCCESS] Wi-Fi module loaded successfully.
[INFO] Waiting for module to initialize...
[SUCCESS] Wi-Fi module is active in kernel.
[INFO] Combo adapters use the standard btusb driver when their Bluetooth interface appears.

==> Verifying installation...
[SUCCESS] DKMS module registered: aic8800/1.0.0, 7.3.4-300.fc45.x86_64, x86_64: installed
[INFO] Installed source: installed: 2026-11-22T05:12:40Z revision: 1a2ce4e
[SUCCESS] Wi-Fi kernel module is loaded.
[INFO] No Bluetooth controller is present (normal for Wi-Fi-only adapters or when no combo adapter is connected).
[INFO] Bluetooth ZLP quirk is installed but inactive (no 368b:8d81 or a69c:8d81 device present).

[INFO] Loaded AIC modules:
aic8800_fdrv 1126400 0
aic_load_fw 159744 1 aic8800_fdrv
cfg80211 1740800 3 mac80211,rtl8xxxu,aic8800_fdrv
[SUCCESS] Firmware installed for 6 chip variant(s) in /lib/firmware/
[INFO] Checking for wireless interfaces...
[INFO] Checking for Bluetooth interfaces on combo adapters...

╔════════════════════════════════════════════════════════════════╗
║ INSTALLATION COMPLETED SUCCESSFULLY!                           ║
╚════════════════════════════════════════════════════════════════╝
```

> [!NOTE]
> **Secure Boot 与模块签名告警**：
> 在实机日志中显示 `secureboot: Secure boot disabled`，因此未签名的 DKMS 模块直接加载生效。内核日志中出现的 `aic_load_fw: module verification failed: signature and/or required key missing - tainting kernel` 是 Linux 内核针对树外第三方模块的常规合规性记录（由于 `aic_load_fw` 作为底层依赖先于主驱动加载，故仅在加载首个树外模块时触发一次告警），在未开启 Secure Boot 时不会阻止模块运行。若读者环境中启用了安全启动，需导入 DKMS 生成的 MOK 证书并在开机时完成 Enroll MOK 授权。
>
> **安装脚本的设计细节**：
>
> 1. **跨发行版依赖适配**：在 Debian/Ubuntu 下脚本安装独立 `eject` 包，而在 Fedora/RHEL 下则通过 DNF 安装 `util-linux`（Fedora 将 `/usr/bin/eject` 纳入 `util-linux` 核心工具包中），确保 `aic.rules` 中的脱壳指令具备可执行依赖。
> 2. **预检编译沙箱（Pre-flight Build）**：在正式向 `/usr/src/` 写入驱动并注册 DKMS 之前，脚本先在 `/tmp/aic8800-preflight.XXXXXX` 临时沙箱中执行试编译。若遇到内核头文件缺失或编译器不兼容，脚本直接报错退出，既不会篡改系统已有驱动，也不会留下半损坏的 DKMS 记录。
> 3. **固件冲突保护与备份轮转**：脚本通过 `rpm -qf`（Debian 下为 `dpkg -S`）检测目标路径是否属于系统包管理器。若检测到用户原有非官方固件，会自动备份至 `/var/backups/aic8800-firmware-install-YYYYMMDD-HHMMSS/`，并自动维护最新两个备份版本，避免固件混用导致硬件挂死。

### 2. udev 自动脱壳规则解析

安装脚本在执行时，会自动将仓库中的规则文件部署到系统的 `/etc/udev/rules.d/aic.rules`。查看其内容：

```bash
❯ cat /etc/udev/rules.d/aic.rules
# AIC8800 USB mass-storage mode switch rules
ACTION=="add", SUBSYSTEM=="block", ENV{DEVTYPE}=="disk", KERNEL=="sd*", ATTRS{idVendor}=="a69c", ATTRS{idProduct}=="5721",  SYMLINK+="aicudisk", RUN+="/usr/bin/eject /dev/%k"
ACTION=="add", SUBSYSTEM=="block", ENV{DEVTYPE}=="disk", KERNEL=="sd*", ATTRS{idVendor}=="a69c", ATTRS{idProduct}=="5722",  SYMLINK+="aicudisk", RUN+="/usr/bin/eject /dev/%k"
ACTION=="add", SUBSYSTEM=="block", ENV{DEVTYPE}=="disk", KERNEL=="sd*", ATTRS{idVendor}=="a69c", ATTRS{idProduct}=="5723",  SYMLINK+="tendaudisk", RUN+="/usr/bin/eject /dev/%k"
ACTION=="add", SUBSYSTEM=="block", ENV{DEVTYPE}=="disk", KERNEL=="sd*", ATTRS{idVendor}=="a69c", ATTRS{idProduct}=="5724",  SYMLINK+="ugreenax900", RUN+="/usr/bin/eject /dev/%k"
ACTION=="add", SUBSYSTEM=="block", ENV{DEVTYPE}=="disk", KERNEL=="sd*", ATTRS{idVendor}=="a69c", ATTRS{idProduct}=="5725",  SYMLINK+="tendaudiskv2", RUN+="/usr/bin/eject /dev/%k"
ACTION=="add", SUBSYSTEM=="block", ENV{DEVTYPE}=="disk", KERNEL=="sd*", ATTRS{idVendor}=="a69c", ATTRS{idProduct}=="5726",  SYMLINK+="tendaudiskv3", RUN+="/usr/bin/eject /dev/%k"
ACTION=="add", SUBSYSTEM=="block", ENV{DEVTYPE}=="disk", KERNEL=="sd*", ATTRS{idVendor}=="a69c", ATTRS{idProduct}=="5727",  SYMLINK+="tendaudiskv4", RUN+="/usr/bin/eject /dev/%k"
ACTION=="add", SUBSYSTEM=="block", ENV{DEVTYPE}=="disk", KERNEL=="sd*", ATTRS{idVendor}=="a69c", ATTRS{idProduct}=="572a",  SYMLINK+="tendaudiskv5", RUN+="/usr/bin/eject /dev/%k"
ACTION=="add", SUBSYSTEM=="block", ENV{DEVTYPE}=="disk", KERNEL=="sd*", ATTRS{idVendor}=="a69c", ATTRS{idProduct}=="572c",  SYMLINK+="cudydiskv2", RUN+="/usr/bin/eject /dev/%k"
ACTION=="add", SUBSYSTEM=="block", ENV{DEVTYPE}=="disk", KERNEL=="sd*", ATTRS{idVendor}=="a69c", ATTRS{idProduct}=="572f",  SYMLINK+="aicudisk572f", RUN+="/usr/bin/eject /dev/%k"
ACTION=="add", SUBSYSTEM=="block", ENV{DEVTYPE}=="disk", KERNEL=="sd*", ATTRS{idVendor}=="a69c", ATTRS{idProduct}=="5732",  SYMLINK+="brostrendax900bt", RUN+="/usr/bin/eject /dev/%k"

# AIC8800D80 "Pandora" clone: switch 1111:1111 to its operational USB ID.
ACTION=="add", SUBSYSTEM=="usb", ENV{DEVTYPE}=="usb_device", ATTR{idVendor}=="1111", ATTR{idProduct}=="1111", ATTR{product}=="88M80*", RUN+="/bin/sh -c 'if [ -x /usr/sbin/usb_modeswitch ]; then exec /usr/sbin/usb_modeswitch -b $attr{busnum} -g $attr{devnum} -c /etc/usb_modeswitch.d/1111:1111; elif [ -x /usr/bin/usb_modeswitch ]; then exec /usr/bin/usb_modeswitch -b $attr{busnum} -g $attr{devnum} -c /etc/usb_modeswitch.d/1111:1111; fi'"
```

> [!IMPORTANT]
> **脱壳规则要点**：
>
> 1. **通过 block 层的 `eject` 触发脱壳**：规则匹配 `SUBSYSTEM=="block"`（块设备添加事件），调用 `/usr/bin/eject /dev/%k` 发送 SCSI 弹出指令触发芯片切入网卡模式，并创建 `/dev/aicudisk` 等符号链接。规则涵盖腾达（Tenda）、绿联（Ugreen AX900）、Cudy 等多个品牌的 AIC8800 设备。
> 2. **`usb_modeswitch` 的作用范围**：规则末尾的 `usb_modeswitch` 仅针对 `1111:1111`（标注为 `88M80*` 的克隆版硬件），常见的 `a69c:5721` 直接使用 `eject` 即可。

### 3. 驱动生效验证方法

驱动首次加载时打印的 `RELEASE DATE:2026_0123_5f7be68d` 是原厂 SDK 源码中写死的静态版本串，社区维护者推送更新或修改 rules 规则时该值通常保持不变。根据 `install.sh` 的实现机制，验证新驱动是否真正生效的方法如下：

```bash
# 1. 查看 install.sh 本次写入的源码快照版本（包含 git 提交短哈希）
cat /usr/src/aic8800-1.0.0/SOURCE_REVISION

# 2. 检查内存中运行的模块与刚刚编译安装到磁盘的模块 hash 是否一致
# 若两者输出的 srcversion 完全相同，证明当前内核加载的正是刚刚编译的最新模块
cat /sys/module/aic8800_fdrv/srcversion
modinfo -F srcversion aic8800_fdrv

# 3. 查看 DKMS 注册与构建状态
dkms status

# 4. 查看安装全流程日志细节
cat /var/log/aic8800-install.log
```

---

## 四、 重新插拔：固件加载与模式切换

安装驱动后重新插入网卡，系统会自动完成脱壳、固件下发与驱动绑定。从内核日志（`dmesg -T`）中可以看到网卡先后经历了设备号 17（`5721` 存储态）、18（`8d80` 固件态）和 19（`8d81` 工作态）三次枚举：

```text
[Sun Nov 22 13:56:27 2026] usb 1-2: new high-speed USB device number 17 using xhci_hcd
[Sun Nov 22 13:56:27 2026] usb 1-2: New USB device found, idVendor=a69c, idProduct=5721, bcdDevice= 2.00
[Sun Nov 22 13:56:27 2026] usb-storage 1-2:1.0: USB Mass Storage device detected
[Sun Nov 22 13:56:27 2026] scsi host4: usb-storage 1-2:1.0
[Sun Nov 22 13:56:28 2026] sd 4:0:0:0: [sdb] Attached SCSI removable disk
[Sun Nov 22 13:56:29 2026] usb 1-2: USB disconnect, device number 17
[Sun Nov 22 13:56:29 2026] usb 1-2: new high-speed USB device number 18 using xhci_hcd
[Sun Nov 22 13:56:29 2026] usb 1-2: New USB device found, idVendor=a69c, idProduct=8d80, bcdDevice= 1.00
[Sun Nov 22 13:56:30 2026] usb 1-2: USB disconnect, device number 18
[Sun Nov 22 13:56:30 2026] usb 1-2: new high-speed USB device number 19 using xhci_hcd
[Sun Nov 22 13:56:31 2026] usb 1-2: New USB device found, idVendor=368b, idProduct=8d81, bcdDevice= 1.00
```

从 `13:56:27` 识别存储态触发 `aic.rules`，到 `13:56:29` 弹出切入 `8d80`，再到 `13:56:31` 固件注入完毕枚举为 `368b:8d81`，整个过程约 4 秒。

### 1. 固件微码注入时序（设备 18）

在 `8d80` 状态下，`aic_load_fw` 驱动模块向芯片片上 SRAM 加载固件微码：

```text
[Sun Nov 22 13:56:29 2026] usb 1-2: new high-speed USB device number 18 using xhci_hcd
[Sun Nov 22 13:56:29 2026] usb 1-2: New USB device found, idVendor=a69c, idProduct=8d80, bcdDevice= 1.00
[Sun Nov 22 13:56:29 2026] Aic high speed USB device detected
[Sun Nov 22 13:56:29 2026] chip_id=7, chip_mcu_id = 1
[Sun Nov 22 13:56:29 2026] ### Upload fw_patch_table_8800d80_u02.bin fw_patch_table, size=1384
[Sun Nov 22 13:56:29 2026] ### Upload fw_adid_8800d80_u02.bin firmware, @ = 201940  size=1708
[Sun Nov 22 13:56:29 2026] ### Upload fw_patch_8800d80_u02.bin firmware, @ = 1e0000  size=32700
[Sun Nov 22 13:56:29 2026] ### Upload fw_patch_8800d80_u02_ext0.bin firmware, @ = 20b43c  size=16136
[Sun Nov 22 13:56:29 2026] aicbt_patch_table_load bt btmode[4]:5
[Sun Nov 22 13:56:29 2026] aicbt_patch_table_load bt uart_baud[4]:1500000
[Sun Nov 22 13:56:30 2026] ### Upload fmacfw_8800d80_u02.bin firmware, @ = 120000  size=358072
[Sun Nov 22 13:56:30 2026] usb 1-2: USB disconnect, device number 18
```

约 1 秒内，固件加载器完成了芯片辨识，向内存地址依次写入微码与参数文件：

1. `fw_patch_table_8800d80_u02.bin`：微码补丁表（1384 字节）；
2. `fw_adid_8800d80_u02.bin`：配置与标定微码（写入地址 `@ = 201940`，大小 1708 字节）；
3. `fw_patch_8800d80_u02.bin` & `ext0.bin`：补丁微码文件（分别写入 `@ = 1e0000` 与 `@ = 20b43c`）；
4. `aicbt_patch_table_load`：驱动补丁表载入蓝牙参数，打印 `btmode: 5` 与 `uart_baud: 1500000`；
5. `fmacfw_8800d80_u02.bin`：FullMAC 无线主体固件（写入地址 `@ = 120000`，大小 358072 字节）。

微码传输完成后芯片复位，`device number 18` 断开，并重新枚举为复合设备（Composite Device）。

### 2. 内核报错成因与蓝牙接口让渡

微码注入后，网卡作为 `device number 19` 重新接入总线，驱动握手日志如下：

```text
[Sun Nov 22 13:56:30 2026] usb 1-2: new high-speed USB device number 19 using xhci_hcd
[Sun Nov 22 13:56:31 2026] usb 1-2: New USB device found, idVendor=368b, idProduct=8d81, bcdDevice= 1.00
[Sun Nov 22 13:56:31 2026] usb_err:<aicwf_parse_usb,2144>: non WLAN interface 0: 0xe0:0x1:0x1
[Sun Nov 22 13:56:31 2026] AICWFDBG(LOGERROR)	aicwf_parse_usb err -19
[Sun Nov 22 13:56:31 2026] usb_err:<aicwf_usb_probe,2535>: failed with errno -19
[Sun Nov 22 13:56:31 2026] Bluetooth: MGMT ver 1.23
[Sun Nov 22 13:56:32 2026] rwnx_set_mac_address enter
```

在系统详细日志中，还可以看到 `aic_load_fw` 与无线驱动对 Interface 1 的探针反馈：

```text
[Sun Nov 22 13:28:22 2026] aic_load_fw 1-7:1.0: probe with driver aic_load_fw failed with error -1
[Sun Nov 22 13:28:22 2026] aic_load_fw 1-7:1.1: probe with driver aic_load_fw failed with error -1
[Sun Nov 22 13:28:22 2026] aic_load_fw 1-7:1.2: probe with driver aic_load_fw failed with error -1
[Sun Nov 22 13:28:22 2026] usb_err:<aicwf_parse_usb,2144>: non WLAN interface 1: 0xe0:0x1:0x1
[Sun Nov 22 13:28:22 2026] AICWFDBG(LOGERROR)	aicwf_parse_usb err -19
[Sun Nov 22 13:28:22 2026] usb_err:<aicwf_usb_probe,2535>: failed with errno -19
```

日志中的 `LOGERROR` 与 `errno -19` 并非驱动异常，而是多驱动协同下的端点让渡设计：

1. **`non WLAN interface 0/1: 0xe0:0x1:0x1` 与 `failed with errno -19`**：
   复合设备中 **Interface 0 与 Interface 1** 属于蓝牙标准协议类接口（类代码 `0xe0:0x01:0x01`）。无线主驱动 `aic8800_fdrv` 在遍历端点时，识别到这两个接口属于蓝牙而非 WLAN，因此主动向 USB 核心返回 `-19`（`-ENODEV`，即“此设备不属于该驱动”）。这是一种主动让渡，使系统自带的 `btusb` 驱动得以绑定并初始化蓝牙协议栈（触发 `Bluetooth: MGMT ver 1.23`）；`aic8800_fdrv` 自身则继续绑定后续的无线网卡接口（Interface 2）。
2. **`probe with driver aic_load_fw failed with error -1`**：
   此时固件已经在 `8d80` 阶段灌入芯片 SRAM，工作态 `8d81` 下无需再次加载固件，因此固件加载模块直接返回 `-1` 退出探针，避免对正常工作的硬件造成重复擦写。
3. **配置文件读取回退机制**：
   日志中出现 `aic_userconfig_8800d80.txt` 打开失败并回退到 `request_firmware`，属于驱动预设的兼容逻辑：优先尝试通过本地文件系统路径直接打开配置，未果后回退至内核标准的 `request_firmware()` 接口。

> [!CAUTION]
> **关于 `PERMISSIVE CUSTOM REGULATORY RULES` 的合规提醒**：
> 在初始化日志中，驱动输出了 `CAUTION: USING PERMISSIVE CUSTOM REGULATORY RULES`。这表明该社区驱动启用了内部相对宽松的射频规则集，跳过了 Linux 内核 CRDA（Central Regulatory Domain Agent）对具体国家代码的信道与发射功率限制。用户在实际使用中需自行注意无线电频段合规。

---

## 五、 网络与蓝牙功能实测

### 1. 复合设备接口分工（lsusb -t）

在终端执行 `lsusb -t` 查看完整的 USB 设备驱动绑定树：

```bash
❯ lsusb -t
/:  Bus 001.Port 001: Dev 001, Class=root_hub, Driver=xhci_hcd/16p, 480M
    |__ Port 002: Dev 019, If 0, Class=Wireless, Driver=btusb, 480M
    |__ Port 002: Dev 019, If 1, Class=Wireless, Driver=btusb, 480M
    |__ Port 002: Dev 019, If 2, Class=Vendor Specific Class, Driver=aic8800_fdrv, 480M
    |__ Port 005: Dev 003, If 0, Class=Human Interface Device, Driver=usbhid, 12M
    |__ Port 005: Dev 003, If 1, Class=Human Interface Device, Driver=usbhid, 12M
    |__ Port 006: Dev 004, If 0, Class=Human Interface Device, Driver=usbhid, 1.5M
/:  Bus 002.Port 001: Dev 001, Class=root_hub, Driver=xhci_hcd/9p, 20000M/x2
    |__ Port 008: Dev 002, If 0, Class=Mass Storage, Driver=uas, 5000M
```

> [!NOTE]
> **复合设备接口分工**：
>
> - **Interface 0 (`Class=Wireless`)**：HCI 控制器与 ACL 数据传输，绑定至内核自带的 `btusb`；
> - **Interface 1 (`Class=Wireless`)**：SCO 同步语音传输，同样绑定至 `btusb`；
> - **Interface 2 (`Class=Vendor Specific Class`)**：无线网络数据传输接口，绑定至编译生成的 `aic8800_fdrv` 驱动。

### 2. 无线网卡与蓝牙 MAC 地址特征

通过 `ip link` 查看生成的无线网络接口：

```bash
❯ ip link
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN mode DEFAULT group default qlen 1000
    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00
2: enp0s31f6: <NO-CARRIER,BROADCAST,MULTICAST,UP> mtu 1500 qdisc fq_codel state DOWN mode DEFAULT group default qlen 1000
    link/ether c0:25:a5:xx:xx:xx brd ff:ff:ff:ff:ff:ff
    altname enxc025a5xxxxxx
...
21: wlan0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP mode DORMANT group default qlen 1000
    link/ether 62:2b:91:xx:xx:xx brd ff:ff:ff:ff:ff:ff permaddr 8c:77:3b:xx:xx:fe
    altname wlx8c773bxxxxxx
```

查看蓝牙控制器：

```bash
❯ bluetoothctl list
Controller 8C:77:3B:XX:XX:FF fedora [default]
```

#### MAC 地址特征：

网卡的物理 MAC 地址与蓝牙控制器 MAC 地址保持连续：

- **Wi-Fi 硬件永久 MAC（`permaddr`）**：`8c:77:3b:xx:xx:fe`
- **蓝牙控制器 MAC**：`8c:77:3b:xx:xx:ff`

两者物理地址连续（`...FE` 与 `...FF`），属于双模单芯片常见的设计。

### 3. Wi-Fi 连接实测

执行扫描并连接至 5GHz 频段 AP：

```bash
# 扫描可用无线网络并连接
nmcli device wifi connect "MyWiFi_5G" password "YourSecurePassword"

# 检查当前链路状态与物理层参数
nmcli -f IN-USE,SSID,BSSID,CHAN,FREQ,RATE,SIGNAL,BARS,SECURITY device wifi
```

接口成功关联至无线热点并建立网络连接。

### 4. 蓝牙音频外设连接实测

连接蓝牙耳机 OPPO Enco Air4 Pro 测试，内核日志记录了 ZLP 启用与 AVRCP 输入设备注册：

```text
[Sun Nov 22 14:14:30 2026] aic_zlp_quirk: enabled ZLP on the first matching 8d81 ACL bulk OUT URB
[Sun Nov 22 14:14:31 2026] input: OPPO Enco Air4 Pro (AVRCP) as /devices/virtual/input/input20
```

在蓝牙传输 ACL 数据时，`aic_zlp_quirk` 模块生效，为批量 OUT 端点启用 ZLP 处理，随后系统正常识别耳机的 AVRCP 输入。

---

## 六、 常见问题与排障记录

### 1. bluetoothctl 命令行扫描瞬间退出

- **故障现象**：在终端或脚本中执行 `bluetoothctl scan on`，命令执行后瞬间返回提示符，终端没有输出任何发现的设备 MAC；若通过管道一次性倾倒命令：
    ```bash
    # 常见错误用法：一次性批量输入
    bluetoothctl << EOF
    scan on
    pair 4C:87:5D:XX:XX:XX
    trust 4C:87:5D:XX:XX:XX
    connect 4C:87:5D:XX:XX:XX
    exit
    EOF
    ```
    控制台频繁报错 `Device not available` 或配对未完成即被系统直接中断。
- **原因分析**：
    1. `bluetoothctl` 采用异步事件循环架构。单次命令行调用 `bluetoothctl scan on` 时，程序仅向 D-Bus 的 `org.bluez.Adapter1` 接口提交了 `StartDiscovery` 请求；因缺少后续阻塞参数，进程直接退出，终端无法持续捕获异步广播的 `InterfacesAdded` 设备事件。
    2. 蓝牙配对（Pairing）涉及多轮 PIN 码协商与服务发现。批量输入末尾的 `exit` 会导致客户端在底层握手事务尚未完成时提前断开通信。
- **排查与解决**：
    - 脚本化单次扫描时，使用 `--timeout` 显式限定阻塞窗口：
        ```bash
        bluetoothctl --timeout 10 scan on
        ```
    - 配对设备时，建议进入交互式 REPL 模式分步操作：
        ```bash
        bluetoothctl
        [bluetooth]# power on
        [bluetooth]# default-agent
        [bluetooth]# scan on
        # 待设备 MAC 出现后执行配对与连接
        [bluetooth]# pair 4C:87:5D:XX:XX:XX
        [bluetooth]# trust 4C:87:5D:XX:XX:XX
        [bluetooth]# connect 4C:87:5D:XX:XX:XX
        ```

### 2. 桌面状态栏显示没有蓝牙适配器

- **故障现象**：网卡驱动成功且 `bluetoothctl list` 能正常看到控制器（`Controller 8C:77:3B:XX:XX:FF`），但桌面状态栏托盘的蓝牙图标依旧显示灰色并提示 `Bluetooth: No adapters`，无法在图形界面操作。
- **原因分析**：
    - 原生桌面组件通常能实时响应 BlueZ 的 D-Bus 信号。但在某些第三方桌面扩展（如 DankMaterialShell）中，扩展在用户会话启动时初始化并缓存蓝牙适配器对象。若开机时外置蓝牙硬件尚未就绪，组件未监听到 D-Bus 上的新增适配器信号，导致前端缓存未刷新。
- **排查与解决**：
    - 首先可通过 sysfs 确认内核层是否存在蓝牙适配器接口：
        ```bash
        ls -la /sys/class/bluetooth/
        ```
    - 重启桌面前端服务以强制重新拉取 D-Bus 适配器列表：
        ```bash
        # 若使用 DankMaterialShell，重启前端服务
        dms restart

        # 若仍未显示，配合重启 bluetoothd 触发广播
        sudo systemctl restart bluetooth
        dms restart
        ```

### 3. 安装驱动后已插设备未自动切换

- **故障现象**：执行 `sudo ./install.sh` 成功安装驱动与 `/etc/udev/rules.d/aic.rules` 后，原本插在机器上的网卡依旧持续停留在 `a69c:5721` 存储形态，并未自动弹出切换为网卡。
- **原因分析**：
    1. **udev 规则依赖 `ACTION=="add"` 事件**：回顾 `aic.rules` 的声明：
        ```text
        ACTION=="add", SUBSYSTEM=="block", ENV{DEVTYPE}=="disk", ... RUN+="/usr/bin/eject /dev/%k"
        ```
        当网卡在驱动安装前就已经插入系统时，其 SCSI 块设备添加事件在开机或插入瞬间就已经消费完毕。安装驱动写入新规则文件后，内核不会针对已存在的旧块设备重新派发 `add` 事件，因此 `eject` 命令未被触发。
    2. **安装脚本的设计考量**：查看 `install.sh` 源码可以发现，脚本在部署完 udev 规则后，仅针对特定 USB 克隆设备执行了定向重触发：
        ```bash
        # 仅针对已插入的 1111:1111 重新派发 USB add 事件，避免重触发整个系统的外设
        udevadm trigger --action=add --subsystem-match=usb \
            --attr-match=idVendor=1111 --attr-match=idProduct=1111
        ```
        脚本未向 block 子系统广播全局 `udevadm trigger`，以防影响系统上其他正在读写的磁盘，因此在控制台提示：`[INFO] If an adapter in mass-storage mode is already plugged in, unplug and replug it.`。
- **排查与解决**：
    - **方法一（重新插拔，推荐）**：将网卡拔出并重新插入，产生全新的 `add` 硬件事件触发脱壳；
    - **方法二（手动弹出）**：在终端向存储节点下发指令强制脱壳：
        ```bash
        sudo eject /dev/sdb
        ```

---

## 七、 底层原理解析

### 1. 驱动程序与片上固件分工

在 AIC8800 这类 FullMAC 无线网卡中，宿主机驱动与片上微码有着明确的职责分界：

{{< mermaid >}}
flowchart LR
subgraph Host["宿主机 (Host CPU / 内核空间)"]
direction TB
NetSub["网络子系统 (cfg80211 / mac80211)"]
BlueZSub["蓝牙子系统 (BlueZ / btusb)"]
FDrv["aic8800_fdrv.ko (绑定 If 2)"]
FwLoader["aic_load_fw.ko"]
USBCore["Linux USB Core 子系统"]
FWSrc["根文件系统 /lib/firmware/aic8800*"]

        NetSub <--> FDrv
        BlueZSub <--> USBCore
        FDrv <--> USBCore
        FWSrc -->|request_firmware 读取| FwLoader
        FwLoader -->|下发 .bin 微码| USBCore
    end

    subgraph USBBus["USB 物理总线"]
        direction TB
        Control["If 0 & If 1 (btusb) / If 2 (aic8800_fdrv)"]
    end

    subgraph Device["网卡硬件 (AIC8800D80 芯片)"]
        direction TB
        MCU["片上 MCU / 微处理器"]
        SRAM["片上 SRAM (固件运行区)"]
        RF["无线射频前端"]

        MCU <--> SRAM
        MCU <--> RF
    end

    USBCore <--> USBBus
    USBBus <--> MCU
{{< /mermaid >}}

- **驱动程序（`.ko`，例如 `aic8800_fdrv.ko`）**：
    - 存放在宿主机 `/lib/modules/$(uname -r)/extra/` 目录，运行在 **宿主机 CPU 内核态**；
    - 职责是向上对接 Linux 网络协议栈接口（`net_device`、`cfg80211`），向下将网络数据封装为 URB 请求块经由 USB 物理总线分发。
- **固件微码（`.bin`，存放在 `/lib/firmware/aic8800*`）**：
    - 运行在 **网卡芯片内部的片上微处理器（MCU）** 之上；
    - 职责是处理物理层射频控制与底层报文收发；
    - **加载时序**：网卡断电后片上 RAM 数据不保留。通电后必须由 `aic_load_fw.ko` 通过内核 `request_firmware()` 接口将微码注入 SRAM，芯片才拥有网络通信能力。

### 2. 内核升级时的 DKMS 自动重编机制

在 Fedora 系统中，内核通过 DNF 频繁升级时，DKMS 通过以下机制保证驱动连续可用：

1. **源码常驻**：源码被注册在 `/usr/src/aic8800-1.0.0/`，受 `dkms.conf` 规范声明。
2. **内核安装钩子（Hook）**：当通过 `dnf update` 安装新内核时，RPM 安装后事务会触发 `/usr/bin/kernel-install`。
3. **钩子调度**：`/usr/bin/kernel-install` 遍历执行 `/usr/lib/kernel/install.d/` 目录下的钩子脚本，其中包含 **`40-dkms.install`**。
4. **静默构建与打包**：`40-dkms.install` 调用 `dkms autoinstall -k <NEW_KERNEL_VERSION>`，在新内核头文件目录下静默完成模块编译，并通知 `dracut` 将新模块打包入 `initramfs`。

> [!IMPORTANT]
> **DKMS 的维护边界**：
> DKMS 仅跟踪**本地安装的内核版本变化**。如果上游社区驱动本身更新修复了 Bug，DKMS 不会自动执行 `git pull`。开发者仍需手动进入驱动目录拉取最新代码，并重新执行 `sudo ./install.sh` 覆盖升级。

### 3. 蓝牙 ACL ZLP 补丁机制

在实机日志中，内核输出了补丁触发记录：

```text
[Sun Nov 22 14:14:30 2026] aic_zlp_quirk: enabled ZLP on the first matching 8d81 ACL bulk OUT URB
[Sun Nov 22 14:14:31 2026] input: OPPO Enco Air4 Pro (AVRCP) as /devices/virtual/input/input20
```

#### 传输定界与边界挂起成因

USB 规范规定，在批量传输（Bulk Transfer）中，数据流按照数据包拆分，每个包最大不能超过端点声明的 `wMaxPacketSize`（高速 USB 通常为 512 字节）。

当主机向网卡内部蓝牙控制器发送一段不定长的数据时，接收端如何判断事务结束？

- **短包（Short Packet）机制**：只要收到的数据包大小**小于** `wMaxPacketSize`，接收端即认定这一笔传输（Transaction）结束，立即呈递给上层固件处理；
- **边界挂起问题**：如果某一次蓝牙 ACL 数据帧的总字节数，**恰好是 `wMaxPacketSize` 的整数倍**，发送端传出的每一个包都等于最大包长。接收端控制器在读满最大包长后，无法判定后面是否仍有数据，其硬件 FIFO 状态机将持续等待，直到超时崩溃。

#### 基于 Kprobes 的动态挂接实现

早期社区方案通常采用重编译并替换内核原生 `btusb.ko`（或维护树外 `aic_btusb` 驱动）的方式，跨内核版本维护成本较高。

在当前的 `shenmintao/aic8800d80` 实现中：

1. **清理历史遗留配置**：`install.sh` 自动清理 `/etc/modprobe.d/` 中旧版 `aic_btusb` 配置，并卸载早期测试性的 DKMS 诊断包，让蓝牙回归标准 `btusb` 驱动。
2. **基于 Kprobes 动态挂接**：`aic_zlp_quirk` 模块利用内核的 Kprobes 探针机制（依赖 `CONFIG_KPROBES`），在运行时动态拦截 `btusb` 的 URB 提交函数。该模块仅对硬件 VID:PID 为 `368b:8d81` 或 `a69c:8d81` 的设备生效，为其 ACL Bulk OUT 端点追加 `URB_ZERO_PACKET` 标志位，无需修改磁盘上的内核文件。

#### 运行时状态观测与计数核验

在日常使用中，读者可以通过 sysfs 接口实时读取该补丁的探针挂接入口与零长度包注入计数：

```bash
# 查看当前补丁挂接的内核符号入口（Hook）
cat /sys/module/aic_zlp_quirk/parameters/hook

# 查看内核运行至今，补丁已成功追加注入的 ZLP 包总数（Injections）
cat /sys/module/aic_zlp_quirk/parameters/injections
```

当蓝牙音频外设进行高吞吐 ACL 音频数据传输时，每当数据总长命中 512 字节整倍数边界，`injections` 计数器就会实时累加。这为验证蓝牙传输稳定性提供了透明、量化的内核级观测窗口。

---

## 结语

驱动 AIC8800D80 这类“免驱”网卡，核心在于理清 USB 存储形态到网卡形态的脱壳逻辑，以及固件加载与多接口让渡的时序。配合 DKMS 与 udev 规则，可以在新内核环境下实现即插即用；而在遇到蓝牙外设卡顿或数据传输挂起时，ZLP 补丁与 sysfs 注入计数器则提供了直接的排障与观测途径。

---

## 参考与致谢

- 社区驱动仓库：[shenmintao/aic8800d80 - GitHub](https://github.com/shenmintao/aic8800d80)
- Linux 内核文档：[Dynamic Kernel Module Support (DKMS) - ArchWiki](https://wiki.archlinux.org/title/Dynamic_Kernel_Module_Support)
- USB-IF 协议规范：[Universal Serial Bus Specification Revision 2.0 (Bulk Transfers & ZLP)](https://www.usb.org/document-library/usb-20-specification)
- Fedora 内核安装规范：[Fedora Kernel Install Framework and Dracut Hooks](https://fedoraproject.org/wiki/Kernel)
