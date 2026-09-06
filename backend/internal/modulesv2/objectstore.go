package modulesv2

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

type objectStore interface {
	Put(context.Context, string, string, string) error
	Open(context.Context, string) (io.ReadSeekCloser, error)
}
type localObjects struct{ root string }

func (s localObjects) Put(_ context.Context, path, key, _ string) error {
	dest := filepath.Join(s.root, key)
	if _, err := os.Stat(dest); err == nil {
		return nil
	}
	return os.Rename(path, dest)
}
func (s localObjects) Open(_ context.Context, key string) (io.ReadSeekCloser, error) {
	return os.Open(filepath.Join(s.root, key))
}

type s3Objects struct {
	client *minio.Client
	bucket string
}

func (s s3Objects) Put(ctx context.Context, path, key, mime string) error {
	_, err := s.client.FPutObject(ctx, s.bucket, key, path, minio.PutObjectOptions{ContentType: mime})
	return err
}
func (s s3Objects) Open(ctx context.Context, key string) (io.ReadSeekCloser, error) {
	obj, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	if _, err = obj.Stat(); err != nil {
		obj.Close()
		return nil, err
	}
	return obj, nil
}

// Credentials and remote clients are read only when the archive is enabled.
func (m *Manager) initArchive(ctx context.Context) error {
	if err := os.MkdirAll(m.root, 0700); err != nil {
		return fmt.Errorf("archive_unavailable")
	}
	if m.objects != nil {
		return nil
	}
	endpoint := os.Getenv("ARCHIVE_S3_ENDPOINT")
	if endpoint == "" {
		m.objects = localObjects{m.root}
		return nil
	}
	client, err := minio.New(endpoint, &minio.Options{Creds: credentials.NewStaticV4(os.Getenv("ARCHIVE_S3_ACCESS_KEY"), os.Getenv("ARCHIVE_S3_SECRET_KEY"), ""), Secure: os.Getenv("ARCHIVE_S3_TLS") != "false"})
	if err != nil {
		return fmt.Errorf("archive_unavailable")
	}
	bucket := os.Getenv("ARCHIVE_S3_BUCKET")
	probe, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	exists, err := client.BucketExists(probe, bucket)
	if err != nil || !exists {
		return fmt.Errorf("archive_unavailable")
	}
	m.objects = s3Objects{client, bucket}
	return nil
}
func (m *Manager) objectStorage() objectStore { m.mu.RLock(); defer m.mu.RUnlock(); return m.objects }
