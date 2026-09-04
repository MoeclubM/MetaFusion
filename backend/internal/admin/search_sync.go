package admin

import (
	"context"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/models"
)

func (s *AdminService) refreshWorkSearchIndex(ctx context.Context, workID uuid.UUID) {
	if s.search == nil {
		return
	}
	var work models.Work
	if err := s.db.Preload("Tags").Preload("Translations").First(&work, workID).Error; err != nil {
		log.Printf("[Admin] skip search refresh for work %s: %v", workID, err)
		return
	}
	indexCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := s.search.IndexWorkDoc(indexCtx, &work); err != nil {
		log.Printf("[Admin] search refresh failed for work %s: %v", workID, err)
	}
}
