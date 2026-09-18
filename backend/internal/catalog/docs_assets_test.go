package catalog

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

// 文档页只能引用同源资源：正面要求是「页面里没有任何第三方 URL」（审计 S-4：无 SRI 的 CDN
// 脚本与主站同源执行），反向要求是「页面引用的每个资源都在白名单里」——否则页面拿到 404，
// 等于把文档打挂却没人发现。
func TestDocsPagesReferenceOnlySelfHostedAssets(t *testing.T) {
	urlRe := regexp.MustCompile(`(?:src|href)="([^"]+)"`)
	pages := map[string]string{"/api/docs": docsHTML, "/api/swagger": swaggerHTML}
	for name, html := range pages {
		refs := urlRe.FindAllStringSubmatch(html, -1)
		if len(refs) == 0 {
			t.Fatalf("%s: 页面里一个 src/href 都没解析到，正则或页面结构变了", name)
		}
		for _, m := range refs {
			ref := m[1]
			if strings.Contains(ref, "//") {
				t.Errorf("%s 引用了站外资源 %q：文档页脚本必须同源自托管", name, ref)
				continue
			}
			asset, ok := strings.CutPrefix(ref, "/api/docs/assets/")
			if !ok {
				continue // 页内同源资源（/favicon.svg 等）
			}
			if _, ok := docsAssets[asset]; !ok {
				t.Errorf("%s 引用了白名单外的资源 %q：页面会拿到 404", name, ref)
			}
		}
	}
}

// 摘要与上游发布物逐字一致（升级时同步改 docsassets/PROVENANCE.md 与本表）。CDN 时代这条保证
// 由 SRI 提供，自托管后由仓库内摘要承担：任何对这几份压缩产物的静默改动都会在这里失败。
func TestDocsAssetsMatchPinnedDigests(t *testing.T) {
	want := map[string]string{
		"scalar-standalone.js":            "48289f8a965d73ae510c469462cac0d8f72865de705e186278d5485058b2a5fc",
		"swagger-ui.css":                  "1ac324f7dcd27e4b9386b4bd6421271ec147e922a22c05ba24b11515e9aa6321",
		"swagger-ui-bundle.js":            "62df541529080464a7660adc793eab7128c6193ce3be24ddc1e0e0a4a63edc2f",
		"swagger-ui-standalone-preset.js": "5243d492e14505e0cab87ac8b0195d0e615943e651743b2b698450a46eb470be",
	}
	if len(docsAssets) != len(want) {
		t.Fatalf("白名单条目 %d 个，期望 %d 个：新增资源要同时更新本表", len(docsAssets), len(want))
	}
	for name, sum := range want {
		a, ok := docsAssets[name]
		if !ok {
			t.Errorf("白名单缺 %s", name)
			continue
		}
		got := sha256.Sum256(a.body)
		if hex.EncodeToString(got[:]) != sum {
			t.Errorf("%s 摘要变了：确认它是上游同名版本的发布物并同步 PROVENANCE.md", name)
		}
		if len(a.body) < 1024 {
			t.Errorf("%s 只有 %d 字节，像是没真正落盘的占位文件", name, len(a.body))
		}
	}
}

// 资源与页面同一道闸门（匿名 401 / 无管理码 403 / 管理员 200），且带 nosniff 与 ETag；
// 白名单外的名字一律 404——包括路径穿越写法：白名单是键比对，不做任何路径拼接。
func TestDocsAssetsServedBehindGate(t *testing.T) {
	admin := &User{ID: "u-admin", Role: "admin", Permissions: []string{PermissionLifecycleManage}}
	editor := &User{ID: "u-editor", Role: "editor", Permissions: []string{PermissionEntityEdit}}
	first := "/api/docs/assets/swagger-ui.css"
	w := httptest.NewRecorder()
	gateEngine(nil).ServeHTTP(w, httptest.NewRequest(http.MethodGet, first, nil))
	if w.Code != http.StatusUnauthorized {
		t.Errorf("匿名取资源: status=%d, want 401", w.Code)
	}
	w = httptest.NewRecorder()
	gateEngine(editor).ServeHTTP(w, httptest.NewRequest(http.MethodGet, first, nil))
	if w.Code != http.StatusForbidden {
		t.Errorf("无管理码取资源: status=%d, want 403", w.Code)
	}
	for name := range docsAssets {
		path := "/api/docs/assets/" + name
		w = httptest.NewRecorder()
		gateEngine(admin).ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusOK {
			t.Fatalf("%s 管理员取资源: status=%d body=%.120s", path, w.Code, w.Body.String())
		}
		if got := w.Header().Get("X-Content-Type-Options"); got != "nosniff" {
			t.Errorf("%s X-Content-Type-Options=%q, want nosniff", path, got)
		}
		if w.Header().Get("ETag") == "" {
			t.Errorf("%s 缺 ETag：浏览器每次都要重下整份资源", path)
		}
		if w.Body.Len() != len(docsAssets[name].body) {
			t.Errorf("%s 下发长度 %d，期望 %d", path, w.Body.Len(), len(docsAssets[name].body))
		}
	}
	for _, path := range []string{
		"/api/docs/assets/unknown.js",
		"/api/docs/assets/../docs_assets.go",
		"/api/docs/assets/%2e%2e/docs_assets.go",
		"/api/docs/assets/",
	} {
		w = httptest.NewRecorder()
		gateEngine(admin).ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusNotFound {
			t.Errorf("%s: status=%d, want 404", path, w.Code)
		}
	}
}
