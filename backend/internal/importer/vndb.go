package importer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/metafusion/metafusion-app/internal/security"
)

var (
	vndbVNRegex        = regexp.MustCompile(`(?:vndb\.org/)?v(\d+)`)
	vndbStaffRegex     = regexp.MustCompile(`(?:vndb\.org/)?s(\d+)`)
	vndbCharacterRegex = regexp.MustCompile(`(?:vndb\.org/)?c(\d+)`)
	vndbProducerRegex  = regexp.MustCompile(`(?:vndb\.org/)?p(\d+)`)
)

// ParseVNDBID 提取 VNDB 实体类型与编号 (v17, s2, c12, p1 等)
func ParseVNDBID(input string) (entityType string, id string, err error) {
	clean := strings.TrimSpace(strings.ToLower(input))
	if m := vndbVNRegex.FindStringSubmatch(clean); len(m) > 1 {
		return "work", "v" + m[1], nil
	}
	if m := vndbStaffRegex.FindStringSubmatch(clean); len(m) > 1 {
		return "artist", "s" + m[1], nil
	}
	if m := vndbCharacterRegex.FindStringSubmatch(clean); len(m) > 1 {
		return "character", "c" + m[1], nil
	}
	if m := vndbProducerRegex.FindStringSubmatch(clean); len(m) > 1 {
		return "organization", "p" + m[1], nil
	}
	if numericIDRegex.MatchString(clean) {
		return "work", "v" + clean, nil
	}
	return "", "", fmt.Errorf("invalid VNDB URL or identifier: %s", input)
}

// queryVNDBKana 执行 VNDB 官方 Kana HTTP API 查询
func queryVNDBKana(ctx context.Context, endpoint string, payload map[string]interface{}) ([]byte, error) {
	apiURL := fmt.Sprintf("https://api.vndb.org/kana/%s", endpoint)
	if err := security.ValidateExternalURL(apiURL); err != nil {
		return nil, fmt.Errorf("security check failed for VNDB URL: %w", err)
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "MetaFusion-OmniImporter/1.0 ( contact@metafusion.io )")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("VNDB API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("VNDB returned status %d: %s", resp.StatusCode, string(respBody))
	}

	return io.ReadAll(resp.Body)
}

// FetchVNDBVNPreview 解析 VNDB 视觉小说作品
func FetchVNDBVNPreview(ctx context.Context, vnID string) (*PreviewResponse, error) {
	payload := map[string]interface{}{
		"filters": []interface{}{"id", "=", vnID},
		"fields":  "title, alttitle, titles{lang, title, latin, official, main}, aliases, released, description, image.url, length_minutes, tags{name, category}, developers{name, original, id}, staff{name, original, role, eid, note, id}",
	}

	respBytes, err := queryVNDBKana(ctx, "vn", payload)
	if err != nil {
		return nil, err
	}

	var vnRes struct {
		Results []struct {
			ID          string `json:"id"`
			Title       string `json:"title"`
			AltTitle    string `json:"alttitle"`
			Aliases     []string `json:"aliases"`
			Released    string `json:"released"`
			Description string `json:"description"`
			Image       struct {
				URL string `json:"url"`
			} `json:"image"`
			Titles []struct {
				Lang     string `json:"lang"`
				Title    string `json:"title"`
				Latin    string `json:"latin"`
				Official bool   `json:"official"`
				Main     bool   `json:"main"`
			} `json:"titles"`
			Tags []struct {
				Name     string `json:"name"`
				Category string `json:"category"`
			} `json:"tags"`
			Developers []struct {
				ID       string `json:"id"`
				Name     string `json:"name"`
				Original string `json:"original"`
			} `json:"developers"`
			Staff []struct {
				ID       string `json:"id"`
				Eid      int    `json:"eid"`
				Name     string `json:"name"`
				Original string `json:"original"`
				Role     string `json:"role"`
				Note     string `json:"note"`
			} `json:"staff"`
		} `json:"results"`
	}

	if err := json.Unmarshal(respBytes, &vnRes); err != nil || len(vnRes.Results) == 0 {
		return nil, fmt.Errorf("VNDB visual novel %s not found", vnID)
	}

	item := vnRes.Results[0]

	// 标题与多语言
	mainTitle := item.Title
	origTitle := item.AltTitle
	translations := make([]TranslationItem, 0)
	aliasSet := make(map[string]bool)

	for _, a := range item.Aliases {
		if strings.TrimSpace(a) != "" {
			aliasSet[strings.TrimSpace(a)] = true
		}
	}

	for _, t := range item.Titles {
		if t.Title != "" {
			loc := models.NormalizeLocale(t.Lang)
			translations = append(translations, TranslationItem{
				Locale:  loc,
				Title:   strings.TrimSpace(t.Title),
				Summary: "",
			})
			if t.Lang == "ja" && origTitle == "" {
				origTitle = t.Title
			}
			if (t.Lang == "zh-Hans" || t.Lang == "zh-CN" || t.Lang == "zh") && mainTitle == item.Title {
				mainTitle = t.Title
			}
		}
	}

	aliases := make([]string, 0, len(aliasSet))
	for a := range aliasSet {
		aliases = append(aliases, a)
	}

	// 演职员与开发者主体提取
	var artists []ArtistPreview
	artistNameMap := make(map[string]bool)

	for _, dev := range item.Developers {
		devName := strings.TrimSpace(dev.Name)
		if devName == "" || artistNameMap[devName] {
			continue
		}
		artistNameMap[devName] = true
		artists = append(artists, ArtistPreview{
			Name:         devName,
			OriginalName: dev.Original,
			Role:         "Studio / Developer",
			EntityType:   models.EntityTypeStudio,
			Country:      "JP",
			ExternalIDs: models.JSONB{
				"vndb_producer": dev.ID,
			},
		})
	}

	for _, st := range item.Staff {
		stName := strings.TrimSpace(st.Name)
		if stName == "" || artistNameMap[stName] {
			continue
		}
		artistNameMap[stName] = true

		role := "Staff"
		roleLower := strings.ToLower(st.Role)
		switch {
		case strings.Contains(roleLower, "scenario") || strings.Contains(roleLower, "writer") || strings.Contains(roleLower, "author"):
			role = "Author / Scenario"
		case strings.Contains(roleLower, "director"):
			role = "Director"
		case strings.Contains(roleLower, "art") || strings.Contains(roleLower, "character design") || strings.Contains(roleLower, "illustrator"):
			role = "Character Design / Artist"
		case strings.Contains(roleLower, "music") || strings.Contains(roleLower, "composer") || strings.Contains(roleLower, "sound"):
			role = "Composer"
		case strings.Contains(roleLower, "producer"):
			role = "Producer"
		}

		artists = append(artists, ArtistPreview{
			Name:         stName,
			OriginalName: st.Original,
			Role:         role,
			EntityType:   models.EntityTypePerson,
			Disambiguation: st.Note,
			ExternalIDs: models.JSONB{
				"vndb_staff": st.ID,
			},
		})
	}

	// 查询角色与声优信息
	charPayload := map[string]interface{}{
		"filters": []interface{}{"vn", "=", []interface{}{"id", "=", vnID}},
		"fields":  "name, original, role, vns{id, rtype, role, seiyuu{id, name, original}}",
	}
	if charBytes, err := queryVNDBKana(ctx, "character", charPayload); err == nil {
		var charRes struct {
			Results []struct {
				ID       string `json:"id"`
				Name     string `json:"name"`
				Original string `json:"original"`
				Role     string `json:"role"`
				Vns      []struct {
					ID     string `json:"id"`
					Role   string `json:"role"`
					Seiyuu []struct {
						ID       string `json:"id"`
						Name     string `json:"name"`
						Original string `json:"original"`
					} `json:"seiyuu"`
				} `json:"vns"`
			} `json:"results"`
		}
		if err := json.Unmarshal(charBytes, &charRes); err == nil {
			for _, ch := range charRes.Results {
				charName := strings.TrimSpace(ch.Name)
				if charName == "" {
					continue
				}
				for _, v := range ch.Vns {
					for _, sy := range v.Seiyuu {
						syName := strings.TrimSpace(sy.Name)
						if syName == "" {
							continue
						}
						key := syName + "_as_" + charName
						if artistNameMap[key] {
							continue
						}
						artistNameMap[key] = true
						artists = append(artists, ArtistPreview{
							Name:          syName,
							OriginalName:  sy.Original,
							Role:          "Voice Actor",
							EntityType:    models.EntityTypePerson,
							CharacterName: charName,
							ExternalIDs: models.JSONB{
								"vndb_staff":     sy.ID,
								"vndb_character": ch.ID,
							},
						})
					}
				}
			}
		}
	}

	// 标签提取
	tags := []string{"Visual Novel", "ACG", "Game"}
	for _, t := range item.Tags {
		if strings.TrimSpace(t.Name) != "" && (t.Category == "cont" || t.Category == "ero") {
			tags = append(tags, t.Name)
		}
	}

	work := WorkPreview{
		Title:            mainTitle,
		OriginalTitle:    origTitle,
		Aliases:          aliases,
		ReleaseDate:      item.Released,
		BeginDate:        item.Released,
		Country:          "JP",
		Language:         "ja",
		OriginalLanguage: "ja",
		Summary:          item.Description,
		CoverImageURL:    item.Image.URL,
		CoverAspect:      "2:3",
		ContentRating:    "Restricted",
		Tags:             tags,
		ExternalIDs: models.JSONB{
			"vndb": vnID,
		},
		Translations: translations,
		CatalogMetadata: models.JSONB{
			"vndb_id": vnID,
		},
	}

	release := ReleasePreview{
		EditionName:         fmt.Sprintf("%s（官方首发版）", mainTitle),
		Packaging:           "digital_release",
		Country:             "JP",
		Language:            "ja",
		DistributionChannel: "digital",
		EditionDate:         item.Released,
		Notes:               fmt.Sprintf("Imported from VNDB visual novel %s", vnID),
		ExternalIDs: models.JSONB{
			"vndb": vnID,
		},
	}

	mediums := []MediumPreview{
		{
			Position:      1,
			Name:          "Game Master / Windows / Package",
			Format:        "Digital",
			MediaCategory: "game",
			Tracks: []TrackPreview{
				{
					Position:        1,
					Title:           fmt.Sprintf("%s (Main Story)", mainTitle),
					DurationSeconds: 7200,
				},
			},
		},
	}

	return &PreviewResponse{
		Source:      "vndb",
		EntityType:  "work",
		ExternalID:  vnID,
		ExternalURL: fmt.Sprintf("https://vndb.org/%s", vnID),
		MediaType:   "game",
		Work:        work,
		Artists:     artists,
		Release:     release,
		Mediums:     mediums,
		Tags:        tags,
	}, nil
}

// FetchVNDBStaffPreview 解析 VNDB 创作者/人物/声优
func FetchVNDBStaffPreview(ctx context.Context, staffID string) (*PreviewResponse, error) {
	payload := map[string]interface{}{
		"filters": []interface{}{"id", "=", staffID},
		"fields":  "name, original, gender, lang, aliases, description, extlinks{label, url}",
	}

	respBytes, err := queryVNDBKana(ctx, "staff", payload)
	if err != nil {
		return nil, err
	}

	var res struct {
		Results []struct {
			ID          string   `json:"id"`
			Name        string   `json:"name"`
			Original    string   `json:"original"`
			Gender      string   `json:"gender"`
			Lang        string   `json:"lang"`
			Aliases     []string `json:"aliases"`
			Description string   `json:"description"`
			Extlinks    []struct {
				Label string `json:"label"`
				URL   string `json:"url"`
			} `json:"extlinks"`
		} `json:"results"`
	}

	if err := json.Unmarshal(respBytes, &res); err != nil || len(res.Results) == 0 {
		return nil, fmt.Errorf("VNDB staff %s not found", staffID)
	}

	item := res.Results[0]
	extIDs := models.JSONB{
		"vndb_staff": staffID,
	}
	for _, l := range item.Extlinks {
		lbl := strings.ToLower(strings.TrimSpace(l.Label))
		if strings.Contains(lbl, "twitter") || strings.Contains(lbl, "x") {
			extIDs["twitter"] = l.URL
		} else if strings.Contains(lbl, "wikidata") {
			extIDs["wikidata"] = l.URL
		} else if strings.Contains(lbl, "anidb") {
			extIDs["anidb"] = l.URL
		}
	}

	artist := ArtistPreview{
		Name:           item.Name,
		OriginalName:   item.Original,
		EntityType:     models.EntityTypePerson,
		Country:        strings.ToUpper(item.Lang),
		Biography:      item.Description,
		Language:       item.Lang,
		Aliases:        item.Aliases,
		ExternalIDs:    extIDs,
	}

	return &PreviewResponse{
		Source:      "vndb",
		EntityType:  "artist",
		ExternalID:  staffID,
		ExternalURL: fmt.Sprintf("https://vndb.org/%s", staffID),
		MediaType:   "person",
		Artist:      &artist,
	}, nil
}

// FetchVNDBCharacterPreview 解析 VNDB 虚拟角色
func FetchVNDBCharacterPreview(ctx context.Context, charID string) (*PreviewResponse, error) {
	payload := map[string]interface{}{
		"filters": []interface{}{"id", "=", charID},
		"fields":  "name, original, aliases, description, image.url, sex, b_month, b_day, height, weight, bust, waist, hips, blood_type",
	}

	respBytes, err := queryVNDBKana(ctx, "character", payload)
	if err != nil {
		return nil, err
	}

	var res struct {
		Results []struct {
			ID          string   `json:"id"`
			Name        string   `json:"name"`
			Original    string   `json:"original"`
			Aliases     []string `json:"aliases"`
			Description string   `json:"description"`
			Sex         string   `json:"sex"`
			Height      int      `json:"height"`
			Weight      int      `json:"weight"`
			BloodType   string   `json:"blood_type"`
			Image       struct {
				URL string `json:"url"`
			} `json:"image"`
		} `json:"results"`
	}

	if err := json.Unmarshal(respBytes, &res); err != nil || len(res.Results) == 0 {
		return nil, fmt.Errorf("VNDB character %s not found", charID)
	}

	item := res.Results[0]
	bioParts := []string{}
	if item.Description != "" {
		bioParts = append(bioParts, item.Description)
	}
	specs := []string{}
	if item.Sex != "" {
		specs = append(specs, fmt.Sprintf("性别: %s", item.Sex))
	}
	if item.Height > 0 {
		specs = append(specs, fmt.Sprintf("身高: %d cm", item.Height))
	}
	if item.Weight > 0 {
		specs = append(specs, fmt.Sprintf("体重: %d kg", item.Weight))
	}
	if item.BloodType != "" {
		specs = append(specs, fmt.Sprintf("血型: %s", item.BloodType))
	}
	if len(specs) > 0 {
		bioParts = append(bioParts, "\n【角色设定】\n"+strings.Join(specs, " | "))
	}

	artist := ArtistPreview{
		Name:         item.Name,
		OriginalName: item.Original,
		EntityType:   models.EntityTypeCharacter,
		Role:         "Character",
		Biography:    strings.Join(bioParts, "\n\n"),
		AvatarURL:    item.Image.URL,
		Aliases:      item.Aliases,
		ExternalIDs: models.JSONB{
			"vndb_character": charID,
		},
	}

	return &PreviewResponse{
		Source:      "vndb",
		EntityType:  "character",
		ExternalID:  charID,
		ExternalURL: fmt.Sprintf("https://vndb.org/%s", charID),
		MediaType:   "character",
		Artist:      &artist,
	}, nil
}

// FetchVNDBProducerPreview 解析 VNDB 制作公司/发行厂牌
func FetchVNDBProducerPreview(ctx context.Context, prodID string) (*PreviewResponse, error) {
	payload := map[string]interface{}{
		"filters": []interface{}{"id", "=", prodID},
		"fields":  "name, original, type, lang, aliases, description",
	}

	respBytes, err := queryVNDBKana(ctx, "producer", payload)
	if err != nil {
		return nil, err
	}

	var res struct {
		Results []struct {
			ID          string   `json:"id"`
			Name        string   `json:"name"`
			Original    string   `json:"original"`
			Type        string   `json:"type"` // "co" (company), "in" (individual), "ng" (amateur group)
			Lang        string   `json:"lang"`
			Aliases     []string `json:"aliases"`
			Description string   `json:"description"`
		} `json:"results"`
	}

	if err := json.Unmarshal(respBytes, &res); err != nil || len(res.Results) == 0 {
		return nil, fmt.Errorf("VNDB producer %s not found", prodID)
	}

	item := res.Results[0]
	entType := models.EntityTypeStudio
	if item.Type == "co" {
		entType = models.EntityTypePublisher
	} else if item.Type == "ng" {
		entType = models.EntityTypeCircle
	}

	artist := ArtistPreview{
		Name:         item.Name,
		OriginalName: item.Original,
		EntityType:   entType,
		Role:         "Studio / Producer",
		Country:      strings.ToUpper(item.Lang),
		Biography:    item.Description,
		Aliases:      item.Aliases,
		ExternalIDs: models.JSONB{
			"vndb_producer": prodID,
		},
	}

	return &PreviewResponse{
		Source:      "vndb",
		EntityType:  "organization",
		ExternalID:  prodID,
		ExternalURL: fmt.Sprintf("https://vndb.org/%s", prodID),
		MediaType:   "organization",
		Artist:      &artist,
	}, nil
}
