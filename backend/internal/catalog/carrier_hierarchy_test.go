package catalog

import (
	"database/sql/driver"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/models"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestValidateTrackContentWorksBindsUUIDList(t *testing.T) {
	first, second := uuid.New(), uuid.New()
	for _, tc := range []struct {
		name  string
		track models.Track
		ids   []uuid.UUID
	}{
		{"legacy reference", models.Track{CanonicalEntryID: &first}, []uuid.UUID{first}},
		{"repeated reference", models.Track{CanonicalEntryID: &first, Contents: []models.TrackContent{{CanonicalEntryID: first}}}, []uuid.UUID{first}},
		{"multiple contents", models.Track{Contents: []models.TrackContent{{CanonicalEntryID: first}, {CanonicalEntryID: second}}}, []uuid.UUID{first, second}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, err := gorm.Open(postgres.New(postgres.Config{DSN: "host=localhost user=test dbname=test"}), &gorm.Config{DryRun: true, DisableAutomaticPing: true})
			if err != nil {
				t.Fatal(err)
			}
			queried := false
			if err := db.Callback().Query().After("gorm:query").Register("test:check_uuid_bindings", func(tx *gorm.DB) {
				queried = true
				if !strings.Contains(tx.Statement.SQL.String(), "id IN ($1") {
					t.Errorf("expected expanded IN list, got %s", tx.Statement.SQL.String())
				}
				if len(tx.Statement.Vars) != len(tc.ids) {
					t.Errorf("got %d SQL arguments, want %d", len(tx.Statement.Vars), len(tc.ids))
				}
				bound := map[string]bool{}
				for _, arg := range tx.Statement.Vars {
					value, err := driver.DefaultParameterConverter.ConvertValue(arg)
					if err != nil {
						t.Errorf("SQL argument cannot be bound: %v", err)
						continue
					}
					id, ok := value.(string)
					if !ok {
						t.Errorf("expected UUID string argument, got %T", value)
						continue
					}
					bound[id] = true
				}
				for _, id := range tc.ids {
					if !bound[id.String()] {
						t.Errorf("missing bound UUID %s", id)
					}
				}
			}); err != nil {
				t.Fatal(err)
			}
			// DryRun builds the production query without returning any rows.
			err = validateTrackContentWorks(db, uuid.New(), &tc.track)
			if err == nil || err.Error() != "catalog.canonical_not_found" {
				t.Fatalf("expected missing entries from dry run, got %v", err)
			}
			if !queried {
				t.Fatal("canonical entry lookup was not executed")
			}
		})
	}
}
