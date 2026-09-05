package catalog

import (
	"strings"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"github.com/metafusion/metafusion-app/internal/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// LocaleTextInput 同一语种下的题名与简介（或主体姓名与履历）一并提交。
// Aliases 为该语种下的并列标题（同语种多标题）；Title/Name 为该语种主标题。
type LocaleTextInput struct {
	Locale    string   `json:"locale"`
	Title     string   `json:"title"`
	Name      string   `json:"name"`
	Summary   string   `json:"summary"`
	Biography string   `json:"biography"`
	Aliases   []string `json:"aliases"`
}

func cleanLocaleAliases(primary string, aliases []string) []string {
	seen := map[string]bool{strings.ToLower(strings.TrimSpace(primary)): true}
	out := make([]string, 0, len(aliases))
	for _, a := range aliases {
		t := strings.TrimSpace(a)
		if t == "" {
			continue
		}
		low := strings.ToLower(t)
		if seen[low] {
			continue
		}
		seen[low] = true
		out = append(out, t)
	}
	return out
}

// filterKnownTitlesFromAliases 剔除实体级 aliases 中已在任一翻译标题
// （主标题或同语种并列标题）中出现的值：原语言标题归属翻译行，不进别名。
func filterKnownTitlesFromAliases(aliases []string, items []LocaleTextInput) []string {
	known := map[string]bool{}
	for _, it := range items {
		for _, t := range append([]string{it.Title, it.Name}, it.Aliases...) {
			if t = strings.TrimSpace(t); t != "" {
				known[strings.ToLower(t)] = true
			}
		}
	}
	out := make([]string, 0, len(aliases))
	for _, a := range aliases {
		t := strings.TrimSpace(a)
		if t == "" || known[strings.ToLower(t)] {
			continue
		}
		out = append(out, t)
	}
	return out
}

func parseLocaleInputs(items []LocaleTextInput) []LocaleTextInput {
	by := map[string]LocaleTextInput{}
	for _, it := range items {
		loc := models.NormalizeLocale(strings.TrimSpace(it.Locale))
		if !models.ValidLocales[loc] {
			continue
		}
		it.Locale = loc
		it.Title = strings.TrimSpace(it.Title)
		it.Name = strings.TrimSpace(it.Name)
		it.Summary = strings.TrimSpace(it.Summary)
		it.Biography = strings.TrimSpace(it.Biography)
		if it.Title == "" {
			it.Title = it.Name
		}
		if it.Name == "" {
			it.Name = it.Title
		}
		if it.Summary == "" {
			it.Summary = it.Biography
		}
		if it.Biography == "" {
			it.Biography = it.Summary
		}
		it.Aliases = cleanLocaleAliases(it.Title, it.Aliases)
		if it.Title == "" && it.Summary == "" {
			continue
		}
		by[loc] = it
	}
	out := make([]LocaleTextInput, 0, len(by))
	for _, v := range by {
		out = append(out, v)
	}
	return out
}

func catalogLanguageFrom(explicit string, items []LocaleTextInput, canonicalTitle string) string {
	exp := strings.TrimSpace(explicit)
	if exp != "" {
		n := models.NormalizeLocale(exp)
		if models.ValidLocales[n] {
			return n
		}
	}
	canon := strings.TrimSpace(canonicalTitle)
	if canon != "" {
		for _, it := range items {
			if it.Title == canon || it.Name == canon {
				return it.Locale
			}
		}
	}
	for _, it := range items {
		if it.Title != "" || it.Name != "" {
			return it.Locale
		}
	}
	return "zh-CN"
}

func localeTitle(items []LocaleTextInput, loc string) string {
	for _, it := range items {
		if it.Locale == loc {
			if it.Title != "" {
				return it.Title
			}
			return it.Name
		}
	}
	return ""
}

func localeBody(items []LocaleTextInput, loc string) string {
	for _, it := range items {
		if it.Locale == loc {
			if it.Summary != "" {
				return it.Summary
			}
			return it.Biography
		}
	}
	return ""
}

// catalogLocaleFromContentLang maps ISO 639-1 original_language onto a catalog locale.
func catalogLocaleFromContentLang(iso string) string {
	switch strings.ToLower(strings.TrimSpace(iso)) {
	case "zh", "zh-cn", "zh-hans":
		return "zh-CN"
	case "zh-tw", "zh-hk", "zh-hant":
		return "zh-TW"
	case "en", "en-us", "en-gb":
		return "en-US"
	case "ja", "jpn":
		return "ja"
	case "ko", "kor":
		return "ko"
	default:
		n := models.NormalizeLocale(iso)
		if models.ValidLocales[n] {
			return n
		}
		return ""
	}
}

func ensureCanonicalPack(items []LocaleTextInput, loc, title, body string) []LocaleTextInput {
	if strings.TrimSpace(title) == "" && strings.TrimSpace(body) == "" {
		return items
	}
	if localeTitle(items, loc) != "" || localeBody(items, loc) != "" {
		return items
	}
	t := strings.TrimSpace(title)
	b := strings.TrimSpace(body)
	return append(items, LocaleTextInput{Locale: loc, Title: t, Name: t, Summary: b, Biography: b})
}

func applyWorkLocaleDefaults(work *models.Work, translations []LocaleTextInput, languageHint string) []LocaleTextInput {
	items := parseLocaleInputs(translations)
	hint := catalogLanguageFrom(languageHint, items, work.Title)
	items = ensureCanonicalPack(items, hint, work.Title, work.Summary)
	work.Language = catalogLanguageFrom(languageHint, items, work.Title)
	if t := localeTitle(items, work.Language); t != "" {
		work.Title = t
	}
	work.Summary = localeBody(items, work.Language)
	// 原始语言是多语言标题体系中的一员：确保原语言标题落在对应翻译行，
	// 而不是实体级 aliases（aliases 只收真正的跨语种异名/搜索别名）。
	if origLoc := catalogLocaleFromContentLang(work.OriginalLanguage); origLoc != "" {
		if t := localeTitle(items, origLoc); t != "" {
			work.OriginalTitle = t
		} else if strings.TrimSpace(work.OriginalTitle) != "" {
			items = ensureCanonicalPack(items, origLoc, work.OriginalTitle, "")
		}
		if t := localeTitle(items, origLoc); t != "" {
			work.OriginalTitle = t
		}
	}
	work.Aliases = filterKnownTitlesFromAliases(work.Aliases, items)
	return items
}

func applyArtistLocaleDefaults(artist *models.Artist, translations []LocaleTextInput, languageHint string) []LocaleTextInput {
	items := parseLocaleInputs(translations)
	hint := catalogLanguageFrom(languageHint, items, artist.Name)
	items = ensureCanonicalPack(items, hint, artist.Name, artist.Biography)
	artist.Language = catalogLanguageFrom(languageHint, items, artist.Name)
	if t := localeTitle(items, artist.Language); t != "" {
		artist.Name = t
	}
	artist.Biography = localeBody(items, artist.Language)
	return items
}

func applyFranchiseLocaleDefaults(fr *models.Franchise, translations []LocaleTextInput, languageHint string) []LocaleTextInput {
	items := parseLocaleInputs(translations)
	hint := catalogLanguageFrom(languageHint, items, fr.Title)
	items = ensureCanonicalPack(items, hint, fr.Title, fr.Summary)
	fr.Language = catalogLanguageFrom(languageHint, items, fr.Title)
	if t := localeTitle(items, fr.Language); t != "" {
		fr.Title = t
	}
	fr.Summary = localeBody(items, fr.Language)
	if strings.TrimSpace(fr.OriginalTitle) != "" {
		covered := false
		for _, it := range items {
			for _, t := range append([]string{it.Title, it.Name}, it.Aliases...) {
				if strings.EqualFold(strings.TrimSpace(t), strings.TrimSpace(fr.OriginalTitle)) {
					covered = true
					break
				}
			}
			if covered {
				break
			}
		}
		if !covered {
			items = ensureCanonicalPack(items, catalogLanguageFrom("", items, fr.OriginalTitle), fr.OriginalTitle, "")
		}
	}
	fr.Aliases = filterKnownTitlesFromAliases(fr.Aliases, items)
	return items
}

func (s *CatalogService) upsertWorkTranslations(workID uuid.UUID, items []LocaleTextInput) {
	keep := make([]string, 0, len(items))
	for _, it := range items {
		keep = append(keep, it.Locale)
		row := models.WorkTranslation{WorkID: workID, Locale: it.Locale, Title: it.Title, Summary: it.Summary, Aliases: pq.StringArray(it.Aliases)}
		_ = s.db.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "work_id"}, {Name: "locale"}},
			DoUpdates: clause.AssignmentColumns([]string{"title", "summary", "aliases"}),
		}).Create(&row).Error
	}
	q := s.db.Where("work_id = ?", workID)
	if len(keep) > 0 {
		q = q.Where("locale NOT IN ?", keep)
	}
	_ = q.Delete(&models.WorkTranslation{}).Error
}

func upsertWorkTranslationsDB(db *gorm.DB, workID uuid.UUID, items []LocaleTextInput) error {
	keep := make([]string, 0, len(items))
	for _, it := range items {
		keep = append(keep, it.Locale)
		row := models.WorkTranslation{WorkID: workID, Locale: it.Locale, Title: it.Title, Summary: it.Summary, Aliases: pq.StringArray(it.Aliases)}
		if err := db.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "work_id"}, {Name: "locale"}},
			DoUpdates: clause.AssignmentColumns([]string{"title", "summary", "aliases"}),
		}).Create(&row).Error; err != nil {
			return err
		}
	}
	q := db.Where("work_id = ?", workID)
	if len(keep) > 0 {
		q = q.Where("locale NOT IN ?", keep)
	}
	return q.Delete(&models.WorkTranslation{}).Error
}

func (s *CatalogService) upsertArtistTranslations(artistID uuid.UUID, items []LocaleTextInput) {
	keep := make([]string, 0, len(items))
	for _, it := range items {
		name := it.Name
		if name == "" {
			name = it.Title
		}
		bio := it.Biography
		if bio == "" {
			bio = it.Summary
		}
		keep = append(keep, it.Locale)
		row := models.ArtistTranslation{ArtistID: artistID, Locale: it.Locale, Name: name, Biography: bio, Aliases: pq.StringArray(it.Aliases)}
		_ = s.db.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "artist_id"}, {Name: "locale"}},
			DoUpdates: clause.AssignmentColumns([]string{"name", "biography", "aliases"}),
		}).Create(&row).Error
	}
	q := s.db.Where("artist_id = ?", artistID)
	if len(keep) > 0 {
		q = q.Where("locale NOT IN ?", keep)
	}
	_ = q.Delete(&models.ArtistTranslation{}).Error
}

func upsertArtistTranslationsDB(db *gorm.DB, artistID uuid.UUID, items []LocaleTextInput) error {
	keep := make([]string, 0, len(items))
	for _, it := range items {
		name := it.Name
		if name == "" {
			name = it.Title
		}
		bio := it.Biography
		if bio == "" {
			bio = it.Summary
		}
		keep = append(keep, it.Locale)
		row := models.ArtistTranslation{ArtistID: artistID, Locale: it.Locale, Name: name, Biography: bio, Aliases: pq.StringArray(it.Aliases)}
		if err := db.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "artist_id"}, {Name: "locale"}},
			DoUpdates: clause.AssignmentColumns([]string{"name", "biography", "aliases"}),
		}).Create(&row).Error; err != nil {
			return err
		}
	}
	q := db.Where("artist_id = ?", artistID)
	if len(keep) > 0 {
		q = q.Where("locale NOT IN ?", keep)
	}
	return q.Delete(&models.ArtistTranslation{}).Error
}

func (s *CatalogService) upsertFranchiseTranslations(fid uuid.UUID, items []LocaleTextInput) {
	keep := make([]string, 0, len(items))
	for _, it := range items {
		keep = append(keep, it.Locale)
		row := models.FranchiseTranslation{FranchiseID: fid, Locale: it.Locale, Title: it.Title, Summary: it.Summary, Aliases: pq.StringArray(it.Aliases)}
		_ = s.db.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "franchise_id"}, {Name: "locale"}},
			DoUpdates: clause.AssignmentColumns([]string{"title", "summary", "aliases"}),
		}).Create(&row).Error
	}
	q := s.db.Where("franchise_id = ?", fid)
	if len(keep) > 0 {
		q = q.Where("locale NOT IN ?", keep)
	}
	_ = q.Delete(&models.FranchiseTranslation{}).Error
}
