package audit

// 真库用例（契约 §6.2）：MF_V2_TEST_DSN 未设时 testutil.Database 自动跳过。

import (
	"context"
	"database/sql"
	"encoding/json"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/metafusion/metafusion-app/internal/testutil"
)

// forbiddenInRow 是"整行文本零命中"的敏感正则（契约 §4/§6.2）。
//
// 一个契约层面的必然前提：键名本身会出现在 changes 的 JSON 文本里，所以
// "整行零命中 password|token|secret" 只在**调用方不把敏感键名写进 changes**时成立——
// 脱敏解决的是"值泄露"，键名由调用方不写入来保证（各服务的 changes 键就是 kind/status/
// title/source_id 这类业务字段）。因此整行断言跑在"真实载荷形状"的行上，
// 键名替换规则单独用 changes 精确断言（见 TestPostgresRecorderRedactsSecretKeys）。
var forbiddenInRow = []*regexp.Regexp{
	regexp.MustCompile(`(?i)password`),
	regexp.MustCompile(`(?i)token`),
	regexp.MustCompile(`(?i)secret`),
	regexp.MustCompile(`mfp_|mf_pat_|sk_`),
	regexp.MustCompile(`[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}`),
}

// Schema 重复执行必须安全（迁移路径与目录服务启动路径都会跑它，四个服务还可能同时首次建表）；
// 一次 Record 恰好落一行；changes 已脱敏、UA 已截断、非法 actor uuid 不会把整行带下去。
func TestPostgresRecorderWritesExactlyOneSanitizedRow(t *testing.T) {
	db := testutil.Database(t)
	ctx := context.Background()
	for i := 1; i <= 2; i++ {
		if _, err := db.ExecContext(ctx, Schema); err != nil {
			t.Fatalf("第 %d 次执行 Schema 失败: %v", i, err)
		}
	}
	rec := NewRecorder(db, ServiceName)
	rec.Record(Entry{
		Action:         "entity.created",
		ActorUserID:    "not-a-uuid",
		ActorUsername:  "alice",
		CredentialType: "session",
		ActorIP:        "10.0.0.9",
		ActorUserAgent: strings.Repeat("u", 700),
		TargetType:     "entity",
		TargetID:       "0190f0f0-0000-7000-8000-000000000042",
		Changes: map[string]any{
			"kind":  map[string]any{"after": "work"},
			"title": map[string]any{"before": "旧题名", "after": "新题名"},
			"note":  "联系 jane.doe@example.com",
		},
		RequestMethod: "POST",
		Route:         "/api/catalog/entities",
		HTTPStatus:    200,
		RequestID:     "rid-postgres-1",
	})
	rec.Close() // 排空队列并停 goroutine

	var count int
	if err := db.QueryRowContext(ctx, "SELECT count(*) FROM audit.audit_log").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("一次 Record 必须恰好落一行: %d", count)
	}

	var (
		service, action, username, credential string
		method, route, requestID, ua, result  string
		targetType, targetID                  string
		actorID                               sql.NullString
		status                                int
		changes                               []byte
		occurredAt                            time.Time
	)
	row := db.QueryRowContext(ctx, "SELECT service, action, actor_user_id, actor_username, credential_type,"+
		" target_type, target_id, changes, result, request_method, route, http_status, request_id, actor_user_agent, occurred_at"+
		" FROM audit.audit_log WHERE request_id='rid-postgres-1'")
	if err := row.Scan(&service, &action, &actorID, &username, &credential, &targetType, &targetID,
		&changes, &result, &method, &route, &status, &requestID, &ua, &occurredAt); err != nil {
		t.Fatalf("读回落库行失败: %v", err)
	}
	if service != ServiceName {
		t.Errorf("service 由 Recorder 补齐: %q", service)
	}
	if action != "entity.created" || result != "success" || status != 200 || method != "POST" {
		t.Errorf("动作/结果/状态: %q %q %d %q", action, result, status, method)
	}
	if actorID.Valid {
		t.Errorf("非法 actor uuid 必须写 NULL 而不是让整行被拒: %q", actorID.String)
	}
	if username != "alice" || credential != "session" || targetType != "entity" || targetID != "0190f0f0-0000-7000-8000-000000000042" {
		t.Errorf("操作者/目标: %q %q %q %q", username, credential, targetType, targetID)
	}
	if route != "/api/catalog/entities" || requestID != "rid-postgres-1" {
		t.Errorf("路由模板/请求 id: %q %q", route, requestID)
	}
	if r := []rune(ua); len(r) != userAgentMax {
		t.Errorf("UA 必须截断到 %d rune: %d", userAgentMax, len(r))
	}
	if occurredAt.IsZero() {
		t.Error("occurred_at 必须由服务端补齐")
	}
	var decoded map[string]any
	if err := json.Unmarshal(changes, &decoded); err != nil {
		t.Fatalf("changes 不是合法 JSON: %v (%s)", err, changes)
	}
	if title, ok := decoded["title"].(map[string]any); !ok || title["after"] != "新题名" {
		t.Errorf("changes 丢了变更摘要: %s", changes)
	}
	if note, _ := decoded["note"].(string); note != "联系 j***@example.com" {
		t.Errorf("值里的邮箱未遮罩: %q", note)
	}

	var rowText string
	if err := db.QueryRowContext(ctx, "SELECT concat_ws(' ', service, action, actor_username, credential_type,"+
		" actor_ip, actor_user_agent, target_type, target_id, changes::text, result, error_code, request_method, route, request_id)"+
		" FROM audit.audit_log").Scan(&rowText); err != nil {
		t.Fatal(err)
	}
	for _, p := range forbiddenInRow {
		if hit := p.FindString(rowText); hit != "" {
			t.Fatalf("整行文本命中敏感正则 %s: %q\n行原文: %s", p, hit, rowText)
		}
	}
}

// 键名黑名单在落库路径上同样生效（值被替换成 [redacted]）：精确断言 changes，
// 因为键名会出现在 JSON 文本里，不能拿它跑"整行零命中"。
func TestPostgresRecorderRedactsSecretKeys(t *testing.T) {
	db := testutil.Database(t)
	ctx := context.Background()
	if _, err := db.ExecContext(ctx, Schema); err != nil {
		t.Fatal(err)
	}
	rec := NewRecorder(db, ServiceName)
	if err := rec.RecordSync(ctx, Entry{
		Action: "thing.updated",
		Changes: map[string]any{
			"password":     "hunter2",
			"api_token":    "mfp_abcdefghijklmnop",
			"clientSecret": "s3cr3t",
			"title":        "题名不动",
		},
		RequestID: "rid-postgres-2",
	}); err != nil {
		t.Fatalf("RecordSync 必须能同步落库: %v", err)
	}
	var changes []byte
	if err := db.QueryRowContext(ctx, "SELECT changes FROM audit.audit_log WHERE request_id='rid-postgres-2'").Scan(&changes); err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(changes, &decoded); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"password", "api_token", "clientSecret"} {
		if decoded[k] != redacted {
			t.Errorf("键 %s 必须整值替换: %#v", k, decoded[k])
		}
	}
	if decoded["title"] != "题名不动" {
		t.Errorf("普通字段不该被动: %#v", decoded["title"])
	}
}

// 表不存在时 RecordSync 必须回错误（而不是静默成功）：审计落在旁路，调用方要能看到失败。
func TestPostgresRecorderReportsMissingSchema(t *testing.T) {
	db := testutil.Database(t)
	rec := NewRecorder(db, ServiceName)
	if err := rec.RecordSync(context.Background(), Entry{Action: "entity.created"}); err == nil {
		t.Fatal("未建表时必须回错误")
	}
	rec.Close()
}
