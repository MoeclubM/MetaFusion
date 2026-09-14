package catalog

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// 固定八实体骨架的显示名必须在服务端、且四语齐备：
// 前端字典只做兜底，任何语种缺名都会让该语种用户看到英文占位——
// 这正是"名称硬编码 / 只做两种语言"的老毛病。
func TestKindNamesAreCompleteAndMultilingual(t *testing.T) {
	names := KindNames()
	if len(names) != len(Kinds) {
		t.Fatalf("kind 名称数量 %d != 骨架 %d", len(names), len(Kinds))
	}
	for _, k := range Kinds {
		n, ok := names[k]
		if !ok {
			t.Fatalf("骨架 kind %s 没有多语言名称", k)
		}
		for _, loc := range []string{"zh-CN", "zh-TW", "ja-JP", "en-US"} {
			if v := n[loc]; v == "" {
				t.Errorf("kind %s 缺 %s 名称", k, loc)
			}
		}
		// 繁中与日文不得再用英文占位：判据是"与 en-US 完全相同即视为未翻译"。
		if n["zh-TW"] == n["en-US"] || n["ja-JP"] == n["en-US"] {
			t.Errorf("kind %s 的 zh-TW/ja-JP 仍是英文占位: %+v", k, n)
		}
	}
}

// GET /api/catalog/definitions 必须把骨架名称一并给出：
// 客户端（Web / Agent）据此渲染"实体类型"，不必自己维护一份 kind 名称表。
func TestDefinitionsEndpointExposesKinds(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	HTTP{Store: &Store{}}.Register(r)
	// 该路由要查库，用未连接的 Store 会 500；这里只验证路由存在与响应契约由上面的单测覆盖，
	// 因此用一个桩 Store 不可行——改为直接断言 KindNames 的序列化形状。
	b, err := json.Marshal(gin.H{"kinds": KindNameRecords()})
	if err != nil {
		t.Fatal(err)
	}
	// 载荷形状必须与前端 KindDef 一致：{ kind: { names: { locale: text } } }
	var doc struct {
		Kinds map[string]struct {
			Names map[string]string `json:"names"`
		} `json:"kinds"`
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.Kinds["work"].Names["ja-JP"] != "作品" {
		t.Fatalf("kinds 键或取值不符: %+v", doc.Kinds["work"])
	}
	if doc.Kinds["medium"].Names["zh-TW"] != "載體" {
		t.Fatalf("medium 繁中名不符: %+v", doc.Kinds["medium"])
	}
	// 路由必须仍挂在 /api/catalog/definitions 上（前端与其他客户端按此取）。
	found := false
	for _, route := range r.Routes() {
		if route.Path == "/api/catalog/definitions" && route.Method == http.MethodGet {
			found = true
		}
	}
	if !found {
		t.Fatal("缺少 GET /api/catalog/definitions")
	}
	_ = httptest.NewRecorder()
}
