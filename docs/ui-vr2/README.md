# VR UI — 2D Study 复刻截图

2026-10-20。把 [`design/ui-2d`](../../design/ui-2d/) 的六屏版式搬进 760×470 的 VR 面板后截的图。

| 文件 | 状态 |
| --- | --- |
| `home.png` | 主页，Proving Ground |
| `songs.png` | 选歌，Proving Ground 选中 |
| `songs-selected.png` | 选歌，切到 Antagonism（`?chart=demo`） |
| `packs.png` | Add packs |
| `paused.png` | 暂停在 0:30，Score / Combo / Accuracy 有值 |
| `settings.png` | 六个真实设置项 |
| `result.png` | 结算，91 Perfect / 100% |
| `sheet.png` | 六屏总览 |

截图用开发服务器、正对面板的相机和干净背景：

```text
?panel=home|songs|packs|paused|settings|result
&vr=1&clock=0&chrome=0
&cam=0,1.33,0.34&look=0,1.33,-0.34
```

暂停 / 结算要带分数时，让自动演示先跑 30 秒：

```text
?auto=1&warp=30&freeze=1&panel=paused
```

`?chrome=0` 只隐藏桌面镜像上的诊断面板、lil-gui、Stats 和包加载器，不影响 VR 面板。
