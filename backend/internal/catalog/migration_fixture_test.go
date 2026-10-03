package catalog

import (
	"fmt"
	"github.com/metafusion/metafusion-app/migrations"
	"io/fs"
)

// The active installation baseline is immutable. Completed legacy databases
// register it after validating baseline.json; they never replay this DDL.
const baselineFile = "000021_catalog_baseline.up.sql"

func catalogBaseline() (string, error) {
	b, err := fs.ReadFile(migrations.FS, baselineFile)
	if err != nil {
		return "", fmt.Errorf("read catalog baseline %s: %w", baselineFile, err)
	}
	return string(b), nil
}
