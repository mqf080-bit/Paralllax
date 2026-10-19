# FUTURE — Unity、3D 预览与资源库

> 2026-10-19 ｜ Phase 1 WebXR 原型完成后的架构备忘。
> 结论先写：**Web 编辑器继续作为制谱工具；Unity 负责最终画面；单文件 `.parallax` 保留为便携快照，日常工作区改为「谱面 + 资源引用」。**

---

## 1. Unity 时代的 3D 预览

### 1.1 不要把 Unity 的视觉搬进 three.js

现在编辑器里的 3D 预览和游戏播放器共用一套 Three.js 运行时。未来 Unity 会有更复杂的材质、背景、粒子、后处理；
如果继续在 Web 里复刻，会变成第二个渲染器，永远追不上。

建议把预览分成三层：

| 层 | 负责 | 是否必须和 Unity 一致 |
| --- | --- | --- |
| 玩法层 | note / arc 位置、SV、shift、判定窗口、时间 | **必须** |
| 关卡舞台层 | 背景、光照、相机、材质、特效 | **不要求**，只做代理 |
| 最终画面 | Unity 场景 / 后处理 / VR 舒适度 | Unity 独占 |

编辑器每天使用的是**玩法层 + 轻量舞台代理**，不是 Unity 画面。

### 1.2 共享玩法契约

把「影响手感和判定的东西」抽成版本化契约，而不是两套实现各写一遍：

- 时间单位 ms；
- `x` / `z` / `lane` 坐标；
- 台面高度、判定带 `bandZ`、note 尺寸；
- `z = bandZ - (S(arrive) - S(now)) × flowSpeed / 1000`；
- SV 积分 / 缓动、arc 采样、hold / arc tick 规则；
- shift 窗口与过渡。

建议放一份 `runtime-contract.md` + 一组 golden chart（固定谱面 + 固定时间点的期望位置 / 判定结果），
Web 预览和 Unity 各自跑测试，结果必须一致。

如果以后 Unity 侧逻辑复杂到两边难以同步，再把核心编译成 WASM / native library 给两边共用；
现阶段不值得。

### 1.3 舞台 manifest

给每张谱一个可选的舞台描述，而不是把 Unity 场景写死在代码里：

```json
{
  "stage": {
    "id": "infinity-heaven",
    "unityScene": "Assets/Stages/InfinityHeaven.unity",
    "preview": {
      "background": { "kind": "image", "asset": "sha256:..." },
      "fog": "#05060a",
      "camera": { "position": [0, 1.62, 0.52], "target": [0, 0.95, -1.4] }
    }
  }
}
```

- 编辑器只消费 `preview`：图片 / 视频 / 纯色 / 简单雾，够看构图和节奏即可；
- Unity 消费 `unityScene` / prefab / Addressables，真实背景和特效全在 Unity；
- 新增背景效果时，编辑器不需要改代码，只要支持新的 preview kind（或先降级为纯色）；
- `preview` 可以是低分辨率代理，不进入最终包。

### 1.4 需要看真实画面时

按成本从低到高：

1. **编辑器低模预览**（日常）——只保证玩法可读；
2. **Unity 远程预览**（推荐）——编辑器通过 WebSocket 把 `chart.json` + 时间 / 播放状态发给
   Unity standalone / Quest 构建；Unity 渲染，编辑器只控制走带。视觉一致，且不把 Unity 塞进浏览器；
3. **Unity WebGL 嵌入编辑器**（不推荐日常用）——包体大、加载慢、输入 / 音频 / WebXR 都麻烦，
   只适合偶尔截图。

### 1.5 Unity 导入链路

- Unity 端实现 `.parallax` / library 的 importer；
- 编辑器导出到 Unity 监听的目录，Unity 自动 reimport + 刷新当前谱面；
- 传送门：`Open in Unity` 按钮，带谱面路径和当前 playhead；
- 这样编辑器更新谱面，Unity 不需要重启。

---

## 2. 谱面包与共享资源

### 2.1 现在的问题

`infinity-heaven.parallax` 是 18.4MB，其中：

- `chart.json` 只有 8KB；
- FLAC 18.2MB；
- 封面 257KB。

单文件包每次改一个 note 都要重写 18MB，这在迭代期很低效。

### 2.2 三个层级

| 形态 | 用途 | 是否包含资源 |
| --- | --- | --- |
| **Workspace / 工作区** | 编辑器日常保存 | 只存谱面 + 资源引用 |
| **Standalone `.parallax`** | 发给别人 / 离线试玩 | 自包含快照 |
| **Library / 资源库** | 多张谱、共享背景 / 音频 | 资源只存一份 |

不要把「工作区」和「发行包」继续混成一个文件。

### 2.3 工作区布局

```text
project/
  project.json
  charts/
    infinity-heaven.json
  assets/
    audio/<sha256>.flac
    cover/<sha256>.jpg
    background/<sha256>.webp
  library.json
```

- 谱面引用**内容哈希**，不引用绝对路径；
- 资源不可变：改背景 = 新哈希，旧谱面仍可指旧版本；
- 保存一个 note 只写几 KB 的 chart JSON；
- 编辑器用 File System Access API 访问目录；不支持时退回 IndexedDB + 导入 / 导出 zip。

### 2.4 Library 索引

```json
{
  "version": 2,
  "assets": {
    "sha256:aaa...": { "path": "assets/audio/aaa.flac", "mime": "audio/flac", "size": 18199150 },
    "sha256:bbb...": { "path": "assets/background/bbb.webp", "mime": "image/webp", "size": 1200000 }
  },
  "charts": {
    "infinity-heaven": {
      "chart": "charts/infinity-heaven.json",
      "assets": {
        "audio": "sha256:aaa...",
        "cover": "sha256:ccc...",
        "background": "sha256:bbb..."
      }
    }
  }
}
```

- 多张谱共用背景：只保留一份 asset；
- 更新一张谱：只改 `charts/...json` 和 `library.json` 的 chart 条目；
- 更新共享背景：新增哈希，想升级的谱面改引用；不想动的谱面继续用旧哈希；
- 资源可以放本地目录、HTTP、Unity Addressables，索引格式不变。

### 2.5 外部索引的取舍

**要外部索引，但要有 fallback：**

- 迭代 / 在线发行：library + 外部资源，HTTP 缓存 / Addressables 去重；
- 单文件 `.parallax`：仍然保留，作为便携、离线、分享的「快照」；
- 不要只做外链：断链、CORS、文件移动都会让谱面不可玩；
- 单文件包可以引用外部资源，但导出时必须能选择「bundle 全部资源」生成自包含版本。

### 2.6 大背景 / 视频

- 不要塞进每次编辑的 chart 写入路径；
- 编辑器只用 `preview` 低清代理（图片 / 低码率视频）；
- Unity 用完整资源，走 Addressables / 本地库；
- 需要流式加载时，库索引里给 URL + hash + size，Unity / Web 各自缓存。

### 2.7 压缩与版本

- 单文件可以用 zip / zip64：JSON deflate，FLAC / 视频 store（已经压缩）；
- `.parallax` v1 读取器永久保留；v2 增加 library / asset 引用；
- 包 / 库 / 谱面各自有版本号，导入时做迁移；
- 资源哈希做完整性校验。

---

## 3. 建议的推进顺序

1. **冻结当前 v1 `.parallax`**：作为 Portable Snapshot，不再往里塞复杂资源逻辑；
2. **抽玩法契约 + golden tests**：Web 与未来 Unity 共用；
3. **编辑器加工作区**：资源缓存 + chart-only 保存 / 导出；
4. **加 library 索引**：多谱、共享背景、按哈希去重；
5. **Unity importer + Addressables**：读 `.parallax` 和 library；
6. **Unity 远程预览**：需要看真实画面时再接，不阻塞日常制谱。

日常路径应该是：

```text
编辑器保存 chart.json（KB 级）
  → Unity 监听目录热重载
  → 需要分享时才 build 成 .parallax（MB 级）
```
