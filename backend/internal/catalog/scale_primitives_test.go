package catalog

import (
	"testing"

	"github.com/google/uuid"
)

// 主键必须是 UUIDv7（时间有序）：随机 v4 在亿级下会把 B-tree 插入点打散到全表。
func TestNewIDIsTimeOrderedV7(t *testing.T) {
	first := newID()
	if v := uuid.MustParse(first).Version(); v != 7 {
		t.Fatalf("newID 版本=%d，期望 7（UUIDv7）", v)
	}
	// 同毫秒内 v7 用随机位保证唯一；跨毫秒必须递增（字典序即时间序）。
	var prev string
	for i := 0; i < 2000; i++ {
		id := newID()
		if prev != "" && id < prev {
			t.Fatalf("ID 非单调：%s < %s", id, prev)
		}
		prev = id
	}
}
