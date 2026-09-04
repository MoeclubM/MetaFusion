package importer

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
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

type bgmEpisodeItem struct {
	ID              int    `json:"id"`
	Name            string `json:"name"`
	NameCN          string `json:"name_cn"`
	Airdate         string `json:"airdate"`
	DurationSeconds int    `json:"duration_seconds"`
	Ep              int    `json:"ep"`
	Sort            int    `json:"sort"`
	SubjectID       int    `json:"subject_id"`
	Disc            int    `json:"disc"`
	Type            int    `json:"type"`
}

type bgmEpisodesResponse struct {
	Data   []bgmEpisodeItem `json:"data"`
	Total  int              `json:"total"`
	Limit  int              `json:"limit"`
	Offset int              `json:"offset"`
}

// fetchBangumiEpisodes 拉取 Bangumi 真实分集列表（/v0/episodes?subject_id=）。
// 返回 nil 表示源无分集数据（音乐/书籍/游戏等类型常见），调用方回退诚实占位。
func fetchBangumiEpisodes(ctx context.Context, client *http.Client, subjectID string) []bgmEpisodeItem {
	episodesURL := fmt.Sprintf("https://api.bgm.tv/v0/episodes?subject_id=%s&limit=100&offset=0", subjectID)
	if err := security.ValidateExternalURL(episodesURL); err != nil {
		return nil
	}
	var out []bgmEpisodeItem
	offset := 0
	for len(out) < 200 {
		pageURL := fmt.Sprintf("https://api.bgm.tv/v0/episodes?subject_id=%s&limit=100&offset=%d", subjectID, offset)
		eReq, err := http.NewRequestWithContext(ctx, "GET", pageURL, nil)
		if err != nil {
			break
		}
		eReq.Header.Set("User-Agent", "MetaFusion-OmniImporter/1.0 ( contact@metafusion.io )")
		eReq.Header.Set("Accept", "application/json")
		eResp, err := client.Do(eReq)
		if err != nil || eResp.StatusCode != http.StatusOK {
			if eResp != nil {
				eResp.Body.Close()
			}
			break
		}
		var page bgmEpisodesResponse
		decErr := json.NewDecoder(eResp.Body).Decode(&page)
		eResp.Body.Close()
		if decErr != nil || len(page.Data) == 0 {
			break
		}
		out = append(out, page.Data...)
		offset += len(page.Data)
		if page.Total > 0 && offset >= page.Total {
			break
		}
		if len(page.Data) < 100 {
			break
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// bgmInfoboxText 提取 infobox 首个匹配键的文本值（支持 string / {v} / [{v}] 三种形状）。
func bgmInfoboxText(infobox []bgmInfoboxItem, keys ...string) string {
	want := map[string]bool{}
	for _, k := range keys {
		want[k] = true
	}
	for _, item := range infobox {
		if !want[strings.TrimSpace(item.Key)] {
			continue
		}
		switch val := item.Value.(type) {
		case string:
			if s := strings.TrimSpace(val); s != "" {
				return s
			}
		case []interface{}:
			for _, sub := range val {
				if m, ok := sub.(map[string]interface{}); ok {
					if v, exists := m["v"]; exists {
						if s := strings.TrimSpace(fmt.Sprintf("%v", v)); s != "" {
							return s
						}
					}
				} else if s := strings.TrimSpace(fmt.Sprintf("%v", sub)); s != "" {
					return s
				}
			}
		default:
			if s := strings.TrimSpace(fmt.Sprintf("%v", val)); s != "" && s != "<nil>" {
				return s
			}
		}
	}
	return ""
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

	client := security.NewSafeHTTPClient(15 * time.Second)

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
		if k == "出版社" || k == "发行" {
			publisherName = strings.TrimSpace(fmt.Sprintf("%v", item.Value))
		} else if k == "ISBN" {
			isbn = strings.TrimSpace(fmt.Sprintf("%v", item.Value))
		} else if k == "别名" {
			switch val := item.Value.(type) {
			case string:
				if s := strings.TrimSpace(val); s != "" {
					aliases = append(aliases, s)
				}
			case []interface{}:
				for _, sub := range val {
					if subMap, ok := sub.(map[string]interface{}); ok {
						if v, exists := subMap["v"]; exists {
							if s := strings.TrimSpace(fmt.Sprintf("%v", v)); s != "" {
								aliases = append(aliases, s)
							}
						}
					} else if subStr := strings.TrimSpace(fmt.Sprintf("%v", sub)); subStr != "" {
						aliases = append(aliases, subStr)
					}
				}
			}
		}
	}

	// 创作者与机构提取 (LRM 编目标准：提炼核心主创与制作机构，过滤底层数百名原画/补间/进行协力人员)
		var artists []ArtistPreview
		artistNameMap := make(map[string]bool)

		for _, p := range persons {
			pName := strings.TrimSpace(p.Name)
			if pName == "" || artistNameMap[pName] {
				continue
			}

			rel := strings.TrimSpace(p.Relation)
			if rel == "" {
				rel = "Creator"
			}

			role := rel
			if strings.Contains(rel, "出版社") || strings.Contains(rel, "发行") || strings.Contains(rel, "出版") || strings.Contains(rel, "唱片") {
				if publisherName == "" {
					publisherName = pName
				}
			}

			artistNameMap[pName] = true

			entType := models.EntityTypePerson
			if p.Type == 2 || (p.Type == 0 && (rel == "动画制作" || rel == "制作公司" || rel == "出版社" || rel == "唱片公司" || rel == "开发商")) {
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

		// 角色与配音声优提取 (对标 Bangumi 完整收录并保留角色层级与声优双轨绑定)
		for _, ch := range bgmChars {
			chName := strings.TrimSpace(ch.Name)
			if chName == "" {
				continue
			}
			roleType := strings.TrimSpace(ch.Relation)
			if roleType == "" {
				roleType = "主角"
			}

			// 1. 角色本体实体 (Character 实体，记录出场定位：主角/配角/客串)
			charKey := "char_" + chName
			if !artistNameMap[charKey] {
				artistNameMap[charKey] = true
				artists = append(artists, ArtistPreview{
					Name:        chName,
					Role:        roleType,
					EntityType:  models.EntityTypeVirtualCharacter,
					Country:     "JP",
					AvatarURL:   ch.Images.Large,
					ExternalIDs: models.JSONB{
						"bangumi_character": strconv.Itoa(ch.ID),
					},
				})
			}

			// 2. 角色配音声优 (Voice Actor 自然人实体，记录“配演 角色”对应关系)
			if len(ch.Actors) > 0 {
				for _, act := range ch.Actors {
					actName := strings.TrimSpace(act.Name)
					if actName == "" {
						continue
					}
					actorKey := actName + "_as_" + chName
					if artistNameMap[actorKey] {
						continue
					}
					artistNameMap[actorKey] = true
					artists = append(artists, ArtistPreview{
						Name:          actName,
						Role:          "Voice Actor",
						EntityType:    models.EntityTypePerson,
						Country:       "JP",
						AvatarURL:     act.Images.Large,
						CharacterName: chName,
						ExternalIDs: models.JSONB{
							"bangumi_person": strconv.Itoa(act.ID),
						},
					})
				}
			}
		}

	// 媒体类型分类及封面比例（format/mediaCategory 均为规范词表 ID 小写，
	// 落库前 importer.go 共享链路再经 ontology 归一化兜底）。
	mediaType := "book"
	coverAspect := "3:4"
	format := "paperback"
	mediaCategory := "novel"
	switch data.Type {
	case 1: // Book
		mediaType = "book"
		coverAspect = "3:4"
		format = "paperback"
		mediaCategory = "novel"
	case 2: // Anime
		mediaType = "anime"
		coverAspect = "2:3"
		format = "broadcast"
		mediaCategory = "anime"
	case 3: // Music
		mediaType = "music"
		coverAspect = "1:1"
		format = "cd"
		mediaCategory = "music"
	case 4: // Game
		mediaType = "game"
		coverAspect = "2:3"
		format = "digital"
		mediaCategory = "game"
	case 6: // Real/Drama
		mediaType = "tv"
		coverAspect = "2:3"
		format = "broadcast"
		mediaCategory = "tv_series"
	}

	// 标签提取：先写与 media_types.code 对齐的规范 format 形态标签
	// （货架 query_tags 命中用），再写手法 medium 标签，最后才是源原生 genre 标签。
	tagMap := make(map[string]bool)
	formatTag := ""
	mediumTag := ""
	switch mediaType {
	case "book":
		formatTag = "图书"
	case "anime":
		formatTag = "动画番剧"
		mediumTag = "动画"
	case "music":
		formatTag = "专辑"
		mediumTag = "原声"
	case "game":
		formatTag = "游戏"
	case "tv":
		formatTag = "剧集"
	}
	if formatTag != "" {
		tagMap[formatTag] = true
	}
	// 形态细分：动画剧场版/连续剧/漫画/轻小说等，按源类型与条目特征补齐。
	switch mediaType {
	case "anime":
		tagMap["动画剧场版"] = true
	case "tv":
		tagMap["连续剧"] = true
		mediumTag = "实拍"
	case "book":
		mediumTag = ""
	}
	if mediumTag != "" {
		tagMap[mediumTag] = true
	}
	tagGroups := map[string]string{}
	if formatTag != "" {
		tagGroups[formatTag] = "format"
	}
	if mediumTag != "" {
		tagGroups[mediumTag] = "medium"
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

	// 真实分集：anime/tv/music 走 /v0/episodes?subject_id= 拉取真实话/曲目
	// （标题/播出日/disc/时长）；书籍走 infobox 发售日诚实单卷；游戏/无分集源回退计数占位。
	realEpisodes := fetchBangumiEpisodes(ctx, client, subjectID)
	var mediums []MediumPreview
	if len(realEpisodes) > 0 {
		// 按 disc 分介质（disc<=0 归入 Disc 1），介质内按 sort 排序。
		discOrder := []int{}
		discTracks := map[int][]TrackPreview{}
		for _, ep := range realEpisodes {
			disc := ep.Disc
			if disc <= 0 {
				disc = 1
			}
			if _, ok := discTracks[disc]; !ok {
				discOrder = append(discOrder, disc)
			}
			epTitle := strings.TrimSpace(ep.NameCN)
			if epTitle == "" {
				epTitle = strings.TrimSpace(ep.Name)
			}
			sortNo := ep.Sort
			if sortNo <= 0 {
				sortNo = ep.Ep
			}
			if epTitle == "" {
				epTitle = fmt.Sprintf("第 %d 话", sortNo)
			}
			discTracks[disc] = append(discTracks[disc], TrackPreview{
				Position:         sortNo,
				Title:            epTitle,
				DurationSeconds:  ep.DurationSeconds,
				AirDate:          strings.TrimSpace(ep.Airdate),
				BangumiEpisodeID: strconv.Itoa(ep.ID),
			})
		}
		sort.Ints(discOrder)
		for i, disc := range discOrder {
			tks := discTracks[disc]
			sort.Slice(tks, func(a, b int) bool { return tks[a].Position < tks[b].Position })
			medName := ""
			if len(discOrder) == 1 {
				medName = "TV Broadcast / BD-BOX"
				if mediaType == "music" {
					medName = "Disc 1（原盘曲目）"
				}
			} else {
				medName = fmt.Sprintf("Disc %d", disc)
			}
			mediums = append(mediums, MediumPreview{
				Position:      i + 1,
				Name:          medName,
				Format:        format,
				MediaCategory: mediaCategory,
				Tracks:        tks,
			})
		}
	} else {
		// 诚实回退：书籍按 volumes 卷数列卷（无卷数则单卷），其他类型单介质零曲目。
		medName := "Vol. 1（单行本）"
		itemCount := data.Volumes
		var tracks []TrackPreview
		if mediaType == "book" && itemCount > 0 {
			if itemCount > 100 {
				itemCount = 100
			}
			for i := 1; i <= itemCount; i++ {
				tracks = append(tracks, TrackPreview{
					Position: i,
					Title:    fmt.Sprintf("%s 第 %d 卷", workTitle, i),
				})
			}
			if itemCount > 1 {
				medName = fmt.Sprintf("全 %d 卷（单行本）", itemCount)
			}
		} else if mediaType == "anime" || mediaType == "tv" {
			medName = "TV Broadcast / BD-BOX"
		} else if mediaType == "music" {
			medName = "Disc 1（原盘曲目）"
		} else if mediaType == "game" {
			medName = "Digital（数字版游戏本体）"
		}
		mediums = append(mediums, MediumPreview{
			Position:      1,
			Name:          medName,
			Format:        format,
			MediaCategory: mediaCategory,
			Tracks:        tracks,
		})
	}

	// 发行版本名（LRM 规范）与包装/渠道：书籍按出版社+ISBN 走平装/精装，
	// 动画走 broadcast+box_set，音乐走 physical+jewel_case，游戏走 digital。
	packaging := "box_set"
	distChannel := "physical"
	if mediaType == "book" {
		packaging = "paperback"
	} else if mediaType == "music" {
		packaging = "jewel_case"
	} else if mediaType == "game" {
		packaging = "digital"
		distChannel = "digital"
	} else if mediaType == "tv" {
		distChannel = "mixed"
	}
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

	// Work 起止日期：infobox 放送开始/结束优先（剧集/动画），回退发售日/发售日期，
	// 最后回退顶层 date；结束缺失时 Ended 保持 false 不伪造。
	workBegin := bgmInfoboxText(data.Infobox, "放送开始", "开始", "发售日", "发售日期", "发行日期", "出版日期")
	workEnd := bgmInfoboxText(data.Infobox, "播放结束", "结束")
	if workBegin == "" {
		workBegin = strings.TrimSpace(data.Date)
	}

	// Infobox 人员兜底：v0 /subjects/{id}/persons 对书籍/音乐等类型经常为空，
	// 作者/插画/艺术家等主创只存在于 infobox 键值对——按白名单解析补齐演职员，
	// 实体类型与角色映射与 persons 链路对齐（作者→author、插画→illustrator、
	// 音乐→composer、演唱/艺术家→performer、制作→producer、出版社/发行→publisher）。
	infoboxStaffRoles := map[string][2]string{ // key -> {roleCode, entityType}
		"作者": {"author", "person"}, "原作": {"author", "person"}, "脚本": {"author", "person"}, "编剧": {"author", "person"},
		"插画": {"illustrator", "person"}, "插图": {"illustrator", "person"}, "作画": {"illustrator", "person"}, "人物设定": {"illustrator", "person"},
		"音乐": {"composer", "person"}, "作曲": {"composer", "person"}, "编曲": {"composer", "person"},
		"艺术家": {"performer", "person"}, "演唱": {"performer", "person"}, "歌手": {"performer", "person"}, "表演者": {"performer", "person"}, "主题歌演出": {"performer", "person"},
		"导演": {"director", "person"}, "监督": {"director", "person"},
		"动画制作": {"producer", "studio"}, "制作": {"producer", "studio"}, "开发商": {"producer", "studio"}, "制造商": {"producer", "studio"}, "厂商": {"producer", "studio"},
		"出版社": {"publisher", "publisher"}, "发行": {"publisher", "publisher"}, "品牌": {"publisher", "publisher"}, "唱片公司": {"publisher", "publisher"},
	}
	seenArtistNames := map[string]bool{}
	for _, a := range artists {
		if n := strings.ToLower(strings.TrimSpace(a.Name)); n != "" {
			seenArtistNames[n] = true
		}
	}
	appendInfoboxStaff := func(name, roleCode, entType string) {
		name = strings.TrimSpace(name)
		if name == "" {
			return
		}
		if seenArtistNames[strings.ToLower(name)] {
			return
		}
		seenArtistNames[strings.ToLower(name)] = true
		artists = append(artists, ArtistPreview{
			Name:       name,
			Role:       roleCode,
			EntityType: entType,
			Country:    "JP",
		})
	}
	for _, item := range data.Infobox {
		mapping, ok := infoboxStaffRoles[strings.TrimSpace(item.Key)]
		if !ok {
			continue
		}
		emitStaff := func(raw string) {
			for _, part := range strings.Split(raw, "、") {
				appendInfoboxStaff(strings.TrimSpace(part), mapping[0], mapping[1])
			}
		}
		switch val := item.Value.(type) {
		case string:
			emitStaff(val)
		case []interface{}:
			for _, sub := range val {
				if m, ok := sub.(map[string]interface{}); ok {
					if v, exists := m["v"]; exists {
						emitStaff(strings.TrimSpace(fmt.Sprintf("%v", v)))
					}
				} else {
					emitStaff(strings.TrimSpace(fmt.Sprintf("%v", sub)))
				}
			}
		}
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

	// 标签过滤：人名/工作室/角色/作品名是 Artist/Franchise 实体，不是标签。
	// 与本条目主体或任一演职员实体同名的标签在入库前剔除，避免实体词污染标签字典。
	excludeNames := map[string]bool{}
	addExcluded := func(names ...string) {
		for _, n := range names {
			if n = strings.ToLower(strings.TrimSpace(n)); n != "" {
				excludeNames[n] = true
			}
		}
	}
	addExcluded(data.Name, data.NameCN, workTitle, origTitle)
	for _, a := range artists {
		addExcluded(a.Name, a.OriginalName, a.CharacterName)
		for _, al := range a.Aliases {
			addExcluded(al)
		}
	}
	for _, al := range aliases {
		addExcluded(al)
	}
	filteredTags := make([]string, 0, len(tags))
	filteredGroups := map[string]string{}
	for _, tg := range tags {
		if !excludeNames[strings.ToLower(strings.TrimSpace(tg))] {
			filteredTags = append(filteredTags, tg)
			if g, ok := tagGroups[tg]; ok {
				filteredGroups[tg] = g
			}
		}
	}
	tags = filteredTags

	work := WorkPreview{
		Title:            workTitle,
		OriginalTitle:    origTitle,
		Aliases:          aliases,
		ReleaseDate:      data.Date,
		BeginDate:        workBegin,
		EndDate:          workEnd,
		Country:          "JP",
		Language:         "zh-CN",
		OriginalLanguage: "ja",
		Summary:          data.Summary,
		CoverImageURL:    coverURL,
		CoverAspect:      coverAspect,
		ContentRating:    "General",
		Tags:             tags,
		TagGroups:        filteredGroups,
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
		Packaging:           packaging,
		Country:             "JP",
		Language:            "ja",
		DistributionChannel: distChannel,
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

	client := security.NewSafeHTTPClient(15 * time.Second)
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

	client := security.NewSafeHTTPClient(15 * time.Second)
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
		EntityType:   models.EntityTypeVirtualCharacter,
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
