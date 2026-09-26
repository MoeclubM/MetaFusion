package catalog

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metafusion/metafusion-app/internal/capabilities"
)

// gateEngine 挂载真实路由表并把身份直接注入上下文：目录侧的鉴权中间件在无令牌时
// 不覆盖已存在的 catalog_user，因此这里不需要账号服务或数据库。
func gateEngine(u *User) *gin.Engine {
	r := gin.New()
	r.Use(func(c *gin.Context) {
		if u != nil {
			c.Set("catalog_user", u)
		}
		c.Next()
	})
	HTTP{Store: &Store{}}.Register(r)
	return r
}

// 受权限码保护的写端点必须"未登录 401 / 无码 403 / 有码才进处理器"。
// 探针用非法 JSON：处理器在闸门之后先解析 body，返回 invalid_payload(400)，
// 与 401/403 的差别即证明闸门存在且认的是权限码而不是"登录即可"。
func TestProtectedRouteGates(t *testing.T) {
	gin.SetMode(gin.TestMode)
	// 持另一个目录码：能证明被拒的原因是"缺这个码"，而不是"没有权限声明"。
	otherCode := &User{ID: "u-other", Permissions: []string{PermissionEntityEdit}}
	importUser := &User{ID: "u-imp", Permissions: []string{PermissionImportSubmit}}
	relationUser := &User{ID: "u-rel", Permissions: []string{PermissionRelationEdit}}
	wildcard := &User{ID: "u-admin", Permissions: []string{permissionWildcard}}
	id := "00000000-0000-0000-0000-000000000001"

	for _, tc := range []struct {
		name       string
		method     string
		path       string
		withCode   *User
		wantDenied string // 无码/匿名时的期望错误码
	}{
		{"importer preview", http.MethodPost, "/api/importer/preview", importUser, ""},
		{"importer import", http.MethodPost, "/api/importer/import", importUser, ""},
		{"relation create", http.MethodPost, "/api/catalog/relations", relationUser, ""},
		{"relation update", http.MethodPut, "/api/catalog/relations/" + id, relationUser, ""},
		{"relation delete", http.MethodDelete, "/api/catalog/relations/" + id, relationUser, ""},
	} {
		// 匿名：401（未登录）与 403（无权限）必须是两个状态，前端据此决定跳登录还是提示无权限。
		w := httptest.NewRecorder()
		gateEngine(nil).ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, strings.NewReader("{")))
		if w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), "authentication_required") {
			t.Errorf("%s anonymous: status=%d body=%s want 401 authentication_required", tc.name, w.Code, w.Body.String())
		}
		// 登录但持别的目录码：403。
		w = httptest.NewRecorder()
		gateEngine(otherCode).ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, strings.NewReader("{")))
		if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "forbidden") {
			t.Errorf("%s without the code: status=%d body=%s want 403 forbidden", tc.name, w.Code, w.Body.String())
		}
		// 持码（含 * 通配）：过闸门，处理器按非法载荷报 400。
		for _, u := range []*User{tc.withCode, wildcard} {
			w = httptest.NewRecorder()
			gateEngine(u).ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, strings.NewReader("{")))
			if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "invalid_payload") {
				t.Errorf("%s with code %v: status=%d body=%s want 400 invalid_payload", tc.name, u.Permissions, w.Code, w.Body.String())
			}
		}
	}
}

// 墓碑端点的闸门由组合根注入（capabilities.Register 的第二个参数），这里用真实验签器与真实令牌
// 跑端到端：未登录 401、非管理员 403，管理员才拿到 409 与 hint。少了任何一层，未登录都能拿到 409。
func TestModuleToggleRetiredGate(t *testing.T) {
	gin.SetMode(gin.TestMode)
	key := testKey(t)
	s := &Store{Verifier: testVerifier(t, key)}
	engine := gin.New()
	capabilities.New(func(string) string { return "" }).Register(engine, HTTP{Store: s}.AdminGate())

	put := func(token string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPut, "/api/admin/modules/community", nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		engine.ServeHTTP(w, req)
		return w
	}
	// 未登录：401，且响应里不该出现墓碑机器码与 hint。
	if w := put(""); w.Code != http.StatusUnauthorized || !strings.Contains(w.Body.String(), "authentication_required") || strings.Contains(w.Body.String(), "module_toggle_retired") {
		t.Fatalf("未登录应 401 且不泄漏墓碑响应: status=%d body=%s", w.Code, w.Body.String())
	}
	// 非管理员（editor 只带 catalog.entity.edit）：403。
	editor := signTestToken(t, key, func(c Claims) Claims {
		c.Permissions = []string{PermissionEntityEdit}
		return c
	})
	if w := put(editor); w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "forbidden") {
		t.Fatalf("非管理员应 403: status=%d body=%s", w.Code, w.Body.String())
	}
	// 管理员（admin 组的 * 通配）：才拿到 409 与 hint。
	admin := signTestToken(t, key, func(c Claims) Claims {
		c.Permissions = []string{permissionWildcard}
		return c
	})
	if w := put(admin); w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), "module_toggle_retired") || !strings.Contains(w.Body.String(), "hint") {
		t.Fatalf("管理员应拿到 409 + hint: status=%d body=%s", w.Code, w.Body.String())
	}
	// 没有 permissions 的旧令牌不可借角色获得管理权限。
	legacy := signTestToken(t, key, func(c Claims) Claims {
		c.Permissions = nil
		return c
	})
	if w := put(legacy); w.Code != http.StatusForbidden {
		t.Fatalf("无权限码的令牌应拒绝: status=%d body=%s", w.Code, w.Body.String())
	}
}

// resetPreviewBucket 清掉预览路由的限流计数：限流桶是进程级全局状态，
// 用例之间共享配额会让断言依赖执行顺序。
func resetPreviewBucket() {
	routeAttempts.Range(func(k, _ any) bool {
		if s, ok := k.(string); ok && strings.HasSuffix(s, "|/api/importer/preview") {
			routeAttempts.Delete(k)
		}
		return true
	})
}

// 预览端点带 10/min 限流（与 /compare 同档）：第 11 次请求被 429 挡住并给 Retry-After。
// 计数桶按 IP+路由，本用例进出都清桶，避免影响其它用例。
func TestImporterPreviewIsRateLimited(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetPreviewBucket()
	defer resetPreviewBucket()
	u := &User{ID: "u-rl", Permissions: []string{PermissionImportSubmit}}
	engine := gateEngine(u)
	for i := 0; i < 10; i++ {
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/importer/preview", strings.NewReader("{")))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("request %d: status=%d body=%s want 400", i+1, w.Code, w.Body.String())
		}
	}
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/importer/preview", strings.NewReader("{")))
	if w.Code != http.StatusTooManyRequests || !strings.Contains(w.Body.String(), "rate_limited") {
		t.Fatalf("11th request: status=%d body=%s want 429 rate_limited", w.Code, w.Body.String())
	}
	if w.Header().Get("Retry-After") == "" {
		t.Fatal("429 must carry Retry-After")
	}
}

// 预览端点拒绝 media_type_hint：该字段是声明而非输入（来源解析按 URL/ID 判定媒介类型），
// 非空即 400 not_supported（旧行为是收下后从不读取）。
func TestImporterPreviewRejectsMediaTypeHint(t *testing.T) {
	gin.SetMode(gin.TestMode)
	resetPreviewBucket()
	u := &User{ID: "u-hint", Permissions: []string{PermissionImportSubmit}}
	w := httptest.NewRecorder()
	body := strings.NewReader(`{"url_or_id":"7","media_type_hint":"music"}`)
	gateEngine(u).ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/importer/preview", body))
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "media_type_hint") {
		t.Fatalf("media_type_hint must be rejected: status=%d body=%s", w.Code, w.Body.String())
	}
}

// /tags 查询失败必须暴露错误：旧行为是 200 + 空表，DB 故障看起来像"库里没有标签"，
// 前端标签云与筛选建议会静默变空。
func TestTagsEndpointReportsQueryFailure(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dsn := strings.TrimSpace(os.Getenv("MF_V2_TEST_DSN"))
	if dsn == "" {
		t.Skip("MF_V2_TEST_DSN must identify an isolated PostgreSQL test server")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	// 立即关闭的连接池：任何查询都返回 "sql: database is closed"，
	// 用它验证 /tags 不再把查询失败吞成 200 空表。
	_ = db.Close()
	engine := gin.New()
	HTTP{Store: &Store{DB: db}}.Register(engine)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/catalog/tags", nil))
	// 只断言"错误被暴露"：连接级失败不是 pq.Error，respond 目前给出的还不是 5xx
	// （见报告里的新发现：respond 对非 pq 的库错误仍按 400 透出原文），
	// 本用例钉住的是"不再吞成 200 空表"。
	if w.Code == http.StatusOK || !strings.Contains(w.Body.String(), "error") {
		t.Fatalf("tags query failure must surface an error instead of an empty 200: status=%d body=%s", w.Code, w.Body.String())
	}
}

// 反向对照：只要求登录的端点对"无任何目录码的登录用户"照旧放行（400 而非 403），
// 避免把闸门加宽的改动顺手扩到实体草稿这类既有入口。
func TestLoginOnlyRouteStaysOpen(t *testing.T) {
	gin.SetMode(gin.TestMode)
	plain := &User{ID: "u-plain", Permissions: []string{"community.post.create"}}
	w := httptest.NewRecorder()
	gateEngine(plain).ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/catalog/entities", strings.NewReader("{")))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("login-only endpoint rejected a logged-in user: status=%d body=%s", w.Code, w.Body.String())
	}
}
