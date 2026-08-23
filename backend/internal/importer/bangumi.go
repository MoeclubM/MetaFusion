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
	bgmURLRegex = regexp.MustCompile(`(?:bgm\.tv|bangumi\.tv|chii\.in)/subject/(\d+)`)
)

type bgmInfoboxItem struct {
	Key   string      `json:"key"`
	Value interface{} `json:"value"`
}

type bgmSubjectResponse struct {
	ID          int              `json:"id"`
	Type        int              `json:"type"` // 1: book, 2: anime, 3: music, 4: game, 6: real
	Name        string           `json:"name"`
	NameCN      string           `json:"name_cn"`
	Summary     string           `json:"summary"`
	Date        string           `json:"date"`
	Platform    string           `json:"platform"`
	Images      struct {
		Large  string `json:"large"`
		Common string `json:"common"`
		Medium string `json:"medium"`
		Small  string `json:"small"`
		Grid   string `json:"grid"`
	} `json:"images"`
	Infobox     []bgmInfoboxItem `json:"infobox"`
	Volumes     int              `json:"volumes"`
	Eps         int              `json:"eps"`
	TotalEpisodes int            `json:"total_episodes"`
	Tags        []struct {
		Name  string `json:"name"`
		Count int    `json:"count"`
	} `json:"tags"`
}

type bgmPersonItem struct {
	ID       int    `json:"id"`
	Name     string `json:"name"`
	Type     int    `json:"type"` // 1: person, 2: company/studio, 3: group
	Relation string `json:"relation"` // "原作", "导演", "作者", "音乐", "动画制作", "出版社", etc.
	Career   []string `json:"career"`
	Images   struct {
		Large  string `json:"large"`
		Medium string `json:"medium"`
	} `json:"images"`
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

	// 并发查询 Staff/Persons 信息
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

	// 创作者提取
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
		}

		entType := models.EntityTypePerson
		if p.Type == 2 || p.Type == 3 || strings.Contains(rel, "制作") || strings.Contains(rel, "社") {
			entType = models.EntityTypeStudio
		}

		artists = append(artists, ArtistPreview{
			Name:           pName,
			Role:           role,
			EntityType:     entType,
			Country:        "JPN",
			Disambiguation: fmt.Sprintf("Bangumi %s", rel),
			Language:       "ja",
			ExternalIDs: models.JSONB{
				"bangumi": strconv.Itoa(p.ID),
			},
		})
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
		if isbn != "" {
			editionName = fmt.Sprintf("%s（%s，ISBN %s）", workTitle, pubPart, isbn)
		} else {
			editionName = fmt.Sprintf("%s（%s）", workTitle, pubPart)
		}
	} else if mediaType == "anime" {
		editionName = fmt.Sprintf("%s（官方网络流媒体首播/蓝光版）", workTitle)
	} else {
		editionName = fmt.Sprintf("%s（官方首发版）", workTitle)
	}

	extIDs := models.JSONB{
		"bangumi": strconv.Itoa(data.ID),
	}
	if isbn != "" {
		extIDs["isbn"] = isbn
	}

	return &PreviewResponse{
		Source:      "bangumi",
		ExternalID:  strconv.Itoa(data.ID),
		ExternalURL: fmt.Sprintf("https://bgm.tv/subject/%d", data.ID),
		MediaType:   mediaType,
		Work: WorkPreview{
			Title:            workTitle,
			OriginalTitle:    origTitle,
			Aliases:          aliases,
			ReleaseDate:      data.Date,
			BeginDate:        data.Date,
			Country:          "JPN",
			Language:         "zh-CN",
			OriginalLanguage: "ja",
			Summary:          data.Summary,
			CoverImageURL:    coverURL,
			CoverAspect:      coverAspect,
			ContentRating:    "General",
			Tags:             tags,
			Translations: []TranslationItem{
				{Locale: "zh-CN", Title: workTitle, Summary: data.Summary},
				{Locale: "ja", Title: origTitle, Summary: data.Summary},
			},
			CatalogMetadata: extIDs,
		},
		Artists: artists,
		Release: ReleasePreview{
			EditionName:         editionName,
			Barcode:             isbn,
			Publisher:           publisherName,
			Packaging:           "booklet",
			Country:             "JPN",
			Language:            "ja",
			DistributionChannel: "mixed",
			EditionDate:         data.Date,
			Notes:               fmt.Sprintf("Imported from Bangumi (Subject ID: %d)", data.ID),
			CatalogMetadata:     extIDs,
		},
		Mediums: mediums,
		Tags:    tags,
	}, nil
}
