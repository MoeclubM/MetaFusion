package catalog

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"testing"
	"time"
)

// R2 口径（纯逻辑，无需真库）："不存在"进 missing，只有它；超时/中断/连接失败是
// 查询失败，必须按失败处理，不得进 missing 伪装部分成功。
func TestIsIdentityNotFound(t *testing.T) {
	if !isIdentityNotFound(sql.ErrNoRows) {
		t.Fatal("sql.ErrNoRows 应判为不存在")
	}
	if !isIdentityNotFound(errRedirectCycle) {
		t.Fatal("redirect_cycle 应判为不存在")
	}
	if !isIdentityNotFound(fmt.Errorf("resolve: %w", errRedirectCycle)) {
		t.Fatal("包裹后的 redirect_cycle 仍应判为不存在")
	}
	for _, err := range []error{
		errors.New("boom"),
		context.Canceled,
		context.DeadlineExceeded,
		fmt.Errorf("query: %w", context.DeadlineExceeded),
	} {
		if isIdentityNotFound(err) {
			t.Fatalf("%v 不得判为不存在", err)
		}
	}
}

// R2 回归（无需真库）：反向别名查询失败必须返回 error。旧实现 Query 出错直接返回
// 已收集列表、Scan 出错只 break——调用方拿到的是"成功的部分结果"。
// sql.Open 不建连（取消的 ctx 在拨号前即失败），覆盖 Query 出错分支。
func TestReverseAliasesQueryFailureIsError(t *testing.T) {
	db, err := sql.Open("postgres", "postgres://127.0.0.1:1/nope?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s := &Store{DB: db}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := s.reverseAliases(ctx, "00000000-0000-0000-0000-000000000000", map[string]bool{}); err == nil {
		t.Fatal("反向别名查询失败必须返回 error，不得伪装成功")
	}
	if _, err := s.ResolveIdentity(ctx, "00000000-0000-0000-0000-000000000000", nil); err == nil {
		t.Fatal("身份解析失败必须返回 error，不得返回成功的部分结果")
	}
}

// R2 真库：深链（4 跳）一次收齐且 complete=true；取消/超时的 ctx 按失败返回，
// 不得返回 complete=false 的部分成功。无 MF_V2_TEST_DSN 时跳过。
func TestPostgresResolveIdentityDeepChainComplete(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	a := f.save(Entity{Kind: "work", Title: "深链甲"})
	b := f.save(Entity{Kind: "work", Title: "深链乙"})
	c := f.save(Entity{Kind: "work", Title: "深链丙"})
	d := f.save(Entity{Kind: "work", Title: "深链丁"})
	batch2Merge(t, f, a, b.ID)
	bCur, err := f.s.Get(ctx, b.ID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	batch2Merge(t, f, bCur, c.ID)
	cCur, err := f.s.Get(ctx, c.ID, &f.u)
	if err != nil {
		t.Fatal(err)
	}
	batch2Merge(t, f, cCur, d.ID)
	res, err := f.s.ResolveIdentity(ctx, d.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Complete {
		t.Fatal("深链解析成功必须 complete=true")
	}
	if !sameIDSet(res.Aliases, []string{a.ID, b.ID, c.ID}) {
		t.Fatalf("深链应一次收齐全部别名：%v", res.Aliases)
	}
	// 取消的 ctx：失败，不是部分成功。
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := f.s.ResolveIdentity(cancelled, d.ID, nil); err == nil {
		t.Fatal("取消的查询必须返回 error，不得伪装成功")
	}
	// 超时的 ctx：同样失败。
	timedOut, stop := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer stop()
	if _, err := f.s.ResolveIdentity(timedOut, d.ID, nil); err == nil {
		t.Fatal("超时的查询必须返回 error，不得伪装成功")
	}
}
