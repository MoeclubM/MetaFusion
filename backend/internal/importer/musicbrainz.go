package importer

import (
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
	mbidRegex         = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	mbReleaseURLRegex = regexp.MustCompile(`musicbrainz\.org/release/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})`)
	mbRgURLRegex      = regexp.MustCompile(`musicbrainz\.org/release-group/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})`)
	mbArtistURLRegex  = regexp.MustCompile(`musicbrainz\.org/artist/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})`)
	mbLabelURLRegex   = regexp.MustCompile(`musicbrainz\.org/label/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})`)
)

type mbArtistCredit struct {
	Name   string `json:"name"`
	Artist struct {
		ID             string `json:"id"`
		Name           string `json:"name"`
		SortName       string `json:"sort-name"`
		Disambiguation string `json:"disambiguation"`
		Type           string `json:"type"` // "Person", "Group", "Other"
		Country        string `json:"country"`
	} `json:"artist"`
	Joinphrase string `json:"joinphrase"`
}

type mbReleaseResponse struct {
	ID                   string           `json:"id"`
	Title                string           `json:"title"`
	Status               string           `json:"status"`
	Packaging            string           `json:"packaging"`
	Date                 string           `json:"date"`
	Country              string           `json:"country"`
	Barcode              string           `json:"barcode"`
	ArtistCredit         []mbArtistCredit `json:"artist-credit"`
	TextRepresentation   struct {
		Language string `json:"language"`
		Script   string `json:"script"`
	} `json:"text-representation"`
	ReleaseGroup struct {
		ID               string           `json:"id"`
		Title            string           `json:"title"`
		PrimaryType      string           `json:"primary-type"`
		FirstReleaseDate string           `json:"first-release-date"`
		ArtistCredit     []mbArtistCredit `json:"artist-credit"`
		Tags             []struct {
			Name string `json:"name"`
		} `json:"tags"`
		Genres []struct {
			Name string `json:"name"`
		} `json:"genres"`
	} `json:"release-group"`
	Media []struct {
		Position   int    `json:"position"`
		Format     string `json:"format"`
		Title      string `json:"title"`
		TrackCount int    `json:"track-count"`
		Tracks     []struct {
			ID       string `json:"id"`
			Position int    `json:"position"`
			Number   string `json:"number"`
			Title    string `json:"title"`
			Length   int    `json:"length"` // ms
			Recording struct {
				ID    string `json:"id"`
				Title string `json:"title"`
				ISRCs []string `json:"isrcs"`
			} `json:"recording"`
			ArtistCredit []mbArtistCredit `json:"artist-credit"`
		} `json:"tracks"`
	} `json:"media"`
	LabelInfoList []struct {
		CatalogNumber string `json:"catalog-number"`
		Label         struct {
			ID             string `json:"id"`
			Name           string `json:"name"`
			SortName       string `json:"sort-name"`
			Type           string `json:"type"`
			Disambiguation string `json:"disambiguation"`
		} `json:"label"`
	} `json:"label-info-list"`
	Tags []struct {
		Name string `json:"name"`
	} `json:"tags"`
	Genres []struct {
		Name string `json:"name"`
	} `json:"genres"`
}

type mbReleaseGroupResponse struct {
	ID               string           `json:"id"`
	Title            string           `json:"title"`
	PrimaryType      string           `json:"primary-type"`
	FirstReleaseDate string           `json:"first-release-date"`
	ArtistCredit     []mbArtistCredit `json:"artist-credit"`
	Releases         []struct {
		ID      string `json:"id"`
		Title   string `json:"title"`
		Status  string `json:"status"`
		Date    string `json:"date"`
		Country string `json:"country"`
	} `json:"releases"`
	Tags []struct {
		Name string `json:"name"`
	} `json:"tags"`
	Genres []struct {
		Name string `json:"name"`
	} `json:"genres"`
}

// ParseMusicBrainzID 从输入串中提取 MBID 并判断是 release 还是 release-group
func ParseMusicBrainzID(input string) (id string, isReleaseGroup bool, err error) {
	clean := strings.TrimSpace(input)
	if m := mbReleaseURLRegex.FindStringSubmatch(clean); len(m) > 1 {
		return m[1], false, nil
	}
	if m := mbRgURLRegex.FindStringSubmatch(clean); len(m) > 1 {
		return m[1], true, nil
	}
	if mbidRegex.MatchString(clean) {
		return clean, false, nil
	}
	return "", false, fmt.Errorf("invalid MusicBrainz MBID or URL: %s", input)
}

// FetchMusicBrainzPreview 获取 MusicBrainz 元数据并构建标准化预览
func FetchMusicBrainzPreview(ctx context.Context, input string) (*PreviewResponse, error) {
	mbid, isRg, err := ParseMusicBrainzID(input)
	if err != nil {
		return nil, err
	}

	client := &http.Client{
		Timeout: 15 * time.Second,
	}

	targetReleaseID := mbid
	if isRg {
		// 先查询 Release Group 获取具体 release id
		rgURL := fmt.Sprintf("https://musicbrainz.org/ws/2/release-group/%s?inc=artists+releases+tags+genres&fmt=json", mbid)
		if err := security.ValidateExternalURL(rgURL); err != nil {
			return nil, fmt.Errorf("security check failed for MusicBrainz URL: %w", err)
		}

		req, err := http.NewRequestWithContext(ctx, "GET", rgURL, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", "MetaFusion-OmniImporter/1.0 ( contact@metafusion.io )")
		req.Header.Set("Accept", "application/json")

		resp, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("MusicBrainz request failed: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			return nil, fmt.Errorf("MusicBrainz returned status %d: %s", resp.StatusCode, string(body))
		}

		var rgData mbReleaseGroupResponse
		if err := json.NewDecoder(resp.Body).Decode(&rgData); err != nil {
			return nil, fmt.Errorf("failed to parse MusicBrainz JSON: %w", err)
		}

		if len(rgData.Releases) == 0 {
			return nil, fmt.Errorf("no release found in MusicBrainz Release Group %s", mbid)
		}
		targetReleaseID = rgData.Releases[0].ID
	}

	// 查询具体的 Release
	apiURL := fmt.Sprintf("https://musicbrainz.org/ws/2/release/%s?inc=artists+recordings+release-groups+media+labels+url-rels+tags+genres&fmt=json", targetReleaseID)
	if err := security.ValidateExternalURL(apiURL); err != nil {
		return nil, fmt.Errorf("security check failed for MusicBrainz URL: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "MetaFusion-OmniImporter/1.0 ( contact@metafusion.io )")
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("MusicBrainz release request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("MusicBrainz release API returned %d: %s", resp.StatusCode, string(body))
	}

	var data mbReleaseResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, fmt.Errorf("failed to decode MusicBrainz release JSON: %w", err)
	}

	// 提取母体 Work 纯净标题
	workTitle := strings.TrimSpace(data.ReleaseGroup.Title)
	if workTitle == "" {
		workTitle = strings.TrimSpace(data.Title)
	}

	// 提取主创艺术家
	var artists []ArtistPreview
	artistNameParts := make([]string, 0)
	for _, ac := range data.ArtistCredit {
		name := strings.TrimSpace(ac.Name)
		if name == "" {
			name = strings.TrimSpace(ac.Artist.Name)
		}
		if name != "" {
			artistNameParts = append(artistNameParts, name+ac.Joinphrase)
			
			entityType := models.EntityTypePerson
			if strings.EqualFold(ac.Artist.Type, "Group") || strings.EqualFold(ac.Artist.Type, "Orchestra") {
				entityType = models.EntityTypeGroup
			}

			artists = append(artists, ArtistPreview{
				Name:           name,
				OriginalName:   ac.Artist.SortName,
				Role:           "Composer / Performer",
				EntityType:     entityType,
				Country:        ac.Artist.Country,
				Disambiguation: ac.Artist.Disambiguation,
				Language:       "en-US",
				ExternalIDs: models.JSONB{
					"musicbrainz": ac.Artist.ID,
				},
			})
		}
	}
	primaryArtistStr := strings.Join(artistNameParts, "")

	// 出版商/厂牌信息
	publisherName := ""
	catalogNum := ""
	if len(data.LabelInfoList) > 0 {
		catalogNum = data.LabelInfoList[0].CatalogNumber
		pubName := strings.TrimSpace(data.LabelInfoList[0].Label.Name)
		if pubName != "" {
			publisherName = pubName
			artists = append(artists, ArtistPreview{
				Name:           pubName,
				Role:           "Publisher / Label",
				EntityType:     models.EntityTypeLabel,
				Disambiguation: data.LabelInfoList[0].Label.Disambiguation,
				ExternalIDs: models.JSONB{
					"musicbrainz": data.LabelInfoList[0].Label.ID,
				},
			})
		}
	}

	// 标签与流派 (Tags & Genres)
	tagMap := make(map[string]bool)
	tagMap["Music"] = true
	tagMap["Music Album"] = true
	if data.ReleaseGroup.PrimaryType != "" {
		tagMap[data.ReleaseGroup.PrimaryType] = true
	}
	for _, t := range data.ReleaseGroup.Tags {
		if name := strings.TrimSpace(t.Name); name != "" {
			tagMap[strings.Title(name)] = true
		}
	}
	for _, g := range data.ReleaseGroup.Genres {
		if name := strings.TrimSpace(g.Name); name != "" {
			tagMap[strings.Title(name)] = true
		}
	}
	for _, t := range data.Tags {
		if name := strings.TrimSpace(t.Name); name != "" {
			tagMap[strings.Title(name)] = true
		}
	}
	for _, g := range data.Genres {
		if name := strings.TrimSpace(g.Name); name != "" {
			tagMap[strings.Title(name)] = true
		}
	}
	tags := make([]string, 0, len(tagMap))
	for k := range tagMap {
		tags = append(tags, k)
	}

	// 发布时间
	releaseDate := data.Date
	if releaseDate == "" {
		releaseDate = data.ReleaseGroup.FirstReleaseDate
	}
	// 规范化 YYYY-MM-DD
	if len(releaseDate) == 4 {
		releaseDate = releaseDate + "-01-01"
	} else if len(releaseDate) == 7 {
		releaseDate = releaseDate + "-01"
	}

	// 官方 CoverArtArchive 封面链接
	coverURL := fmt.Sprintf("https://coverartarchive.org/release/%s/front", data.ID)

	// Mediums & Tracks
	var mediums []MediumPreview
	mainFormat := "Digital"
	for _, med := range data.Media {
		format := strings.TrimSpace(med.Format)
		if format == "" {
			format = "CD"
		}
		mainFormat = format

		medName := strings.TrimSpace(med.Title)
		if medName == "" {
			medName = fmt.Sprintf("Disc %d", med.Position)
		}

		var tracks []TrackPreview
		for _, trk := range med.Tracks {
			trkTitle := strings.TrimSpace(trk.Title)
			if trkTitle == "" {
				trkTitle = strings.TrimSpace(trk.Recording.Title)
			}
			trkArtist := primaryArtistStr
			if len(trk.ArtistCredit) > 0 {
				var trkParts []string
				for _, tac := range trk.ArtistCredit {
					trkParts = append(trkParts, tac.Name+tac.Joinphrase)
				}
				trkArtist = strings.Join(trkParts, "")
			}
			isrc := ""
			if len(trk.Recording.ISRCs) > 0 {
				isrc = trk.Recording.ISRCs[0]
			}

			tracks = append(tracks, TrackPreview{
				Position:        trk.Position,
				Title:           trkTitle,
				DurationSeconds: trk.Length / 1000,
				ArtistCredit:    trkArtist,
				ISRC:            isrc,
				RecordingMBID:   trk.Recording.ID,
			})
		}

		mediums = append(mediums, MediumPreview{
			Position:      med.Position,
			Name:          medName,
			Format:        format,
			MediaCategory: "audio",
			Tracks:        tracks,
		})
	}

	// 语言匹配
	lang := "en-US"
	if strings.EqualFold(data.TextRepresentation.Language, "jpn") {
		lang = "ja"
	} else if strings.EqualFold(data.TextRepresentation.Language, "zho") {
		lang = "zh-CN"
	} else if strings.EqualFold(data.TextRepresentation.Language, "kor") {
		lang = "ko"
	}

	// 发行版命名（严格遵照 LRM 编目标准）
	// {作品主名}（{国家/地区} {规格/介质}，{发行厂牌}，{CatalogNumber}）
	specParts := make([]string, 0)
	if data.Country != "" {
		specParts = append(specParts, data.Country)
	}
	specParts = append(specParts, mainFormat)
	if publisherName != "" {
		specParts = append(specParts, publisherName)
	}
	if catalogNum != "" {
		specParts = append(specParts, catalogNum)
	}
	editionName := fmt.Sprintf("%s（%s）", workTitle, strings.Join(specParts, "，"))

	packaging := strings.ToLower(strings.TrimSpace(data.Packaging))
	if packaging == "" {
		packaging = "jewel_case"
	} else if strings.Contains(packaging, "digipak") {
		packaging = "digipak"
	} else if strings.Contains(packaging, "gatefold") {
		packaging = "gatefold"
	} else if strings.Contains(packaging, "box") {
		packaging = "box_set"
	} else {
		packaging = "jewel_case"
	}

	summary := fmt.Sprintf("由 %s 创作的音乐作品，于 %s 官方发行于 %s。", primaryArtistStr, releaseDate, data.Country)
	if data.ReleaseGroup.PrimaryType != "" {
		summary = fmt.Sprintf("由 %s 创作的 %s 音乐作品，于 %s 官方发行于 %s。", primaryArtistStr, data.ReleaseGroup.PrimaryType, releaseDate, data.Country)
	}

	res := &PreviewResponse{
		Source:      "musicbrainz",
		ExternalID:  data.ID,
		ExternalURL: fmt.Sprintf("https://musicbrainz.org/release/%s", data.ID),
		MediaType:   "music",
		Work: WorkPreview{
			Title:            workTitle,
			OriginalTitle:    data.Title,
			Aliases:          []string{},
			ReleaseDate:      releaseDate,
			BeginDate:        releaseDate,
			Country:          data.Country,
			Language:         lang,
			OriginalLanguage: data.TextRepresentation.Language,
			Summary:          summary,
			CoverImageURL:    coverURL,
			CoverAspect:      "1:1",
			ContentRating:    "General",
			Tags:             tags,
			ExternalIDs: models.JSONB{
				"musicbrainz": data.ReleaseGroup.ID,
			},
			Translations: []TranslationItem{
				{
					Locale:  "zh-CN",
					Title:   workTitle,
					Summary: summary,
				},
				{
					Locale:  "en-US",
					Title:   data.Title,
					Summary: summary,
				},
			},
			CatalogMetadata: models.JSONB{
				"musicbrainz_release_id":       data.ID,
				"musicbrainz_release_group_id": data.ReleaseGroup.ID,
			},
		},
		Artists: artists,
		Release: ReleasePreview{
			EditionName:         editionName,
			CatalogNumber:       catalogNum,
			Barcode:             data.Barcode,
			Publisher:           publisherName,
			Packaging:           packaging,
			Country:             data.Country,
			Language:            lang,
			DistributionChannel: "physical",
			EditionDate:         releaseDate,
			Notes:               fmt.Sprintf("Imported from MusicBrainz (Release MBID: %s)", data.ID),
			ExternalIDs: models.JSONB{
				"musicbrainz": data.ID,
			},
			CatalogMetadata: models.JSONB{
				"musicbrainz_release_id": data.ID,
			},
		},
		Mediums: mediums,
		Tags:    tags,
	}

	return res, nil
}

// FetchMusicBrainzArtistPreview 解析 MusicBrainz 音乐人/创作者/乐团
func FetchMusicBrainzArtistPreview(ctx context.Context, mbid string) (*PreviewResponse, error) {
	cleanMBID := strings.TrimSpace(mbid)
	if m := mbArtistURLRegex.FindStringSubmatch(cleanMBID); len(m) > 1 {
		cleanMBID = m[1]
	}
	if !mbidRegex.MatchString(cleanMBID) {
		return nil, fmt.Errorf("invalid MusicBrainz Artist MBID: %s", mbid)
	}

	client := &http.Client{Timeout: 15 * time.Second}
	apiURL := fmt.Sprintf("https://musicbrainz.org/ws/2/artist/%s?fmt=json&inc=aliases+tags+genres+ratings+url-rels", cleanMBID)
	if err := security.ValidateExternalURL(apiURL); err != nil {
		return nil, fmt.Errorf("security check failed for MusicBrainz URL: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "MetaFusion-OmniImporter/1.0 ( contact@metafusion.io )")
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("MusicBrainz artist request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("MusicBrainz returned %d: %s", resp.StatusCode, string(b))
	}

	var data struct {
		ID             string `json:"id"`
		Name           string `json:"name"`
		SortName       string `json:"sort-name"`
		Type           string `json:"type"`
		Country        string `json:"country"`
		Disambiguation string `json:"disambiguation"`
		Gender         string `json:"gender"`
		LifeSpan       struct {
			Begin string `json:"begin"`
			End   string `json:"end"`
			Ended bool   `json:"ended"`
		} `json:"life-span"`
		Aliases []struct {
			Name     string `json:"name"`
			SortName string `json:"sort-name"`
			Locale   string `json:"locale"`
			Primary  bool   `json:"primary"`
		} `json:"aliases"`
		Relations []struct {
			Type string `json:"type"`
			URL  struct {
				Resource string `json:"resource"`
			} `json:"url"`
		} `json:"relations"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, fmt.Errorf("failed to decode MusicBrainz artist JSON: %w", err)
	}

	aliases := make([]string, 0)
	nameZh := ""
	for _, a := range data.Aliases {
		if strings.TrimSpace(a.Name) != "" && a.Name != data.Name {
			aliases = append(aliases, strings.TrimSpace(a.Name))
			if (a.Locale == "zh" || a.Locale == "zh-Hans" || a.Locale == "zh-CN") && nameZh == "" {
				nameZh = strings.TrimSpace(a.Name)
			}
		}
	}

	extIDs := models.JSONB{
		"musicbrainz": data.ID,
	}
	for _, r := range data.Relations {
		resURL := strings.TrimSpace(r.URL.Resource)
		if strings.Contains(resURL, "wikidata.org") {
			extIDs["wikidata"] = resURL
		} else if strings.Contains(resURL, "discogs.com") {
			extIDs["discogs"] = resURL
		} else if strings.Contains(resURL, "spotify.com") {
			extIDs["spotify"] = resURL
		} else if strings.Contains(resURL, "apple.com") {
			extIDs["apple_music"] = resURL
		}
	}

	entType := models.EntityTypePerson
	switch strings.ToLower(data.Type) {
	case "group":
		entType = models.EntityTypeGroup
	case "orchestra":
		entType = models.EntityTypeOrchestra
	}

	bio := data.Disambiguation
	if data.LifeSpan.Begin != "" {
		if bio != "" {
			bio += "\n"
		}
		bio += fmt.Sprintf("活跃时期: %s", data.LifeSpan.Begin)
		if data.LifeSpan.End != "" {
			bio += fmt.Sprintf(" ~ %s", data.LifeSpan.End)
		}
	}

	translations := make([]TranslationItem, 0)
	if nameZh != "" {
		translations = append(translations, TranslationItem{
			Locale:  "zh-CN",
			Title:   nameZh,
			Summary: bio,
		})
	}
	if data.Name != "" {
		translations = append(translations, TranslationItem{
			Locale:  "en-US",
			Title:   data.Name,
			Summary: bio,
		})
	}

	artist := ArtistPreview{
		Name:           data.Name,
		OriginalName:   data.SortName,
		EntityType:     entType,
		Country:        data.Country,
		Biography:      bio,
		Disambiguation: data.Disambiguation,
		Aliases:        aliases,
		ExternalIDs:    extIDs,
		Translations:   translations,
	}

	return &PreviewResponse{
		Source:      "musicbrainz",
		EntityType:  "artist",
		ExternalID:  data.ID,
		ExternalURL: fmt.Sprintf("https://musicbrainz.org/artist/%s", data.ID),
		MediaType:   "music",
		Artist:      &artist,
	}, nil
}

// FetchMusicBrainzLabelPreview 解析 MusicBrainz 唱片厂牌/出版机构
func FetchMusicBrainzLabelPreview(ctx context.Context, mbid string) (*PreviewResponse, error) {
	cleanMBID := strings.TrimSpace(mbid)
	if m := mbLabelURLRegex.FindStringSubmatch(cleanMBID); len(m) > 1 {
		cleanMBID = m[1]
	}
	if !mbidRegex.MatchString(cleanMBID) {
		return nil, fmt.Errorf("invalid MusicBrainz Label MBID: %s", mbid)
	}

	client := &http.Client{Timeout: 15 * time.Second}
	apiURL := fmt.Sprintf("https://musicbrainz.org/ws/2/label/%s?fmt=json&inc=aliases+tags+genres+ratings+url-rels", cleanMBID)
	if err := security.ValidateExternalURL(apiURL); err != nil {
		return nil, fmt.Errorf("security check failed for MusicBrainz URL: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "MetaFusion-OmniImporter/1.0 ( contact@metafusion.io )")
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("MusicBrainz label request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("MusicBrainz returned %d: %s", resp.StatusCode, string(b))
	}

	var data struct {
		ID             string `json:"id"`
		Name           string `json:"name"`
		SortName       string `json:"sort-name"`
		Type           string `json:"type"`
		Country        string `json:"country"`
		Disambiguation string `json:"disambiguation"`
		LabelCode      int    `json:"label-code"`
		LifeSpan       struct {
			Begin string `json:"begin"`
			End   string `json:"end"`
			Ended bool   `json:"ended"`
		} `json:"life-span"`
		Aliases []struct {
			Name string `json:"name"`
		} `json:"aliases"`
		Relations []struct {
			Type string `json:"type"`
			URL  struct {
				Resource string `json:"resource"`
			} `json:"url"`
		} `json:"relations"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, fmt.Errorf("failed to decode MusicBrainz label JSON: %w", err)
	}

	aliases := make([]string, 0)
	for _, a := range data.Aliases {
		if strings.TrimSpace(a.Name) != "" && a.Name != data.Name {
			aliases = append(aliases, strings.TrimSpace(a.Name))
		}
	}

	extIDs := models.JSONB{
		"musicbrainz_label": data.ID,
	}
	if data.LabelCode > 0 {
		extIDs["label_code"] = data.LabelCode
	}
	for _, r := range data.Relations {
		resURL := strings.TrimSpace(r.URL.Resource)
		if strings.Contains(resURL, "wikidata.org") {
			extIDs["wikidata"] = resURL
		} else if strings.Contains(resURL, "discogs.com") {
			extIDs["discogs"] = resURL
		}
	}

	bio := data.Disambiguation
	if data.Type != "" {
		if bio != "" {
			bio += " | "
		}
		bio += fmt.Sprintf("厂牌类型: %s", data.Type)
	}

	artist := ArtistPreview{
		Name:           data.Name,
		OriginalName:   data.SortName,
		EntityType:     models.EntityTypeLabel,
		Role:           "Record Label",
		Country:        data.Country,
		Biography:      bio,
		Disambiguation: data.Disambiguation,
		Aliases:        aliases,
		ExternalIDs:    extIDs,
	}

	return &PreviewResponse{
		Source:      "musicbrainz",
		EntityType:  "organization",
		ExternalID:  data.ID,
		ExternalURL: fmt.Sprintf("https://musicbrainz.org/label/%s", data.ID),
		MediaType:   "organization",
		Artist:      &artist,
	}, nil
}
