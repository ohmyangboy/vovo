# vovo 产品网站

使用 Paper Blog CLI 的本地项目模式，参考 bobo 官网的 Markdown 单栏结构。首页包含项目介绍、WIP 状态、三张应用截图与安装入口。

```bash
# 在 vovo 仓库根目录执行
paper -l build
paper -l serve --port 8000
```

预览入口以 CLI 输出为准。静态页面生成到 `out/`，与桌面应用的 `dist/` 分开。Paper 的原生部署需要将 `out/` 提交到 Git，再通过 subtree 发布至 `gh-pages`，因此网站构建产物纳入版本管理。

- `.paper-config.json`：项目内配置，紫色强调色、vovo 图标与图片圆角。
- `posts/index.md`：产品首页。
- `posts/getting-started.md`：安装与使用。
- `posts/assets/`：图标和三张原始截图。构建关闭图片压缩，保留截图清晰度。

更改 Markdown 后重新构建，或使用 `serve` 的热更新。

## 发布

线上地址：<https://ohmyangboy.github.io/vovo/>

在仓库根目录执行：

```bash
paper -l build
touch out/.nojekyll
paper -l deploy
git push origin main
```

`deploy` 会提交网站产物，并将 `out/` 推送到 `gh-pages` 分支。最后将该提交同步到 `main`，保留后续 subtree 发布所需的历史。GitHub Pages 使用 `gh-pages` 分支根目录作为发布源；部署需要等待 GitHub 的构建完成，不能仅凭 CLI 推送成功判断网站已上线。
