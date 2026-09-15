package catalog

import (
	"testing"

	"github.com/google/uuid"
)

// 结构类判断：只有写这三张表的 kind 才需要与父子环检查串行（其余 kind 并行写）。
// 判错方向的代价不对称：多判只是慢，漏判会放过层级环。
func TestStructuralKind(t *testing.T) {
	for _, k := range Kinds {
		want := k == "content_unit" || k == "medium" || k == "track"
		if got := structuralKind(k); got != want {
			t.Errorf("structuralKind(%s)=%v，期望 %v", k, got, want)
		}
	}
	if structuralKind("") {
		t.Fatal("空 kind 不应走串行写通道")
	}
}

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
