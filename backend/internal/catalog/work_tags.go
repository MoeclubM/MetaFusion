package catalog

import (
	"strings"

	"github.com/metafusion/metafusion-app/internal/models"
)

func (s *CatalogService) replaceWorkTagsByName(work *models.Work, names []string) {
	if names == nil {
		return
	}
	tags := s.ensureTagsByName(names)
	_ = s.db.Model(work).Association("Tags").Replace(&tags)
}

func (s *CatalogService) replaceFranchiseTagsByName(fr *models.Franchise, names []string) {
	if names == nil {
		return
	}
	tags := s.ensureTagsByName(names)
	_ = s.db.Model(fr).Association("Tags").Replace(&tags)
}

func (s *CatalogService) ensureTagsByName(names []string) []models.Tag {
	var tags []models.Tag
	seen := map[string]bool{}
	for _, n := range names {
		n = strings.TrimSpace(n)
		if n == "" || seen[n] {
			continue
		}
		seen[n] = true
		var tag models.Tag
		if err := s.db.Where("name = ?", n).First(&tag).Error; err != nil {
			tag = models.Tag{Name: n, GroupType: models.TagGroupGeneral}
			if err := s.db.Create(&tag).Error; err != nil {
				continue
			}
		}
		if models.TagGroupIsCarrier(tag.GroupType) {
			continue
		}
		tags = append(tags, tag)
	}
	return tags
}
