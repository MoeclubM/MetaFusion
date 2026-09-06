// Package moduleapi is the stable boundary for optional modules; it has no ORM dependencies.
package moduleapi

import (
	"context"
	"encoding/json"
)

type Principal struct {
	ID   string `json:"id"`
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
