package catalog

// 交互式文档页的静态资源：随二进制自托管，页面不再从公共 CDN 取脚本。
// 为什么不用 CDN：这几份文件与主站同源执行，没有 SRI 时等于把脚本信任边界交给第三方
// （2026-09-19 审计 S-4）。升级方式与许可见 docsassets/PROVENANCE.md。

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

//go:embed docsassets
var docsAssetFS embed.FS

// docsAssetTypes 是唯一的可下发清单：键即 URL 末段，没有路径拼接，因此不存在目录遍历面。
// 内容类型写死在表里，不按扩展名猜（nosniff 之外再加一道）。embed 会连 Apache-2.0 的
// LICENSE/NOTICE 一起带进二进制，能否下发只由本表决定。
var docsAssetTypes = map[string]string{
	"scalar-standalone.js":            "text/javascript; charset=utf-8",
	"swagger-ui.css":                  "text/css; charset=utf-8",
	"swagger-ui-bundle.js":            "text/javascript; charset=utf-8",
	"swagger-ui-standalone-preset.js": "text/javascript; charset=utf-8",
}

// docsAssets 启动时一次性读入：内容是构建期固定的、不随请求与用户变化，摘要可以在这时算好，
// 之后每次请求只回字节，不做重复 I/O 与哈希。
var docsAssets = loadDocsAssets()

type docsAsset struct {
	body        []byte
	contentType string
	etag        string
}

func loadDocsAssets() map[string]docsAsset {
	out := make(map[string]docsAsset, len(docsAssetTypes))
	for name, contentType := range docsAssetTypes {
		body, err := docsAssetFS.ReadFile("docsassets/" + name)
		if err != nil {
			// 文件在 embed 里就不该读不到：只可能是清单与目录不同步，启动即暴露。
			panic("catalog: docsassets/" + name + ": " + err.Error())
		}
		sum := sha256.Sum256(body)
		out[name] = docsAsset{body: body, contentType: contentType, etag: "\"" + hex.EncodeToString(sum[:16]) + "\""}
	}
	return out
}

// docsAssetsHandler 下发文档页资源，挂在 /api/docs 组下，与页面同一道管理闸门。
func docsAssetsHandler(c *gin.Context) {
	name := strings.TrimPrefix(c.Param("filepath"), "/")
	a, ok := docsAssets[name]
	if !ok {
		c.JSON(404, gin.H{"error": "not_found"})
		return
	}
	c.Header("Content-Type", a.contentType)
	c.Header("X-Content-Type-Options", "nosniff")
	// 内容只随版本变化：同一版本内让浏览器复用；仍标 private，避免被任何共享缓存留存。
	c.Header("ETag", a.etag)
	c.Header("Cache-Control", "private, max-age=86400")
	// ServeContent 负责 If-None-Match 与 Range；modtime 传零值表示不发 Last-Modified
	// （构建期内容没有有意义的修改时间，摘要才是版本标识）。
	http.ServeContent(c.Writer, c.Request, name, time.Time{}, bytes.NewReader(a.body))
}
