package catalog

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// 权限码是账号服务与目录侧的共享契约：改名等于改两边，这里把拼写钉死
// （对照 metafusion-auth/internal/store/access.go 的 PermissionCatalog 与 seed_groups.go）。
func TestCatalogPermissionCodesMatchAccountService(t *testing.T) {
	want := []string{"catalog.entity.edit", "catalog.relation.edit", "catalog.definitions.manage", "catalog.lifecycle.manage", "catalog.import.submit", "catalog.shelves.manage"}
	if len(catalogPermissionCodes) != len(want) {
		t.Fatalf("catalog permission code drift: %v", catalogPermissionCodes)
	}
	for _, code := range want {
		if !contains(catalogPermissionCodes, code) {
			t.Fatalf("missing catalog permission code %q", code)
		}
	}
}

// 令牌带 permissions 时以码为准：放行、拒绝、* 通配各一条。
func TestCanHonoursTokenPermissions(t *testing.T) {
	editor := User{Role: "member", Permissions: []string{PermissionEntityEdit, PermissionRelationEdit}}
	if !editor.Can(PermissionEntityEdit) {
		t.Fatal("granted permission code must pass")
	}
	if editor.Can(PermissionDefinitionsManage) || editor.Can(PermissionLifecycleManage) {
		t.Fatalf("ungranted permission code must be denied: %+v", editor)
	}
	wildcard := User{Role: "member", Permissions: []string{permissionWildcard}}
	for _, code := range catalogPermissionCodes {
		if !wildcard.Can(code) {
			t.Fatalf("wildcard must grant %q", code)
		}
	}
	// 其它子系统的码与本服务无关：没声明 catalog 码就不放行目录能力。
	foreign := User{Role: "admin", Permissions: []string{"community.post.moderate"}}
	if foreign.Can(PermissionEntityEdit) {
		t.Fatal("foreign-service codes must not grant catalog capabilities")
	}
}

// 老令牌（没有 permissions 声明）按历史角色兜底：未按权限组配置的实例与有效期内
// 的老令牌都不能被这次改动打死。
func TestCanLegacyRoleFallback(t *testing.T) {
	admin := User{Role: "admin"}
	for _, code := range catalogPermissionCodes {
		if !admin.Can(code) {
			t.Fatalf("legacy admin must pass %q", code)
		}
	}
	if admin.Can("community.post.moderate") {
		t.Fatal("role fallback must stay inside catalog codes")
	}
	editor := User{Role: "editor"}
	if !editor.Can(PermissionEntityEdit) {
		t.Fatal("legacy editor must keep entity editing")
	}
	for _, code := range []string{PermissionRelationEdit, PermissionDefinitionsManage, PermissionLifecycleManage, PermissionImportSubmit, PermissionShelvesManage} {
		if editor.Can(code) {
			t.Fatalf("legacy editor must stay out of admin-only code %q", code)
		}
	}
	for _, legacy := range []User{{Role: "user"}, {Role: ""}} {
		if legacy.Can(PermissionEntityEdit) {
			t.Fatalf("non-editor legacy role must not gain catalog capabilities: %+v", legacy)
		}
	}
	// 令牌一旦带了 permissions 就以码为准：角色不再额外放行，否则兜底会变成绕过权限组的后门。
	limited := User{Role: "admin", Permissions: []string{PermissionEntityEdit}}
	if !limited.Can(PermissionEntityEdit) || limited.Can(PermissionLifecycleManage) {
		t.Fatalf("explicit permissions must win over the legacy role: %+v", limited)
	}
}

// S01：显式空权限不得回落 admin（空数组、显式 null、非 nil 空集合三种形态）；
// 缺键老令牌（nil、无标记、非 PAT、非第三方）保持历史兜底（见 TestCanLegacyRoleFallback）。
func TestCanDeniesExplicitEmptyAdmin(t *testing.T) {
	for _, u := range []User{
		{Role: "admin", Permissions: []string{}, PermissionsSet: true},
		{Role: "admin", Permissions: []string{}},
		{Role: "admin", PermissionsSet: true},
	} {
		for _, code := range catalogPermissionCodes {
			if u.Can(code) {
				t.Fatalf("显式空权限不得回落 admin：%+v 不该放行 %s", u, code)
			}
		}
	}
	// 对照：缺键老令牌的 admin 兜底必须保持（历史令牌兼容）。
	if !(User{Role: "admin"}).Can(PermissionLifecycleManage) {
		t.Fatal("缺键老令牌的 admin 兜底必须保持")
	}
}

// S01：第三方 OAuth 身份在治理码上直接拒绝，即使带 * 通配或显式持有该码，
// 即使令牌形态像老令牌（缺 permissions 键）——第三方标记优先于一切兜底。
func TestCanDeniesThirdPartyGovernance(t *testing.T) {
	for _, u := range []User{
		{Role: "admin", Permissions: []string{permissionWildcard}, IsThirdParty: true, PermissionsSet: true},
		{Role: "user", Permissions: []string{PermissionEntityEdit}, IsThirdParty: true, PermissionsSet: true},
		{Role: "admin", IsThirdParty: true},
	} {
		for _, code := range catalogPermissionCodes {
			if u.Can(code) {
				t.Fatalf("第三方不得放行治理码：%+v 不该放行 %s", u, code)
			}
		}
	}
}

// S01：载荷的 permissions 键存在性决定分支（缺键老令牌 vs 显式空声明），
// scope/client_id 任一非空即第三方（与社区 cabfa6c 同规则）。
func TestClaimsPresenceAndThirdPartyMapping(t *testing.T) {
	var c Claims
	if err := json.Unmarshal([]byte(`{"sub":"u-1","permissions":[]}`), &c); err != nil || !c.permissionsPresent || c.Permissions == nil {
		t.Fatalf("显式空数组应记存在且非 nil：%v %+v", err, c)
	}
	var missing Claims
	if err := json.Unmarshal([]byte(`{"sub":"u-1"}`), &missing); err != nil || missing.permissionsPresent || missing.Permissions != nil {
		t.Fatalf("缺键应记不存在且 nil：%v %+v", err, missing)
	}
	var nul Claims
	if err := json.Unmarshal([]byte(`{"sub":"u-1","permissions":null}`), &nul); err != nil || !nul.permissionsPresent || nul.Permissions != nil {
		t.Fatalf("显式 null 应记存在但 nil：%v %+v", err, nul)
	}
	var tp Claims
	if err := json.Unmarshal([]byte(`{"sub":"u-1","scope":"openid profile","client_id":"third-party-app"}`), &tp); err != nil {
		t.Fatal(err)
	}
	u := ClaimsToUser(&tp)
	if u == nil || !u.IsThirdParty {
		t.Fatalf("带 OAuth 标记的载荷应为第三方：%+v", u)
	}
	session := ClaimsToUser(&c)
	if session == nil || session.IsThirdParty || !session.PermissionsSet {
		t.Fatalf("会话载荷不应标第三方且应带存在标记：%+v", session)
	}
	if ClaimsToUser(nil) != nil {
		t.Fatal("nil 载荷应得 nil 用户")
	}
}

// 权限码放行与拒绝落到编辑判定上：同一实体，持码者与无码者结果不同，角色不参与。
func TestEditingDecidedByPermissionCode(t *testing.T) {
	for _, tc := range []struct {
		name string
		u    User
		e    Entity
		want bool
	}{
		{"entity.edit maintains foreign published", User{ID: "self", Role: "member", Permissions: []string{PermissionEntityEdit}}, Entity{Status: "published", CreatedBy: "other"}, true},
		{"no code cannot maintain foreign published", User{ID: "self", Role: "member", Permissions: []string{"community.post.create"}}, Entity{Status: "published", CreatedBy: "other"}, false},
		{"no code may still edit own draft", User{ID: "self", Role: "member", Permissions: []string{"community.post.create"}}, Entity{Status: "draft", CreatedBy: "self"}, true},
		{"own published needs the code", User{ID: "self", Role: "member", Permissions: []string{"community.post.create"}}, Entity{Status: "published", CreatedBy: "self"}, false},
		{"entity.edit stays out of foreign drafts", User{ID: "self", Role: "member", Permissions: []string{PermissionEntityEdit}}, Entity{Status: "draft", CreatedBy: "other"}, false},
		{"lifecycle.manage reaches foreign drafts", User{ID: "self", Role: "member", Permissions: []string{PermissionLifecycleManage}}, Entity{Status: "draft", CreatedBy: "other"}, true},
		{"terminated status stays closed", User{ID: "self", Role: "member", Permissions: []string{permissionWildcard}}, Entity{Status: "merged", CreatedBy: "self"}, false},
	} {
		if got := canEditEntity(tc.u, tc.e); got != tc.want {
			t.Errorf("%s: canEditEntity=%v want=%v", tc.name, got, tc.want)
		}
		if got := canWriteRelation(tc.u, tc.e); got != tc.want {
			t.Errorf("%s: canWriteRelation=%v want=%v", tc.name, got, tc.want)
		}
	}
	// 关系目标端否决权：持实体编辑权可挂他人公开条目，无码者不可。
	published := Entity{Status: "published", CreatedBy: "other"}
	if !canAttachToTarget(User{ID: "self", Role: "member", Permissions: []string{PermissionEntityEdit}}, published) {
		t.Fatal("catalog.entity.edit must attach to published targets")
	}
	if canAttachToTarget(User{ID: "self", Role: "member", Permissions: []string{"community.post.create"}}, published) {
		t.Fatal("member without catalog code must not attach to foreign published targets")
	}
}

// 路由闸门：403 由权限码决定，401 才是未登录；老令牌按角色兜底仍能进。
func TestRequiredGateUsesPermissionCode(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name string
		u    *User
		want int
	}{
		{"anonymous", nil, http.StatusUnauthorized},
		{"ungranted code", &User{Role: "member", Permissions: []string{"community.post.create"}}, http.StatusForbidden},
		{"granted code", &User{Role: "member", Permissions: []string{PermissionDefinitionsManage}}, http.StatusOK},
		{"wildcard", &User{Role: "member", Permissions: []string{permissionWildcard}}, http.StatusOK},
		{"legacy admin token", &User{Role: "admin"}, http.StatusOK},
		{"legacy member token", &User{Role: "user"}, http.StatusForbidden},
		{"explicit empty admin", &User{Role: "admin", Permissions: []string{}, PermissionsSet: true}, http.StatusForbidden},
		{"third-party admin wildcard", &User{Role: "admin", Permissions: []string{permissionWildcard}, IsThirdParty: true}, http.StatusForbidden},
		{"third-party explicit code", &User{Role: "user", Permissions: []string{PermissionDefinitionsManage}, IsThirdParty: true}, http.StatusForbidden},
	} {
		r := gin.New()
		r.GET("/x", func(c *gin.Context) {
			if tc.u != nil {
				c.Set("catalog_user", tc.u)
			}
		}, required(PermissionDefinitionsManage), func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/x", nil))
		if w.Code != tc.want {
			t.Errorf("%s: status=%d want=%d", tc.name, w.Code, tc.want)
		}
	}
	// code 为空只要求登录：任意登录用户都能过（含第三方，自助草稿走所有权判定）。
	r := gin.New()
	r.GET("/x", func(c *gin.Context) { c.Set("catalog_user", &User{Role: "member"}) }, required(""), func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/x", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("authenticated-only gate rejected a logged-in user: %d", w.Code)
	}
	r2 := gin.New()
	r2.GET("/x", func(c *gin.Context) {
		c.Set("catalog_user", &User{Role: "user", IsThirdParty: true})
	}, required(""), func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })
	w2 := httptest.NewRecorder()
	r2.ServeHTTP(w2, httptest.NewRequest(http.MethodGet, "/x", nil))
	if w2.Code != http.StatusOK {
		t.Fatalf("authenticated-only gate must stay open to third-party callers: %d", w2.Code)
	}
}
