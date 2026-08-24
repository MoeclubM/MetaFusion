package importer

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/metafusion/metafusion-app/internal/security"
)

var (
	bgmURLRegex          = regexp.MustCompile(`(?:bgm\.tv|bangumi\.tv|chii\.in)/subject/(\d+)`)
	bgmPersonURLRegex    = regexp.MustCompile(`(?:bgm\.tv|bangumi\.tv|chii\.in)/(?:person|prsn)/(\d+)`)
	bgmCharacterURLRegex = regexp.MustCompile(`(?:bgm\.tv|bangumi\.tv|chii\.in)/(?:character|crt)/(\d+)`)
)

type bgmInfoboxItem struct {
	Key   string      `json:"key"`
	Value interface{} `json:"value"`
}

type bgmSubjectResponse struct {
	ID            int              `json:"id"`
	Type          int              `json:"type"` // 1: book, 2: anime, 3: music, 4: game, 6: real
	Name          string           `json:"name"`
	NameCN        string           `json:"name_cn"`
	Summary       string           `json:"summary"`
	Date          string           `json:"date"`
	Platform      string           `json:"platform"`
	Images        struct {
		Large  string `json:"large"`
		Common string `json:"common"`
		Medium string `json:"medium"`
		Small  string `json:"small"`
		Grid   string `json:"grid"`
	} `json:"images"`
	Infobox       []bgmInfoboxItem `json:"infobox"`
	Volumes       int              `json:"volumes"`
	Eps           int              `json:"eps"`
	TotalEpisodes int              `json:"total_episodes"`
	Tags          []struct {
		Name  string `json:"name"`
		Count int    `json:"count"`
	} `json:"tags"`
}

type bgmPersonItem struct {
	ID       int      `json:"id"`
	Name     string   `json:"name"`
	Type     int      `json:"type"` // 1: person, 2: company/studio, 3: group
	Relation string   `json:"relation"` // "原作", "导演", "作者", "音乐", "动画制作", "出版社", etc.
	Career   []string `json:"career"`
	Images   struct {
		Large  string `json:"large"`
		Medium string `json:"medium"`
	} `json:"images"`
}

type bgmSubjectCharacterItem struct {
	ID       int    `json:"id"`
	Name     string `json:"name"`
	Relation string `json:"relation"`
	Images   struct {
		Large string `json:"large"`
	} `json:"images"`
	Actors []struct {
		ID     int    `json:"id"`
		Name   string `json:"name"`
		Images struct {
			Large string `json:"large"`
		} `json:"images"`
	} `json:"actors"`
}

type bgmPersonDetail struct {
	ID      int              `json:"id"`
	Name    string           `json:"name"`
	Type    int              `json:"type"` // 1: individual, 2: company, 3: group
	Career  []string         `json:"career"`
	Summary string           `json:"summary"`
	Images  struct {
		Large  string `json:"large"`
		Medium string `json:"medium"`
	} `json:"images"`
	Infobox []bgmInfoboxItem `json:"infobox"`
}

type bgmCharacterDetail struct {
	ID       int              `json:"id"`
	Name     string           `json:"name"`
	RoleName string           `json:"role_name"`
	Summary  string           `json:"summary"`
	Images   struct {
		Large  string `json:"large"`
		Medium string `json:"medium"`
	} `json:"images"`
	Infobox  []bgmInfoboxItem `json:"infobox"`
}

// ParseBangumiID 从输入中提取 Bangumi Subject ID
func ParseBangumiID(input string) (string, error) {
	clean := strings.TrimSpace(input)
	if m := bgmURLRegex.FindStringSubmatch(clean); len(m) > 1 {
		return m[1], nil
	}
	if numericIDRegex.MatchString(clean) {
		return clean, nil
	}
	return "", fmt.Errorf("invalid Bangumi URL or Subject ID: %s", input)
}

// ParseBangumiPersonID 从输入中提取 Bangumi Person ID
func ParseBangumiPersonID(input string) (string, error) {
	clean := strings.TrimSpace(input)
	if m := bgmPersonURLRegex.FindStringSubmatch(clean); len(m) > 1 {
		return m[1], nil
	}
	if numericIDRegex.MatchString(clean) {
		return clean, nil
	}
	return "", fmt.Errorf("invalid Bangumi Person URL or ID: %s", input)
}

// ParseBangumiCharacterID 从输入中提取 Bangumi Character ID
func ParseBangumiCharacterID(input string) (string, error) {
	clean := strings.TrimSpace(input)
	if m := bgmCharacterURLRegex.FindStringSubmatch(clean); len(m) > 1 {
		return m[1], nil
	}
	if numericIDRegex.MatchString(clean) {
		return clean, nil
	}
	return "", fmt.Errorf("invalid Bangumi Character URL or ID: %s", input)
}

// FetchBangumiPreview 请求 Bangumi 官方开放 API 并组装 ACG/书籍/动画/游戏全量规范预览
func FetchBangumiPreview(ctx context.Context, input string) (*PreviewResponse, error) {
	subjectID, err := ParseBangumiID(input)
	if err != nil {
		return nil, err
	}

	client := &http.Client{
		Timeout: 15 * time.Second,
	}

	subjectURL := fmt.Sprintf("https://api.bgm.tv/v0/subjects/%s", subjectID)
	if err := security.ValidateExternalURL(subjectURL); err != nil {
		return nil, fmt.Errorf("security check failed for Bangumi URL: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "GET", subjectURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "MetaFusion-OmniImporter/1.0 ( contact@metafusion.io )")
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Bangumi API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Bangumi returned %d: %s", resp.StatusCode, string(body))
	}

	var data bgmSubjectResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, fmt.Errorf("failed to decode Bangumi subject JSON: %w", err)
	}

	// 1. 并发查询 Staff/Persons 信息
	var persons []bgmPersonItem
	personsURL := fmt.Sprintf("https://api.bgm.tv/v0/subjects/%s/persons", subjectID)
	if err := security.ValidateExternalURL(personsURL); err == nil {
		pReq, _ := http.NewRequestWithContext(ctx, "GET", personsURL, nil)
		pReq.Header.Set("User-Agent", "MetaFusion-OmniImporter/1.0 ( contact@metafusion.io )")
		pReq.Header.Set("Accept", "application/json")
		if pResp, err := client.Do(pReq); err == nil && pResp.StatusCode == http.StatusOK {
			_ = json.NewDecoder(pResp.Body).Decode(&persons)
			pResp.Body.Close()
		}
	}

	// 2. 并发查询 Characters & Cast 声优/角色信息
	var bgmChars []bgmSubjectCharacterItem
	charsURL := fmt.Sprintf("https://api.bgm.tv/v0/subjects/%s/characters", subjectID)
	if err := security.ValidateExternalURL(charsURL); err == nil {
		cReq, _ := http.NewRequestWithContext(ctx, "GET", charsURL, nil)
		cReq.Header.Set("User-Agent", "MetaFusion-OmniImporter/1.0 ( contact@metafusion.io )")
		cReq.Header.Set("Accept", "application/json")
		if cResp, err := client.Do(cReq); err == nil && cResp.StatusCode == http.StatusOK {
			_ = json.NewDecoder(cResp.Body).Decode(&bgmChars)
			cResp.Body.Close()
		}
	}

	// 标题处理
	workTitle := strings.TrimSpace(data.NameCN)
	if workTitle == "" {
		workTitle = strings.TrimSpace(data.Name)
	}
	origTitle := strings.TrimSpace(data.Name)

	aliases := make([]string, 0)
	if data.NameCN != "" && data.NameCN != data.Name {
		aliases = append(aliases, data.Name)
	}

	// 解析 Infobox 获取额外元数据
	publisherName := ""
	isbn := ""
	for _, item := range data.Infobox {
		k := strings.TrimSpace(item.Key)
		vStr := fmt.Sprintf("%v", item.Value)
		if k == "出版社" || k == "发行" {
			publisherName = strings.TrimSpace(vStr)
		} else if k == "ISBN" {
			isbn = strings.TrimSpace(vStr)
		} else if k == "别名" {
			aliases = append(aliases, strings.TrimSpace(vStr))
		}
	}

	// 创作者与机构提取
	var artists []ArtistPreview
	artistNameMap := make(map[string]bool)

	for _, p := range persons {
		pName := strings.TrimSpace(p.Name)
		if pName == "" || artistNameMap[pName] {
			continue
		}
		artistNameMap[pName] = true

		role := "Creator"
		rel := p.Relation
		switch {
		case strings.Contains(rel, "原作") || strings.Contains(rel, "作者"):
			role = "Author"
		case strings.Contains(rel, "导演") || strings.Contains(rel, "监督"):
			role = "Director"
		case strings.Contains(rel, "人物设定") || strings.Contains(rel, "作画") || strings.Contains(rel, "插图"):
			role = "Illustrator / Artist"
		case strings.Contains(rel, "音乐") || strings.Contains(rel, "作曲"):
			role = "Composer"
		case strings.Contains(rel, "制作") || strings.Contains(rel, "动画制作") || strings.Contains(rel, "开发"):
			role = "Studio"
		case strings.Contains(rel, "出版社") || strings.Contains(rel, "发行"):
			role = "Publisher"
			if publisherName == "" {
				publisherName = pName
			}
		case strings.Contains(rel, "剧本") || strings.Contains(rel, "系列构成"):
			role = "Screenplay / Writer"
		case strings.Contains(rel, "声优") || strings.Contains(rel, "配音") || strings.Contains(rel, "主演"):
			role = "Voice Actor"
		}

		entType := models.EntityTypePerson
		if p.Type == 2 {
			entType = models.EntityTypeStudio
		} else if p.Type == 3 {
			entType = models.EntityTypeGroup
		}

		artists = append(artists, ArtistPreview{
			Name:         pName,
			Role:         role,
			EntityType:   entType,
			Country:      "JP",
			AvatarURL:    p.Images.Large,
			ExternalIDs: models.JSONB{
				"bangumi_person": strconv.Itoa(p.ID),
			},
		})
	}

	// 角色与配音声优提取
	for _, ch := range bgmChars {
		chName := strings.TrimSpace(ch.Name)
		if chName == "" {
			continue
		}
		if len(ch.Actors) > 0 {
			for _, act := range ch.Actors {
				actName := strings.TrimSpace(act.Name)
				if actName == "" {
					continue
				}
				key := actName + "_as_" + chName
				if artistNameMap[key] {
					continue
				}
				artistNameMap[key] = true
				artists = append(artists, ArtistPreview{
					Name:          actName,
					Role:          "Voice Actor",
					EntityType:    models.EntityTypePerson,
					Country:       "JP",
					AvatarURL:     act.Images.Large,
					CharacterName: chName,
					ExternalIDs: models.JSONB{
						"bangumi_person":    strconv.Itoa(act.ID),
						"bangumi_character": strconv.Itoa(ch.ID),
					},
				})
			}
		} else {
			key := "char_" + chName
			if !artistNameMap[key] {
				artistNameMap[key] = true
				artists = append(artists, ArtistPreview{
					Name:        chName,
					Role:        "Character",
					EntityType:  models.EntityTypeCharacter,
					Country:     "JP",
					AvatarURL:   ch.Images.Large,
					ExternalIDs: models.JSONB{
						"bangumi_character": strconv.Itoa(ch.ID),
					},
				})
			}
		}
	}

	// 媒体类型分类及封面比例
	mediaType := "book"
	coverAspect := "3:4"
	format := "Paperback"
	mediaCategory := "book"
	switch data.Type {
	case 1: // Book
		mediaType = "book"
		coverAspect = "3:4"
		format = "Paperback"
		mediaCategory = "book"
	case 2: // Anime
		mediaType = "anime"
		coverAspect = "2:3"
		format = "Blu-ray"
		mediaCategory = "video"
	case 3: // Music
		mediaType = "music"
		coverAspect = "1:1"
		format = "CD"
		mediaCategory = "audio"
	case 4: // Game
		mediaType = "game"
		coverAspect = "2:3"
		format = "Digital"
		mediaCategory = "game"
	case 6: // Real/Drama
		mediaType = "tv"
		coverAspect = "2:3"
		format = "Digital"
		mediaCategory = "video"
	}

	// 标签提取
	tagMap := make(map[string]bool)
	tagMap["ACG"] = true
	switch mediaType {
	case "book":
		tagMap["Book"] = true
		tagMap["Manga"] = true
	case "anime":
		tagMap["Anime"] = true
		tagMap["Animation"] = true
	case "music":
		tagMap["Music"] = true
		tagMap["OST"] = true
	case "game":
		tagMap["Game"] = true
	}
	for _, t := range data.Tags {
		if strings.TrimSpace(t.Name) != "" && t.Count >= 2 {
			tagMap[t.Name] = true
		}
	}
	tags := make([]string, 0, len(tagMap))
	for k := range tagMap {
		tags = append(tags, k)
	}

	// 封面图像 (优先 large，回退 common)
	coverURL := data.Images.Large
	if coverURL == "" {
		coverURL = data.Images.Common
	}

	// 卷册 / 话数 / Mediums
	var mediums []MediumPreview
	itemCount := data.Volumes
	if itemCount <= 0 {
		itemCount = data.Eps
	}
	if itemCount <= 0 {
		itemCount = data.TotalEpisodes
	}
	if itemCount <= 0 {
		itemCount = 1
	}
	if itemCount > 50 {
		itemCount = 50 // 限制初始预览条目数
	}

	var tracks []TrackPreview
	for i := 1; i <= itemCount; i++ {
		trkTitle := ""
		if mediaType == "book" {
			trkTitle = fmt.Sprintf("%s 第 %d 卷", workTitle, i)
		} else if mediaType == "anime" || mediaType == "tv" {
			trkTitle = fmt.Sprintf("%s 第 %d 话", workTitle, i)
		} else {
			trkTitle = fmt.Sprintf("%s Track %d", workTitle, i)
		}
		tracks = append(tracks, TrackPreview{
			Position:        i,
			Title:           trkTitle,
			DurationSeconds: 1440, // 默认 24 分钟
		})
	}

	medName := "Vol. 1（单行本/剧集正片）"
	if mediaType == "anime" {
		medName = "TV Broadcast / BD-BOX"
	}
	mediums = append(mediums, MediumPreview{
		Position:      1,
		Name:          medName,
		Format:        format,
		MediaCategory: mediaCategory,
		Tracks:        tracks,
	})

	// 发行版本名（LRM 规范）
	editionName := ""
	if mediaType == "book" {
		pubPart := publisherName
		if pubPart == "" {
			pubPart = "初版平装单行本"
		}
		editionName = fmt.Sprintf("%s（%s）", workTitle, pubPart)
	} else if mediaType == "anime" {
		editionName = fmt.Sprintf("%s（官方首播/初版）", workTitle)
	} else {
		editionName = fmt.Sprintf("%s（官方首发版）", workTitle)
	}

	// 多语言实体构建
	translations := make([]TranslationItem, 0)
	if data.NameCN != "" {
		translations = append(translations, TranslationItem{
			Locale:  "zh-CN",
			Title:   data.NameCN,
			Summary: data.Summary,
		})
	}
	if data.Name != "" {
		translations = append(translations, TranslationItem{
			Locale:  "ja-JP",
			Title:   data.Name,
			Summary: "",
		})
	}

	work := WorkPreview{
		Title:            workTitle,
		OriginalTitle:    origTitle,
		Aliases:          aliases,
		ReleaseDate:      data.Date,
		BeginDate:        data.Date,
		Country:          "JP",
		Language:         "zh-CN",
		OriginalLanguage: "ja",
		Summary:          data.Summary,
		CoverImageURL:    coverURL,
		CoverAspect:      coverAspect,
		ContentRating:    "General",
		Tags:             tags,
		ExternalIDs: models.JSONB{
			"bangumi": strconv.Itoa(data.ID),
		},
		Translations: translations,
		CatalogMetadata: models.JSONB{
			"bangumi_id":       strconv.Itoa(data.ID),
			"platform":         data.Platform,
			"total_episodes":   data.TotalEpisodes,
			"volumes":          data.Volumes,
		},
	}

	release := ReleasePreview{
		EditionName:         editionName,
		Publisher:           publisherName,
		Packaging:           "standard_packaging",
		Country:             "JP",
		Language:            "ja",
		DistributionChannel: "physical",
		EditionDate:         data.Date,
		Barcode:             isbn,
		Notes:               fmt.Sprintf("Imported from Bangumi subject %d", data.ID),
		ExternalIDs: models.JSONB{
			"bangumi": strconv.Itoa(data.ID),
		},
	}

	return &PreviewResponse{
		Source:      "bangumi",
		EntityType:  "work",
		ExternalID:  strconv.Itoa(data.ID),
		ExternalURL: fmt.Sprintf("https://bgm.tv/subject/%d", data.ID),
		MediaType:   mediaType,
		Work:        work,
		Artists:     artists,
		Release:     release,
		Mediums:     mediums,
		Tags:        tags,
	}, nil
}

// FetchBangumiPersonPreview 解析 Bangumi 人物/声优/创作者/制作公司
func FetchBangumiPersonPreview(ctx context.Context, input string) (*PreviewResponse, error) {
	personID, err := ParseBangumiPersonID(input)
	if err != nil {
		return nil, err
	}

	client := &http.Client{Timeout: 15 * time.Second}
	apiURL := fmt.Sprintf("https://api.bgm.tv/v0/persons/%s", personID)
	if err := security.ValidateExternalURL(apiURL); err != nil {
		return nil, fmt.Errorf("security check failed for Bangumi Person URL: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "MetaFusion-OmniImporter/1.0 ( contact@metafusion.io )")
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Bangumi Person API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Bangumi Person returned %d: %s", resp.StatusCode, string(b))
	}

	var data bgmPersonDetail
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, fmt.Errorf("failed to decode Bangumi person JSON: %w", err)
	}

	// 提取 Infobox 信息
	nameCN := ""
	aliases := make([]string, 0)
	bioNotes := []string{}
	if data.Summary != "" {
		bioNotes = append(bioNotes, data.Summary)
	}

	infoSpecs := []string{}
	for _, it := range data.Infobox {
		k := strings.TrimSpace(it.Key)
		vStr := fmt.Sprintf("%v", it.Value)
		switch k {
		case "简体中文名", "中文名":
			nameCN = strings.TrimSpace(vStr)
		case "别名":
			aliases = append(aliases, strings.TrimSpace(vStr))
		default:
			if vStr != "" && vStr != "<nil>" {
				infoSpecs = append(infoSpecs, fmt.Sprintf("%s: %s", k, vStr))
			}
		}
	}
	if len(infoSpecs) > 0 {
		bioNotes = append(bioNotes, "\n【档案详情】\n"+strings.Join(infoSpecs, "\n"))
	}

	mainName := data.Name
	origName := data.Name
	if nameCN != "" {
		mainName = nameCN
		aliases = append(aliases, data.Name)
	}

	entType := models.EntityTypePerson
	if data.Type == 2 {
		entType = models.EntityTypeStudio
	} else if data.Type == 3 {
		entType = models.EntityTypeGroup
	}

	translations := make([]TranslationItem, 0)
	if nameCN != "" {
		translations = append(translations, TranslationItem{
			Locale:  "zh-CN",
			Title:   nameCN,
			Summary: data.Summary,
		})
	}
	if data.Name != "" {
		translations = append(translations, TranslationItem{
			Locale:  "ja-JP",
			Title:   data.Name,
			Summary: "",
		})
	}

	artist := ArtistPreview{
		Name:         mainName,
		OriginalName: origName,
		EntityType:   entType,
		Country:      "JP",
		Biography:    strings.Join(bioNotes, "\n\n"),
		AvatarURL:    data.Images.Large,
		Aliases:      aliases,
		ExternalIDs: models.JSONB{
			"bangumi_person": strconv.Itoa(data.ID),
		},
		Translations: translations,
	}

	respEntType := "artist"
	if entType == models.EntityTypeStudio || entType == models.EntityTypePublisher || entType == models.EntityTypeGroup {
		respEntType = "organization"
	}

	return &PreviewResponse{
		Source:      "bangumi",
		EntityType:  respEntType,
		ExternalID:  strconv.Itoa(data.ID),
		ExternalURL: fmt.Sprintf("https://bgm.tv/person/%d", data.ID),
		MediaType:   "person",
		Artist:      &artist,
	}, nil
}

// FetchBangumiCharacterPreview 解析 Bangumi 虚拟角色
func FetchBangumiCharacterPreview(ctx context.Context, input string) (*PreviewResponse, error) {
	charID, err := ParseBangumiCharacterID(input)
	if err != nil {
		return nil, err
	}

	client := &http.Client{Timeout: 15 * time.Second}
	apiURL := fmt.Sprintf("https://api.bgm.tv/v0/characters/%s", charID)
	if err := security.ValidateExternalURL(apiURL); err != nil {
		return nil, fmt.Errorf("security check failed for Bangumi Character URL: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "MetaFusion-OmniImporter/1.0 ( contact@metafusion.io )")
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Bangumi Character API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("Bangumi Character returned %d: %s", resp.StatusCode, string(b))
	}

	var data bgmCharacterDetail
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, fmt.Errorf("failed to decode Bangumi character JSON: %w", err)
	}

	nameCN := ""
	aliases := make([]string, 0)
	bioNotes := []string{}
	if data.Summary != "" {
		bioNotes = append(bioNotes, data.Summary)
	}

	infoSpecs := []string{}
	for _, it := range data.Infobox {
		k := strings.TrimSpace(it.Key)
		vStr := fmt.Sprintf("%v", it.Value)
		switch k {
		case "简体中文名", "中文名":
			nameCN = strings.TrimSpace(vStr)
		case "别名":
			aliases = append(aliases, strings.TrimSpace(vStr))
		default:
			if vStr != "" && vStr != "<nil>" {
				infoSpecs = append(infoSpecs, fmt.Sprintf("%s: %s", k, vStr))
			}
		}
	}
	if len(infoSpecs) > 0 {
		bioNotes = append(bioNotes, "\n【角色设定】\n"+strings.Join(infoSpecs, "\n"))
	}

	mainName := data.Name
	origName := data.Name
	if nameCN != "" {
		mainName = nameCN
		aliases = append(aliases, data.Name)
	}

	translations := make([]TranslationItem, 0)
	if nameCN != "" {
		translations = append(translations, TranslationItem{
			Locale:  "zh-CN",
			Title:   nameCN,
			Summary: data.Summary,
		})
	}
	if data.Name != "" {
		translations = append(translations, TranslationItem{
			Locale:  "ja-JP",
			Title:   data.Name,
			Summary: "",
		})
	}

	artist := ArtistPreview{
		Name:         mainName,
		OriginalName: origName,
		EntityType:   models.EntityTypeCharacter,
		Role:         "Character",
		Country:      "JP",
		Biography:    strings.Join(bioNotes, "\n\n"),
		AvatarURL:    data.Images.Large,
		Aliases:      aliases,
		ExternalIDs: models.JSONB{
			"bangumi_character": strconv.Itoa(data.ID),
		},
		Translations: translations,
	}

	return &PreviewResponse{
		Source:      "bangumi",
		EntityType:  "character",
		ExternalID:  strconv.Itoa(data.ID),
		ExternalURL: fmt.Sprintf("https://bgm.tv/character/%d", data.ID),
		MediaType:   "character",
		Artist:      &artist,
	}, nil
}
