package catalog

import (
	"context"
	"fmt"
	"testing"
)

func TestPostgresBulkStructureBeyondParameterLimit(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	work := f.save(Entity{Kind: "work", Title: "bulk read work"})
	unit := f.save(Entity{Kind: "content_unit", Title: "bulk read unit", WorkID: work.ID})
	expression := f.save(Entity{Kind: "expression", Title: "bulk read expression", WorkID: work.ID, ContentUnitID: unit.ID})
	release := f.save(Entity{Kind: "release", Title: "bulk read release", Subjects: []Subject{{WorkID: work.ID, Role: "primary"}}})
	medium := f.save(Entity{Kind: "medium", Title: "bulk read medium", ReleaseID: release.ID})
	track := f.save(Entity{Kind: "track", Title: "bulk read track", MediumID: medium.ID, Contents: []Inclusion{{ExpressionID: expression.ID, Position: 1}}})
	ids := make([]string, 66000)
	for i := range ids {
		ids[i] = fmt.Sprintf("00000000-0000-4000-8000-%012x", i+1)
	}
	for _, sample := range []Entity{unit, expression, release, medium, track} {
		t.Run(sample.Kind, func(t *testing.T) {
			entities := make(map[string]Entity, len(ids)+1)
			for _, id := range ids {
				entities[id] = Entity{ID: id, Kind: sample.Kind}
			}
			entities[sample.ID] = Entity{ID: sample.ID, Kind: sample.Kind}
			got, err := fillStructural(ctx, f.s.DB, entities)
			if err != nil {
				t.Fatalf("structure lookup with >65535 IDs: %v", err)
			}
			e := got[sample.ID]
			if e.WorkID != sample.WorkID || e.ContentUnitID != sample.ContentUnitID || e.ReleaseID != sample.ReleaseID || e.MediumID != sample.MediumID || len(e.Subjects) != len(sample.Subjects) || len(e.Contents) != len(sample.Contents) {
				t.Fatalf("structural fields lost: %+v", e)
			}
			if len(e.Subjects) > 0 && e.Subjects[0].WorkID != work.ID {
				t.Fatal("release subjects lost")
			}
			if len(e.Contents) > 0 && e.Contents[0].ExpressionID != expression.ID {
				t.Fatal("track contents lost")
			}
		})
	}
	got, err := getManyFrom(ctx, f.s.DB, append(ids, track.ID, expression.ID), &f.u)
	if err != nil || len(got) != 2 || len(got[track.ID].Contents) != 1 {
		t.Fatalf("entity lookup beyond parameter limit: count=%d err=%v", len(got), err)
	}
}
