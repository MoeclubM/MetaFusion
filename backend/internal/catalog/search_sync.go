package catalog

import (
	"context"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/models"
)

// refreshWorkSearchIndex keeps the OpenSearch projection close to PostgreSQL.
// Search is a derived read model: indexing failures are logged but never roll
// back a successful catalog write. This helper is intentionally synchronous
// and bounded; a transactional outbox can replace it later without changing
// catalog write semantics.
func (s *CatalogService) refreshWorkSearchIndex(ctx context.Context, workID uuid.UUID) {
	if s.search == nil {
		return
	}

	var work models.Work
	if err := s.db.Preload("Tags").Preload("Translations").First(&work, workID).Error; err != nil {
		log.Printf("[Catalog] skip search refresh for work %s: %v", workID, err)
		return
	}

	indexCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := s.search.IndexWorkDoc(indexCtx, &work); err != nil {
		log.Printf("[Catalog] search refresh failed for work %s: %v", workID, err)
	}
}
