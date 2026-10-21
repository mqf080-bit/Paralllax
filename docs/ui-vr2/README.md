# VR UI / 打击反馈截图

2026-10-20。把 [`design/ui-2d`](../../design/ui-2d/) 的六屏版式搬进 760×470 的 VR 面板后截的图；
2026-10-21 追加 hit 造型、碎裂与设计样张。

面板为 **1.55m 宽 × 0.959m 高，放在眼前 1.35m、中心高度 1.44m**；截图相机就是实际站姿 `0,1.60,0` 看向面板，和佩戴时的视野关系更接近。

| 文件 | 状态 |
| --- | --- |
| `home.png` | 主页，Proving Ground |
| `songs.png` | 选歌，包含 `packages/index.json` 的 Air / Ticks 与 Infinity Heaven；选中包后才下载 `.parallax` |
| `songs-selected.png` | 选歌，切到 Antagonism（`?chart=demo`） |
| `packs.png` | Add packs |
| `paused.png` | 暂停在 0:30，Score / Combo / Accuracy 有值 |
| `settings.png` | 六个真实设置项 |
| `result.png` | 结算，91 Perfect / 100%；右侧 GOOD TIMING 显示 early / late |
| `sheet.png` | 六屏总览 |
| `guide.png` | 游玩中的竖直判定引导网：只点亮网格线，不画底板 / 光晕 |
| `hit-after.png` | 新的对称 sandwich hit：上下同形釉面 + 窄金属芯 + 内收手别色光缝，总高 0.084m |
| `hit-impact.png` | 命中后的直接碎裂；没有冲击环，碎片按 perfect / good 分档 |
| `hit-lab-all.png` | 设计样张：三个对称方向；A / SANDWICH 最终被采用 |
| `hit-lab-a.png` | 采用方向 A 的近距离材质检查 |
| `hit-lab-a-air.png` | 方向 A 抬到空中、右手；上下同形 |
| `hit-lab-a-shatter.png` | 方向 A 的碎裂设计样张 |
| `hitbox-gui.png` | dev 调试 GUI：hit 判定盒 X / Z 倍率与当前尺寸（时间窗不变） |

`hit-lab-*` 来自 [`design/hit-lab`](../../design/hit-lab/)，是独立光照下的设计样张，不是游戏实拍；
`hit-after.png` / `hit-impact.png` 才是主代码里的游戏画面。

截图用开发服务器、正对面板的相机和干净背景：

```text
?panel=home|songs|packs|paused|settings|result
&vr=1&clock=0&chrome=0
&cam=0,1.6,0&look=0,1.44,-1.35
```

暂停 / 结算要带分数时，让自动演示先跑 30 秒：

```text
?auto=1&warp=30&freeze=1&panel=paused
```

`?chrome=0` 只隐藏桌面镜像上的诊断面板、lil-gui、Stats 和包加载器，不影响 VR 面板。
