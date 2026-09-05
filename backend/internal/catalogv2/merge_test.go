package catalogv2

import (
	"context"
	"testing"
)

func TestPostgresMergeReferences(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	old := f.save(Entity{Kind: "work", Title: "Duplicate song"})
	target := f.save(Entity{Kind: "work", Title: "Song"})
	unit := f.save(Entity{Kind: "content_unit", Title: "Part", WorkID: old.ID})
	expression := f.save(Entity{Kind: "expression", Title: "Recording", WorkID: old.ID, ContentUnitID: unit.ID})
	release := f.save(Entity{Kind: "release", Title: "Single", Subjects: []Subject{{WorkID: old.ID, Role: "primary"}}})
	medium := f.save(Entity{Kind: "medium", Title: "CD", ReleaseID: release.ID})
	track := f.save(Entity{Kind: "track", Title: "01", MediumID: medium.ID, Contents: []Inclusion{{ExpressionID: expression.ID}}})
	actor := f.save(Entity{Kind: "agent", Title: "Singer"})
	_, err := f.s.SaveRelation(ctx, RelationEdit{Relation: Relation{Type: "performed_by", SourceID: expression.ID, TargetID: actor.ID}, EditNote: "credit", Sources: fixtureSources()}, f.u)
	if err != nil {
		t.Fatal(err)
	}
	merge := func(a, b Entity) {
		t.Helper()
		_, err := f.s.Lifecycle(ctx, a.ID, LifecycleEdit{ExpectedVersion: a.Version, TargetID: b.ID, EditNote: "merge duplicate identity", Sources: fixtureSources()}, f.u)
		if err != nil {
			t.Fatal(err)
		}
	}
	merge(old, target)
	got, err := f.s.Get(ctx, expression.ID, nil)
	if err != nil || got.WorkID != target.ID || got.Version != 2 {
		t.Fatalf("expression not rehomed: %+v %v", got, err)
	}
	occurrences, err := f.s.Occurrences(ctx, target.ID, nil)
	if err != nil || len(occurrences) != 1 {
		t.Fatalf("merged work occurrences: %d %v", len(occurrences), err)
	}
	next := f.save(Entity{Kind: "expression", Title: "Same recording", WorkID: target.ID, ContentUnitID: unit.ID})
	merge(got, next)
	gotTrack, _ := f.s.Get(ctx, track.ID, nil)
	if gotTrack.Contents[0].ExpressionID != next.ID {
		t.Fatal("inclusion did not move")
	}
	rels, err := f.s.Relations(ctx, next.ID, nil)
	if err != nil || len(rels) != 1 {
		t.Fatalf("credit did not move: %v", err)
	}
	resolved, err := f.s.Resolve(ctx, old.ID, nil)
	if err != nil || resolved.ID != target.ID {
		t.Fatal("old identity is not resolvable")
	}
	revisions, err := f.s.Revisions(ctx, track.ID, &f.u)
	if err != nil || len(revisions) != 2 {
		t.Fatal("missing reference revision")
	}
}

func TestPostgresPublicReferences(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	draft := f.save(Entity{Kind: "work", Title: "Private draft", Status: "draft"})
	_, err := f.s.Save(ctx, Edit{Entity: Entity{Kind: "expression", Title: "Public recording", Status: "published", WorkID: draft.ID}, EditNote: "test disclosure", Sources: fixtureSources()}, f.u)
	if err == nil {
		t.Fatal("published reference disclosed draft")
	}
}
