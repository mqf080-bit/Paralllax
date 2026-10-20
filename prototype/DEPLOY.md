# 部署到 Cloudflare Pages

目标：给 Quest 3 一个固定的 HTTPS 地址，不再用 USB / `adb reverse`；电脑睡眠也不影响打开。

这个项目是纯静态站点：`npm run build` 产出 `prototype/dist`，没有服务端。

---

## 先选部署方式

| 方式 | 更新方式 | 适合 |
| --- | --- | --- |
| **Git integration（推荐）** | push 到 GitHub 自动构建 | 日常测试、长期使用 |
| Direct Upload（Wrangler） | 本地 `npm run build` 后手动上传 | 不想让 Cloudflare 读仓库、临时部署 |

> Cloudflare 的规则：**Git integration 和 Direct Upload 项目不能互转**。想长期用自动部署，第一次就选 Git integration。

---

## 一、Git integration（推荐）

### 1. 创建 Pages 项目

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages**。
2. **Create application** → **Pages** → **Connect to Git**。
3. 授权 GitHub，选择 `mqf080-bit/Paralllax`。
4. **Install & Authorize** → **Begin setup**。

### 2. 填写构建配置

这是本仓库的关键：项目不在仓库根目录，而在 `prototype/`。

| 字段 | 值 |
| --- | --- |
| Project name | `parallax-vr`（可换；会决定 `<name>.pages.dev`） |
| Production branch | `main` |
| Framework preset | None 或 Vite |
| **Root directory (advanced)** | **`prototype`** |
| Build command | `npm ci && npm run build` |
| Build output directory | `dist` |
| Environment variable | `NODE_VERSION=22` |

说明：

- `npm ci` 必须在 `prototype/` 里执行；根目录不填 `prototype` 会找不到 `package.json`。
- `npm run build` 已经包含 `tsc --noEmit`，构建失败会直接显示在 Pages 日志里。
- Vite 8 需要较新的 Node，固定 `NODE_VERSION=22` 最省事。
- 不需要设置 `base`：Pages 项目部署在域名根路径，资源用 `/assets/...` 正常。

### 3. 首次部署

点 **Save and Deploy**。构建完成后会得到：

```text
https://<project-name>.pages.dev
```

Quest 浏览器打开这个地址，点 **ENTER VR**。这是 HTTPS，满足 WebXR 的 secure context，不需要开发者模式，也不需要 adb。

### 4. 以后怎么更新、重新部署

**正常方式：push 到 `main`，自动部署。**

```bash
git add .
git commit -m "feat: ..."
git push origin main
```

Cloudflare 会自动：

1. 拉取最新 `main`；
2. 在 `prototype/` 里执行 `npm ci && npm run build`；
3. 把新的 `dist/` 发布到生产地址。

看进度：**Workers & Pages → parallax-vr → Deployments**。最新一条从 `Building` 变成 `Success` 后，`https://<project>.pages.dev` 就是新版本。

Quest 上刷新页面即可。Vite 产物带内容哈希，正常不会吃到旧 JS；如果还看到旧页面，关掉标签页重开，或在地址后加 `?v=2`。

### 5. 分支预览

推到非 `main` 分支，或开 Pull Request，Pages 会生成预览部署，例如：

```text
https://<branch>.<project>.pages.dev
```

适合先在头显里试一版，再合并到 `main`。合并后才会更新生产地址。

### 6. 回滚

**Deployments → 选一个旧 deployment → Rollback**。不需要改代码；适合“新版本在 Quest 里坏了，先退回上一版”。

### 7. 可选：只在新代码变化时构建

仓库里还有 `design/`、`docs/` 等目录。默认任何 push 都会触发构建；如果觉得浪费，可以在 Pages 项目里设置 **Build watch paths**：

```text
prototype/*
```

只让 `prototype/` 的变化触发部署。改文档时不重建。

---

## 二、Direct Upload（手动上传）

适合不想把 GitHub 仓库接到 Cloudflare 的情况。注意：Direct Upload 项目以后不能转成 Git integration。

### 第一次

```bash
cd prototype
npx wrangler login
npx wrangler pages project create parallax-vr
```

按提示把 production branch 设为 `main`。

### 每次更新

```bash
cd prototype
npm run build
npx wrangler pages deploy dist --project-name parallax-vr
```

也可以用仓库里的快捷脚本（项目名同样是 `parallax-vr`，被占用时改 `package.json`）：

```bash
cd prototype
npm run deploy:pages
```

部署完成后地址仍是：

```text
https://parallax-vr.pages.dev
```

如果项目名已被占用，Cloudflare 会在 `pages.dev` 前加随机后缀；以 Dashboard 显示的地址为准，后续 `--project-name` 也要用实际项目名。

> `wrangler pages deploy` 默认发布 production；加 `--branch=<name>` 才是预览环境。

---

## 三、部署后在 Quest 上测什么

1. 打开 `https://<project>.pages.dev`；
2. 确认页面底部有 **ENTER VR**（不是 “VR NOT SUPPORTED”）；
3. 进入 VR，确认菜单、选歌、暂停、设置、结算都能打开；
4. 重新 push 一版，Quest 刷新，确认新 UI 出现。

常用参数：

```text
?panel=songs
?panel=settings
?chart=demo&panel=songs
?auto=1
```

生产构建里 `?chrome=0` 不再生效（它只隐藏桌面 dev 覆盖层）；VR 里本来也看不到那层 DOM。

---

## 四、常见问题

### 构建失败：找不到 package.json

Root directory 没填 `prototype`。整个构建命令都在 root directory 里执行。

### 部署成功但页面 404 / 资源 404

Build output directory 应为 `dist`，不是 `prototype/dist`（root 已经是 `prototype`）。

### Quest 打开是 HTTP 或提示 WebXR 不可用

必须用 `https://...pages.dev`，不要用局域网 IP。Pages 默认 HTTPS。

### 更新后 Quest 还是旧页面

先关标签重开；仍不行就在 URL 后加 `?v=2`。Pages 的 HTML 可能被浏览器缓存，但带哈希的 JS/CSS 会更新。

### 自定义谱面 / 音频怎么一起上线

放进 `prototype/public/` 再构建，例如：

```text
prototype/public/charts/my-chart.json
prototype/public/packages/my-pack.parallax
prototype/public/track.mp3
```

构建后它们会在 `dist/` 里，用：

```text
?chart=/charts/my-chart.json
?pack=/packages/my-pack.parallax
?audio=/track.mp3
```

访问。注意这些文件会公开在 `pages.dev` 上，不要放未授权的音频。

### 想加访问限制

Pages 项目可以套 **Cloudflare Access**。但 Quest 浏览器里做邮箱验证码登录比较麻烦；原型阶段更常用的是不公开的 `pages.dev` 地址。不要把密钥写进前端。

---

## 五、最短路径

如果只想先跑通：

1. Dashboard 连 GitHub 仓库；
2. Root directory 填 `prototype`；
3. Build command 填 `npm ci && npm run build`；
4. Output 填 `dist`；
5. 保存部署；
6. Quest 打开 `https://<project>.pages.dev`；
7. 以后改完代码 `git push origin main`，等 Deployments 变 Success，Quest 刷新。

参考：[Cloudflare Pages Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/)、[Build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)、[Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)。
