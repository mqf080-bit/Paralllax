# Parallax — prototype

Phase 1 的 WebXR 原型。**Step 0–4 已完成，下一步 Step 5（制谱器）。**

> 项目总览与进度：[`../README.md`](../README.md) ｜ 谱面格式：[`CHART.md`](CHART.md) ｜ 迭代记录：[`STATUS.md`](STATUS.md)

设计真相在仓库根的 `parallax-idea.md`；施工协议在 `agent.md`。这里只放能跑的东西。

## 跑起来

```bash
cd prototype
npm install
npm run dev
```

默认监听 **`127.0.0.1:5173`**，只走 loopback。桌面浏览器打开 <http://127.0.0.1:5173> 即可。

> 依赖装在 WSL 里时，npm 默认缓存目录可能只读；必要时加 `--cache /tmp/parallax-npm-cache`。

## 在 Quest 3 上打开

WebXR 要求 **secure context**。`http://localhost` 和 `http://127.0.0.1` 算，`http://192.168.x.x:5173` 不算 —— 所以「Vite 开 `--host` 后用局域网 IP 打开」通常拿不到 `navigator.xr`。

### 方案 A — USB + `adb reverse`（推荐）

1. Quest 3 打开**开发者模式**与**USB 调试**，USB 连 PC。
2. 确认设备可见：
   ```bash
   adb devices -l
   ```
3. 反向映射端口：
   ```bash
   adb reverse tcp:5173 tcp:5173
   ```
4. PC 上起服务：
   ```bash
   cd prototype && npm run dev
   ```
5. Quest 浏览器打开 <http://localhost:5173>，点页面底部的 **ENTER VR**。

无线变体（先 USB 配对一次）：

```bash
adb tcpip 5555
adb connect <quest-ip>:5555
adb reverse tcp:5173 tcp:5173
```

Quest 休眠 / 重连后可能会掉，重跑 `adb connect` + `adb reverse` 即可。

#### 项目跑在 WSL 里时（本机情况）

`adb` 在哪一侧，决定了 `adb reverse` 把端口映射到哪：

- **adb 在 WSL 里**：WSL 默认看不到 USB 设备，需要 Windows 侧装 `usbipd-win` 并 `usbipd attach --wsl` 把 Quest 接进来。成功后 `adb reverse` 落在 WSL 的 loopback，服务也在 WSL 里，直接可用。
- **adb 在 Windows 里**：`adb reverse` 落在 **Windows** 的 loopback。WSL2 的 localhost 转发通常能把 Windows 的 `127.0.0.1:5173` 转到 WSL 内的服务；如果转不过来，用 `npm run dev:lan` 让 Vite 监听 `0.0.0.0`。Quest 仍然打开 `http://localhost:5173` —— **secure context 由 URL 决定，不受监听地址影响**。

### 耳机里的操作

| 做什么 | 怎么做 |
| --- | --- |
| 打键 | 手扫过判定带（hit 要速度 + 位移，drag 只要扫过，hold 要按住扳机 / 侧握） |
| 打 arc | 手跟着弧走；弧上的黄铜珠是**关键物量**，必须进体积判定 |
| 点 UI | 手柄指向面板，**扣扳机**；靠近了直接伸手戳也行 |
| 暂停 / 重试 / 设置 | 右前方那条 `SETTINGS / PAUSE / RETRY`（播放时会淡到 30%） |

音频：没有音轨资产，默认按谱面的 `timing` **现场合成鼓组**。想听真曲子，把文件放到
`prototype/public/`，用 `?audio=/track.mp3` 打开；`meta.offset` 与设置面板的 `AUDIO OFFSET`
用来校准「键比声音早 / 晚」。

### dev 参数

`?chart=demo` 切回 12s 示例谱 · `?auto=1` 自动演示 · `?freeze=1` 冻结 · `?warp=2.4` 快进 · `?flow=4` 流速 ·
`?shift=left|right` · `?panel=settings|result` 摊开面板 · `?clock=0` 关掉音频时钟 ·
`?offset=20&volume=0.6&lead=2000` 音频参数 · `?audio=/track.mp3` 真实音轨 ·
`?aim=1&aimTarget=settings|pause|retry&click=1` 假手验证激光笔。

### 方案 B — 隧道（备选）

用 Cloudflare Tunnel / ngrok 把 `127.0.0.1:5173` 暴露成 HTTPS URL，Quest 浏览器直接打开。无需开发者模式，但出公网、有延迟。

### 方案 C — 局域网 HTTPS（不推荐）

`mkcert` + Vite HTTPS，需要 Quest 信任本地 CA；Quest 系统设置不保证提供证书安装入口。

## 场景里有什么（Step 1）

站在腰高台面前（`local-floor`，台面默认 0.95m）：

- **只有 4 条轨**，编号 1–4。没有 6 轨物理场、没有隐藏轨、没有盲板。
- **没有凹槽**：台面是一块整板，轨与轨之间只有一条 1.6mm 的暗分割线（3 条）。
- **没有边框**：台面宽度 = 4 轨 + 4mm 倒角余量，轨的外沿就是台面外沿。
- **进深 10m**：台面是一条跑道，远端收进雾里。
- **判定带**：台面上一条冷白亮带（柔光 + 芯线），**静态**，位置不动（`parallax-idea.md` 5.1）。
- **剖切**：近端整面 + 右侧靠玩家 2.4m 的一段敞开，露出承力底板、中层甲板、纵筋与横梁；切面有倒角框与断面端头。
- **浮空显示**：右前方 2.6m、台面上方 0.1m 的**空间文字**（曲名 / 分数 / 物量）。它属于世界，不跟头走，也没有显示屏 —— 只有字和一条黄铜细线。
- **材质实验台（dev）**：正前方 0.7m 的四件样品（暗瓷 / 冰锥 / 玻璃管 / 黄铜环），自转，带一盏检验灯。`?lab=0` 或调试面板可关。
- **没有底座**：台面是悬空的板，不做桌子。
- **背景**：暗房 + 1m 网格地面 + 远处渐变，无 shader 演出。

> 这一版与 `parallax-idea.md` 的差异（6 轨物理场 / 凹槽）是刻意为之，原因与待办写在 `STATUS.md` §6。

## 调试面板（仅 dev）

右上 `PARALLAX · STEP 1`，改任何尺寸都会立即重建台面：

| 分组 | 参数 |
| --- | --- |
| 台面 | 高度 / 轨宽 / 进深 / 近端距离 / 板厚 |
| 布局 | 近端轨号、判定带 |
| 浮空显示 | X 右 / Y 高 / Z 前 |
| 材质实验台 | 显示样品 |
| 表现 | 曝光、环境强度 |
| 底部 | 恢复默认 |

左下 `LINK DIAGNOSTICS` 同时显示 `fps / draw calls / triangles`，用来估 72fps 的余量。

### 开发用 URL 参数

只改桌面视角与开关，不进正式构建：

```
?cam=0,1.62,0.52&look=0,0.95,-1.4       # 相机 / 注视点
&exposure=1.2&env=1.0                    # 曝光 / 环境强度
&numbers=1                               # 近端轨号
&lab=0                                   # 关掉材质实验台（dev 默认显示）
```

## 脚本

```bash
npm run dev        # Vite dev server（127.0.0.1:5173）
npm run dev:lan    # 同上，但监听 0.0.0.0（WSL + Windows 侧 adb 时用）
npm run build      # tsc --noEmit && vite build
npm run typecheck  # 只做类型检查
npm run preview    # 预览 dist/
```

## 目录

```
prototype/
├── index.html
├── vite.config.ts
├── tsconfig.json
└── src/
    ├── main.ts              # 渲染器 / 相机 / 会话 / 主循环 / 生命周期
    ├── config.ts            # 唯一参数来源 + 派生几何
    ├── xr/
    │   └── xr-support.ts    # secure context / navigator.xr / immersive-vr 探测
    ├── materials/
    │   ├── textures.ts      # 程序化贴图：拉丝 / 冰晶 / 玻璃波纹 / 脏污 / 判定带
    │   ├── environment.ts   # 程序化 PMREM 环境（暗房 + 冷白灯带）
    │   └── library.ts       # 材质库（金属 / 陶瓷 / 玻璃 / 冰 / 黄铜 …）
    ├── scene/
    │   ├── table.ts         # 台面 / 分割线 / 判定带 / 剖切腔体
    │   ├── display.ts       # 浮空显示（曲名 / 分数）
    │   ├── materialLab.ts   # 材质实验台（dev）
    │   ├── backdrop.ts      # 暗房与地面
    │   └── controllers.ts   # 控制器射线 / 端点 / 扳机闪烁
    └── ui/
        ├── diagnostics.ts   # 链路自检 + 渲染开销
        ├── debug.ts         # lil-gui 调试面板（仅 dev）
        └── style.css
```

## 设备要求

- Meta Quest 3（或任何支持 `immersive-vr` 的 WebXR 运行时）
- 桌面 fallback：任意支持 WebGL2 的浏览器（Chrome / Edge / Firefox）

## 已知不做的

Step 1 **不含**：键型、判定、shift 动画、谱面、编辑器、浅色主题、接触阴影 / SSAO、背景 shader 演出。

这一版也**不含**：6 轨物理场、凹槽、隐藏轨、台面底座。

当前状态与已知问题见 [`STATUS.md`](./STATUS.md)。
