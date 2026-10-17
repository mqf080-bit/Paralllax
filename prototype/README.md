# Parallax — prototype

Phase 1 的 WebXR 原型。**当前完成 Step 0（链路）与 Step 1（台面与布局）。**

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

### 方案 B — 隧道（备选）

用 Cloudflare Tunnel / ngrok 把 `127.0.0.1:5173` 暴露成 HTTPS URL，Quest 浏览器直接打开。无需开发者模式，但出公网、有延迟。

### 方案 C — 局域网 HTTPS（不推荐）

`mkcert` + Vite HTTPS，需要 Quest 信任本地 CA；Quest 系统设置不保证提供证书安装入口。

## 场景里有什么（Step 1）

站在腰高台面前（`local-floor`，台面默认 0.95m）：

- **6 条铣出的导轨槽**，编号 0–5 固定；默认只显示中间 4 条（1–4），0 / 5 用盲板盖住（有板缝，能看出「这块能拆」）。
- **没有「画框」**：台面四周只留 20mm 倒角余量、近端 50mm、远端 60mm。槽几乎占满台面。
- **槽**：宽 180mm、深 6mm（取最浅），内壁衬板比台面暗，槽口有 AO 带。
- **导轨**：槽之间 4mm 高的凸起铝条，顶面一条镜面倒角。
- **判定带**：槽底一段冷白亮带（柔光 + 芯线），**静态**，相对槽底不动（`parallax-idea.md` 5.1）。
- **剖切**：近端整面 + 右侧近半段敞开，露出承力底板、中层甲板、四根纵筋与横梁；切面有倒角框与断面端头。
- **HUD**：视野右前方 3–4 点钟方向的**空间文字**（曲名 / 分数 / 物量），没有背板、没有显示屏。挂在相机下，属于视野。
- **没有底座**：台面是悬空的板，不做桌子。
- **背景**：暗房 + 1m 网格地面 + 远处渐变，无 shader 演出。

> 桌面截图看不出槽的深度 —— 深度主要靠 VR 的视差与立体感。判断请戴头显。

## 调试面板（仅 dev）

右上 `PARALLAX · STEP 1`，改任何尺寸都会立即重建台面：

| 分组 | 参数 |
| --- | --- |
| 台面 | 高度 / 进深 / 近端距离 / 轨距 / 槽宽 / 槽深 / 导轨高度 |
| 布局 | 4 轨窗口（0–3 / 1–4 / 2–5）、揭开隐藏轨、近端轨号、判定带 |
| 表现 | 曝光、环境强度 |
| 底部 | 恢复默认 |

左下 `LINK DIAGNOSTICS` 同时显示 `fps / draw calls / triangles`，用来估 72fps 的余量。

### 开发用 URL 参数

只改桌面视角与开关，不进正式构建：

```
?cam=0,1.62,0.52&look=0,0.95,-0.62      # 相机 / 注视点
&exposure=1.2&env=1.0                    # 曝光 / 环境强度
&window=-1&reveal=1&numbers=1            # 4 轨窗口 / 揭开 0·5 / 轨号
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
    │   ├── textures.ts      # 程序化贴图：拉丝 / AO / 判定带 / 铭牌 / 轨号
    │   ├── environment.ts   # 程序化 PMREM 环境（暗房 + 冷白灯带）
    │   └── library.ts       # 材质库（金属 / 陶瓷 / 玻璃 / 冰 / 黄铜 …）
    ├── scene/
    │   ├── table.ts         # 台面 / 槽 / 导轨 / 盲板 / 判定带 / 剖切腔体
    │   ├── hud.ts           # 视野固定的空间文字 HUD
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

当前状态与已知问题见 [`STATUS.md`](./STATUS.md)。
