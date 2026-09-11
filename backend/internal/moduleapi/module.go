// Package moduleapi is the stable boundary for optional modules; it has no ORM dependencies.
package moduleapi

import (
	"context"
	"encoding/json"
)

type Principal struct {
	ID   string `json:"id"`
	Username string `json:"username,omitempty"`
	Role string `json:"role"`
}
type Entity struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Title      string `json:"title"`
	RedirectID string `json:"redirect_id,omitempty"`
	Status     string `json:"status"`
}
type Catalog interface {
	Lookup(context.Context, string, *Principal) (Entity, error)
	// LookupMany 批量取实体元信息（仅返回调用方可见者），供外围系统在不直接
	// 访问 catalog 表的前提下补齐标题/类型等展示数据。
	LookupMany(context.Context, []string, *Principal) (map[string]Entity, error)
	// RelatedEntities 返回该实体的邻居中属于指定 kind 的实体（仅可见者），
	// 供外围系统获取"关联合集"等而不直接 JOIN catalog.relations。
	RelatedEntities(context.Context, string, []string, *Principal) ([]Entity, error)
	Authenticate(context.Context, string) (Principal, error)
	Export(context.Context, string, *Principal) (json.RawMessage, error)
	Submit(context.Context, json.RawMessage, Principal) (json.RawMessage, error)
}
type Manifest struct {
	ID           string            `json:"id"`
	Version      string            `json:"version"`
	Dependencies map[string]string `json:"dependencies"`
	Enabled      bool              `json:"enabled"`
	Healthy      bool              `json:"healthy"`
}
