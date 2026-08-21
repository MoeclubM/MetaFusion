package search

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	elasticsearch8 "github.com/elastic/go-elasticsearch/v8"
	"github.com/elastic/go-elasticsearch/v8/esapi"
	"github.com/gin-gonic/gin"
	"github.com/metafusion/metafusion-app/internal/config"
	"github.com/metafusion/metafusion-app/internal/models"
	"gorm.io/gorm"
)

const IndexWorks = "metafusion_works"

type SearchService struct {
	es  *elasticsearch8.Client
	db  *gorm.DB
	cfg *config.Config
}

func NewSearchService(cfg *config.Config, db *gorm.DB) (*SearchService, error) {
	es, err := elasticsearch8.NewClient(elasticsearch8.Config{
		Addresses: []string{cfg.ElasticURL},
	})
	if err != nil {
		return nil, err
	}

	service := &SearchService{es: es, db: db, cfg: cfg}
	_ = service.ensureIndex(context.Background())
	return service, nil
}

func (s *SearchService) ensureIndex(ctx context.Context) error {
	res, err := s.es.Indices.Exists([]string{IndexWorks})
	if err != nil {
		log.Printf("Elasticsearch index check notice: %v", err)
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
					"media_type": { "type": "keyword" },
					"category_code": { "type": "keyword" },
					"summary": { "type": "text" },
					"release_year": { "type": "integer" },
					"tags": { "type": "keyword" },
					"created_at": { "type": "date" }
				}
			}
		}`
		req := esapi.IndicesCreateRequest{
			Index: IndexWorks,
			Body:  bytes.NewReader([]byte(mapping)),
		}
		_, err := req.Do(ctx, s.es)
		if err != nil {
			log.Printf("Failed to create ES index: %v", err)
		} else {
			log.Println("Elasticsearch index created successfully.")
		}
	}
	return nil
}

// IndexWorkDoc 异步将作品编目索引至 Elasticsearch
func (s *SearchService) IndexWorkDoc(ctx context.Context, work *models.Work) error {
	tags := make([]string, len(work.Tags))
	for i, t := range work.Tags {
		tags[i] = t.Name
	}

	year := 0
	if work.ReleaseDate != nil {
		year = work.ReleaseDate.Year()
	}

	doc := map[string]interface{}{
		"id":             work.ID.String(),
		"title":          work.Title,
		"original_title": work.OriginalTitle,
		"aliases":        work.Aliases,
		"media_type":     work.MediaType,
		"category_code":  work.CategoryCode,
		"summary":        work.Summary,
		"release_year":   year,
		"tags":           tags,
		"created_at":     work.CreatedAt,
	}

	data, err := json.Marshal(doc)
	if err != nil {
		return err
	}

	req := esapi.IndexRequest{
		Index:      IndexWorks,
		DocumentID: work.ID.String(),
		Body:       bytes.NewReader(data),
		Refresh:    "true",
	}
	res, err := req.Do(ctx, s.es)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	return nil
}

// SearchWorks 执行多维检索与 Facet 聚合 — MusicBrainz 搜索对等
// 支持 ?type=work|artist|release|all&q=&limit=&offset=，游客开放
func (s *SearchService) SearchWorks(c *gin.Context) {
	q := c.Query("q")
	if q == "" {
		q = c.Query("query")
	}
	typ := c.DefaultQuery("type", "work")
	if typ == "" {
		typ = "work"
	}
	mediaType := c.Query("media_type")
	categoryCode := c.Query("category_code")
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

	// 专类搜索：artist/release 直查 SQL，work 走 ES 优先
	if typ == "artist" {
		var artists []models.Artist
		like := "%" + q + "%"
		dbq := s.db.Model(&models.Artist{}).Where("name ILIKE ? OR original_name ILIKE ? OR disambiguation ILIKE ?", like, like, like)
		var total int64
		dbq.Count(&total)
		dbq.Offset(offset).Limit(limit).Find(&artists)
		c.JSON(http.StatusOK, gin.H{"type": "artist", "items": artists, "total": total, "limit": limit, "offset": offset, "query": q})
		return
	}
	if typ == "release" {
		var releases []models.Release
		like := "%" + q + "%"
		dbq := s.db.Model(&models.Release{}).Where("edition_name ILIKE ? OR publisher ILIKE ? OR catalog_number ILIKE ?", like, like, like)
		var total int64
		dbq.Count(&total)
		dbq.Preload("Work").Offset(offset).Limit(limit).Find(&releases)
		c.JSON(http.StatusOK, gin.H{"type": "release", "items": releases, "total": total, "limit": limit, "offset": offset, "query": q})
		return
	}
	if typ == "all" {
		like := "%" + q + "%"
		var works []models.Work
		var artists []models.Artist
		var releases []models.Release
		s.db.Where("title ILIKE ? OR original_title ILIKE ?", like, like).Limit(limit).Find(&works)
		s.db.Where("name ILIKE ? OR original_name ILIKE ?", like, like).Limit(limit).Find(&artists)
		s.db.Where("edition_name ILIKE ? OR publisher ILIKE ?", like, like).Preload("Work").Limit(limit).Find(&releases)
		c.JSON(http.StatusOK, gin.H{"type": "all", "works": works, "artists": artists, "releases": releases, "query": q})
		return
	}

	// 默认 work 搜索走 ES
	// 构建 ES 多字段模糊检索与过滤
	var mustClauses []map[string]interface{}
	if q != "" {
		mustClauses = append(mustClauses, map[string]interface{}{
			"multi_match": map[string]interface{}{
				"query":     q,
				"fields":    []string{"title^3", "original_title^2", "aliases", "summary"},
				"fuzziness": "AUTO",
			},
		})
	} else {
		mustClauses = append(mustClauses, map[string]interface{}{
			"match_all": map[string]interface{}{},
		})
	}

	var filterClauses []map[string]interface{}
	if mediaType != "" {
		filterClauses = append(filterClauses, map[string]interface{}{
			"term": map[string]interface{}{"media_type": mediaType},
		})
	}
	if categoryCode != "" {
		filterClauses = append(filterClauses, map[string]interface{}{
			"term": map[string]interface{}{"category_code": categoryCode},
		})
	}

	queryBody := map[string]interface{}{
		"query": map[string]interface{}{
			"bool": map[string]interface{}{
				"must":   mustClauses,
				"filter": filterClauses,
			},
		},
		"aggs": map[string]interface{}{
			"media_types": map[string]interface{}{
				"terms": map[string]interface{}{"field": "media_type"},
			},
			"categories": map[string]interface{}{
				"terms": map[string]interface{}{"field": "category_code"},
			},
			"tags": map[string]interface{}{
				"terms": map[string]interface{}{"field": "tags", "size": 20},
			},
		},
		"from": offset,
		"size": limit,
	}

	bodyBytes, _ := json.Marshal(queryBody)
	res, err := s.es.Search(
		s.es.Search.WithContext(c.Request.Context()),
		s.es.Search.WithIndex(IndexWorks),
		s.es.Search.WithBody(bytes.NewReader(bodyBytes)),
		s.es.Search.WithTrackTotalHits(true),
	)

	if err != nil {
		// 若 ES 服务离线则回退至 PostgreSQL ILIKE
		log.Printf("ES search degraded to SQL: %v", err)
		var works []models.Work
		like := "%" + q + "%"
		dbq := s.db.Model(&models.Work{}).Where("title ILIKE ? OR original_title ILIKE ? OR ? = ANY(aliases)", like, like, q)
		if mediaType != "" {
			dbq = dbq.Where("media_type = ?", mediaType)
		}
		if categoryCode != "" {
			dbq = dbq.Where("category_code = ?", categoryCode)
		}
		var total int64
		dbq.Count(&total)
		dbq.Offset(offset).Limit(limit).Find(&works)
		c.JSON(http.StatusOK, gin.H{"type": "work", "items": works, "total": total, "limit": limit, "offset": offset, "query": q, "degraded": true})
		return
	}
	defer res.Body.Close()

	var result map[string]interface{}
	if err := json.NewDecoder(res.Body).Decode(&result); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}
