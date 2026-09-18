# 交互式文档页的第三方静态资源（自托管）

这两份页面原先直接从公共 CDN 取脚本（`cdn.jsdelivr.net` / `unpkg.com`），没有 SRI，也没有 CSP
兜底：CDN 任一侧被投毒就等于在主站同源执行任意脚本（2026-09-19 审计 S-4，与主前端 `localStorage`
里的令牌叠加即账号接管）。现在文件随二进制一起发布，页面只引用同源
`/api/docs/assets/<name>`，不再存在第三方脚本通道；页面本身也在
`catalog.lifecycle.manage` 闸门之后（管理面）。

| 文件 | 上游包 | 版本 | sha256 |
| --- | --- | --- | --- |
| `scalar-standalone.js` | `@scalar/api-reference` | 1.69.0 | `48289f8a965d73ae510c469462cac0d8f72865de705e186278d5485058b2a5fc` |
| `swagger-ui.css` | `swagger-ui-dist` | 5.33.0 | `1ac324f7dcd27e4b9386b4bd6421271ec147e922a22c05ba24b11515e9aa6321` |
| `swagger-ui-bundle.js` | `swagger-ui-dist` | 5.33.0 | `62df541529080464a7660adc793eab7128c6193ce3be24ddc1e0e0a4a63edc2f` |
| `swagger-ui-standalone-preset.js` | `swagger-ui-dist` | 5.33.0 | `5243d492e14505e0cab87ac8b0195d0e615943e651743b2b698450a46eb470be` |

许可：`@scalar/api-reference` 为 MIT（以该 npm 包元数据的 `license` 字段为准，上游仓库为
<https://github.com/scalar/scalar>）；`swagger-ui-dist` 为 Apache-2.0，其
`LICENSE-swagger-ui.txt` 与 `NOTICE-swagger-ui.txt` 一并放在本目录并随二进制发布。
新增文件前先确认许可允许再分发。

## 升级方式

1. 从上面两个 npm 包的同名文件取新版覆盖（固定版本号，不要用 `@5` 这类浮动 tag）。
2. `sha256sum` 重算并写回本表，同时更新 `docs_assets_test.go` 里的期望摘要。
3. 跑 `go test ./internal/catalog/ -run 'Docs|OpenAPI'` 与 `go build ./...`。

## 约束

- 页面脚本只能引用 `/api/docs/assets/` 下的白名单文件；`docs_gate_test.go` 会断言页面里
  没有第三方 URL，`docs_assets_test.go` 会断言白名单外的名字取不到东西、摘要与国际版本一致。
- 不要把页面改回 CDN：这几份文件是在主源上执行的，属于主站的脚本信任边界，不是普通静态资源。
