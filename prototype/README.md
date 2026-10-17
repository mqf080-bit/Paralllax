# Parallax — prototype

Phase 1 的 WebXR 原型。**当前只完成 Step 0：链路验证。**

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
4. PC 上起服务（本项目默认就只听 loopback）：
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

## 页面里能看到什么

左下是 **LINK DIAGNOSTICS** 面板，逐项回答「为什么进不去 VR」：

| 行 | 含义 |
| --- | --- |
| `secure context` | `window.isSecureContext`。false 就一定是访问方式的问题 |
| `navigator.xr` | 浏览器硬件 / 浏览器是否支持 WebXR |
| `immersive-vr` | `isSessionSupported('immersive-vr')` 的结果 |
| `session` | 当前会话状态 |
| `reference space` | 进会话后确认 `local-floor` 已生效 |
| `controllers` | 左右手控制器的连接状态（`●` 已连 / `○` 未连） |
| `fps` | 实际帧率（500ms 窗口） |

场景内容：1 米一格的网格地面 + 一个悬浮方块 + 两条控制器射线。方块在扳机按下时会闪一下 —— 那是「事件到了」的凭据，**不是命中反馈**。

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
    ├── main.ts            # 渲染器 / 相机 / 会话 / 主循环
    ├── xr/
    │   └── xr-support.ts  # secure context / navigator.xr / immersive-vr 探测
    ├── scene/
    │   ├── stage.ts       # 地面 + 网格 + 悬浮方块 + 光照
    │   └── controllers.ts # 控制器射线 / 端点 / 扳机闪烁
    └── ui/
        ├── diagnostics.ts # 自检面板
        └── style.css
```

## 设备要求

- Meta Quest 3（或任何支持 `immersive-vr` 的 WebXR 运行时）
- 桌面 fallback：任意支持 WebGL2 的浏览器（Chrome / Edge / Firefox）

## 已知不做的

Step 0 **不含**：台面、槽、材质语言、键型、判定、shift、谱面、编辑器。这些从 Step 1 起逐步进入，见 `agent.md` §3。

当前状态与已知问题见 [`STATUS.md`](./STATUS.md)。
