---
title: "Tailscale + GCP 双栈自建 DERP：远程 SSH 连接家里 Fedora 实战"
date: 2026-11-28
lastmod: 2026-11-28
description: "记录使用 Tailscale 搭配 GCP 双栈 e2-micro 自建 DERP 远程 SSH 连接家里 Fedora 的过程，涵盖方案选型、底层原理、UDP GRO 网卡调优、acme.sh 双栈签证书、Docker 鉴权部署、Mihomo TUN 共存与 SELinux 排坑。"
summary: "从方案选型、WireGuard 与 DERP 机制，到 GCP 双栈 DERP 部署、UDP GRO 优化、Fedora 原生 sshd 加固与 Clash/Mihomo TUN 共存的实战笔记。"
tags: ["Tailscale", "DERP", "GCP", "Fedora", "SSH", "IPv6", "Mihomo", "Linux", "网络优化"]
categories: ["技术实战"]
slug: "tailscale-gcp-dual-stack-derp-fedora-ssh"
draft: false
showTableOfContents: true
showZenMode: true
---

家里放了一台 Fedora 台式机，出门在外需要用笔记本或手机通过 SSH 连回家。手头正好有一台公网云服务器（本文以 GCP `e2-micro` 双栈 Debian 12 为例）和一个自有域名，因此采用 Tailscale 搭配自建双栈 DERP 的方案。

本文记录这套方案的选型依据、底层工作原理、GCP 服务端部署（包含 Linux 网卡 UDP GRO 持久化优化、双栈自动续期证书与防白嫖鉴权），以及 Fedora 客户端与 Mihomo TUN 共存、SELinux 排坑和链路实测结果。文中隐私信息已做脱敏处理，实操时请将 `derp.example.com`、`you@example.com`、`<你的公网IPv4>`、`<你的公网IPv6前缀>`、`<你的Fedora用户名>` 与 `<Fedora_Tailscale_IP>` 替换为实际值。

---

## 一、 方案选型与核心原理

### 1. 三种内网远程方案对比

远程访问内网主机常见有三种路线：

| 方案类型                                               | 连通率                       | 延迟与带宽                 | 客户端要求       | 适用场景                           |
| :----------------------------------------------------- | :--------------------------- | :------------------------- | :--------------- | :--------------------------------- |
| 混合方案：打洞为主 + 自建中转兜底（Tailscale + DERP）  | 100%（打洞失败自动回落）     | 直连跑满家宽上传，延迟最低 | 两端安装 Tailscale | 日常主力：SSH、远程开发、传大文件  |
| 纯服务器中转（frp / autossh 反向隧道）                 | 100%（无视任何 NAT）         | 受限于服务器带宽与绕路延迟 | 仅需原生 `ssh`   | 纯命令行操作、临时在他人设备上连接 |
| 纯 P2P 打洞（无中转兜底）                              | 视 NAT 类型而定，对称 NAT 易失败 | 延迟最低，不消耗服务器流量 | 两端安装组网工具 | 网络环境固定且确认非对称 NAT       |

最终选择 Tailscale 搭配公网服务器自建 DERP：能直连时自动走 P2P；遇到手机 5G 或家宽对称型 NAT 导致打洞失败时，自动切到自己服务器上的 DERP 加密中转。这样既保证连通率，又不需要把家里的 `22` 端口暴露到公网。

### 2. WireGuard 虚拟网卡与端到端加密

安装 Tailscale 后，系统会创建一张虚拟网卡 `tailscale0`，并分配一个属于 `100.64.0.0/10`（RFC 6598 CGNAT 保留段）的固定虚拟内网 IP。只有登录同一 Tailscale 账号的设备才能在这个虚拟局域网内互通，公网无法路由到该地址。

**密钥交换方式**：每台设备首次运行 `tailscale up` 时，会在本地生成一对 Curve25519 非对称密钥。私钥始终留在本地，设备只将公钥上报给 Tailscale 控制服务器，由控制服务器分发给同账号下的其他设备。两端用“本地私钥 + 对方公钥”协商出对称会话密钥，后续数据使用 ChaCha20-Poly1305 加密。

**为什么用 UDP 封装而不用 TCP**：

- 避免 TCP over TCP 熔断：隧道内跑的 SSH 本身是 TCP。如果外层隧道也用 TCP，一旦公网丢包，内外两层会同时超时重传并触发拥塞降速，导致明显卡顿。改用无状态 UDP 封装后，重传只交给内层 TCP 处理。
- 更容易 NAT 打洞：UDP 没有三次握手，穿透路由器 NAT 的成功率高于 TCP。

### 3. 控制面、STUN 打洞与自建 DERP 中转

两台内网设备原本互相不知道对方的公网地址。设备会先向 STUN 服务器（UDP `3478`）发送探测包获取自己的公网 `IP:端口`，再经由 Tailscale 控制面交换公钥和公网坐标。随后两端几乎同时向对方的公网 `IP:端口` 发 UDP 试探包，触发路由器 NAT 表放行回包，从而建立 P2P 直连。

当两端 NAT 过于严格、UDP 打洞失败时，就轮到 DERP 上场。DERP（Designated Encrypted Relay for Packets）是 [Tailscale 官方架构](https://tailscale.com/docs/reference/derp-servers) 中的加密中继协议，承担“打洞前的信令牵线”和“打洞失败时的中转兜底”两个角色：

{{< mermaid >}}
flowchart TB
    subgraph Home["家里局域网"]
        Fedora["Fedora 台式机<br/>tailscale0 + 原生 sshd"]
    end

    subgraph External["外部网络 (手机 5G / 笔记本)"]
        Client["外部终端<br/>SSH 客户端 + Tailscale"]
    end

    subgraph Control["Tailscale 控制面"]
        Coord["协调服务器<br/>分发节点公钥与公网坐标"]
    end

    subgraph GCP["GCP e2-micro (双栈 Debian 12)"]
        STUN["STUN 服务 (UDP 3478)<br/>探测公网 IP 与端口"]
        DERP["自建 derper (TCP 12345 TLS)<br/>公钥鉴权 + 盲转密文"]
    end

    Fedora -.->|交换公钥与端点| Coord
    Client -.->|交换公钥与端点| Coord
    Fedora -.->|NAT 探测| STUN
    Client -.->|NAT 探测| STUN

    Client ==>|优先: WireGuard UDP P2P 直连| Fedora
    Client -->|兜底: TLS 长连接中转| DERP
    Fedora -->|兜底: TLS 长连接中转| DERP
{{< /mermaid >}}

自建 DERP 节点的四个工作机制：

1. **主动出站建长连接**：家里 Fedora 和外部设备各自主动向自建 DERP 发起标准 HTTPS（TLS）TCP 长连接，再升级为 DERP 双向通道。因为是内网主动出站的 TCP 连接，无论 NAT 多严格都能放行。
2. **公钥鉴权防白嫖**：建连时，`derper` 读取客户端节点公钥，通过挂载进容器的宿主机 `tailscaled.sock` 核对设备是否属于自己的 Tailnet，陌生设备直接拒绝。
3. **盲转密文**：流量离开设备前已经过 SSH 和 WireGuard 双层加密，DERP 帧头只携带目标设备的节点公钥。服务端按内存里的 `公钥 ↔ TCP 连接` 映射表原样转发密文，本身没有私钥，无法解密内容。
4. **后台探测切回直连**：即使处于中转状态，Tailscale 仍会在后台通过 DERP 互发 Disco 探测消息；一旦网络条件具备（例如获取到公网 IPv6），会在不断开 SSH 的情况下自动切回 P2P 直连。

---

## 二、 GCP 服务端部署（双栈 Debian 12）

本节使用子域名 `derp.example.com` 和自定义端口 `12345`，将 `80` 留给 `acme.sh` 自动续期，把 `443` 留给同机可能部署的网站或其他服务。GCP 双栈 VPC（`vpc-ipv6`）、Standard 网络层级与 `e2-micro` 实例的初始化流程已在前一篇笔记中记录，此处直接复用：

{{< article link="/posts/gcp-always-free-dual-stack-reality/" showSummary=true >}}

### 1. 静态 IP、双栈防火墙与 DNS

在 GCP 控制台的 **VPC 网络 → IP 地址** 中，将实例的外部 IP 从临时（Ephemeral）转为静态（Static），避免实例重启后 IP 变动；网络层级保持为 Standard（标准），以使用每月 200 GB 免费出站流量额度。

> [!WARNING]
> **GCP 外部 IPv4 计费提醒**（参考 [Google Cloud VPC 网络定价文档](https://cloud.google.com/vpc/network-pricing)）
>
> - **运行中外部 IPv4**：无论静态还是临时，均按 `$0.005 / 小时` 计费（一个月约 `$3.60 ~ $3.65`）。
> - **闲置静态 IPv4**：虚拟机停止或删除后若未释放该静态 IP，会触发 `$0.010 / 小时` 的闲置费率，不再使用实例时务必同步释放。
> - **免费部分**：内部静态/临时 IP（把内网 IP 固定成静态不会收费或带来副作用）以及外部 IPv6 均免费。

接下来放行三个入站端口：

- `tcp:80`：供 `acme.sh` 签发和自动续期 Let's Encrypt 证书时完成 HTTP-01 验证。
- `tcp:12345`：自定义的 DERP HTTPS 中继端口（避开默认 `443`）。
- `udp:3478`：STUN 服务端口，用于 NAT 穿透探测与延迟测速。

依据 [Google Cloud VPC 防火墙规则文档](https://docs.cloud.google.com/firewall/docs/using-firewalls)，单条规则不能同时混写 IPv4 和 IPv6 来源网段，双栈环境需要拆成两条规则创建：

```bash
# IPv4 入站放行（将 --network 替换为你的实际 VPC 名称，如 default 或 vpc-ipv6）
gcloud compute firewall-rules create allow-tailscale-derp \
  --direction=INGRESS \
  --priority=1000 \
  --network=vpc-ipv6 \
  --action=ALLOW \
  --rules=tcp:80,tcp:12345,udp:3478 \
  --source-ranges=0.0.0.0/0

# IPv6 入站放行
gcloud compute firewall-rules create allow-tailscale-derp-v6 \
  --direction=INGRESS \
  --priority=1000 \
  --network=vpc-ipv6 \
  --action=ALLOW \
  --rules=tcp:80,tcp:12345,udp:3478 \
  --source-ranges=::/0
```

命令中未加 `--target-tags` 时，规则会对 `vpc-ipv6` 内的所有实例生效；如果该 VPC 里还跑着其他机器，可以补上 `--target-tags=tailscale-derp` 限定生效范围。

随后在域名 DNS 控制台为 `derp.example.com` 添加两条记录：

- `A` 记录：指向 GCP 外部静态 IPv4 地址。
- `AAAA` 记录：指向 GCP 虚拟机网卡实际拿到的完整公网 IPv6 地址（可在服务器上运行 `ip -6 addr show scope global` 确认）。

> [!WARNING]
> **Cloudflare 托管 DNS 时务必关闭小黄云（设为仅 DNS / 灰云）**
> 开启代理模式后，Cloudflare 不转发 UDP（会导致 STUN `3478` 失效，`tailscale netcheck` 测不出延迟），也不转发自定义非标端口 `12345`。

### 2. Linux 网卡 UDP GRO 转发优化（持久化）

根据 [Tailscale 官方性能优化文档](https://tailscale.com/docs/reference/best-practices/performance) 和 [Tailscale Linux UDP 吞吐量分析](https://tailscale.com/blog/quic-udp-throughput)，在 Linux 节点上开启 `rx-udp-gro-forwarding` 并关闭 `rx-gro-list`（后者优先级更高，会限制 UDP GRO 转发效果），可以降低转发时的 CPU 开销并提高吞吐量。

先确认宿主机已安装 `ethtool`（若未安装可执行 `sudo apt update && sudo apt install -y ethtool`），再创建自动适配双栈默认网卡的脚本：

```bash
sudo tee /usr/local/sbin/tailscale-udp-gro.sh > /dev/null << 'EOF'
#!/usr/bin/env bash
set -euo pipefail

ETHTOOL_BIN="$(command -v ethtool)"
DEVS="$(
  {
    ip -o route get 8.8.8.8 2>/dev/null || true
    ip -6 -o route get 2001:4860:4860::8888 2>/dev/null || true
  } | awk '{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1)}' | sort -u
)"

for dev in $DEVS; do
  "$ETHTOOL_BIN" -K "$dev" rx-udp-gro-forwarding on rx-gro-list off
done
EOF

sudo chmod +x /usr/local/sbin/tailscale-udp-gro.sh
```

脚本中的几处细节：

- `sudo tee ... > /dev/null << 'EOF'`：绕开 `sudo echo ... >` 的重定向权限限制；`'EOF'` 带单引号可防止写入时提前展开 `$DEVS` 和 `$(...)`。
- `ip -o route get ... 2>/dev/null || true`：只查询内核路由表，不实际发包；加上 `|| true` 防止单栈环境下其中一条查询失败触发 `set -e` 退出。
- `awk + sort -u`：提取 `dev` 后的网卡名并去重，避免双栈共用同一张网卡时重复设置。

`ethtool -K` 的修改在重启后会恢复默认值，因此配套创建一个 `oneshot` 类型的 systemd 服务，在网络就绪后、`tailscaled` 启动前自动执行：

```bash
sudo tee /etc/systemd/system/tailscale-udp-gro.service > /dev/null << 'EOF'
[Unit]
Description=Enable UDP GRO forwarding for Tailscale
After=network-online.target
Wants=network-online.target
Before=tailscaled.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/tailscale-udp-gro.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now tailscale-udp-gro.service
```

验证是否生效（将 `<网卡名>` 替换为实际网卡，如 `ens4`）：

```bash
ethtool -k <网卡名> | grep -E 'rx-udp-gro-forwarding|rx-gro-list'
```

预期输出中应包含 `rx-udp-gro-forwarding: on` 与 `rx-gro-list: off`。

### 3. 宿主机安装 Tailscale（客户端鉴权前置）

为了防止陌生设备白嫖自建 DERP 流量，需要在同一台宿主机上运行官方 Tailscale 客户端，让 `derper` 通过本地套接字验证接入设备身份。服务端同时关闭 Tailscale 对宿主机 DNS 的接管，避免干扰云主机原生 DNS 或 Docker 容器解析：

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo systemctl enable --now tailscaled
sudo tailscale up --accept-dns=false
tailscale status
```

按终端输出的链接完成登录授权即可。如果此前已经登录过但未带参数，直接补执行 `sudo tailscale set --accept-dns=false`。

### 4. 用 `acme.sh` 签发双栈 TLS 证书

使用 `--standalone` 模式签发证书时，建议全程切到 `root` 下执行：一方面 `socat` 监听 `80` 特权端口需要高权限，另一方面能避免后续写入 `/opt/derp/certs/` 以及 cron 定时续期执行 `docker restart derper` 时报权限错误。

另外，由于域名同时配置了 `A` 和 `AAAA` 记录，依据 [Let's Encrypt IPv6 支持文档](https://letsencrypt.org/docs/ipv6-support/)，验证服务器会优先连接 IPv6 地址，签发时必须加上 `--listen-v6`（Linux 默认双栈套接字会同时响应 IPv6 和 IPv4 请求）：

```bash
sudo -i

# 1. 安装依赖（standalone 模式需要 socat，自动续期需要 cron）
apt update && apt install -y socat cron
systemctl enable --now cron

# 2. 安装 acme.sh 并切换默认 CA 为 Let's Encrypt
curl https://get.acme.sh | sh -s email=you@example.com
/root/.acme.sh/acme.sh --set-default-ca --server letsencrypt

# 3. 临时借用 80 端口签发双栈证书
/root/.acme.sh/acme.sh --issue -d derp.example.com --standalone --listen-v6

# 4. 安装证书（derper 严格要求文件名为 <域名>.crt 和 <域名>.key）
# --reloadcmd 加 || true 是为了避免首次安装时 derper 容器尚未创建导致命令报错退出，后续每 60 天续期会自动重启容器
mkdir -p /opt/derp/certs
/root/.acme.sh/acme.sh --install-cert -d derp.example.com \
  --fullchain-file /opt/derp/certs/derp.example.com.crt \
  --key-file /opt/derp/certs/derp.example.com.key \
  --reloadcmd "docker restart derper || true"

# 5. 确认两个证书文件已就绪后，可按需 exit 退回普通用户
ls -l /opt/derp/certs/
```

### 5. 使用 Docker 启动带鉴权的 `derper`

安装 Docker 并启动 [fredliang/derper](https://hub.docker.com/r/fredliang/derper) 容器：

```bash
# 安装并启动 Docker（如已安装可跳过）
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable --now docker

# 启动自建 DERP 容器
sudo docker run -d \
  --name derper \
  --restart always \
  --network host \
  -v /opt/derp/certs:/app/certs:ro \
  -v /var/run/tailscale/tailscaled.sock:/var/run/tailscale/tailscaled.sock \
  -e DERP_DOMAIN=derp.example.com \
  -e DERP_ADDR=:12345 \
  -e DERP_STUN_PORT=3478 \
  -e DERP_HTTP_PORT=-1 \
  -e DERP_CERT_MODE=manual \
  -e DERP_VERIFY_CLIENTS=true \
  fredliang/derper:latest
```

关键参数说明：

- `--network host`：直接共享宿主机网络栈，同时监听宿主机 IPv4 与 IPv6，省去配置 Docker 默认网桥 IPv6 NAT 的麻烦。
- `-v /opt/derp/certs:/app/certs:ro`：只读挂载证书目录，文件名须为 `<DERP_DOMAIN>.crt` 与 `<DERP_DOMAIN>.key`。
- `-v /var/run/tailscale/tailscaled.sock:...` 配合 `DERP_VERIFY_CLIENTS=true`：开启客户端鉴权，只允许自己 Tailnet 内的设备使用中转。
- `DERP_HTTP_PORT=-1`：关闭容器自带的 `80` 端口 HTTP 服务，把 `80` 完整空出来留给 `acme.sh` 每 60 天自动续期。

检查启动日志与监听端口：

```bash
sudo docker logs --tail 30 derper
sudo ss -tulnp | grep -E '12345|3478'
```

日志中出现下面两行，且 `ss` 输出显示 `derper` 同时监听 `*:12345`（TCP）与 `*:3478`（UDP），即说明服务端运行正常：

```text
STUN server listening on [::]:3478
derper: serving on :12345 with TLS
```

---

## 三、 Tailscale 后台配置自定义 DERP

打开 [Tailscale Access Controls](https://login.tailscale.com/admin/acls/file)，按照 [Tailscale 官方 DERP 规范](https://tailscale.com/docs/reference/derp-servers) 在最外层 `{ ... }` 内添加 `derpMap`（注意不要贴到最外层大括号外面，否则会报 `invalid character ':' after top-level value`）：

```json
{
  "acls": [
    {
      "action": "accept",
      "src": ["*"],
      "dst": ["*:*"]
    }
  ],
  "derpMap": {
    "OmitDefaultRegions": true,
    "Regions": {
      "900": {
        "RegionID": 900,
        "RegionCode": "gcp",
        "RegionName": "GCP Custom DERP",
        "Nodes": [
          {
            "Name": "1",
            "RegionID": 900,
            "HostName": "derp.example.com",
            "DERPPort": 12345,
            "STUNPort": 3478
          }
        ]
      }
    }
  }
}
```

配置说明：

- `RegionID`：Tailscale 规定自定义区域编号范围为 `900~999`。
- `OmitDefaultRegions`：设为 `true` 会屏蔽官方 DERP，强制只走自己的 GCP 节点；设为 `false` 则保留官方全球节点并按延迟择优兜底。
- 本文 Fedora 端走原生 `sshd`（原因见下一节），因此 ACL 里不额外添加 `"ssh"` 规则块；如果后续在其他未开启 SELinux 的节点上需要使用 Tailscale 内置 SSH，再按需补充即可。

> [!IMPORTANT]
> 将 `OmitDefaultRegions` 设为 `true` 且只部署了单个自建节点时，如果需要维护或重启这台 GCP 服务器，请先将 `OmitDefaultRegions` 临时改回 `false`，避免维护期间整个 Tailnet 失联。

---

## 四、 Fedora 客户端接入、避坑与 SSH 加固

### 1. 安装登录与禁用密钥过期

Fedora 自带仓库虽然收录了 `tailscale`，但打包版本通常会滞后于 [Tailscale 官方软件源](https://pkgs.tailscale.com/stable/) 的最新版（例如实测时 Fedora 源停在 `1.102.5`，官方源已发布 `1.104.7`）。如果直接从 Fedora 自带源安装，系统里没有 `/etc/yum.repos.d/tailscale.repo`，后续运行 `sudo tailscale update` 会报 `no such file or directory`，而 `sudo dnf upgrade tailscale` 也只会检查 Fedora 源并提示 `Nothing to do.`。

更省事的做法是先添加 Tailscale 官方 Fedora 源（直接用 `tee` 写入可避开 DNF4 与 DNF5 的 `config-manager` 参数差异），再安装并启动：

```bash
# 1. 添加 Tailscale 官方 Fedora 源
curl -fsSL https://pkgs.tailscale.com/stable/fedora/tailscale.repo \
  | sudo tee /etc/yum.repos.d/tailscale.repo > /dev/null

# 2. 刷新元数据并安装 Tailscale
# 如果此前已从 Fedora 自带源装过旧版本，将 install 改为 upgrade：sudo dnf upgrade --refresh tailscale
sudo dnf install -y --refresh tailscale
sudo systemctl enable --now tailscaled
sudo tailscale up --accept-dns=false
```

打开终端打印的授权链接登录账号。以后只要 `/etc/yum.repos.d/tailscale.repo` 在，执行 `sudo dnf upgrade` 或 `sudo tailscale update` 都可以跟进官方最新版；升级完可以跑一次 `tailscale version` 确认版本号。

如果此前是从 Fedora 自带源安装再切到官方包升级，RPM 脚本可能会输出 `Failed to set unit properties on tailscale-systray.service: Unit tailscale-systray.service not found.`。这是未启用系统托盘图标服务导致的无害提示，不影响 `tailscaled` 核心守护进程；升级完成后执行 `sudo systemctl restart tailscaled` 并用 `tailscale status` 核对状态即可，不必重新跑 `tailscale up`。

> [!TIP]
> - **禁用密钥过期**：登录完成后，建议进入 Tailscale 网页后台的 **Machines** 列表找到家里的 Fedora，点击右侧菜单开启 **Disable key expiry**，避免默认 180 天后密钥过期导致远程失联。
> - **免 `sudo` 操作**：执行一次 `sudo tailscale set --operator=$USER` 后，当前用户日常运行 `tailscale` 子命令就不再需要反复输入 `sudo`。

### 2. 与 Mihomo / Clash Verge Rev TUN 模式共存

如果 Fedora 上常开代理软件（如 Clash Verge Rev / Mihomo 内核）的 TUN 模式，默认配置下会触发三类冲突：

1. **DNS 抢占**：Tailscale 的 `100.100.100.100` 与 Clash TUN 争抢系统解析，导致网页打不开或分流异常。
2. **TUN 路由劫持**：开启 `strict-route: true` 后，Mihomo 可能把 `100.64.0.0/10` 等 Tailscale 内网流量劫持进代理 TUN。
3. **`fake-ip` 导致控制面卡死（最隐蔽）**：如果 `controlplane.tailscale.com` 被 Mihomo 解析成 `198.18.x.x` 假 IP，而 `tailscaled` 为防回环会直接走物理网卡连接控制面，发往假 IP 的包会被路由器直接丢弃，表现为 `tailscale up` 长时间卡死、`tailscale status` 一直报 `unexpected state: NoState`。

解决方法分三步：

1. **Tailscale 侧关闭 DNS 接管**：

   ```bash
   sudo tailscale set --accept-dns=false
   ```

   执行后系统 DNS 统一交由 Clash Verge Rev 管理，不影响 Tailscale 组网和 `100.x.y.z` 互通（只是无法直接使用 MagicDNS 短主机名，用 IP 或 `~/.ssh/config` 别名替代即可）。

2. **在 Mihomo 配置（或 Clash Verge Rev 的全局扩展配置 Merge）中补充三处规则**，合并到对应区块，不要重复定义同名顶级键：

   ```yaml
   dns:
     fake-ip-filter:
       # 避免自建 DERP 与 Tailscale 控制面域名被解析成 198.18.x.x 假 IP
       - "derp.example.com"
       - "+.ts.net"
       - "+.tailscale.com"
       - "+.tailscale.io"

   tun:
     # 排除 Tailscale IPv4 CGNAT 与 IPv6 ULA 网段，防止 strict-route 劫持内网流量
     route-exclude-address:
       - 100.64.0.0/10
       - fd7a:115c:a1e0::/48

   rules:
     # 放在顶部私有规则区，避免直连 DERP/STUN 与内网流量落入末尾 MATCH,PROXY
     - DOMAIN,derp.example.com,DIRECT
     - DOMAIN-SUFFIX,ts.net,DIRECT
     - IP-CIDR,<你的公网IPv4>/32,DIRECT,no-resolve
     - IP-CIDR6,<你的公网IPv6前缀>/96,DIRECT,no-resolve
     - IP-CIDR,100.64.0.0/10,DIRECT,no-resolve
     - IP-CIDR6,fc00::/7,DIRECT,no-resolve
   ```

3. **重载配置并清缓存验证**：保存并重载 Clash Verge Rev 后，如果此前已经缓存过假 IP，先清理系统 DNS 缓存再重启 `tailscaled`：

   ```bash
   sudo resolvectl flush-caches
   sudo systemctl restart tailscaled
   tailscale status
   ```

### 3. 绕开 SELinux 拦截：关闭 Tailscale SSH，改用原生 `sshd` 并加固

在 Fedora 上如果启用 `tailscale up --ssh`，执行 `tailscale status` 会看到健康警告：

```text
SELinux is enabled; Tailscale SSH may not work.
```

不建议为了这个功能去关闭 SELinux。更稳妥的做法是关闭 Tailscale 内置 SSH，改用 Fedora 原生 `sshd` 跑在 Tailscale 虚拟内网上。这样天然兼容 SELinux，支持 SFTP 和编辑器远程开发，也不会向公网暴露 `22` 端口：

```bash
sudo tailscale set --ssh=false
sudo systemctl enable --now sshd
```

接着在外部常用电脑上配置公钥免密和 SSH 别名：

```bash
# 将本机公钥推送到家里 Fedora
ssh-copy-id <你的Fedora用户名>@<Fedora_Tailscale_IP>
```

在外部电脑的 `~/.ssh/config` 中写入别名：

```text
Host fedora
    HostName <Fedora_Tailscale_IP>
    User <你的Fedora用户名>
```

确认通过 `ssh fedora` 免密登录成功后，在 Fedora 的 `/etc/ssh/sshd_config` 中禁用密码登录和 root 登录，再平滑重载服务：

```text
PasswordAuthentication no
PermitRootLogin no
```

```bash
sudo systemctl reload sshd
```

---

## 五、 链路验证、延迟实测与排障记录

### 1. 服务端连通性与 DERP 诊断

在本地客户端依次执行以下三条命令做端到端验收：

```bash
# 1. 验证域名直达源站 IP、TCP 12345 连通且 TLS 证书有效
curl -vk --connect-timeout 5 https://derp.example.com:12345/

# 2. 查看本机 NAT 类型、IPv6 状态与自建 DERP 延迟
tailscale netcheck

# 3. 单独诊断自建 gcp 节点的 TLS 与 STUN 连通性
sudo tailscale debug derp gcp
```

正常启用后，`curl` 会返回 Tailscale DERP 页面，`tailscale netcheck` 会显示 `Nearest DERP: GCP Custom DERP` 及对应的毫秒延迟。

> [!NOTE]
> `tailscale debug derp gcp` 中出现关于 `http://derp.example.com/generate_204`（`80` 端口）的警告属于正常现象，因为我们在启动容器时主动设置了 `DERP_HTTP_PORT=-1`。

### 2. 实测对比：中转兜底 vs IPv6 直连

- **场景 A（家宽纯 IPv4 对称 NAT + 手机 5G）**：执行 `tailscale ping <手机Tailscale_IP>`，返回 `via DERP(gcp) in ~490-520ms`（国内 → 美西 GCP → 国内双程延迟），稳定零丢包；手机端 App 显示 `Relayed connection (GCP)`，敲 SSH 命令行流畅可用。
- **场景 B（Fedora 获取公网 IPv6 后）**：`tailscale netcheck` 显示 `IPv6: yes, [240x:...]:端口`，执行 `tailscale status` 可看到与双栈 GCP 节点已自动建立 IPv6 P2P 直连：`active; direct [2600:...]:41641`。

后续优化方向：如果家里宽带本身支持 IPv6，在家里路由器开启 IPv6（Native / SLAAC）后，手机 5G 与家里 Fedora 就能直接走国内公网 IPv6 打洞直连，延迟预计可从 ~450 ms 降到 30~50 ms，也能省去大文件经海外服务器中转的流量开销。

### 3. 排查小插曲：热点切换触发 AIC8800 驱动死机

在测试切换手机热点的过程中，Fedora 出现了一次整机冻死。重启后通过 `journalctl -b -1 -k -n 40 --no-pager` 查到，内核最后一条报错来自第三方 AIC8800 无线网卡驱动的空指针异常，与 Tailscale 和代理软件无关：

```text
rwnx_rx_scanu_start_cfm rwnx_hw->scan_request is NULL!!
```

临时规避方法是关闭 NetworkManager 的 Wi-Fi 扫描随机 MAC，长期则建议改插网线或更换 Linux 内核原生免驱的 Intel AX200 / AX210 网卡：

```bash
sudo tee /etc/NetworkManager/conf.d/wifi-no-rand-mac.conf << 'EOF'
[device]
wifi.scan-rand-mac-address=no
EOF
sudo systemctl restart NetworkManager
```

关于这枚 AIC8800D80 网卡在 Fedora 下的驱动编译与排障细节，可以参考之前的记录：

{{< article link="/posts/fedora-aic8800-wifi-bluetooth-driver-guide/" showSummary=true >}}

### 4. 高频踩坑 FAQ

{{< accordion mode="collapse" separated="true" >}}
{{< accordionItem title="tailscale netcheck 中自建 gcp 延迟为空" open="true" >}}
- **常见原因**：Cloudflare 开了橙色小黄云代理，或 GCP 防火墙未放行 `udp:3478`。
- **解决方案**：在 Cloudflare 将该子域名改为仅 DNS（灰云），并核对 GCP IPv4/IPv6 两条防火墙规则是否均绑定到了正确的 `--network`。
{{< /accordionItem >}}
{{< accordionItem title="acme.sh --standalone 报错退出" >}}
- **常见原因**：未安装 `socat`，或用普通用户运行无权绑定 `80` 端口。
- **解决方案**：先执行 `sudo -i` 切到 `root`，安装 `socat` 和 `cron` 后再签发证书。
{{< /accordionItem >}}
{{< accordionItem title="acme.sh --install-cert 报权限不足" >}}
- **常见原因**：用 `sudo mkdir` 创建的 `/opt/derp/certs` 属主为 `root`，普通用户无权写入。
- **解决方案**：全程在 `root` 环境下安装和运行 `acme.sh`，保证证书写入与后续 cron 续期执行 `docker restart derper` 权限一致。
{{< /accordionItem >}}
{{< accordionItem title="60 天后证书自动续期失败" >}}
- **常见原因**：`80` 端口被其他服务占用，或 IPv6 防火墙未放行 `tcp:80`。
- **解决方案**：保持 `DERP_HTTP_PORT=-1` 不占 `80` 端口，并确认 GCP 的 IPv4 和 IPv6 防火墙规则都放行了 `tcp:80`。
{{< /accordionItem >}}
{{< accordionItem title="开启 Clash TUN 后网页打不开、tailscale up 卡死（NoState）或 100.x 不通" >}}
- **常见原因**：Tailscale 接管了系统 DNS；TUN 虚拟网卡劫持了 `100.64.0.0/10` 流量；或 `fake-ip-filter` 漏放 `+.tailscale.com` / `+.tailscale.io`，导致 `controlplane.tailscale.com` 解析出 `198.18.x.x` 假 IP 后一直卡在 `unexpected state: NoState`。
- **解决方案**：执行 `sudo tailscale set --accept-dns=false`，在 Mihomo 配置中补齐 `dns.fake-ip-filter`、`tun.route-exclude-address` 与顶部双栈直连 `rules`，重载后执行 `sudo resolvectl flush-caches && sudo systemctl restart tailscaled`。若重启后仍持续报 `NoState`，可用 `sudo journalctl -u tailscaled -n 40 --no-pager` 查看卡在 DNS 还是控制面连接。
{{< /accordionItem >}}
{{< accordionItem title="Fedora 上 sudo tailscale update 报 tailscale.repo 不存在，dnf upgrade 提示 Nothing to do" >}}
- **常见原因**：此前通过 Fedora 自带仓库安装了 `tailscale`，系统缺少 `/etc/yum.repos.d/tailscale.repo`，且 Fedora 官方源的打包版本通常会滞后于 Tailscale 最新版。
- **解决方案**：用 `curl -fsSL https://pkgs.tailscale.com/stable/fedora/tailscale.repo | sudo tee /etc/yum.repos.d/tailscale.repo > /dev/null` 添加官方源，再运行 `sudo dnf upgrade --refresh tailscale` 与 `sudo systemctl restart tailscaled`（升级脚本若提示 `tailscale-systray.service not found` 可忽略）。
{{< /accordionItem >}}
{{< /accordion >}}

---

## 六、 Tailscale 常用命令速查

| 命令                                     | 说明                                                         |
| :--------------------------------------- | :----------------------------------------------------------- |
| `sudo tailscale up --accept-dns=false`   | 登录并启动连接（不接管系统 DNS）                             |
| `sudo tailscale down`                    | 临时断开连接（保留登录态）                                   |
| `sudo tailscale logout`                  | 注销当前设备并退出账号                                       |
| `sudo tailscale set <参数>`              | 在线修改配置项（如 `--ssh=false`、`--accept-dns=false`、`--operator=$USER`） |
| `tailscale version`                      | 查看当前 Tailscale 版本信息                                  |
| `sudo tailscale update`                  | 升级到官方最新版（需已添加官方软件源）                       |
| `tailscale status`                       | 查看所有在线设备、IP、直连/中转状态及健康警告                |
| `tailscale ip -4` / `tailscale ip -6`    | 查看本机 Tailscale IPv4 / IPv6                               |
| `tailscale ping <目标IP或主机名>`        | 查看两台设备间是 `via IP:Port` 直连还是 `via DERP` 中转      |
| `tailscale netcheck`                     | 检测本机 NAT 类型、IPv6 状态与 DERP 延迟                     |
| `sudo tailscale debug derp gcp`          | 诊断自建 DERP 节点的 TLS 与 STUN 连通性                      |
| `tailscale file cp <文件> <主机名>:`     | 通过 Taildrop 在自有设备间直接传文件                         |

---

## 参考资料

- [Tailscale DERP Servers 官方文档](https://tailscale.com/docs/reference/derp-servers)
- [Tailscale 官方软件源（Fedora 等发行版）](https://pkgs.tailscale.com/stable/)
- [Tailscale Performance Best Practices](https://tailscale.com/docs/reference/best-practices/performance)
- [Tailscale Blog: Surpassing 10Gb/s over Tailscale (Linux UDP GRO)](https://tailscale.com/blog/quic-udp-throughput)
- [Google Cloud VPC 网络定价文档](https://cloud.google.com/vpc/network-pricing)
- [Google Cloud VPC 防火墙规则文档](https://docs.cloud.google.com/firewall/docs/using-firewalls)
- [Let's Encrypt IPv6 支持文档](https://letsencrypt.org/docs/ipv6-support/)
- [fredliang/derper Docker 镜像](https://hub.docker.com/r/fredliang/derper)
