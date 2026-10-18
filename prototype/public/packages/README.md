# 示例谱面包

- `air-example.parallax`：由 `../charts/air-example.json` 打包，含一个示例
  `theme/dark.json` 资源（当前游戏只携带、不消费主题）。

游戏页：

```text
?pack=/packages/air-example.parallax
```

编辑器：`IMPORT` 选这个文件，会同时恢复谱面和包内资源；`EXPORT` 会重新打回 `.parallax`。
