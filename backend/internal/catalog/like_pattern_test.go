package catalog

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

// 真库回归（无 MF_V2_TEST_DSN 时 testutil.Database 自动 Skip）：搜索词里的 LIKE 元字符
// 只按字面命中——q="%" 不能再返回全库，q="_" 也不能当单字符通配符。
func TestPostgresSearchTreatsWildcardsLiterally(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	percent := f.save(Entity{Kind: "work", Title: "销量 100% 纪念版"})
	underscore := f.save(Entity{Kind: "work", Title: "下划线_样本"})
	f.save(Entity{Kind: "work", Title: "普通题名"})
	// 字面 %/_ 的标签，覆盖 /tags 那个 ILIKE 拼接点。
	// tags 是适用于 Work 的字段，这里只测试 LIKE 转义，不需业务分类。
	f.save(Entity{Kind: "work", Title: "标签样本甲", Attributes: map[string]any{"tags": []string{"销量100%"}}})
	f.save(Entity{Kind: "work", Title: "标签样本乙", Attributes: map[string]any{"tags": []string{"下划线_标签"}}})

	all, err := f.s.Count(ctx, ListOptions{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if all != 5 {
		t.Fatalf("baseline total = %d, want the 5 fixtures", all)
	}

	useTestSearch(t, f.s)
	for _, tc := range []struct {
		query string
		total int
		id    string
	}{
		{"%", 2, percent.ID}, {"100%", 2, percent.ID}, {"_", 2, underscore.ID}, {"不存在的普通词", 0, ""},
	} {
		page, err := f.s.Search(ctx, ListOptions{Query: tc.query, Limit: 50}, nil, "")
		if err != nil || page.Total != tc.total {
			t.Fatalf("literal search %q: %+v err=%v", tc.query, page, err)
		}
		if tc.id != "" {
			found := false
			for _, e := range page.Items {
				if e.ID == tc.id {
					found = true
				}
			}
			if !found {
				t.Fatalf("literal search %q omitted %s", tc.query, tc.id)
			}
		}
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
