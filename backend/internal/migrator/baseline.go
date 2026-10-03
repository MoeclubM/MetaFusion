package migrator

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
)

type ledgerEntry struct {
	Version  int64  `json:"version"`
	Name     string `json:"name"`
	Checksum string `json:"checksum"`
}

type baselineManifest struct {
	Version  int64         `json:"version"`
	Replaces int64         `json:"replaces"`
	Legacy   []ledgerEntry `json:"legacy"`
}

func (m *Migrator) loadBaseline(files []MigrationFile) (*baselineManifest, error) {
	data, err := fs.ReadFile(m.source, "baseline.json")
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var b baselineManifest
	if err := json.Unmarshal(data, &b); err != nil {
		return nil, fmt.Errorf("invalid baseline manifest: %w", err)
	}
	if b.Version <= b.Replaces || b.Replaces <= 0 || len(b.Legacy) == 0 {
		return nil, errors.New("invalid baseline boundary")
	}
	seen := map[int64]bool{}
	for _, e := range b.Legacy {
		checksum, err := hex.DecodeString(e.Checksum)
		if e.Version <= 0 || e.Version > b.Replaces || seen[e.Version] || e.Name == "" || err != nil || len(checksum) != 32 {
			return nil, errors.New("invalid baseline legacy entry")
		}
		seen[e.Version] = true
	}
	if !seen[b.Replaces] {
		return nil, errors.New("baseline boundary missing from legacy manifest")
	}
	found := false
	for _, f := range files {
		if f.Direction == DirectionUp {
			if f.Version <= b.Replaces {
				return nil, errors.New("archived SQL must not be present in active migrations")
			}
			if f.Version == b.Version {
				found = true
			}
		}
	}
	if !found {
		return nil, errors.New("baseline SQL missing")
	}
	return &b, nil
}

// validateLedger recognizes only immutable active or archived migration entries.
// A database may start empty, or have the complete pre-baseline ledger. Partial
// legacy databases must finish upgrading with the previous release first.
func (m *Migrator) validateLedger(applied map[int64]AppliedMigration, files []MigrationFile, b *baselineManifest) (bool, error) {
	expected := map[int64]ledgerEntry{}
	for _, f := range files {
		if f.Direction == DirectionUp {
			if _, ok := expected[f.Version]; ok {
				return false, fmt.Errorf("duplicate migration version %d", f.Version)
			}
			expected[f.Version] = ledgerEntry{f.Version, f.Name, checksumOf(f.Content)}
		}
	}
	if b != nil {
		for _, e := range b.Legacy {
			expected[e.Version] = e
		}
	}
	legacy := false
	for v, a := range applied {
		e, ok := expected[v]
		if !ok {
			return false, fmt.Errorf("unknown applied migration %d; use the matching release", v)
		}
		if a.Dirty {
			return false, fmt.Errorf("database is in a dirty state at version %d", v)
		}
		if a.Checksum == "" {
			return false, fmt.Errorf("migration %d has an unverified checksum; verify with the previous release", v)
		}
		if a.Checksum != e.Checksum || a.Name != e.Name {
			return false, fmt.Errorf("migration %d name/checksum changed: applied migrations are immutable", v)
		}
		if b != nil && v <= b.Replaces {
			legacy = true
		}
	}
	if legacy {
		for _, e := range b.Legacy {
			if _, ok := applied[e.Version]; !ok {
				return false, fmt.Errorf("incomplete legacy ledger: missing migration %d; upgrade through %06d using the pre-baseline release", e.Version, b.Replaces)
			}
		}
	}
	if b != nil && len(applied) > 0 && !legacy {
		if _, ok := applied[b.Version]; !ok {
			return false, fmt.Errorf("active ledger is missing installation baseline %d", b.Version)
		}
	}
	return legacy, nil
}
