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
	imdbIDRegex          = regexp.MustCompile(`^(?:https?://(?:www\.)?imdb\.com/title/)?(tt\d+)(?:[/?#].*)?$`)
	imdbNameRegex        = regexp.MustCompile(`^(?:https?://(?:www\.)?imdb\.com/name/)?(nm\d+)(?:[/?#].*)?$`)
	tmdbURLRegex         = regexp.MustCompile(`^(?:https?://)?(?:[a-zA-Z0-9-]+\.)?themoviedb\.org/(movie|tv)/(\d+)(?:[/?#].*)?$`)
	tmdbPersonURLRegex   = regexp.MustCompile(`^(?:https?://)?(?:[a-zA-Z0-9-]+\.)?themoviedb\.org/person/(\d+)(?:[/?#].*)?$`)
	tmdbCompanyURLRegex  = regexp.MustCompile(`^(?:https?://)?(?:[a-zA-Z0-9-]+\.)?themoviedb\.org/company/(\d+)(?:[/?#].*)?$`)
	numericIDRegex       = regexp.MustCompile(`^\d+$`)
)

type tmdbFindResponse struct {
	MovieResults []struct {
		ID            int     `json:"id"`
		Title         string  `json:"title"`
		OriginalTitle string  `json:"original_title"`
		PosterPath    string  `json:"poster_path"`
		ReleaseDate   string  `json:"release_date"`
		Overview      string  `json:"overview"`
		VoteAverage   float64 `json:"vote_average"`
	} `json:"movie_results"`
	TVResults []struct {
		ID           int     `json:"id"`
		Name         string  `json:"name"`
		OriginalName string  `json:"original_name"`
		PosterPath   string  `json:"poster_path"`
		FirstAirDate string  `json:"first_air_date"`
		Overview     string  `json:"overview"`
		VoteAverage  float64 `json:"vote_average"`
	} `json:"tv_results"`
}

type tmdbPerson struct {
	ID         int    `json:"id"`
	Name       string `json:"name"`
	Job        string `json:"job"`
	Department string `json:"department"`
	Character  string `json:"character"`
}

type tmdbMovieDetail struct {
	ID                  int      `json:"id"`
	Title               string   `json:"title"`
	OriginalTitle       string   `json:"original_title"`
	OriginalLanguage    string   `json:"original_language"`
	Overview            string   `json:"overview"`
	PosterPath          string   `json:"poster_path"`
	ReleaseDate         string   `json:"release_date"`
	Runtime             int      `json:"runtime"`
	ImdbID              string   `json:"imdb_id"`
	Genres              []struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
	} `json:"genres"`
	ProductionCompanies []struct {
		ID            int    `json:"id"`
		Name          string `json:"name"`
		OriginCountry string `json:"origin_country"`
	} `json:"production_companies"`
	Credits struct {
		Cast []tmdbPerson `json:"cast"`
		Crew []tmdbPerson `json:"crew"`
	} `json:"credits"`
	Keywords struct {
		Keywords []struct {
			ID   int    `json:"id"`
			Name string `json:"name"`
		} `json:"keywords"`
	} `json:"keywords"`
	Translations struct {
		Translations []struct {
			Iso639_1 string `json:"iso_639_1"`
			Name     string `json:"name"`
			Data     struct {
				Title    string `json:"title"`
				Overview string `json:"overview"`
			} `json:"data"`
		} `json:"translations"`
	} `json:"translations"`
}

type tmdbTVDetail struct {
	ID                  int      `json:"id"`
	Name                string   `json:"name"`
	OriginalName        string   `json:"original_name"`
	OriginalLanguage    string   `json:"original_language"`
	Overview            string   `json:"overview"`
	PosterPath          string   `json:"poster_path"`
	FirstAirDate        string   `json:"first_air_date"`
	LastAirDate         string   `json:"last_air_date"`
	NumberOfEpisodes    int      `json:"number_of_episodes"`
	NumberOfSeasons     int      `json:"number_of_seasons"`
	EpisodeRunTime      []int    `json:"episode_run_time"`
	Genres              []struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
	} `json:"genres"`
	ProductionCompanies []struct {
		ID            int    `json:"id"`
		Name          string `json:"name"`
		OriginCountry string `json:"origin_country"`
	} `json:"production_companies"`
	Credits struct {
		Cast []tmdbPerson `json:"cast"`
		Crew []tmdbPerson `json:"crew"`
	} `json:"credits"`
	CreatedBy []struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
	} `json:"created_by"`
	Translations struct {
		Translations []struct {
			Iso639_1 string `json:"iso_639_1"`
			Name     string `json:"name"`
			Data     struct {
				Name     string `json:"name"`
				Overview string `json:"overview"`
			} `json:"data"`
		} `json:"translations"`
	} `json:"translations"`
}

// ParseTMDBOrIMDbID 解析输入中的 TMDB/IMDb 标识符
func ParseTMDBOrIMDbID(input string, hint string) (isIMDb bool, id string, mediaType string, err error) {
	clean := strings.TrimSpace(input)
	if m := imdbIDRegex.FindStringSubmatch(clean); len(m) > 1 {
		return true, m[1], "movie", nil
	}
	if m := tmdbURLRegex.FindStringSubmatch(clean); len(m) > 2 {
		return false, m[2], m[1], nil
	}
	if numericIDRegex.MatchString(clean) {
		mType := "movie"
		if strings.EqualFold(hint, "tv") || strings.EqualFold(hint, "series") {
			mType = "tv"
		}
		return false, clean, mType, nil
	}
	return false, "", "", fmt.Errorf("invalid TMDB or IMDb URL/ID: %s", input)
}

// FetchTMDBPreview 查询 TMDB 或 IMDb 并构建影视/剧集全量规范预览
func FetchTMDBPreview(ctx context.Context, input string, hint string, apiKey string) (*PreviewResponse, error) {
	isIMDb, id, mediaType, err := ParseTMDBOrIMDbID(input, hint)
	if err != nil {
		return nil, err
	}

	client := &http.Client{
		Timeout: 15 * time.Second,
	}

	// 1. 如果有 apiKey，优先使用官方 TMDB v3 API
	effectiveKey := apiKey
	if effectiveKey == "" {
		// 回退公共开放只读网关（或从 IMDb JSON-LD / HTML 直接智能解析）
		if isIMDb {
			return fetchIMDbDirectPreview(ctx, client, id)
		}
		// 若无 API Key 且输入为 TMDB ID，尝试公网抓取或引导
		return fetchTMDBWebScrapePreview(ctx, client, id, mediaType)
	}

	tmdbID := id
	if isIMDb {
		findURL := fmt.Sprintf("https://api.themoviedb.org/3/find/%s?external_source=imdb_id&api_key=%s&language=zh-CN", id, effectiveKey)
		if err := security.ValidateExternalURL(findURL); err != nil {
			return nil, err
		}

		req, err := http.NewRequestWithContext(ctx, "GET", findURL, nil)
		if err != nil {
			return nil, err
		}
		resp, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("TMDB find request failed: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return fetchIMDbDirectPreview(ctx, client, id)
		}

		var findRes tmdbFindResponse
		if err := json.NewDecoder(resp.Body).Decode(&findRes); err != nil {
			return nil, err
		}

		if len(findRes.MovieResults) > 0 {
			tmdbID = fmt.Sprintf("%d", findRes.MovieResults[0].ID)
			mediaType = "movie"
		} else if len(findRes.TVResults) > 0 {
			tmdbID = fmt.Sprintf("%d", findRes.TVResults[0].ID)
			mediaType = "tv"
		} else {
			return fetchIMDbDirectPreview(ctx, client, id)
		}
	}

	if mediaType == "tv" {
		return fetchTMDBTVDetail(ctx, client, tmdbID, effectiveKey)
	}
	return fetchTMDBMovieDetail(ctx, client, tmdbID, effectiveKey)
}

func fetchTMDBMovieDetail(ctx context.Context, client *http.Client, tmdbID string, apiKey string) (*PreviewResponse, error) {
	apiURL := fmt.Sprintf("https://api.themoviedb.org/3/movie/%s?append_to_response=credits,keywords,translations&language=zh-CN&api_key=%s", tmdbID, apiKey)
	if err := security.ValidateExternalURL(apiURL); err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("TMDB movie detail failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("TMDB returned %d: %s", resp.StatusCode, string(body))
	}

	var data tmdbMovieDetail
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}

	// 提取中文标题与英文标题
	zhTitle := data.Title
	enTitle := data.OriginalTitle
	zhOverview := data.Overview
	enOverview := data.Overview

	for _, trans := range data.Translations.Translations {
		if trans.Iso639_1 == "en" {
			if trans.Data.Title != "" {
				enTitle = trans.Data.Title
			}
			if trans.Data.Overview != "" {
				enOverview = trans.Data.Overview
			}
		}
	}

	workTitle := zhTitle
	if workTitle == "" {
		workTitle = data.OriginalTitle
	}

	// 演职人员提取
	var artists []ArtistPreview
	artistNames := make([]string, 0)
	publisherName := ""

	for _, crew := range data.Credits.Crew {
		role := ""
		if strings.EqualFold(crew.Job, "Director") {
			role = "Director"
		} else if strings.EqualFold(crew.Job, "Writer") || strings.EqualFold(crew.Job, "Screenplay") || strings.EqualFold(crew.Department, "Writing") {
			role = "Screenplay"
		} else if strings.EqualFold(crew.Job, "Original Music Composer") || strings.EqualFold(crew.Job, "Music") {
			role = "Composer"
		}

		if role != "" {
			artistNames = append(artistNames, crew.Name)
			artists = append(artists, ArtistPreview{
				Name:           crew.Name,
				Role:           role,
				EntityType:     models.EntityTypePerson,
				Disambiguation: fmt.Sprintf("Film %s", role),
				Language:       "zh-CN",
				ExternalIDs: models.JSONB{
					"tmdb": fmt.Sprintf("%d", crew.ID),
				},
			})
		}
	}

	// 主演提取 (前 8 位)
	castLimit := 8
	if len(data.Credits.Cast) < castLimit {
		castLimit = len(data.Credits.Cast)
	}
	for i := 0; i < castLimit; i++ {
		cast := data.Credits.Cast[i]
		artists = append(artists, ArtistPreview{
			Name:           cast.Name,
			Role:           "Performer",
			EntityType:     models.EntityTypePerson,
			Disambiguation: fmt.Sprintf("饰 %s", cast.Character),
			Language:       "zh-CN",
			ExternalIDs: models.JSONB{
				"tmdb": fmt.Sprintf("%d", cast.ID),
			},
		})
	}

	// 制片公司 / 发行厂牌
	if len(data.ProductionCompanies) > 0 {
		pub := data.ProductionCompanies[0]
		publisherName = pub.Name
		artists = append(artists, ArtistPreview{
			Name:           pub.Name,
			Role:           "Production Studio / Publisher",
			EntityType:     models.EntityTypeStudio,
			Country:        pub.OriginCountry,
			Language:       "zh-CN",
			ExternalIDs: models.JSONB{
				"tmdb": fmt.Sprintf("%d", pub.ID),
			},
		})
	}

	// 标签与流派
	tagMap := make(map[string]bool)
	tagMap["Movie"] = true
	tagMap["Cinema"] = true
	for _, g := range data.Genres {
		if g.Name != "" {
			tagMap[g.Name] = true
		}
	}
	for _, k := range data.Keywords.Keywords {
		if k.Name != "" {
			tagMap[strings.Title(k.Name)] = true
		}
	}
	tags := make([]string, 0, len(tagMap))
	for k := range tagMap {
		tags = append(tags, k)
	}

	coverURL := ""
	if data.PosterPath != "" {
		coverURL = fmt.Sprintf("https://image.tmdb.org/t/p/original%s", data.PosterPath)
	}

	durationSec := data.Runtime * 60

	// Medium & Track (电影正片)
	mediums := []MediumPreview{
		{
			Position:      1,
			Name:          "Main Feature（电影正片）",
			Format:        "Digital",
			MediaCategory: "video",
			Tracks: []TrackPreview{
				{
					Position:        1,
					Title:           fmt.Sprintf("%s（完整正片）", workTitle),
					DurationSeconds: durationSec,
					ArtistCredit:    strings.Join(artistNames, " / "),
				},
			},
		},
	}

	// 发行版本名（LRM 规范：{作品主名}（{规格/介质}，{发行厂牌}））
	pubLabel := publisherName
	if pubLabel == "" {
		pubLabel = "Official Release"
	}
	editionName := fmt.Sprintf("%s（4K UHD 官方院线/数字公映版，%s）", workTitle, pubLabel)

	extIDs := models.JSONB{
		"tmdb": fmt.Sprintf("%d", data.ID),
	}
	if data.ImdbID != "" {
		extIDs["imdb"] = data.ImdbID
	}

	return &PreviewResponse{
		Source:      "tmdb",
		ExternalID:  fmt.Sprintf("%d", data.ID),
		ExternalURL: fmt.Sprintf("https://www.themoviedb.org/movie/%d", data.ID),
		MediaType:   "movie",
		Work: WorkPreview{
			Title:            workTitle,
			OriginalTitle:    data.OriginalTitle,
			Aliases:          []string{data.OriginalTitle, enTitle},
			ReleaseDate:      data.ReleaseDate,
			BeginDate:        data.ReleaseDate,
			Country:          "USA",
			Language:         "zh-CN",
			OriginalLanguage: data.OriginalLanguage,
			Summary:          zhOverview,
			CoverImageURL:    coverURL,
			CoverAspect:      "2:3",
			ContentRating:    "General",
			Tags:             tags,
			ExternalIDs:      extIDs,
			Translations: []TranslationItem{
				{Locale: "zh-CN", Title: workTitle, Summary: zhOverview},
				{Locale: "en-US", Title: enTitle, Summary: enOverview},
			},
			CatalogMetadata: extIDs,
		},
		Artists: artists,
		Release: ReleasePreview{
			EditionName:         editionName,
			Publisher:           publisherName,
			Packaging:           "digital_release",
			Country:             "USA",
			Language:            "zh-CN",
			DistributionChannel: "mixed",
			EditionDate:         data.ReleaseDate,
			Notes:               fmt.Sprintf("Imported from TMDB (Movie ID: %d)", data.ID),
			ExternalIDs:         extIDs,
			CatalogMetadata:     extIDs,
		},
		Mediums: mediums,
		Tags:    tags,
	}, nil
}

func fetchTMDBTVDetail(ctx context.Context, client *http.Client, tmdbID string, apiKey string) (*PreviewResponse, error) {
	apiURL := fmt.Sprintf("https://api.themoviedb.org/3/tv/%s?append_to_response=credits,keywords,translations&language=zh-CN&api_key=%s", tmdbID, apiKey)
	if err := security.ValidateExternalURL(apiURL); err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("TMDB TV detail failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("TMDB returned %d: %s", resp.StatusCode, string(body))
	}

	var data tmdbTVDetail
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}

	zhTitle := data.Name
	enTitle := data.OriginalName
	zhOverview := data.Overview
	enOverview := data.Overview

	for _, trans := range data.Translations.Translations {
		if trans.Iso639_1 == "en" {
			if trans.Data.Name != "" {
				enTitle = trans.Data.Name
			}
			if trans.Data.Overview != "" {
				enOverview = trans.Data.Overview
			}
		}
	}

	workTitle := zhTitle
	if workTitle == "" {
		workTitle = data.OriginalName
	}

	var artists []ArtistPreview
	for _, creator := range data.CreatedBy {
		artists = append(artists, ArtistPreview{
			Name:           creator.Name,
			Role:           "Author",
			EntityType:     models.EntityTypePerson,
			Disambiguation: "Series Creator",
			Language:       "zh-CN",
			ExternalIDs: models.JSONB{
				"tmdb": fmt.Sprintf("%d", creator.ID),
			},
		})
	}

	// 演职人员提取
	for _, crew := range data.Credits.Crew {
		if strings.EqualFold(crew.Job, "Director") || strings.EqualFold(crew.Job, "Executive Producer") {
			artists = append(artists, ArtistPreview{
				Name:           crew.Name,
				Role:           "Director",
				EntityType:     models.EntityTypePerson,
				Disambiguation: "TV Director / Producer",
				Language:       "zh-CN",
				ExternalIDs: models.JSONB{
					"tmdb": fmt.Sprintf("%d", crew.ID),
				},
			})
		}
	}

	// 主演提取
	castLimit := 6
	if len(data.Credits.Cast) < castLimit {
		castLimit = len(data.Credits.Cast)
	}
	for i := 0; i < castLimit; i++ {
		cast := data.Credits.Cast[i]
		artists = append(artists, ArtistPreview{
			Name:           cast.Name,
			Role:           "Performer",
			EntityType:     models.EntityTypePerson,
			Disambiguation: fmt.Sprintf("饰 %s", cast.Character),
			Language:       "zh-CN",
			ExternalIDs: models.JSONB{
				"tmdb": fmt.Sprintf("%d", cast.ID),
			},
		})
	}

	publisherName := ""
	if len(data.ProductionCompanies) > 0 {
		pub := data.ProductionCompanies[0]
		publisherName = pub.Name
		artists = append(artists, ArtistPreview{
			Name:           pub.Name,
			Role:           "Production Studio / Publisher",
			EntityType:     models.EntityTypeStudio,
			Country:        pub.OriginCountry,
			Language:       "zh-CN",
			ExternalIDs: models.JSONB{
				"tmdb": fmt.Sprintf("%d", pub.ID),
			},
		})
	}

	tagMap := make(map[string]bool)
	tagMap["TV Series"] = true
	tagMap["Drama"] = true
	for _, g := range data.Genres {
		if g.Name != "" {
			tagMap[g.Name] = true
		}
	}
	tags := make([]string, 0, len(tagMap))
	for k := range tagMap {
		tags = append(tags, k)
	}

	coverURL := ""
	if data.PosterPath != "" {
		coverURL = fmt.Sprintf("https://image.tmdb.org/t/p/original%s", data.PosterPath)
	}

	// Mediums (生成每季的 Medium，及各单集 Tracks)
	mediums := make([]MediumPreview, 0)
	episodeDuration := 45 * 60
	if len(data.EpisodeRunTime) > 0 {
		episodeDuration = data.EpisodeRunTime[0] * 60
	}

	tracks := make([]TrackPreview, 0)
	numEp := data.NumberOfEpisodes
	if numEp <= 0 {
		numEp = 12
	}
	if numEp > 26 {
		numEp = 26 // 初始预览收录代表集数
	}
	for ep := 1; ep <= numEp; ep++ {
		tracks = append(tracks, TrackPreview{
			Position:        ep,
			Title:           fmt.Sprintf("%s 第 %d 集", workTitle, ep),
			DurationSeconds: episodeDuration,
		})
	}

	mediums = append(mediums, MediumPreview{
		Position:      1,
		Name:          "Season 1（第一季完整剧集）",
		Format:        "Digital",
		MediaCategory: "video",
		Tracks:        tracks,
	})

	editionName := fmt.Sprintf("%s 第一季（官方网络流媒体首播版，%s）", workTitle, publisherName)

	extIDs := models.JSONB{
		"tmdb": fmt.Sprintf("%d", data.ID),
	}

	return &PreviewResponse{
		Source:      "tmdb",
		ExternalID:  fmt.Sprintf("%d", data.ID),
		ExternalURL: fmt.Sprintf("https://www.themoviedb.org/tv/%d", data.ID),
		MediaType:   "tv",
		Work: WorkPreview{
			Title:            workTitle,
			OriginalTitle:    data.OriginalName,
			Aliases:          []string{data.OriginalName, enTitle},
			ReleaseDate:      data.FirstAirDate,
			BeginDate:        data.FirstAirDate,
			EndDate:          data.LastAirDate,
			Country:          "USA",
			Language:         "zh-CN",
			OriginalLanguage: data.OriginalLanguage,
			Summary:          zhOverview,
			CoverImageURL:    coverURL,
			CoverAspect:      "2:3",
			ContentRating:    "General",
			Tags:             tags,
			ExternalIDs:      extIDs,
			Translations: []TranslationItem{
				{Locale: "zh-CN", Title: workTitle, Summary: zhOverview},
				{Locale: "en-US", Title: enTitle, Summary: enOverview},
			},
			CatalogMetadata: extIDs,
		},
		Artists: artists,
		Release: ReleasePreview{
			EditionName:         editionName,
			Publisher:           publisherName,
			Packaging:           "digital_release",
			Country:             "USA",
			Language:            "zh-CN",
			DistributionChannel: "digital",
			EditionDate:         data.FirstAirDate,
			Notes:               fmt.Sprintf("Imported from TMDB (TV ID: %d)", data.ID),
			ExternalIDs:         extIDs,
			CatalogMetadata:     extIDs,
		},
		Mediums: mediums,
		Tags:    tags,
	}, nil
}

// fetchIMDbDirectPreview 通过解析 IMDb 的 JSON-LD 结构化数据实现免 API Key 极速解析
func fetchIMDbDirectPreview(ctx context.Context, client *http.Client, imdbID string) (*PreviewResponse, error) {
	imdbURL := fmt.Sprintf("https://www.imdb.com/title/%s/", imdbID)
	if err := security.ValidateExternalURL(imdbURL); err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "GET", imdbURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("IMDb web request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("IMDb page returned status %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	html := string(bodyBytes)

	// 提取 JSON-LD
	jsonLdRegex := regexp.MustCompile(`<script type="application/ld\+json">([\s\S]*?)</script>`)
	matches := jsonLdRegex.FindAllStringSubmatch(html, -1)
	if len(matches) == 0 {
		return nil, fmt.Errorf("failed to extract JSON-LD from IMDb page %s", imdbID)
	}

	var jsonLd map[string]interface{}
	for _, m := range matches {
		if len(m) > 1 {
			var parsed map[string]interface{}
			if err := json.Unmarshal([]byte(m[1]), &parsed); err == nil {
				if parsed["@type"] == "Movie" || parsed["@type"] == "TVSeries" || parsed["name"] != nil {
					jsonLd = parsed
					break
				}
			}
		}
	}

	if jsonLd == nil {
		return nil, fmt.Errorf("no valid Movie/TVSeries JSON-LD found in IMDb page")
	}

	title, _ := jsonLd["name"].(string)
	summary, _ := jsonLd["description"].(string)
	datePublished, _ := jsonLd["datePublished"].(string)
	imageURL, _ := jsonLd["image"].(string)

	var artists []ArtistPreview
	// 提取导演 / 创作者
	if dirs, ok := jsonLd["director"].([]interface{}); ok {
		for _, d := range dirs {
			if dm, ok := d.(map[string]interface{}); ok {
				if name, ok := dm["name"].(string); ok && name != "" {
					artists = append(artists, ArtistPreview{
						Name:       name,
						Role:       "Director",
						EntityType: models.EntityTypePerson,
						Language:   "zh-CN",
					})
				}
			}
		}
	}
	// 提取主演
	if actors, ok := jsonLd["actor"].([]interface{}); ok {
		for i, a := range actors {
			if i >= 6 {
				break
			}
			if am, ok := a.(map[string]interface{}); ok {
				if name, ok := am["name"].(string); ok && name != "" {
					artists = append(artists, ArtistPreview{
						Name:       name,
						Role:       "Performer",
						EntityType: models.EntityTypePerson,
						Language:   "zh-CN",
					})
				}
			}
		}
	}

	// 标签
	tags := []string{"Cinema", "Movie"}
	if g, ok := jsonLd["genre"].([]interface{}); ok {
		for _, item := range g {
			if s, ok := item.(string); ok && s != "" {
				tags = append(tags, s)
			}
		}
	} else if s, ok := jsonLd["genre"].(string); ok && s != "" {
		tags = append(tags, s)
	}

	editionName := fmt.Sprintf("%s（4K UHD 官方院线/流媒体公映版）", title)

	extIDs := models.JSONB{
		"imdb": imdbID,
	}

	mediums := []MediumPreview{
		{
			Position:      1,
			Name:          "Main Feature（完整正片）",
			Format:        "Digital",
			MediaCategory: "video",
			Tracks: []TrackPreview{
				{
					Position:        1,
					Title:           fmt.Sprintf("%s（完整正片）", title),
					DurationSeconds: 7200,
				},
			},
		},
	}

	return &PreviewResponse{
		Source:      "imdb",
		ExternalID:  imdbID,
		ExternalURL: imdbURL,
		MediaType:   "movie",
		Work: WorkPreview{
			Title:            title,
			OriginalTitle:    title,
			Aliases:          []string{},
			ReleaseDate:      datePublished,
			BeginDate:        datePublished,
			Country:          "USA",
			Language:         "zh-CN",
			OriginalLanguage: "en",
			Summary:          summary,
			CoverImageURL:    imageURL,
			CoverAspect:      "2:3",
			ContentRating:    "General",
			Tags:             tags,
			ExternalIDs:      extIDs,
			Translations: []TranslationItem{
				{Locale: "zh-CN", Title: title, Summary: summary},
				{Locale: "en-US", Title: title, Summary: summary},
			},
			CatalogMetadata: extIDs,
		},
		Artists: artists,
		Release: ReleasePreview{
			EditionName:         editionName,
			Packaging:           "digital_release",
			Country:             "USA",
			Language:            "zh-CN",
			DistributionChannel: "mixed",
			EditionDate:         datePublished,
			Notes:               fmt.Sprintf("Imported from IMDb (ID: %s)", imdbID),
			ExternalIDs:         extIDs,
			CatalogMetadata:     extIDs,
		},
		Mediums: mediums,
		Tags:    tags,
	}, nil
}

func fetchTMDBWebScrapePreview(ctx context.Context, client *http.Client, tmdbID string, mediaType string) (*PreviewResponse, error) {
	pageURL := fmt.Sprintf("https://www.themoviedb.org/%s/%s?language=zh-CN", mediaType, tmdbID)
	if err := security.ValidateExternalURL(pageURL); err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "GET", pageURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("TMDB scrape request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("TMDB page returned status %d", resp.StatusCode)
	}

	bodyBytes, _ := io.ReadAll(resp.Body)
	html := string(bodyBytes)

	// 提取 og:title, og:description, og:image
	ogTitleRegex := regexp.MustCompile(`<meta property="og:title" content="([^"]+)"`)
	ogDescRegex := regexp.MustCompile(`<meta property="og:description" content="([^"]+)"`)
	ogImageRegex := regexp.MustCompile(`<meta property="og:image" content="([^"]+)"`)

	title := ""
	if m := ogTitleRegex.FindStringSubmatch(html); len(m) > 1 {
		title = strings.TrimSpace(htmlUnescape(m[1]))
	}
	summary := ""
	if m := ogDescRegex.FindStringSubmatch(html); len(m) > 1 {
		summary = strings.TrimSpace(htmlUnescape(m[1]))
	}
	imageURL := ""
	if m := ogImageRegex.FindStringSubmatch(html); len(m) > 1 {
		imageURL = m[1]
	}

	if title == "" {
		title = fmt.Sprintf("TMDB Entity %s", tmdbID)
	}

	extIDs := models.JSONB{"tmdb": tmdbID}
	tags := []string{"Cinema", "Movie"}
	if mediaType == "tv" {
		tags = []string{"TV Series", "Animation"}
	}

	return &PreviewResponse{
		Source:      "tmdb",
		ExternalID:  tmdbID,
		ExternalURL: pageURL,
		MediaType:   mediaType,
		Work: WorkPreview{
			Title:         title,
			OriginalTitle: title,
			Summary:       summary,
			CoverImageURL: imageURL,
			CoverAspect:   "2:3",
			Tags:          tags,
			ExternalIDs:   extIDs,
			Translations: []TranslationItem{
				{Locale: "zh-CN", Title: title, Summary: summary},
			},
			CatalogMetadata: extIDs,
		},
		Artists: []ArtistPreview{},
		Release: ReleasePreview{
			EditionName:         fmt.Sprintf("%s（官方首发版）", title),
			Packaging:           "digital_release",
			DistributionChannel: "mixed",
			Notes:               fmt.Sprintf("Imported from TMDB (%s ID: %s)", mediaType, tmdbID),
			ExternalIDs:         extIDs,
			CatalogMetadata:     extIDs,
		},
		Mediums: []MediumPreview{
			{
				Position:      1,
				Name:          "Main Feature",
				Format:        "Digital",
				MediaCategory: "video",
				Tracks: []TrackPreview{
					{Position: 1, Title: fmt.Sprintf("%s（正片）", title), DurationSeconds: 7200},
				},
			},
		},
		Tags: tags,
	}, nil
}

func htmlUnescape(s string) string {
	s = strings.ReplaceAll(s, "&quot;", "\"")
	s = strings.ReplaceAll(s, "&amp;", "&")
	s = strings.ReplaceAll(s, "&lt;", "<")
	s = strings.ReplaceAll(s, "&gt;", ">")
	s = strings.ReplaceAll(s, "&#39;", "'")
	return s
}

// ParseTMDBOrIMDbPersonID 解析 TMDB/IMDb 人物标识符
func ParseTMDBOrIMDbPersonID(input string) (isIMDb bool, id string, err error) {
	clean := strings.TrimSpace(input)
	if m := imdbNameRegex.FindStringSubmatch(clean); len(m) > 1 {
		return true, m[1], nil
	}
	if m := tmdbPersonURLRegex.FindStringSubmatch(clean); len(m) > 1 {
		return false, m[1], nil
	}
	if numericIDRegex.MatchString(clean) {
		return false, clean, nil
	}
	return false, "", fmt.Errorf("invalid TMDB/IMDb Person URL or ID: %s", input)
}

// ParseTMDBCompanyID 解析 TMDB 制片公司/工作室标识符
func ParseTMDBCompanyID(input string) (string, error) {
	clean := strings.TrimSpace(input)
	if m := tmdbCompanyURLRegex.FindStringSubmatch(clean); len(m) > 1 {
		return m[1], nil
	}
	if numericIDRegex.MatchString(clean) {
		return clean, nil
	}
	return "", fmt.Errorf("invalid TMDB Company URL or ID: %s", input)
}

// FetchTMDBPersonPreview 解析 TMDB / IMDb 人物与演职员
func FetchTMDBPersonPreview(ctx context.Context, input string, apiKey string) (*PreviewResponse, error) {
	isIMDb, id, err := ParseTMDBOrIMDbPersonID(input)
	if err != nil {
		return nil, err
	}

	client := &http.Client{Timeout: 15 * time.Second}
	personID := id

	if isIMDb && apiKey != "" {
		findURL := fmt.Sprintf("https://api.themoviedb.org/3/find/%s?api_key=%s&external_source=imdb_id", id, apiKey)
		if fReq, err := http.NewRequestWithContext(ctx, "GET", findURL, nil); err == nil {
			fReq.Header.Set("User-Agent", "MetaFusion-OmniImporter/1.0 ( contact@metafusion.io )")
			if fResp, err := client.Do(fReq); err == nil && fResp.StatusCode == http.StatusOK {
				var fData struct {
					PersonResults []struct {
						ID int `json:"id"`
					} `json:"person_results"`
				}
				if json.NewDecoder(fResp.Body).Decode(&fData) == nil && len(fData.PersonResults) > 0 {
					personID = fmt.Sprintf("%d", fData.PersonResults[0].ID)
				}
				fResp.Body.Close()
			}
		}
	}

	if apiKey != "" {
		detailURL := fmt.Sprintf("https://api.themoviedb.org/3/person/%s?api_key=%s&append_to_response=external_ids,translations,images", personID, apiKey)
		req, err := http.NewRequestWithContext(ctx, "GET", detailURL, nil)
		if err == nil {
			req.Header.Set("User-Agent", "MetaFusion-OmniImporter/1.0 ( contact@metafusion.io )")
			if resp, err := client.Do(req); err == nil && resp.StatusCode == http.StatusOK {
				defer resp.Body.Close()
				var data struct {
					ID                 int      `json:"id"`
					Name               string   `json:"name"`
					AlsoKnownAs        []string `json:"also_known_as"`
					Biography          string   `json:"biography"`
					Birthday           string   `json:"birthday"`
					Deathday           string   `json:"deathday"`
					Gender             int      `json:"gender"`
					KnownForDepartment string   `json:"known_for_department"`
					PlaceOfBirth       string   `json:"place_of_birth"`
					ProfilePath        string   `json:"profile_path"`
					ExternalIDs        struct {
						ImdbID      string `json:"imdb_id"`
						WikidataID  string `json:"wikidata_id"`
						TwitterID   string `json:"twitter_id"`
						InstagramID string `json:"instagram_id"`
					} `json:"external_ids"`
					Translations struct {
						Translations []struct {
							Iso639_1 string `json:"iso_639_1"`
							Data     struct {
								Biography string `json:"biography"`
							} `json:"data"`
						} `json:"translations"`
					} `json:"translations"`
				}

				if json.NewDecoder(resp.Body).Decode(&data) == nil {
					avatarURL := ""
					if data.ProfilePath != "" {
						avatarURL = "https://image.tmdb.org/t/p/original" + data.ProfilePath
					}

					extIDs := models.JSONB{
						"tmdb_person": fmt.Sprintf("%d", data.ID),
					}
					if data.ExternalIDs.ImdbID != "" {
						extIDs["imdb_person"] = data.ExternalIDs.ImdbID
					} else if isIMDb {
						extIDs["imdb_person"] = id
					}
					if data.ExternalIDs.WikidataID != "" {
						extIDs["wikidata"] = data.ExternalIDs.WikidataID
					}

					translations := make([]TranslationItem, 0)
					for _, tr := range data.Translations.Translations {
						if tr.Iso639_1 == "zh" && tr.Data.Biography != "" {
							translations = append(translations, TranslationItem{
								Locale:  "zh-CN",
								Title:   data.Name,
								Summary: tr.Data.Biography,
							})
						}
					}

					bio := data.Biography
					if data.PlaceOfBirth != "" {
						if bio != "" {
							bio += "\n\n"
						}
						bio += fmt.Sprintf("出生地: %s", data.PlaceOfBirth)
					}
					if data.Birthday != "" {
						bio += fmt.Sprintf(" | 生日: %s", data.Birthday)
					}

					artist := ArtistPreview{
						Name:         data.Name,
						OriginalName: data.Name,
						EntityType:   models.EntityTypePerson,
						Role:         data.KnownForDepartment,
						Country:      data.PlaceOfBirth,
						Biography:    bio,
						AvatarURL:    avatarURL,
						Aliases:      data.AlsoKnownAs,
						ExternalIDs:  extIDs,
						Translations: translations,
					}

					return &PreviewResponse{
						Source:      "tmdb",
						EntityType:  "artist",
						ExternalID:  fmt.Sprintf("%d", data.ID),
						ExternalURL: fmt.Sprintf("https://www.themoviedb.org/person/%d", data.ID),
						MediaType:   "person",
						Artist:      &artist,
					}, nil
				}
			}
		}
	}

	// 降级爬取 TMDB Person Web 页面
	pageURL := fmt.Sprintf("https://www.themoviedb.org/person/%s", personID)
	pReq, _ := http.NewRequestWithContext(ctx, "GET", pageURL, nil)
	pReq.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	pReq.Header.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")

	pResp, err := client.Do(pReq)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch TMDB person page: %w", err)
	}
	defer pResp.Body.Close()

	htmlBody, _ := io.ReadAll(pResp.Body)
	htmlStr := string(htmlBody)

	nameMatch := regexp.MustCompile(`<meta property="og:title" content="([^"]+)"`).FindStringSubmatch(htmlStr)
	name := fmt.Sprintf("TMDB Person %s", personID)
	if len(nameMatch) > 1 {
		name = htmlUnescape(nameMatch[1])
	}

	imgMatch := regexp.MustCompile(`<meta property="og:image" content="([^"]+)"`).FindStringSubmatch(htmlStr)
	avatarURL := ""
	if len(imgMatch) > 1 {
		avatarURL = imgMatch[1]
	}

	artist := ArtistPreview{
		Name:         name,
		OriginalName: name,
		EntityType:   models.EntityTypePerson,
		Role:         "Actor / Crew",
		AvatarURL:    avatarURL,
		ExternalIDs: models.JSONB{
			"tmdb_person": personID,
		},
	}

	return &PreviewResponse{
		Source:      "tmdb",
		EntityType:  "artist",
		ExternalID:  personID,
		ExternalURL: pageURL,
		MediaType:   "person",
		Artist:      &artist,
	}, nil
}

// FetchTMDBCompanyPreview 解析 TMDB 制片公司/工作室
func FetchTMDBCompanyPreview(ctx context.Context, input string, apiKey string) (*PreviewResponse, error) {
	companyID, err := ParseTMDBCompanyID(input)
	if err != nil {
		return nil, err
	}

	client := &http.Client{Timeout: 15 * time.Second}

	if apiKey != "" {
		detailURL := fmt.Sprintf("https://api.themoviedb.org/3/company/%s?api_key=%s", companyID, apiKey)
		req, err := http.NewRequestWithContext(ctx, "GET", detailURL, nil)
		if err == nil {
			req.Header.Set("User-Agent", "MetaFusion-OmniImporter/1.0 ( contact@metafusion.io )")
			if resp, err := client.Do(req); err == nil && resp.StatusCode == http.StatusOK {
				defer resp.Body.Close()
				var data struct {
					ID            int    `json:"id"`
					Name          string `json:"name"`
					Description   string `json:"description"`
					Headquarters  string `json:"headquarters"`
					Homepage      string `json:"homepage"`
					LogoPath      string `json:"logo_path"`
					OriginCountry string `json:"origin_country"`
				}

				if json.NewDecoder(resp.Body).Decode(&data) == nil {
					logoURL := ""
					if data.LogoPath != "" {
						logoURL = "https://image.tmdb.org/t/p/original" + data.LogoPath
					}

					bio := data.Description
					if data.Headquarters != "" {
						if bio != "" {
							bio += "\n\n"
						}
						bio += fmt.Sprintf("总部: %s", data.Headquarters)
					}
					if data.Homepage != "" {
						if bio != "" {
							bio += " | "
						}
						bio += fmt.Sprintf("官网: %s", data.Homepage)
					}

					artist := ArtistPreview{
						Name:         data.Name,
						OriginalName: data.Name,
						EntityType:   models.EntityTypeStudio,
						Role:         "Production Company",
						Country:      data.OriginCountry,
						Biography:    bio,
						AvatarURL:    logoURL,
						ExternalIDs: models.JSONB{
							"tmdb_company": fmt.Sprintf("%d", data.ID),
						},
					}

					return &PreviewResponse{
						Source:      "tmdb",
						EntityType:  "organization",
						ExternalID:  fmt.Sprintf("%d", data.ID),
						ExternalURL: fmt.Sprintf("https://www.themoviedb.org/company/%d", data.ID),
						MediaType:   "organization",
						Artist:      &artist,
					}, nil
				}
			}
		}
	}

	artist := ArtistPreview{
		Name:         fmt.Sprintf("TMDB Company %s", companyID),
		OriginalName: fmt.Sprintf("TMDB Company %s", companyID),
		EntityType:   models.EntityTypeStudio,
		Role:         "Production Company",
		ExternalIDs: models.JSONB{
			"tmdb_company": companyID,
		},
	}

	return &PreviewResponse{
		Source:      "tmdb",
		EntityType:  "organization",
		ExternalID:  companyID,
		ExternalURL: fmt.Sprintf("https://www.themoviedb.org/company/%s", companyID),
		MediaType:   "organization",
		Artist:      &artist,
	}, nil
}
