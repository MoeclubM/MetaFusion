package search

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/metafusion/metafusion-app/internal/config"
	"github.com/metafusion/metafusion-app/internal/models"
	opensearch "github.com/opensearch-project/opensearch-go/v2"
	"github.com/opensearch-project/opensearch-go/v2/opensearchapi"
	"gorm.io/gorm"
)

const IndexWorks = "metafusion_works"

type SearchService struct {
	os  *opensearch.Client
	db  *gorm.DB
	cfg *config.Config
}

func NewSearchService(cfg *config.Config, db *gorm.DB) (*SearchService, error) {
	osClient, err := opensearch.NewClient(opensearch.Config{
		Addresses: []string{cfg.ElasticURL},
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
	})
	if err != nil {
		return nil, err
	}

	service := &SearchService{os: osClient, db: db, cfg: cfg}
	_ = service.ensureIndex(context.Background())
	go func() {
		_ = service.ReindexAll(context.Background())
	}()
	return service, nil
}

// ReindexAll 将数据库中所有作品全量同步至 OpenSearch 索引
func (s *SearchService) ReindexAll(ctx context.Context) error {
	if s.db == nil {
		return nil
	}
	var works []models.Work
	if err := s.db.Preload("Translations").Preload("Tags").Find(&works).Error; err != nil {
		log.Printf("Failed to load works for OpenSearch reindex: %v", err)
		return err
	}
	count := 0
	for _, w := range works {
		workCopy := w
		if err := s.IndexWorkDoc(ctx, &workCopy); err == nil {
			count++
		}
	}
	log.Printf("Successfully indexed %d/%d works into OpenSearch", count, len(works))
	return nil
}

func (s *SearchService) ensureIndex(ctx context.Context) error {
	res, err := s.os.Indices.Exists([]string{IndexWorks})
	if err != nil {
		log.Printf("OpenSearch index check notice: %v", err)
		return nil
	}
	if res.StatusCode == 404 {
		mapping := `{
			"settings": {
				"number_of_shards": 1,
				"number_of_replicas": 0
			},
			"mappings": {
				"properties": {
					"id": { "type": "keyword" },
					"title": { "type": "text", "analyzer": "standard" },
					"original_title": { "type": "text" },
					"aliases": { "type": "text" },
					"translated_titles": { "type": "text" },
					"media_type": { "type": "keyword" },
					"category_code": { "type": "keyword" },
					"summary": { "type": "text" },
					"release_year": { "type": "integer" },
					"tags": { "type": "keyword" },
					"created_at": { "type": "date" }
				}
			}
		}`
		req := opensearchapi.IndicesCreateRequest{
			Index: IndexWorks,
			Body:  strings.NewReader(mapping),
		}
		_, err := req.Do(ctx, s.os)
		if err != nil {
			log.Printf("Failed to create OpenSearch index: %v", err)
		} else {
			log.Println("OpenSearch index created successfully.")
		}
	}
	return nil
}

// IndexWorkDoc 异步将作品编目索引至 OpenSearch，含多语言标题提取
func (s *SearchService) IndexWorkDoc(ctx context.Context, work *models.Work) error {
	tags := make([]string, len(work.Tags))
	for i, t := range work.Tags {
		tags[i] = t.Name
	}

	year := 0
	if work.ReleaseDate != nil {
		year = work.ReleaseDate.Year()
	}

	// 提取全部多语言标题与摘要
	var translatedTitles []string
	if len(work.Translations) > 0 {
		for _, tr := range work.Translations {
			if strings.TrimSpace(tr.Title) != "" {
				translatedTitles = append(translatedTitles, strings.TrimSpace(tr.Title))
			}
		}
	} else if s.db != nil {
		var trs []models.WorkTranslation
		if err := s.db.Where("work_id = ?", work.ID).Find(&trs).Error; err == nil {
			for _, tr := range trs {
				if strings.TrimSpace(tr.Title) != "" {
					translatedTitles = append(translatedTitles, strings.TrimSpace(tr.Title))
				}
			}
		}
	}

	doc := map[string]interface{}{
		"id":                work.ID.String(),
		"title":             work.Title,
		"original_title":    work.OriginalTitle,
		"aliases":           work.Aliases,
		"translated_titles": translatedTitles,
		"summary":           work.Summary,
		"release_year":      year,
		"tags":              tags,
		"created_at":        work.CreatedAt,
	}

	data, err := json.Marshal(doc)
	if err != nil {
		return err
	}

	req := opensearchapi.IndexRequest{
		Index:      IndexWorks,
		DocumentID: work.ID.String(),
		Body:       bytes.NewReader(data),
		Refresh:    "true",
	}
	res, err := req.Do(ctx, s.os)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	return nil
}

// DeleteWorkDoc 从 OpenSearch 索引中删除指定作品文档
func (s *SearchService) DeleteWorkDoc(ctx context.Context, workID uuid.UUID) error {
	req := opensearchapi.DeleteRequest{
		Index:      IndexWorks,
		DocumentID: workID.String(),
		Refresh:    "true",
	}
	res, err := req.Do(ctx, s.os)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	return nil
}

// SearchWorks 执行多维检索与 Facet 聚合 — MusicBrainz 搜索对等
// 支持 ?type=work|artist|release|franchise|all&q=&limit=&offset=，游客开放
func (s *SearchService) SearchWorks(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	if q == "" {
		q = strings.TrimSpace(c.Query("query"))
	}
	typ := c.DefaultQuery("type", "work")
	if typ == "" {
		typ = "work"
	}
	limitStr := c.DefaultQuery("limit", "25")
	offsetStr := c.DefaultQuery("offset", "0")
	limit, _ := strconv.Atoi(limitStr)
	offset, _ := strconv.Atoi(offsetStr)
	if limit < 1 || limit > 100 {
		limit = 25
	}
	if offset < 0 {
		offset = 0
	}

	// 专类搜索：artist/release/franchise 直查 SQL
	if typ == "franchise" {
		var franchises []models.Franchise
		like := "%" + q + "%"
		dbq := s.db.Model(&models.Franchise{}).
			Joins("LEFT JOIN franchise_translations ON franchise_translations.franchise_id = franchises.id").
			Where("franchises.title ILIKE ? OR franchises.original_title ILIKE ? OR franchises.disambiguation ILIKE ? OR array_to_string(franchises.aliases, ' ') ILIKE ? OR franchise_translations.title ILIKE ?", like, like, like, like, like).
			Distinct()
		var total int64
		dbq.Count(&total)
		dbq.Preload("Translations").Offset(offset).Limit(limit).Find(&franchises)
		c.JSON(http.StatusOK, gin.H{"type": "franchise", "items": franchises, "total": total, "limit": limit, "offset": offset, "query": q})
		return
	}
	if typ == "artist" {
		var artists []models.Artist
		like := "%" + q + "%"
		dbq := s.db.Model(&models.Artist{}).
			Joins("LEFT JOIN artist_translations ON artist_translations.artist_id = artists.id").
			Where("artists.name ILIKE ? OR artists.original_name ILIKE ? OR artists.disambiguation ILIKE ? OR artist_translations.name ILIKE ?", like, like, like, like).
			Distinct()
		var total int64
		dbq.Count(&total)
		dbq.Preload("Translations").Offset(offset).Limit(limit).Find(&artists)
		c.JSON(http.StatusOK, gin.H{"type": "artist", "items": artists, "total": total, "limit": limit, "offset": offset, "query": q})
		return
	}
	if typ == "release" {
		var releases []models.Release
		like := "%" + q + "%"
		dbq := s.db.Model(&models.Release{}).Where("edition_name ILIKE ? OR publisher ILIKE ? OR catalog_number ILIKE ?", like, like, like)
		var total int64
		dbq.Count(&total)
		dbq.Preload("Work").Preload("Work.Translations").Offset(offset).Limit(limit).Find(&releases)
		c.JSON(http.StatusOK, gin.H{"type": "release", "items": releases, "total": total, "limit": limit, "offset": offset, "query": q})
		return
	}
	if typ == "all" {
		like := "%" + q + "%"
		var works []models.Work
		var artists []models.Artist
		var releases []models.Release
		var franchises []models.Franchise
		s.db.Model(&models.Work{}).
			Joins("LEFT JOIN work_translations ON work_translations.work_id = works.id").
			Where("works.title ILIKE ? OR works.original_title ILIKE ? OR ? = ANY(works.aliases) OR work_translations.title ILIKE ?", like, like, q, like).
			Distinct().Preload("Translations").Preload("Tags").Limit(limit).Find(&works)

		s.db.Model(&models.Artist{}).
			Joins("LEFT JOIN artist_translations ON artist_translations.artist_id = artists.id").
			Where("artists.name ILIKE ? OR artists.original_name ILIKE ? OR artist_translations.name ILIKE ?", like, like, like).
			Distinct().Preload("Translations").Limit(limit).Find(&artists)

		s.db.Where("edition_name ILIKE ? OR publisher ILIKE ?", like, like).Preload("Work").Preload("Work.Translations").Limit(limit).Find(&releases)

		s.db.Model(&models.Franchise{}).
			Joins("LEFT JOIN franchise_translations ON franchise_translations.franchise_id = franchises.id").
			Where("franchises.title ILIKE ? OR franchises.original_title ILIKE ? OR array_to_string(franchises.aliases, ' ') ILIKE ? OR franchise_translations.title ILIKE ?", like, like, like, like).
			Distinct().Preload("Translations").Limit(limit).Find(&franchises)

		c.JSON(http.StatusOK, gin.H{"type": "all", "works": works, "artists": artists, "releases": releases, "franchises": franchises, "query": q})
		return
	}

	// 默认 work 搜索走 OpenSearch
	// 构建 OpenSearch 多字段模糊检索与过滤
	var mustClauses []map[string]interface{}
	if q != "" {
		mustClauses = append(mustClauses, map[string]interface{}{
			"multi_match": map[string]interface{}{
				"query":     q,
				"fields":    []string{"title^4", "translated_titles^3", "original_title^2", "aliases^2", "summary"},
				"fuzziness": "AUTO",
			},
		})
	} else {
		mustClauses = append(mustClauses, map[string]interface{}{
			"match_all": map[string]interface{}{},
		})
	}

	queryBody := map[string]interface{}{
		"query": map[string]interface{}{
			"bool": map[string]interface{}{
				"must": mustClauses,
			},
		},
		"aggs": map[string]interface{}{
			"tags": map[string]interface{}{
				"terms": map[string]interface{}{"field": "tags", "size": 20},
			},
		},
		"from": offset,
		"size": limit,
	}

	bodyBytes, _ := json.Marshal(queryBody)
	res, err := s.os.Search(
		s.os.Search.WithContext(c.Request.Context()),
		s.os.Search.WithIndex(IndexWorks),
		s.os.Search.WithBody(bytes.NewReader(bodyBytes)),
		s.os.Search.WithTrackTotalHits(true),
	)

	if err != nil {
		// 若 OpenSearch 服务离线则回退至 PostgreSQL ILIKE + work_translations 联合检索
		log.Printf("OpenSearch search degraded to SQL: %v", err)
		var works []models.Work
		like := "%" + q + "%"
		dbq := s.db.Model(&models.Work{}).
			Joins("LEFT JOIN work_translations ON work_translations.work_id = works.id").
			Where("works.title ILIKE ? OR works.original_title ILIKE ? OR ? = ANY(works.aliases) OR work_translations.title ILIKE ?", like, like, q, like).
			Distinct()
		var total int64
		dbq.Count(&total)
		dbq.Preload("Translations").Preload("Tags").Offset(offset).Limit(limit).Find(&works)
		c.JSON(http.StatusOK, gin.H{"type": "work", "items": works, "total": total, "limit": limit, "offset": offset, "query": q, "degraded": true})
		return
	}
	defer res.Body.Close()

	var result map[string]interface{}
	if err := json.NewDecoder(res.Body).Decode(&result); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	ids, total := parseOSHitIDs(result)
	works := s.loadWorksByIDs(ids)
	c.JSON(http.StatusOK, gin.H{
		"type":         "work",
		"items":        works,
		"total":        total,
		"limit":        limit,
		"offset":       offset,
		"query":        q,
		"aggregations": result["aggregations"],
	})
}

func parseOSHitIDs(result map[string]interface{}) (ids []string, total int64) {
	hitsWrap, _ := result["hits"].(map[string]interface{})
	if hitsWrap == nil {
		return nil, 0
	}
	switch tv := hitsWrap["total"].(type) {
	case float64:
		total = int64(tv)
	case map[string]interface{}:
		if v, ok := tv["value"].(float64); ok {
			total = int64(v)
		}
	}
	arr, _ := hitsWrap["hits"].([]interface{})
	for _, raw := range arr {
		h, _ := raw.(map[string]interface{})
		if h == nil {
			continue
		}
		id := ""
		if src, ok := h["_source"].(map[string]interface{}); ok {
			if s, ok := src["id"].(string); ok {
				id = s
			}
		}
		if id == "" {
			if s, ok := h["_id"].(string); ok {
				id = s
			}
		}
		if id != "" {
			ids = append(ids, id)
		}
	}
	return ids, total
}

func (s *SearchService) loadWorksByIDs(ids []string) []models.Work {
	if len(ids) == 0 {
		return []models.Work{}
	}
	var works []models.Work
	s.db.Preload("Translations").Preload("Tags").Where("id IN ?", ids).Find(&works)
	byID := make(map[string]models.Work, len(works))
	for _, w := range works {
		byID[w.ID.String()] = w
	}
	out := make([]models.Work, 0, len(ids))
	for _, id := range ids {
		if w, ok := byID[id]; ok {
			out = append(out, w)
		}
	}
	return out
}
