package catalog

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
)

// respond 的"错误码 → HTTP 状态码"映射。重点覆盖被 %w 包裹的 forbidden/version_conflict：
// 旧实现用 err.Error() 全等比较，包裹后 403/409 会退化成 400；以及 401 只能来自
// required() 闸门（invalid_credentials 分支已删，目录服务内没有生产者）。
func TestRespondMapsStatusByErrorChain(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{"success", nil, 200, ""},
		{"no rows", sql.ErrNoRows, 404, "not_found"},
		{"forbidden", errForbidden, 403, "forbidden"},
		{"wrapped forbidden", fmt.Errorf("delivery_partial: 1/2 failed: %w", errForbidden), 403, "delivery_partial: 1/2 failed: forbidden"},
		{"doubly wrapped forbidden", fmt.Errorf("merge_relation_conflict: %w", fmt.Errorf("lifecycle: %w", errForbidden)), 403, "merge_relation_conflict: lifecycle: forbidden"},
		{"version conflict", errVersionConflict, 409, "version_conflict"},
		{"wrapped version conflict", fmt.Errorf("attributes.x: %w", errVersionConflict), 409, "attributes.x: version_conflict"},
		{"domain code", errors.New("invalid_payload"), 400, "invalid_payload"},
		{"wrapped domain code keeps message", fmt.Errorf("attributes.foo: %w", errors.New("disabled_term")), 400, "attributes.foo: disabled_term"},
		{"pq unique violation", &pq.Error{Code: "23505"}, 400, "constraint_violation"},
		{"pq foreign key", &pq.Error{Code: "23503"}, 400, "constraint_violation"},
		{"pq invalid text representation", &pq.Error{Code: "22P02"}, 400, "invalid_id"},
		{"pq other", &pq.Error{Code: "08006"}, 500, "database_error"},
	} {
		w := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(w)
		respond(ctx, gin.H{"ok": true}, tc.err)
		if w.Code != tc.wantStatus {
			t.Errorf("%s: status=%d want=%d (body=%s)", tc.name, w.Code, tc.wantStatus, w.Body.String())
		}
		if tc.err == nil {
			continue
		}
		var body struct {
			Error string `json:"error"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatalf("%s: bad body %s", tc.name, w.Body.String())
		}
		if body.Error != tc.wantCode {
			t.Errorf("%s: error=%q want=%q", tc.name, body.Error, tc.wantCode)
		}
	}
}
