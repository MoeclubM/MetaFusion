package catalog

import (
	"context"
	"errors"
	"testing"
)

func TestPostgresSingleDefinitionConfig(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	initial, err := f.s.Definitions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	saved, err := f.s.SaveDefinitions(ctx, initial.Document, initial.ETag, f.u, "single definition", fixtureSources())
	if err != nil {
		t.Fatal(err)
	}
	if saved.ETag == initial.ETag || saved.ETag == "" {
		t.Fatal("saving must rotate the overwrite guard")
	}
	if _, err := f.s.SaveDefinitions(ctx, initial.Document, initial.ETag, f.u, "stale definition", fixtureSources()); !errors.Is(err, errVersionConflict) {
		t.Fatalf("stale edit should conflict: %v", err)
	}
	var rows int
	if err := f.s.DB.QueryRowContext(ctx, "SELECT count(*) FROM catalog.definition_config").Scan(&rows); err != nil || rows != 1 {
		t.Fatalf("expected one live configuration, rows=%d err=%v", rows, err)
	}
	var oldTable bool
	if err := f.s.DB.QueryRowContext(ctx, "SELECT to_regclass('catalog.definitions') IS NOT NULL").Scan(&oldTable); err != nil || oldTable {
		t.Fatalf("retired version table remains: %v %v", oldTable, err)
	}
}
