# 文档站唯一源约定

面向公众的文档（实体模型、编目指南、REST API、法务页）只存在于独立仓库 [metafusion-docs](https://github.com/MoeclubM/metafusion-docs)：
本仓库不保留文档副本，`deploy/docker-compose.yml` 的文档服务以兄弟目录 `../../metafusion-docs` 为构建上下文，
网关把 `/docs/` 反代到该服务。

## 决策依据

拆分前同一批文档在主仓库与 `metafusion-docs` 各存一份并已经分叉，两边都要人盯，容易出现"改了一份忘了同步"。
文档站是独立发布物（VitePress 静态站），与本仓库的代码发布节奏不同，因此把内容源定在 `metafusion-docs`：
该仓库自己跑构建与死链自查，本仓库只负责编排部署。

## 约束

- 网关把 `/docs` 反代到文档站容器（compose 服务名 `docs-site`，容器内端口 `3001`）。
- **只部署一份**：无论本地还是服务器，都不允许出现两个同名容器或两处静态副本，否则容器名与端口会冲突。
- 文档改动与代码改动同批推进时，两个仓库各自提交：本仓库改代码与编排，`metafusion-docs` 改内容。
- 文档站镜像没有仓库发布（`metafusion-docs` 的 CI 只跑 VitePress 构建与死链自查）。
  因此 `deploy/docker-compose.prod.yml` 只给它一个镜像名、**保留 `build`**，而 `deploy.sh pull` 带 `--ignore-pull-failures`：
  镜像缺席时就地从 `../../metafusion-docs` 构建。
