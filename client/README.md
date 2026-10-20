# 持仓侠 · 手机采集客户端（pfclient）

PySide6 桌面客户端，覆盖 Windows / macOS。通过镜像/直连截图 + 本地 OCR，把手机券商 App 的
**持仓 / 理财 / 流水**页面引导式采集并写入持仓侠后端。

## 架构

```
┌────────────────────────────────────────────────────────────┐
│ 引导层  flow/guide.py     步骤卡片 + OCR 判页状态机          │
│ 采集层  capture/          UxPlay 镜像 │ USB DVT │ 轻点背面上传 │
│ 识别层  ocr/              RapidOCR + 表格结构解析            │
│ 核对层  ui/review_dialog  列映射 + 人工修正 + 写入后端        │
│ 后端    api/backend.py    X-User-Id REST 客户端             │
└────────────────────────────────────────────────────────────┘
```

三个采集源可随时在设置里切换：

| 源 | 通道 | 画质 | 自动化 | 状态 |
|---|---|---|---|---|
| `uxplay` | UxPlay `-vrtp` 转发 H.264，本地解码 | 1080p 有损 | 判页自动截图 | 仅预览/券商 App 采集；**银行 App 会检测投屏并拦截** |
| `usb` | pymobiledevice3 `developer dvt screenshot` | **原生 PNG** | 全自动 | 主力采集通道；App 完全无感知 |
| `backtap` | 手机快捷指令 POST 截图 | 原生 PNG | 半自动（轻点背面触发） | 无线场景兜底 |

## 安装运行

```bash
# 需要 Python ≥ 3.13（USB 源的 pymobiledevice3 要求）
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python run.py
```

冒烟测试（不依赖真机/后端）：

```bash
python smoke_test.py
```

## USB DVT 截图通道（iOS 17+ 主力采集）

### 原理

iOS 17 起 Apple 移除了旧的 `screenshotr` 服务，必须走 **RemoteXPC 隧道 + DVT（Developer Tools）**
通道才能拿到原生分辨率 PNG。pymobiledevice3 v11 提供三条隧道路径，本客户端按可用性降级：

| 顺序 | 模式 | 提权要求 | 适用 |
|---|---|---|---|
| 1 | `--userspace` | **无需管理员**（纯 Python 网络栈） | Windows 首选 |
| 2 | `--tunnel <UDID>` | 需 tunneld（管理员） | 已有 tunneld 常驻 |
| 3 | `--native` | 无（借道 Apple remoted） | 仅 macOS |

关键实现要点：

- 旧命令 `developer screenshot` 在 iOS 17+ **已失效**，必须用 `developer dvt screenshot`
- `--tunnel ""`（空串）会弹交互式设备选择器，在子进程里**会挂起** → 必须传具体 UDID
- 银行 App 检测的是 `UIScreen.isCaptured`（投屏/录屏），**不检测 DVT 截图** → 采集银行 App 只能走此通道

### 前置条件

| 项 | 要求 |
|---|---|
| Windows 驱动 | **必须装 iTunes 桌面版或「Apple Devices」**，它提供 `Apple Mobile Device Support`（usbmuxd 监听 `127.0.0.1:27015`）。不装 → pymobiledevice3 完全看不到 USB 设备 |
| 首次连接 | 手机解锁 → 弹「信任此电脑」→ 点信任 |
| 开发者模式 | 见下方「解锁开发者模式」一节 |
| 开发者镜像 | 首次运行会自动 `mounter auto-mount` 挂载 DDI（需联网下载） |

### 解锁开发者模式（iOS 16+ 开关默认隐藏）

Apple 有意隐藏「设置 → 隐私与安全性 → 开发者模式」：**只有设备被开发配对过才会露出该开关**。
macOS 常规做法是连 Xcode 配对，但 Windows 上不需要 Mac——pymobiledevice3 内置 AMFI lockdown 服务，
可直接下发 reveal 指令让开关出现：

```bash
python client/unlock_devmode.py            # reveal：让开关出现（手机侧手动打开）
python client/unlock_devmode.py --enable   # 直接请求开启（手机会重启）
python client/unlock_devmode.py --status   # 只查状态
```

原理：AMFI 收到 `action=0`（DEVELOPER_MODE_REVEAL）后在设备上创建 marker 文件 →
设置 App 读取该 marker 后才显示「开发者模式」项。`action=1` 请求开启（手机重启），
`action=2` 确认重启后的弹窗。

注意：
- reveal 后要**彻底划掉「设置」App 再重开**才生效（marker 是运行时读取）
- 设备有锁屏密码时 AMFI 拒绝代开（`Device has a passcode set`）→ 只能手动在手机上打开开关
- GUI 里也有「解锁开发者模式」按钮

### 自检

```bash
python spike_dvt.py             # 完整链路自检 + 尝试截图
python spike_dvt.py --info      # 只看设备信息
python spike_dvt.py --mount     # 额外挂载开发者磁盘镜像（一般不需要）
python ocr_probe.py             # 对最新截图跑 OCR，打印每行文本/坐标/置信度
python ocr_probe.py --shots     # 对全部已采集截图统计行数与总耗时
```

GUI 里也有「设备诊断」按钮，结果直接写进日志栏。

### 实测结论（iPhone18,1 / iOS 27.2 / Windows）

| 项 | 结果 |
|---|---|
| usbmux | 装「Apple Devices」后立刻可用（`127.0.0.1:27015`） |
| 隧道 | **`auto` 模式**（不传任何 flag）即通，免提权、无需 tunneld |
| 分辨率 | **1206×2622 原生**（AirPlay 镜像上限 1080p，有效线性像素仅约 45%） |
| 文件大小 | 内容页 645 KB / 锁屏态 40 KB（见下方黑图判据） |
| OCR（实测系统设置页） | 20 行文本识别出 19 行，平均置信 0.823，耗时 4.4s |

**iOS 17.4+ 不能传隧道 flag**：`--userspace` / `--tunnel` / `--native` 只对
iOS 17.0–17.3 有意义，17.4+ RSD 隧道由 pymobiledevice3 进程内自动建立，
此时传 flag 会报 `An RSD tunnel is established automatically; no flag is needed`。

**锁屏态会拿到纯黑图**：Secure Layer 由硬件保护，DVT 服务无权限读取，
但命令仍返回 0。客户端用灰度标准差（<2.0）判定单色图并拦截，
提示用户解锁；诊断脚本返回码 4。

## 自动长屏（CoreDevice 通道，iOS 17.4+）

### 原理

iOS 17.4+ 的 **CoreDevice** 服务族提供了两把钥匙，合起来就能**全自动**抓长页面：

| 服务 | 用途 |
|---|---|
| `com.apple.coredevice.screencaptureservice` | 原生 PNG 截图 |
| `com.apple.coredevice.hid.universalhidservice` | **注入真实触摸事件**（`mainTouchscreen` 面 `_ServiceID=257`） |

于是流程变成：`截图 → 注入上滑 → 截图 → … → 到底判定 → 拼接`。

**触摸注入的隐藏前提（pymobiledevice3 源码 "Authentication gate"）**：
backboardd 只接受来自**已认证** HID 面的 digitizer 事件。没有活跃媒体流时，
HID 面被标记为 `authenticated: NO`，事件会被**静默丢弃**。`touch_session()`
的做法是顺手开一条媒体流（Xcode 投屏那条视频管）把认证门顶开，然后丢弃其
RTP 载荷 —— 画面不需要，我们只要"事件能落地"。

### 用法

```bash
python long_shot_probe.py              # 最多 8 屏
python long_shot_probe.py --max 15     # 更多屏
python long_shot_probe.py --ratio 0.5  # 每屏滚动距离（屏高比例，默认 0.42）
```

GUI 里点「**自动长屏**」按钮即可（后台线程，不卡界面）。

### 坐标系统

HID 报告里 X/Y 是 **0..65535 归一化坐标**，不是像素。1206×2622 的屏幕上
"从中间往上拖一屏" ≈ `(32767, 55000) → (32767, 15000)`。

### 到底判定与错误提示

| 现象 | 判定 | 提示 |
|---|---|---|
| 截图全黑（亮度 < 12） | 锁屏/息屏 | 自动注入一次轻触唤醒并重截；仍黑则提示解锁 |
| 滑动后画面完全没变 | 滑动未被消费 | 提示"当前页面不可滚动或触摸注入未生效" |
| 重叠量 ≥ 92% 屏高 | 列表到底 | 正常结束（末屏回弹） |

> iOS **没有暴露锁屏状态 API**（`getlockstate` 在部分版本直接报
> `Action ... is not implemented`），所以判定走"滑动有没有效果"这个功能信号，
> 比图像特征可靠得多（锁屏/通知中心/主屏长得都像，图像特征区分度极差）。

### 拼接

逐屏用**归一化互相关（NCC）**算纵向重叠量，再按重叠裁掉重复部分拼接。

> 踩坑：**行方向绝不能下采样**。两屏裁剪起点不同（0 与 D），行网格会错位，
> 任何按固定步长取行的比较都会失效（曾导致重叠恒为 0）。
> 正确做法：只下采样列；定位用行亮度剖面做一维相关（向量化、对 1px 抖动不敏感），
> 再用像素级 NCC 在 ±3 行内复核。

`test_longshot.py` 是离线合成图测试（滚动 200/400/600px 的重叠量、
未滚动、无关图、拼接总高），不依赖真机。

## Spike 清单（镜像方案验证中，配合人工测试）

用户侧先跑通镜像，客户端需要验证/确认：

- [ ] uxplay 可执行文件路径（设置里指定；Windows 为 MSYS2 编译产物）
- [ ] `-vrtp` 参数语法：客户端默认 `-vrtp 127.0.0.1:5600`，
      若你的 uxplay 版本语法不同（如 `-vrtp 127.0.0.1 5600`），在设置里改「uxplay 参数」
- [ ] RTP 端口与 uxplay 参数中的端口一致（默认 5600）
- [ ] iPhone 与电脑同一局域网、mDNS/DNS-SD 可用（Win 需 Bonjour 服务）
- [ ] 预览区出画面 = 链路通；「立即截图」存 PNG = 采集通
- [ ] **实测目标券商 App 在投屏下是否黑屏**（银行 App 必黑）→ 决定是否全量切 DVT
- [x] DVT 截图分辨率是否为原生 → **确认 1206×2622，非镜像 1080p**

## 引导流程（持仓初始化为例）

1. 启动采集源 → iPhone 屏幕镜像到电脑
2. 按引导卡片操作手机：打开券商 App → 持仓列表页
3. 客户端 OCR 判页成功 → 自动截图（或手动点「立即截图」）
4. 弹出核对窗：列映射（自动猜 + 可改）→ 修正错别字 → 提交
5. 写入后端：`POST /api/holdings`（新建）/ `PUT /api/holdings/:id`（更新）/
   `POST /api/asset/wealth/snapshots`（理财快照）/ `POST /api/asset/cash/adjust`（现金）

## 已知限制 / TODO

- 镜像帧 1080p 有损，密集小字号数字 OCR 有误识风险 → 正式采集建议切 `usb` 源
- 银行 App 会检测投屏（`UIScreen.isCaptured`）→ 银行数据只能走 `usb` 源；券商 App 视实测而定
- **OCR 4.4s/张偏慢**：当前整图 1206×2622 未缩放直接送检。需按持仓表格区域裁剪/
  等比缩到长边 ~1600 再送检，或换 ONNXRuntime GPU / TensorRT 后端
- **OCR 低置信行集中在中文小字**（实测「软件更新」0.71、「自动更新」0.80），数字类文本置信更高
- **DVT 截图是当前屏幕静态帧**，不含连续动画；多屏持仓列表需逐屏手动截图
- **采集完的安全收尾**：关闭开发者模式（设置→隐私与安全性→开关关+重启）
  **不足以撤销配对**。还需删除 VPN 与设备管理里的描述文件，并在 设置→开发者→配对的电脑
  →取消配对。否则 lockdown 信任记录残留
- `capture_now()` 在 UI 线程阻塞等帧（≤5s），后续改异步
- 流水（flows）目前只核对不自动写库（避免重复记账）
- Android（Scrcpy/`adb shell input tap` + `exec-out screencap`）在 todolist
- 打包：PyInstaller（Win）/ py2app（mac）未做

## 环境自愈（重要）

本机全局环境变量 `PYTHONPATH=D:\Chenyifei\SDK\python`（一套 python312 残留 SDK）会被注入
`sys.path`，产生两类故障：

1. **包遮蔽**：venv 里装好的 pillow / PySide6 / rapidocr 被 SDK 目录同名包顶掉
2. **DLL 版本错配**：SDK 目录里的 `pywintypes312.dll`（cp312）优先加载，venv 是 cp313 →
   `import win32security` 报 "DLL load failed"

对策：`client/envfix.py` 的 `repair_environment()` 在启动最早阶段剔除外部注入路径、
把 venv site-packages 置顶、把 venv 自己的 `pywin32_system32` 加入 DLL 搜索目录，
并给子进程返回干净环境（`child_env()`）。`run.py` 与 `spike_dvt.py` 都在 import
第三方包**之前**调用它。

若想保留某条 PYTHONPATH，用环境变量 `PF_KEEP_PYTHONPATH`（`;` 分隔）声明。

## 目录

```
client/
├── run.py                入口
├── smoke_test.py         冒烟测试
├── spike_dvt.py          USB DVT 链路自检脚本
├── long_shot_probe.py    自动长屏采集（滑动+截图+拼接）验证脚本
├── test_longshot.py      长屏拼接重叠检测的离线测试
├── unlock_devmode.py     一键解锁 iPhone 开发者模式（AMFI reveal）
├── envfix.py             解释器环境自愈（PYTHONPATH 污染 / DLL 路径）
├── config.py             配置（client/data/config.json）
├── models.py             Column / ParseResult / CaptureRecord
├── capture/              rtp_h264.py · uxplay_source.py · usb_dvt_source.py · backtap_source.py · long_shot.py
├── ocr/                  engine.py · table.py · money.py · cards.py
├── flow/guide.py         步骤定义 + 判页状态机
├── api/backend.py        后端 REST 客户端
└── ui/                   theme.py · main_window.py · review_dialog.py · settings_dialog.py
```
