# vovo 产品网站

使用 Paper Blog CLI 的本地项目模式，参考 bobo 官网的 Markdown 单栏结构。首页包含项目介绍、WIP 状态、三张应用截图与安装入口。

```bash
# 在 vovo 仓库根目录执行
paper -l build
paper -l serve --port 8000
```

预览入口以 CLI 输出为准。静态页面生成到 `out/`，与桌面应用的 `dist/` 分开；`out/` 已加入 Git 忽略。

- `.paper-config.json`：项目内配置，紫色强调色、vovo 图标与图片圆角。
- `posts/index.md`：产品首页。
- `posts/getting-started.md`：安装与使用。
- `posts/assets/`：图标和三张原始截图。构建关闭图片压缩，保留截图清晰度。

更改 Markdown 后重新构建，或使用 `serve` 的热更新。当前只完成本地网站创建；发布到 GitHub Pages 需另行执行部署。
