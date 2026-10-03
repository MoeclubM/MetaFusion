package testutil

import (
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
)

// LegacyMigrations is a test-only fixture; historical SQL is never embedded in
// the server or migrator. runtime.Caller makes this independent of test cwd.
func LegacyMigrations() fs.FS {
	_, source, _, ok := runtime.Caller(0)
	if !ok {
		panic("cannot locate migration fixtures")
	}
	return os.DirFS(filepath.Join(filepath.Dir(source), "../migrator/testdata/legacy_catalog"))
}
