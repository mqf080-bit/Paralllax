# resources/（素材源目录）

这里放**作者用**的原始素材，不是游戏 / 编辑器的运行时依赖。

建议结构：

```text
resources/
  charts/          # 工作用谱面 JSON
  audio/           # 原始音轨
  themes/          # dark.json / light.json
  backgrounds/     # 背景图 / 视频
```

发行时用制谱器的 `EXPORT` 打成一个 `.parallax` 文件。运行时只认这个包
（以及兼容用的 `?chart=` / `?audio=`），不会扫描这个目录。

格式说明见 [`../prototype/PACKAGE.md`](../prototype/PACKAGE.md)。
