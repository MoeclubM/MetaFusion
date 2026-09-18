package catalog

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// 版本身份端点必须把构建期注入的值原样回出，并且**只**回这五个字段：
// 它是匿名可读的，多一个字段就等于把部署细节放上公开面。
func TestVersionEndpointReportsBuildIdentity(t *testing.T) {
	oldVersion, oldSHA, oldBuild := buildVersion, buildGitSHA, buildTime
	t.Cleanup(func() { buildVersion, buildGitSHA, buildTime = oldVersion, oldSHA, oldBuild })

	buildVersion, buildGitSHA, buildTime = "v1.2.3", "abcdef1234567", "2026-09-26T00:00:00Z"
	got := getVersion(t)
	want := map[string]string{
		"service":    "metafusion-catalog",
		"version":    "v1.2.3",
		"git_sha":    "abcdef1234567",
		"build_time": "2026-09-26T00:00:00Z",
	}
	for key, value := range want {
		if got[key] != value {
			t.Errorf("%s = %v, want %q", key, got[key], value)
		}
	}
	if len(got) != 5 {
		names := make([]string, 0, len(got))
		for key := range got {
			names = append(names, key)
		}
		t.Fatalf("响应字段 %d 个（%v），应为 5 个：多出来的字段等于把部署细节放上公开面", len(got), names)
	}
	started, _ := got["started_at"].(string)
	if _, err := time.Parse(time.RFC3339, started); err != nil {
		t.Fatalf("started_at = %q 不是 RFC3339：%v", started, err)
	}
}

// 没有注入 sha 时必须回 "unknown" 而不是空串：空串让人以为部署链路上传了值，
// 而 "unknown" 是"这次构建没有身份"的明确陈述。
func TestVersionEndpointWithoutInjectedIdentity(t *testing.T) {
	oldVersion, oldSHA, oldBuild := buildVersion, buildGitSHA, buildTime
	t.Cleanup(func() { buildVersion, buildGitSHA, buildTime = oldVersion, oldSHA, oldBuild })

	buildVersion, buildGitSHA, buildTime = "", "", ""
	got := getVersion(t)
	for _, key := range []string{"version", "git_sha", "build_time"} {
		if got[key] != "unknown" {
			t.Errorf("%s = %v, want \"unknown\"", key, got[key])
		}
	}
}

func getVersion(t *testing.T) map[string]any {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	HTTP{Store: &Store{}}.Register(r)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/version", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/version = %d, want 200（必须是匿名可读的公开端点）", w.Code)
	}
	var got map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("响应不是 JSON 对象: %v", err)
	}
	return got
}
