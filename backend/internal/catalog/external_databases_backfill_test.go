package catalog

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/metafusion/metafusion-app/internal/testutil"
)

// TestBackfillExternalDatabaseNamesRepairsStoredRows 覆盖升级后的存量实例：
// 外部权威库的播种是 ON CONFLICT DO NOTHING，种子后来补的 zh-TW/ja 进不了已有行；
// 而名称四语齐备已是写入硬约束，缺语种的行会在后台被拒。启动回填必须补上缺口，
// 同时不能覆盖后台已经改过的人工译文（与定义种子同一「只增不改」精神）。
func TestBackfillExternalDatabaseNamesRepairsStoredRows(t *testing.T) {
	ctx := context.Background()
	s := &Store{DB: testutil.Database(t)}
	if err := s.Initialize(ctx); err != nil {
		t.Fatal(err)
	}
	read := func(code string) Names {
		t.Helper()
		var raw []byte
		if err := s.DB.QueryRowContext(ctx, `SELECT names FROM catalog.external_databases WHERE code=$1`, code).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		out := Names{}
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	// 造出两种存量行：只有中英的，和日文被人工改过的。
	if _, err := s.DB.ExecContext(ctx, `UPDATE catalog.external_databases SET names='{"zh-CN":"官方网站","en-US":"Official Website"}'::jsonb WHERE code='official_website'`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.ExecContext(ctx, `UPDATE catalog.external_databases SET names=jsonb_set(names,'{ja-JP}','"手で直した公式サイト"') WHERE code='wikidata'`); err != nil {
		t.Fatal(err)
	}
	if err := s.EnsureSeedExternalDatabases(ctx); err != nil {
		t.Fatal(err)
	}
	// 缺语种的行补齐，且译文来自种子。
	got := read("official_website")
	if got["zh-TW"] != "官方網站" || got["ja-JP"] != "公式サイト" {
		t.Errorf("存量行未按种子补齐语种：%v", got)
	}
	// 人工改过的日文不被覆盖。
	if w := read("wikidata"); w["ja-JP"] != "手で直した公式サイト" {
		t.Errorf("人工译文被种子覆盖：%v", w["ja-JP"])
	}
	// 全部种子行回填后都应满足写路径的四语判据。
	for _, d := range externalDatabaseSeeds() {
		if err := validateNames(read(d.Code)); err != nil {
			t.Errorf("回填后仍不满足四语判据 %s: %v", d.Code, err)
		}
	}
	// 幂等：再跑一次不改变结果。
	before := read("official_website")["zh-TW"]
	if err := s.EnsureSeedExternalDatabases(ctx); err != nil {
		t.Fatal(err)
	}
	if after := read("official_website")["zh-TW"]; after != before {
		t.Errorf("回填不幂等：%q -> %q", before, after)
	}
}
