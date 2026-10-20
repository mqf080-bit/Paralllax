# Parallax — prototype

Phase 1 的 WebXR 原型。**v0.3.11 / Step 0–5 已完成并验收**：游戏可玩，桌面制谱器可用；Quest 3 实测 72Hz+。

> 项目总览：[`../README.md`](../README.md) ｜ 谱面格式：[`CHART.md`](CHART.md) ｜
> 制谱器：[`EDITOR.md`](EDITOR.md) ｜ 谱面包：[`PACKAGE.md`](PACKAGE.md) ｜ 迭代记录：[`STATUS.md`](STATUS.md) ｜ UI 待办：[`UI-BACKLOG.md`](UI-BACKLOG.md) ｜ 无线上头显：[`DEPLOY.md`](DEPLOY.md) ｜ 设计工作流：[`../DESIGN-WORKFLOW.md`](../DESIGN-WORKFLOW.md)

设计真相在仓库根的 `parallax-idea.md`；Phase 1 旧协议在 `agent_old.md`（已归档，不再遵循）。这里只放能跑的东西。

## 跑起来

```bash
cd prototype
npm install
npm run dev
```

默认监听 **`127.0.0.1:5173`**（只走 loopback）：

- 游戏：<http://127.0.0.1:5173>
- 制谱器：<http://127.0.0.1:5173/editor.html>

> 依赖装在 WSL 里时，npm 默认缓存目录可能只读；必要时加 `--cache /tmp/parallax-npm-cache`。

## 制谱器

单独一页，桌面 2D。时间轴分「标尺 / 6 轨主视图 / 高度 / SV / 波形」五条带，
底部还有一条 Blender 式全局时间线；3D 预览直接跑游戏播放器。

- 3D 视图可直接放置 / 拖动 note 的 x / z；虚拟网格 + `SNAP XZ` 吸附，可整体关闭；
- 选中 arc 后 3D 是主要编辑区：白球自由 x/z、青球只改 x、黄铜球只改 z；
  新建弧只拖终点、起点钉住；ARC 工具点弧身加点，点物量珠切 KEY；拖动实时重建；
- 2D 俯视图可关闭，预览 / 2D 之间有可拖分隔条；
- 放置 / 拖动 / 删除四种键；地面键默认整轨，空中 hit/drag（z > 0.07m）与 arc 点一样 1/4 轨；
  `Shift+点` 多选 note，拖任意选中项整组移动；z 在高度轨直接拖，hold 固定贴地；
- arc 点列可插点、删点、每段选缓动；X / Z 缓动可分开（`easing` / `easingZ`）；
  `linear` 是直线、直角是硬角；`STRAIGHTEN` 一键拉直；
- 时间吸附改成预设 + `DIV / DOT / 三连` 自定义参数；暂停无操作时 3D / 2D / 总览不空转；
- 没音轨时默认不播合成鼓组，走带 `DRUMS` 勾选才响；
- arc 的 `ticks[]` 可以只保留需要结算的物量（直角蛇拐角不放 tick）；
- shift 用背景色带表示当时的 4 轨窗口；SV 点击加点、拖动改倍率；波形放在 2D 最底下；
- 时间吸附含 3 连 / 5 连 / 附点 / 1/32 / 1/24；`Ctrl` 临时自由；
- 导入本地音频、看波形、调 `meta.offset`；FLAC / MP3 自动读封面 / 标题 / 作者；
- `SPECTRUM` 可展开音频频谱，点击 / 拖动定位时间，收起后播放头不跳；
  时长默认音频长度，可手改；
- 预览支持自动打、暂停、0.25×–2×、倒放、FOLLOW；
- 导出 `<title>.parallax` 单文件谱面包（谱面 + 音轨 + 封面 + 资源），也可单独导出 JSON；草稿自动存 localStorage；
- 游戏页左下 `LOAD .parallax` 可以直接选 / 拖入导出的包开玩，不用复制到 `public/`。

操作细节、快捷键、字段约定见 [`EDITOR.md`](EDITOR.md)。

导出的谱面放进 `public/charts/`，游戏页用 `?chart=/charts/文件名.json` 读取
（仓库自带 `example.json` 和 `air-example.json`：后者演示空中 hit/drag、地面 hold 与显式 arc 物量）。

## 在 Quest 3 上打开

WebXR 要求 **secure context**。`http://localhost` 和 `http://127.0.0.1` 算，`http://192.168.x.x:5173` 不算 —— 所以「Vite 开 `--host` 后用局域网 IP 打开」通常拿不到 `navigator.xr`。

> 不想插线：把静态构建部署到 Cloudflare Pages，Quest 收藏 `https://<project>.pages.dev`。完整步骤和更新方式见 [`DEPLOY.md`](DEPLOY.md)。

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

## 耳机里的操作

| 做什么 | 怎么做 |
| --- | --- |
| 开始 | 进 VR 后在主页点 `START`；不再自动开谱 |
| 选歌 / 加包 | 主页 `Songs` 读取 `public/packages/index.json`，包条目在选中后才下载 `.parallax`；`How to add packs` 看 Desktop / Drag / Folder / URL 四种方式 |
| 打键 | 手扫过判定带（hit 要速度 + 位移，drag 只要扫过，hold 要按住扳机 / 侧握） |
| 打 arc | 手跟着弧走；弧上的黄铜珠是**关键物量**，必须进体积判定 |
| 点 UI | 手柄指向面板，**扣扳机**；靠近了直接伸手戳也行 |
| 暂停 | 左手柄 **menu** 键，或 **左手 Y 长按 400ms**；桌面按 `Esc` |
| 暂停里的操作 | `RESUME / RESTART / SETTINGS / HOME`；设置是暂停的二级页 |

音频：没有音轨资产，默认按谱面的 `timing` **现场合成鼓组**。想听真曲子，把文件放到
`prototype/public/`，用 `?audio=/track.mp3` 打开。`meta.offset` 是谱面作者偏移，游戏端只内部应用、不显示；
设置面板的 `Offset` 才是玩家校准（默认 0ms）。

## 场景里有什么

站在腰高台面前（`local-floor`，台面默认 0.95m）：

- **6 条轨的物理场**（单轨宽 0.23m、进深 10m），但只有 **4 轨窗口**会点亮；
  窗口随 shift 整体左 / 右滑一轨，隐藏轨在几何上真的不渲染。
- **台面是一层平面**：没有凹槽、没有边框、没有底座；轨间只有细分割线。
- **note 不一定在轨上**：hit / drag 有连续 `x` 和 `z`，可以浮空 / 落在轨间；
  hold 只能贴地；arc 的每个点都有 x / z。判定用实际位置，不用轨号。
  地面键默认对齐轨中心，离轨是显式例外。
- **判定带**：台面上一条冷白亮带（柔光 + 芯线），静态。
- **浮空显示**：曲名 / 难度 / 物量 / 分数 / COMBO / 血条，绑定窗口右缘，跟着 shift 走。
- **背景**：暗房 + 1m 网格地面 + 雾，无 shader 演出。
- **材质**：黑阳极铝 / 拉丝金属 / 陶瓷 / 冰 / 玻璃 / 黄铜，全部程序化。

## 游戏 dev 参数

`?chart=demo` 12s 示例 · `?chart=/charts/example.json` 外部谱面 ·
`?chart=/charts/air-example.json` 空中 note / 显式 arc 物量 · `?auto=1` 自动完美演示 ·
`?autostart=1` 跳过主页 · `?freeze=1` 冻结 · `?warp=2.4` 快进 · `?flow=4` 流速 · `?shift=left|right` ·
`?panel=home|songs|packs|paused|settings|result` 摊开面板 · `?menuButton=6` 改 menu 键索引 · `?clock=0` 关掉音频时钟 ·
`?offset=20&volume=0.6&lead=2000` 音频参数 · `?audio=/track.mp3` 真实音轨 · `?chrome=0` 隐藏桌面调试覆盖层 · `?panelScale=1.05&panelDistance=0.65&panelY=1.45` 调面板 · `?lane=0.27&band=0.80` 调轨宽 / 判定带。

## 脚本

```bash
npm run dev        # Vite dev server（127.0.0.1:5173）
npm run dev:lan    # 同上，但监听 0.0.0.0（WSL + Windows 侧 adb 时用）
npm run build      # tsc --noEmit && vite build（游戏 + editor 两页）
npm run typecheck  # 只做类型检查
npm run preview    # 预览 dist/
```

## 目录

```
prototype/
├── index.html            # 游戏页
├── editor.html           # 制谱器页
├── public/charts/        # 导出的谱面（example.json / air-example.json）
├── vite.config.ts        # 多页构建入口
└── src/
    ├── main.ts           # 游戏：渲染器 / 相机 / 会话 / 主循环
    ├── config.ts         # 台面参数 + 派生几何
    ├── chart/            # 谱面格式 / 时间轴 / 缓动 / 示例 / 验收谱
    ├── game/             # 播放器 / 判定 / 计分 / arc / hold / 手 / 粒子
    ├── audio/            # 音频时钟 + 程序化节拍轨
    ├── scene/            # 台面 / 浮空显示 / 背景 / 控制器 / 材质实验台
    ├── materials/        # 材质库 / 配色 / 程序化贴图 / 视距淡出
    ├── ui/               # 3D 面板 / 游戏 UI / 调试 / 诊断
    ├── xr/               # WebXR 探测
    └── editor/           # 制谱器（时间轴 / 交互 / 预览 / 检查器 / 波形 / 存取）
```

## 设备要求

- Meta Quest 3（或任何支持 `immersive-vr` 的 WebXR 运行时）
- 桌面 fallback：任意支持 WebGL2 的浏览器（Chrome / Edge / Firefox）
- 制谱器：桌面浏览器（不需要头显）

## 已知问题

- **72fps**：Quest 3 头显实测 72Hz+（用户验收）。
- **音频**：「调度路径」验过，听感需要戴上确认；偏早 / 偏晚用 `AUDIO OFFSET` 微调。
- 自动演示现在是直接完美判定，不再模拟手。
- **菜单键**：优先读 `gamepad.buttons[6]`，读不到时用左手 Y 长按 400ms；需要在 Quest 3 上确认哪个索引真的可用。
- **暂停 / 设置**：游玩中已没有常驻按钮；面板交互只在主页 / 暂停 / 设置 / 结算时接收射线。
- 制谱器：音频 / 封面文件不持久化到草稿，但会进 `.parallax` 包；慢放 / 倒放静音；多选只覆盖 note；没有框选 / 复制粘贴 / 自动 BPM 检测；
  3D 里 arc 点的时间仍要在 2D / 检查器改。
- hold 固定贴地；hit / drag 可以浮空。

当前状态与更细的坑见 [`STATUS.md`](./STATUS.md)，制谱器细节见 [`EDITOR.md`](./EDITOR.md)。
