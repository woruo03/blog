---
title: "基于 GCP 永久免费层的双栈代理与面板隐身配置指南"
date: 2026-11-17
lastmod: 2026-11-24
description: "详解如何基于 GCP Always Free 免费层（e2-micro + Standard 网络）构建双栈 VLESS-Reality 代理，结合 Cloudflare CDN 隐蔽 3x-ui 面板，并配合 Linux 桌面端 Mihomo TUN 模式实现高效分流与零账单运维。"
summary: "涵盖 GCP 计费规则与双栈 VPC 搭建、高延迟内核与 Zram 调优、Reality 协议与面板安全回源、Mihomo 双栈分流配置，以及 3 个典型网络黑洞与端口排障复盘。"
tags: ["GCP", "Xray", "Reality", "IPv6", "Mihomo", "Linux", "网络优化"]
categories: ["技术实战"]
slug: "gcp-always-free-dual-stack-reality"
showTableOfContents: true
featureimage: "https://img.woruo03.com/posts/gcp-always-free-dual-stack-proxy/hakurei-reimu.jpg"
---

Google Cloud Platform (GCP) 的永久免费层（Always Free）中，位于美国指定区域的 `e2-micro` 实例配合标准网络服务层级（Standard Tier），每月提供 200 GB 的免费互联网出站流量。

本文记录如何利用这项配额搭建 IPv4/IPv6 双栈代理：服务端用 Xray 的 VLESS-Reality 协议，3x-ui 面板通过 Cloudflare CDN 反代并配合 GCP 防火墙白名单隐藏源站，客户端用 Mihomo 开启 TUN 模式与故障转移。

---

## 一、 整体架构与零账单设计

### 1. 核心资源选型与配额边界

GCP 的出站网络分为 Premium（高级层级）和 Standard（标准层级）。默认的 Premium 层级通过 Google 全球骨干网传输，流向中国大陆方向按标准流量费计费；只有显式选择 Standard 层级，流量在就近的 Google POP 节点进入公网，才计入每月 200 GB 的免费出站额度。

| 体系组件   | 选型与规格                                         | 核心作用与计费考量                                                                                                           |
| :--------- | :------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| 云主机     | GCP `e2-micro`（`us-west1-b` 俄勒冈）              | 2 vCPU（共享核心）、1 GB 物理内存、30 GB 标准持久磁盘（`pd-standard`），处于 Always Free 范围内。                            |
| 网络层级   | Standard（标准层级）+ 自定义双栈 VPC               | 享有每月 200 GB 免费全球出站流量（覆盖中国大陆方向）。提供公网静态 IPv4（按小时计费，约 $0.005/hr）与免费的外部 `/96` IPv6。 |
| 代理协议   | `3x-ui` + Xray（`VLESS + TCP + Reality + Vision`） | 监听 `443` 端口直连，省去额外的 TLS 握手与证书维护，并支持抗量子密钥交换（`X25519MLKEM768`）。                               |
| 面板安全   | `8443` 端口 + Cloudflare CDN + 源站证书            | 隐藏真实源站 IP，GCP 防火墙限制仅允许 Cloudflare 官方回源 IP 访问，防止公网扫描暴露。                                        |
| 本地客户端 | Linux + Mihomo（Clash Verge Rev）                  | 开启 TUN 模式全局接管流量，配合 Fake-IP 分流与双栈节点自动健康检查故障转移。                                                 |

> [!WARNING]
> **外部 IPv4 地址是按小时计费的**
> 使用 GCP 免费层时需注意外部 IPv4 的计费规则：
>
> - **运行中按小时收费**：无论静态（Static）还是临时（Ephemeral）IP，分配给运行中虚拟机的外部 IPv4 均按 **$0.005 / 小时** 计费，一个月（按 720 小时计）约产生 **$3.60 ~ $3.65** 的固定账单。
> - **未挂载闲置费率**：如果创建了静态 IPv4 但将虚拟机停止（Stop），未绑定到运行中实例的静态 IP 会触发更高的闲置费率——**$0.010 / 小时**（约 $7.20 / 月）。如果停止实例且不再使用，务必及时释放（Release）该 IP。
> - **IPv6 不收费**：GCP 为子网分配的 `/96` 外部 IPv6 地址完全免费，不产生地址占用费。
>
> 因此在规划方案时需要明确：若需要 IPv4 + IPv6 双栈直连，每月需计入约 $3.6 的 IPv4 地址保留成本；如果追求零账单，可以仅保留外部 IPv6（纯 IPv6 实例），通过双栈 CDN 或 IPv6 原生网络连接。

### 2. 网络拓扑与流量路径

方案将代理业务流量与面板管理流量分开走不同路径：

{{< mermaid >}}
flowchart TD
subgraph ClientSide["客户端环境 (Linux Desktop)"]
App["应用程序 / 浏览器"]
Mihomo["Mihomo 内核 (TUN 接管)"]
App -->|全局网络接管| Mihomo
end

    subgraph InternetEdge["公共网络边界"]
        CF["Cloudflare CDN (WAF + 代理反代)"]
    end

    subgraph GCP["GCP 基础设施 (us-west1-b / Standard Tier)"]
        FW["GCP 虚拟防火墙 (最小权限过滤)"]

        subgraph Instance["e2-micro (Debian + Zram 压缩)"]
            Xray["Xray 核心 (TCP:443 Reality 直连)"]
            Panel["3x-ui 面板 (TCP:8443 + 源站证书)"]
        end
    end

    Mihomo -->|业务流量: 直连 TCP:443 / Vision 流控| FW
    Mihomo -.->|管理流量: 访问 panel.example.com| CF
    CF -->|安全回源: 仅放行 Cloudflare 网段| FW

    FW -->|允许访问 443| Xray
    FW -->|允许特定来源访问 8443| Panel
{{< /mermaid >}}

---

## 二、 GCP 双栈 VPC 与最小权限防火墙配置

GCP 默认创建的 `default` VPC 仅支持单栈 IPv4。若要启用外部 IPv6，必须新建自定义模式的双栈 VPC，并在防火墙层面显式放行必要的 ICMPv6 报文。

### 1. 创建双栈 VPC 与子网

在 Google Cloud Shell 或本地已认证的 `gcloud` 终端中执行以下指令：

```bash
# 1. 创建自定义模式的 VPC
gcloud compute networks create vpc-ipv6 --subnet-mode=custom

# 2. 在 us-west1（俄勒冈）区域创建双栈子网，开启外部 IPv6 访问
gcloud compute networks subnets create subnet-ipv6-west1 \
  --network=vpc-ipv6 \
  --region=us-west1 \
  --range=10.10.0.0/24 \
  --stack-type=IPV4_IPV6 \
  --ipv6-access-type=EXTERNAL
```

> [!IMPORTANT]
> 在 GCP 控制台创建 `e2-micro` 实例时，请核对以下关键选项：
>
> - **区域/可用区**：必须选择 `us-west1-b`（Always Free 涵盖区域，包含 `us-west1`、`us-central1`、`us-east1`）；
> - **机器类型**：选择 `e2-micro`；
> - **引导磁盘**：选择 Debian 12，磁盘类型选为 **标准持久磁盘（Standard Persistent Disk）**，容量设为 30 GB；
> - **网络接口**：网络选择 `vpc-ipv6`，子网选择 `subnet-ipv6-west1`；
> - **IP 堆栈类型**：选择 `IPv4 和 IPv6（双栈）`；
> - **网络服务层级**：将 IPv4 与 IPv6 的网络层级均由默认的 Premium 切换为 **Standard**；
> - **外部 IP 计费提示**：绑定的外部 IPv4 存在约 $0.005/小时的基础费用，若日后停止（Stop）实例，务必将静态 IPv4 释放掉以避免 $0.010/小时的闲置费用。

### 2. 配置双栈防火墙规则

GCP 的防火墙规则严格区分 IPv4 与 IPv6 来源地址。在添加规则时，务必通过 `--network=vpc-ipv6` 指定关联的网络，否则规则会默认附着到 `default` 网络从而失效。

```bash
# 1. 放行 SSH 管理端口 (TCP 22)
gcloud compute firewall-rules create vpc-ipv6-allow-ssh-v4 \
  --network=vpc-ipv6 --allow=tcp:22 --source-ranges=0.0.0.0/0 --direction=INGRESS
gcloud compute firewall-rules create vpc-ipv6-allow-ssh-v6 \
  --network=vpc-ipv6 --allow=tcp:22 --source-ranges=::/0 --direction=INGRESS

# 2. 放行 Reality 代理直连端口 (TCP 443)
gcloud compute firewall-rules create vpc-ipv6-allow-reality-v4 \
  --network=vpc-ipv6 --allow=tcp:443 --source-ranges=0.0.0.0/0 --direction=INGRESS
gcloud compute firewall-rules create vpc-ipv6-allow-reality-v6 \
  --network=vpc-ipv6 --allow=tcp:443 --source-ranges=::/0 --direction=INGRESS

# 3. 放行 ICMP 与 IPv6-ICMP (协议号 58)，保证路径 MTU 探测 (PMTUD) 正常
gcloud compute firewall-rules create vpc-ipv6-allow-icmp-v4 \
  --network=vpc-ipv6 --allow=icmp --source-ranges=0.0.0.0/0 --direction=INGRESS
gcloud compute firewall-rules create vpc-ipv6-allow-icmp-v6 \
  --network=vpc-ipv6 --allow=58 --source-ranges=::/0 --direction=INGRESS

# 4. 面板端口 (TCP 8443) 仅允许 Cloudflare 官方 IPv4 回源节点
gcloud compute firewall-rules create vpc-ipv6-allow-cf-panel-v4 \
  --network=vpc-ipv6 --allow=tcp:8443 --direction=INGRESS \
  --source-ranges="173.245.48.0/20,103.21.244.0/22,103.22.200.0/22,103.31.4.0/22,141.101.64.0/18,108.162.192.0/18,190.93.240.0/20,188.114.96.0/20,197.234.240.0/22,198.41.128.0/17,162.158.0.0/15,104.16.0.0/13,104.24.0.0/14,172.64.0.0/13,131.0.72.0/22"

# 5. 面板端口 (TCP 8443) 仅允许 Cloudflare 官方 IPv6 回源节点
gcloud compute firewall-rules create vpc-ipv6-allow-cf-panel-v6 \
  --network=vpc-ipv6 --allow=tcp:8443 --direction=INGRESS \
  --source-ranges="2400:cb00::/32,2606:4700::/32,2803:f800::/32,2405:b500::/32,2405:8100::/32,2a06:98c0::/29,2c0f:f248::/32"
```

---

## 三、 Debian 服务端内核与内存调优

美西（俄勒冈）到国内的物理延迟通常在 150ms ~ 180ms。此外 `e2-micro` 只有 1 GB 物理内存，搭配的 `pd-standard` 云磁盘随机 I/O 较慢，需要调整内核网络缓冲，并避免内存不足时因磁盘换页导致卡顿。

### 1. 启用 BBR 与高延迟网络 TCP 调优

在高延迟网络中，如果 TCP 发送与接收缓冲区设置过小，滑动窗口无法跑满可用带宽。以下配置将接收与发送缓冲区上限提高至 16 MB，并启用 BBR 拥塞控制：

```bash
cat << 'EOF' | sudo tee /etc/sysctl.d/98-tcp-tune.conf
# 队列调度算法与 BBR 拥塞控制
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr

# 读写缓冲区配置 (适配 1GB 内存与跨洋网络 BDP)
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
net.ipv4.tcp_mem = 65536 131072 262144

# 连接握手优化、关闭空闲慢启动与开启路径 MTU 探测
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_notsent_lowat = 16384
net.ipv4.tcp_mtu_probing = 1
net.ipv4.tcp_tw_reuse = 1

# 提升连接队列上限
net.core.somaxconn = 4096
net.core.netdev_max_backlog = 4096
EOF

sudo sysctl --system
```

### 2. 启用 Zram 内存压缩

当 1 GB 内存因网络并发不足时，如果系统将匿名内存写入底层 `pd-standard` 磁盘的 Swap 分区，会触发较高的 I/O 等待甚至假死。使用 Zram 可以在内存中划分出一块压缩块设备作为交换空间，以少量的 CPU 压缩开销避免磁盘 Swap 带来的 I/O 卡顿：

```bash
# 安装 zram-tools 工具包
sudo apt-get update && sudo apt-get install -y zram-tools

# 重启服务使配置生效
sudo systemctl restart zramswap

# 验证压缩交换分区状态
swapon --show
```

---

## 四、 部署 3x-ui、Reality 与 Cloudflare 面板防护

### 1. 安装 3x-ui 并完成初始化

通过官方脚本进行安装：

```bash
bash <(curl -Ls https://raw.githubusercontent.com/mhsanaei/3x-ui/master/install.sh)
```

安装提示中，设置面板监听端口为 `8443`，并配置一段随机的安全访问根路径（例如 `/<RANDOM_ROOT_PATH>/`）。

### 2. 配置 Cloudflare 源站证书与 CDN 反代

为了避免暴露 VPS 真实 IP，面板访问全程经由 Cloudflare CDN 反代：

1. **DNS 记录配置**：在 Cloudflare 控制台中，为面板专用子域名（如 `panel.example.com`）分别添加：
    - `A` 记录：指向 VPS 的外部 IPv4 地址；
    - `AAAA` 记录：指向 VPS 的外部 IPv6 地址；
    - 确保两条记录的代理状态均处于开启（开启橙色云朵代理）。
2. **部署源站证书**：
    - 进入 Cloudflare 控制台的 **SSL/TLS → 源服务器（Origin Server）**；
    - 点击“创建证书”，生成 15 年有效期的 Origin Certificate；
    - 将证书公钥保存至 VPS 的 `/etc/x-ui/cert.pem`，将私钥保存至 `/etc/x-ui/privkey.pem`；
    - 登录 3x-ui 网页后台的 **面板设置**，在公钥文件与密钥文件路径中填入上述绝对路径，保存并重启面板。
3. **传输协议策略配置**：
    - 在 Cloudflare 控制台将加密模式设置为 **完全（严格）/ Full (Strict)**；
    - 在 **网络（Network）** 选项中，确保开启 **WebSockets** 与 **HTTP/2 到源服务器**，以保证后台监控图表正常长连接刷新。

> [!TIP]
> 完成上述配置后，由于 GCP 防火墙已限制 8443 端口仅允许 Cloudflare 官方网段接入，任何直接探测 `https://<VPS_IP>:8443/` 的请求都会被系统防火墙静默丢弃（Drop），公网扫描无法直接探测到面板端口。

### 3. 配置 VLESS + Reality 入站与防超额配额

在 3x-ui 的 **入站列表** 中点击添加规则：

- **协议与监听**：协议选择 `vless`，监听端口填入 `443`；
- **传输配置**：选择 `tcp`；
- **流控（Flow）**：填写 `xtls-rprx-vision`；
- **安全**：选择 `reality`；
- **目标网站（Dest）与 SNI**：选择与 GCP 俄勒冈机房物理距离近且稳定支持 TLSv1.3 的站点，例如 `dl.google.com:443` 或 `www.apple.com:443`；
- **密钥生成**：点击生成按钮生成私钥（PrivateKey）、公钥（PublicKey）以及随机生成的 ShortIds；
- **Sockopt 与日志调优**：
    - 在高级设置中勾选 `TCP Fast Open` 与 `TCP No Delay`；
    - 在 **Xray 设置** 中，将 Access 访问日志设为 `none`，避免低速磁盘因持续写入连接日志消耗 I/O。
- **流量熔断配额**：
    - 将该入站节点的总流量上限设为 `180 GB`，并在每月账单日自动重置。
    - 为 Always Free 政策中的 200 GB 上限保留 20 GB 缓冲余量，防止意外超额产生扣费账单。

---

## 五、 客户端 Mihomo (Clash Verge Rev) 双栈配置

在 Linux 桌面环境（尤其是 Wayland 下）中，许多应用不遵从系统环境变量的代理设置。开启 Mihomo 的 TUN 模式可以实现网络层全局接管，并搭配 Fake-IP 与双栈节点自动测速实现故障转移。

### 1. 完整配置样例

在客户端中创建配置文件并应用：

```yaml
mixed-port: 7897
allow-lan: false
ipv6: true
mode: rule
log-level: info
unified-delay: true
tcp-concurrent: true
find-process-mode: off

dns:
    enable: true
    ipv6: true
    enhanced-mode: fake-ip
    fake-ip-range: 198.18.0.1/16
    respect-rules: true
    default-nameserver:
        - 223.5.5.5
        - 119.29.29.29
    proxy-server-nameserver:
        - https://dns.alidns.com/dns-query
        - https://doh.pub/dns-query
    direct-nameserver:
        - https://doh.pub/dns-query
        - https://dns.alidns.com/dns-query
    nameserver:
        - https://dns.cloudflare.com/dns-query#PROXY
        - https://dns.google/dns-query#PROXY
    nameserver-policy:
        "geosite:category-ads-all": rcode://success
        "geosite:cn":
            - https://doh.pub/dns-query
            - https://dns.alidns.com/dns-query

tun:
    enable: true
    stack: mixed
    auto-route: true
    auto-detect-interface: true
    strict-route: true
    dns-hijack:
        - any:53
        - tcp://any:53

proxies:
    - name: "GCP-Reality-IPv6"
      type: vless
      server: "<VPS_IPv6>"
      port: 443
      uuid: "<UUID>"
      network: tcp
      tls: true
      udp: true
      flow: xtls-rprx-vision
      servername: www.apple.com
      client-fingerprint: chrome
      ip-version: ipv6
      reality-opts:
          public-key: "<PUBLIC_KEY>"
          short-id: "<SHORT_ID>"
          support-x25519mlkem768: true

    - name: "GCP-Reality-IPv4"
      type: vless
      server: "<VPS_IPv4>"
      port: 443
      uuid: "<UUID>"
      network: tcp
      tls: true
      udp: true
      flow: xtls-rprx-vision
      servername: www.apple.com
      client-fingerprint: chrome
      ip-version: ipv4
      reality-opts:
          public-key: "<PUBLIC_KEY>"
          short-id: "<SHORT_ID>"
          support-x25519mlkem768: true

proxy-groups:
    - name: "PROXY"
      type: select
      proxies:
          - "AUTO-URLTEST"
          - "GCP-Reality-IPv6"
          - "GCP-Reality-IPv4"

    - name: "AUTO-URLTEST"
      type: url-test
      url: "https://www.gstatic.com/generate_204"
      interval: 180
      tolerance: 50
      timeout: 3000
      lazy: true
      proxies:
          - "GCP-Reality-IPv6"
          - "GCP-Reality-IPv4"

rules:
    - RULE-SET,private,DIRECT
    - DOMAIN,panel.example.com,PROXY
    - DOMAIN-SUFFIX,example.com,DIRECT
    - RULE-SET,category-ads-all,REJECT
    - RULE-SET,google,PROXY
    - RULE-SET,cn,DIRECT
    - RULE-SET,cn-ip,DIRECT
    - MATCH,PROXY
```

### 2. 关键配置解析

- `tun.stack: mixed`：混合堆栈在 Linux 环境下吞吐性能较好，`strict-route: true` 配合 `dns-hijack` 可将所有 53 端口的 DNS 查询与常规 TCP/UDP 数据导入 TUN 虚拟网卡。
- `AUTO-URLTEST` 策略组：每 180 秒探测一次 IPv4 与 IPv6 节点连通性。当 IPv6 链路出现丢包或劣化时，内核会自动切换到 IPv4 节点。
- `DOMAIN,panel.example.com,PROXY` 规则顺序：若主域名 `example.com` 配有直连规则，必须将面板子域名的 `PROXY` 规则放在它前面，确保访问面板时走代理隧道。

---

## 六、 实战部署中的 3 个典型深坑总结

在实际部署与使用中，以下 3 个网络与配置问题较为常见：

### 1. 校园网拦截 8443 端口与规则顺序配置不当

- **故障现象**：在受控网络（如部分高校校园网、企业内网）环境下，浏览器打开 `https://panel.example.com:8443/<路径>/` 界面时，页面虽然能显示框架（来自本地缓存），但所有 API 请求与 WebSocket 连接均持续报错 `NetworkError`。
- **原因分析**：部分受控网络网关配置了严格的出口端口过滤，默认拦截非标准 HTTPS 端口（如 8443）。若此时客户端的分流规则将个人主域名解析为 `DIRECT`（直连），浏览器就会尝试绕过代理直连 Cloudflare CDN 边缘节点的 8443 端口，导致握手失败。
- **解决方案**：在客户端规则链中，将面板域名单独提出来指定为 `PROXY`，且规则位置必须高于主域名的 `DIRECT`：
    ```yaml
    rules:
        - DOMAIN,panel.example.com,PROXY
        - DOMAIN-SUFFIX,example.com,DIRECT
    ```
    这样访问面板的所有请求均先通过已放行的 443 代理隧道传输至 VPS，再借由代理隧道出站访问 Cloudflare CDN 回源，从而避开本地网络的端口限制。

### 2. VPC 防火墙遗漏 `--network` 与缺少 ICMPv6

- **故障现象**：配置完成后，IPv4 节点正常，但 IPv6 节点出现异常：TLS 握手能通过，小体积 HTTP 请求也能响应，但一旦发起并发请求、大文件下载或访问大体积媒体内容，传输会停滞并最终超时报错。
- **原因分析**：
    1. 执行 `gcloud compute firewall-rules create` 时若未带 `--network=vpc-ipv6` 参数，规则会默认写入 GCP 的 `default` 网络，导致自定义 VPC 内的规则未生效。
    2. IPv6 不支持中间路由器分片，完全依赖路径 MTU 发现机制（Path MTU Discovery, PMTUD）。PMTUD 依赖 ICMPv6 的“Packet Too Big”报文（协议号 58）。若防火墙仅放行了 IPv4 ICMP 而遗漏了协议号 58，中间路由器返回的分片指示报文会被丢弃，形成 Path MTU 黑洞，导致超过 MTU 的长数据包无法送达。
- **排查命令**：检查规则列表中是否包含协议号为 58 的放行规则：
    ```bash
    gcloud compute firewall-rules list --filter="network:vpc-ipv6"
    ```

### 3. `curl -I` 探测 3x-ui 面板返回 404 状态码

- **故障现象**：部署完面板后，在终端执行 `curl -I https://panel.example.com:8443/<随机路径>/` 验证连通性，终端返回 `HTTP/2 404`，容易被误判为 Cloudflare CDN 反代失败或后端服务未启动。
- **原因分析**：3x-ui 的 Web 服务基于 Go Gin 框架构建，其路由表仅注册了 `GET` 与 `POST` 方法，并未针对 `HEAD` 请求（`curl -I` 所发送的方法）注册处理器。接收到 HEAD 请求时，Gin 框架默认返回 404 Not Found。
- **正确探测指令**：使用完整的 `GET` 请求获取 HTTP 状态码：
    ```bash
    curl -s -o /dev/null -w "%{http_code}\n" "https://panel.example.com:8443/<随机路径>/"
    # 正常状态应输出 200
    ```

---

## 结语

利用 GCP Always Free 的 e2-micro 搭配 Standard 网络层级，可以在控制成本（每月仅 IPv4 保留费约 $3.6，或纯 IPv6 零费用）的前提下，获得一个线路相对稳定的自建双栈代理节点。

---

## 参考与致谢

本方案关于 GCP Compute Engine 在 Standard 网络服务层级下启用外部 IPv6 双栈的核心设计，灵感与参考源自 Reddit 社区讨论：

- [How to use ipv6 in compute engine with standard network? - Reddit](https://www.reddit.com/r/googlecloud/comments/1x6zjj7/how_to_use_ipv6_in_compute_engine_with_standard/pht061u/?utm_source=embedv2&utm_medium=comment_embed&utm_content=action_bar&embed_host_url=https%3A%2F%2Fpublish.reddit.com%2Fembed&utm_source=share&utm_medium=mweb3x&utm_name=post_embed&utm_term=1&utm_content=1)
