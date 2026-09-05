package openapi

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
)

func Handler() gin.HandlerFunc {
	var spec map[string]interface{}
	_ = json.Unmarshal([]byte(specJSON), &spec)
	return func(c *gin.Context) {
		c.Header("Content-Type", "application/json; charset=utf-8")
		c.Header("Access-Control-Allow-Origin", "*")
		if spec != nil {
			c.JSON(http.StatusOK, spec)
			return
		}
		var m map[string]interface{}
		if err := json.Unmarshal([]byte(specJSON), &m); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, m)
	}
}

const specJSON = `{
  "openapi": "3.1.0",
  "info": {
    "title": "MetaFusion API",
    "version": "1.0.0",
    "description": "MusicBrainz WS/2 inspired FRBR archive API. Metadata open, media authenticated. Full web parity for apps and agents."
  },
  "servers": [{ "url": "/api/v1" }],
  "paths": {
    "/auth/tokens": {
      "get": { "tags": ["auth"], "summary": "List PATs" },
      "post": { "tags": ["auth"], "summary": "Create PAT" }
    },
    "/catalog/works": { "get": { "tags": ["lookup"], "summary": "List works" } },
    "/catalog/works/{id}": { "get": { "tags": ["lookup"], "summary": "Work detail inc=releases+relations" } },
    "/catalog/works/{id}/contents": { "get": { "tags": ["lookup"], "summary": "Work content directory" } },
    "/catalog/canonical-entries": {
      "get": { "tags": ["lookup"], "summary": "List canonical content entries" },
      "post": { "tags": ["catalog"], "summary": "Create a canonical content entry" }
    },
    "/catalog/canonical-entries/{id}": { "put": { "tags": ["catalog"], "summary": "Update a canonical content entry" } },
    "/catalog/mediums": { "post": { "tags": ["catalog"], "summary": "Create a medium" } },
    "/catalog/mediums/{id}": { "put": { "tags": ["catalog"], "summary": "Update a medium" } },
    "/catalog/tracks": { "post": { "tags": ["catalog"], "summary": "Create a carrier track" } },
    "/catalog/tracks/{id}": { "put": { "tags": ["catalog"], "summary": "Update a carrier track" } },
    "/browse/works": { "get": { "tags": ["browse"], "summary": "Browse works" } },
    "/search": { "get": { "tags": ["search"], "summary": "Search" } }
  }
}`
