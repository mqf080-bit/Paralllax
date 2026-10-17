# prototype / STATUS

> 更新：2026-10-17 18:15 CEST
> 当前 Step：**0 — 已完成，待你验收**
> 设计真相：`../parallax-idea.md`｜施工协议：`../agent.md`

---

## 1. 这一步做了什么

一个最小可进的 WebXR 场景，只用来看链路通不通：

- `WebGLRenderer` + `renderer.xr.enabled`，参考空间 `local-floor`（站立式，原点在脚下）。
- `VRButton`：负责能力探测、`requestSession`、失败提示（"VR NOT SUPPORTED" 等）。
- 场景：1 米网格地面 + 一个悬浮方块（0.3m，位于身前 0.85m、离地 1.1m）+ 半球光 / 主光 / 补光。
- 控制器：两条射线 + 端点球，按手别上青 / 赤；扳机按下时射线闪一下、方块发光 —— 只证明输入事件到达。
- 桌面 fallback：OrbitControls（1.6m 眼高，看向方块）。
- 自检面板：`origin` / `secure context` / `navigator.xr` / `immersive-vr` / `session` / `reference space` / `controllers` / `fps`。
- `stats.js` 在右上角。

**没有**台面、槽、材质语言、键型、判定、shift、谱面、编辑器。

---

## 2. 验收对照（`agent.md` §4）

| 验收项 | 状态 | 说明 |
| --- | --- | --- |
| Quest 浏览器能打开页面 | **未验证** | 需要你接设备 |
| 点 Enter VR 能进 immersive-vr | **未验证** | 同上 |
| 控制器被追踪、射线可见 | **未验证** | 同上；桌面无控制器 |
| 桌面浏览器同一页面能打开 | **已验证**（桌面 Chromium） | 见 §4 |
| HMR 正常 | **已验证**（桌面） | CSS 热替换；TS 改动走整页重载 |
| 记录使用方案 / 命令 / 端口 | 部分 | 方案 A 未定稿（见 §5） |

---

## 3. 怎么测

```bash
# PC
cd prototype
npm run dev            # → http://127.0.0.1:5173

# 另一终端（Quest 已 USB 连接、已开开发者模式 / USB 调试）
adb devices -l         # 应看到设备
adb reverse tcp:5173 tcp:5173
```

Quest 浏览器打开 `http://localhost:5173`，看面板 → 点 **ENTER VR**。

进 VR 后应看到：脚下网格、正前方悬浮方块、两只控制器的射线。扣扳机 → 射线变亮 + 方块闪一下。

**注意**：断开 USB、Quest 休眠重启后 `adb reverse` 会失效，重跑即可。

---

## 4. 已完成的技术验证

- `npx tsc --noEmit` 通过（strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax`）。
- `vite build` 通过（566 kB / gzip 142 kB，主要是 three）。
- Headless Chromium（SwiftShader）加载页面：HTTP 200，WebGL 渲染正常，**控制台无 error / warning**（只有 Vite HMR 自己的 connecting / connected）。
- 面板读数：`secure context true`、`navigator.xr present`、`immersive-vr false`（无头环境无 XR 设备，符合预期）、`session off`。
- HMR：改 `style.css` → `[vite] (client) hmr update`；改 `.ts` → `page reload`（模块没有 accept 处理器，这是预期行为，不是故障）。

---

## 5. 已知问题 / 未决

1. **Quest 3 尚未接入**：`adb devices` 为空。方案 A（USB + `adb reverse`）还是 B（隧道）**仍需你定**。
2. **自检面板是 DOM**：头显里看不见，只能通过桌面镜像看。要验「进没进 VR」得靠头显里的画面本身 —— 这也是为什么场景里必须有一个方块。
3. **手追踪没有可视化**：`optionalFeatures` 里请求了 `hand-tracking`，但没有渲染手部关节；Phase 1 明确控制器优先（`agent.md` §2）。
4. **方块没有接触阴影**：现在它是"浮着"的。Step 0 不引入阴影是刻意的（SSAO / 接触阴影是 Step 1 的材质工作，且是 `parallax-idea.md` 4.6 的硬要求）。
5. **`fps` 在无头环境不可读**：`--virtual-time-budget` 会打乱时间基准，截图里显示 8 不代表真机帧率。真机 72fps 要在头显里看。
6. **本机 npm 缓存目录只读**：装依赖要加 `--cache /tmp/parallax-npm-cache`。这是环境问题，不进仓库。
7. **WSL + adb 的位置问题**：本项目在 `/mnt/d`（WSL）里。`adb` 在 Windows 侧时，`adb reverse` 映射到 Windows 的 loopback，需要 WSL2 localhost 转发把它带到 WSL 内的 Vite；转不过来就用 `npm run dev:lan`。`adb` 在 WSL 侧则需要 `usbipd-win` 做 USB 直通。两种走法都写在 README。
8. **依赖版本较新**：Vite 8 / TypeScript 7 / three r186。已按 r186 调整：不用已废弃的 `THREE.Clock`，时间基准直接用 `setAnimationLoop` 的 timestamp。

---

## 6. 设计与实现的张力（按协议只记录，不擅自改设计）

| 张力 | 现状 | 计划 |
| --- | --- | --- |
| `parallax-idea.md` 2 节：hit / drag 判定看**手**的位移速度与距离 | Phase 1 用控制器，只能拿到手柄位姿 | Step 2 的第一个验证项：手柄速度能否代理手速。若不行，要么改输入，要么改判定的物理量 |
| 4.6 要求浅色模式必须有玻璃**边缘 / 描边 pass** | 已决定 Step 1 只做深色 | 浅色推到深色方向确认之后，单独排期 |
| `references/04-synthesis.md` §5 建议先做三张灰模构图测试 | 与 Step 1 内容重叠 | 并入 Step 1 的验收，不单开一步（需你确认） |

---

## 7. 下一步（等你明确反馈才动）

- **先验收 Step 0**：接上 Quest，确认能进 VR、射线可见、HMR 正常。
- 确认后进 **Step 1 — 基本 UI 风格与 layout**（6 槽台面 / 可见 4 轨 / 深色材质 / 剖切边）。
- 进 Step 1 前需要你定：台面高度（提案 0.95m，相对地面）、槽宽 / 槽深 / 导轨高度的初值方向。
