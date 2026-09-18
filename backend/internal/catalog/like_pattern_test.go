package catalog

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// LIKE 元字符必须按字面处理：不转义时 q="%" 命中全库、q="_" 命中任意单字符。
// 期望值是"用户输入 → 转义 → 两侧补 %"的逐字符结果，覆盖 %、_ 与转义符本身。
func TestLikeContainsEscapesMetacharacters(t *testing.T) {
	cases := []struct{ in, want string }{
		{"", "%%"},
		{"原创歌曲", "%原创歌曲%"},
		{"%", `%\%%`},
		{"_", `%\_%`},
		{"100%", `%100\%%`},
		{`\`, `%\\%`},
		{`a\b`, `%a\\b%`},
		{`%_%`, `%\%\_\%%`},
		{`a_b%c\d`, `%a\_b\%c\\d%`},
		// 顺序敏感用例：必须先转义反斜杠再补 % 和 _，顺序颠倒会把 `\%` 转成四个反斜杠。
		{`\%`, `%\\\%%`},
	}
	for _, c := range cases {
		if got := likeContains(c.in); got != c.want {
			t.Errorf("likeContains(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// 实体查询构造器必须把转义后的模式交给 ILIKE（纯 SQL 构造，不需要数据库）：
// 断言的是真的传到绑定参数的值，而不是"helper 本身写对了"。
func TestEntityQueryUsesEscapedPattern(t *testing.T) {
	args := []any{}
	parts, err := listFilter(listFilterSearchCtx(listFilterSearchDefinitions()), &Store{}, ListOptions{Query: "%"}, nil, &args)
	if err != nil {
		t.Fatal(err)
	}
	if sql := strings.Join(parts, " AND "); !strings.Contains(sql, "ILIKE") {
		t.Fatalf("query predicate lost ILIKE: %s", sql)
	}
	if len(args) != 1 || args[0] != likeContains("%") {
		t.Fatalf("args = %#v, want [%q]", args, likeContains("%"))
	}
}

// 真库回归（无 MF_V2_TEST_DSN 时 testutil.Database 自动 Skip）：搜索词里的 LIKE 元字符
// 只按字面命中——q="%" 不能再返回全库，q="_" 也不能当单字符通配符。
func TestPostgresSearchTreatsWildcardsLiterally(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	percent := f.save(Entity{Kind: "work", Title: "销量 100% 纪念版"})
	underscore := f.save(Entity{Kind: "work", Title: "下划线_样本"})
	f.save(Entity{Kind: "work", Title: "普通题名"})
	// 字面 %/_ 的标签，覆盖 /tags 那个 ILIKE 拼接点。
	// 必须声明 Types：可写属性集合由实体已声明的类型决定（album 的字段集含 tags），
	// 没有类型的实体 attributes 一律 unknown_field——那与 LIKE 转义无关，
	// 是这条夹具原先少了类型声明（tags 本身是已启用的种子字段）。
	f.save(Entity{Kind: "work", Title: "标签样本甲", Types: []string{"album"}, Attributes: map[string]any{"tags": []string{"销量100%"}}})
	f.save(Entity{Kind: "work", Title: "标签样本乙", Types: []string{"album"}, Attributes: map[string]any{"tags": []string{"下划线_标签"}}})

	all, err := f.s.Count(ctx, ListOptions{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if all != 5 {
		t.Fatalf("baseline total = %d, want the 5 fixtures", all)
	}

	hit, err := f.s.Count(ctx, ListOptions{Query: "%"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if hit != 1 {
		t.Fatalf("total for q=%% = %d, want 1 (only the entity whose title carries a literal %%)", hit)
	}
	if hit >= all {
		t.Fatalf("q=%% still returns the whole library: total=%d baseline=%d", hit, all)
	}
	items, err := f.s.List(ctx, ListOptions{Query: "%"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ID != percent.ID {
		t.Fatalf("q=%% items = %d, want only the literal-%% entity %s", len(items), percent.ID)
	}
	// 转义不能把正常的包含匹配一起弄丢：字面 % 实体照旧搜得到。
	if items, err = f.s.List(ctx, ListOptions{Query: "100%"}, nil); err != nil || len(items) != 1 || items[0].ID != percent.ID {
		t.Fatalf("q=100%% items = %d err=%v, want the literal-%% entity", len(items), err)
	}

	under, err := f.s.Count(ctx, ListOptions{Query: "_"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if under != 1 {
		t.Fatalf("total for q=_ = %d, want 1 (only the entity whose title carries a literal _)", under)
	}
	if items, err = f.s.List(ctx, ListOptions{Query: "_"}, nil); err != nil || len(items) != 1 || items[0].ID != underscore.ID {
		t.Fatalf("q=_ items = %d err=%v, want only %s", len(items), err, underscore.ID)
	}

	missing, err := f.s.Count(ctx, ListOptions{Query: "不存在的普通词"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if missing != 0 {
		t.Fatalf("total for a missing plain word = %d, want 0", missing)
	}

	// /tags 是第二个 ILIKE 拼接点，同样只按字面命中（%25 是 URL 编码的 %）。
	engine := gin.New()
	HTTP{Store: f.s}.Register(engine)
	for _, c := range []struct{ query, want string }{{"%25", "销量100%"}, {"_", "下划线_标签"}} {
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/catalog/tags?q="+c.query, nil))
		if w.Code != http.StatusOK {
			t.Fatalf("tags q=%s status=%d body=%s", c.query, w.Code, w.Body.String())
		}
		var resp struct {
			Items []struct {
				Name  string `json:"name"`
				Count int    `json:"count"`
			} `json:"items"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatal(err)
		}
		if len(resp.Items) != 1 || resp.Items[0].Name != c.want {
			t.Fatalf("tags q=%s items=%+v, want only %q", c.query, resp.Items, c.want)
		}
	}
}
