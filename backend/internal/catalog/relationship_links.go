package catalog

import (
	"context"
	"encoding/json"
	"fmt"
)

// EntityLink is a read-only projection of one canonical structural or semantic
// fact. Its key is stable for rendering, but only relation: keys are writable
// relation UUIDs; callers edit fixed links through their owning entity.
type EntityLink struct {
	Key        string         `json:"key"`
	RuleCode   string         `json:"rule_code"`
	Class      string         `json:"class"`
	Direction  string         `json:"direction"`
	SourceID   string         `json:"source_id"`
	TargetID   string         `json:"target_id"`
	Position   int            `json:"position"`
	Role       string         `json:"role,omitempty"`
	Locator    Locator        `json:"locator,omitempty"`
	Attributes map[string]any `json:"attributes,omitempty"`
}

type EntityLinksPage struct {
	SubjectID      string            `json:"subject_id"`
	DefinitionETag string            `json:"definition_etag"`
	Items          []EntityLink      `json:"items"`
	Entities       map[string]Entity `json:"entities"`
	Limit          int               `json:"limit"`
	Offset         int               `json:"offset"`
	HasMore        bool              `json:"has_more"`
}

// Each branch reads the existing source of truth. The endpoint never persists
// copies of these edges in catalog.relations or a second structural table.
const fixedEntityLinksSQL = `
SELECT code, source_id::text, target_id::text, position, role, locator, attributes FROM (
 SELECT 'structure:work_content_unit' AS code, x.work_id AS source_id, x.id AS target_id,
  coalesce((e.document->>'position')::int,0) AS position, ''::text AS role, '{}'::jsonb AS locator, '{}'::jsonb AS attributes
  FROM catalog.content_units x JOIN catalog.entities e ON e.id=x.id WHERE x.work_id=$1::uuid OR x.id=$1::uuid
 UNION ALL
 SELECT 'structure:work_expression', x.work_id, x.id, coalesce((e.document->>'position')::int,0), '', '{}'::jsonb, '{}'::jsonb
  FROM catalog.expressions x JOIN catalog.entities e ON e.id=x.id WHERE x.work_id=$1::uuid OR x.id=$1::uuid
 UNION ALL
 SELECT 'structure:release_medium', x.release_id, x.id, coalesce((e.document->>'position')::int,0), '', '{}'::jsonb, '{}'::jsonb
  FROM catalog.mediums x JOIN catalog.entities e ON e.id=x.id WHERE x.release_id=$1::uuid OR x.id=$1::uuid
 UNION ALL
 SELECT 'structure:medium_track', x.medium_id, x.id, coalesce((e.document->>'position')::int,0), '', '{}'::jsonb, '{}'::jsonb
  FROM catalog.tracks x JOIN catalog.entities e ON e.id=x.id WHERE x.medium_id=$1::uuid OR x.id=$1::uuid
 UNION ALL
 SELECT 'structure:content_unit_parent', x.parent_id, x.id, coalesce((e.document->>'position')::int,0), '', '{}'::jsonb, '{}'::jsonb
  FROM catalog.content_units x JOIN catalog.entities e ON e.id=x.id WHERE x.parent_id IS NOT NULL AND (x.parent_id=$1::uuid OR x.id=$1::uuid)
 UNION ALL
 SELECT 'structure:content_unit_expression', x.content_unit_id, x.id, coalesce((e.document->>'position')::int,0), '', '{}'::jsonb, '{}'::jsonb
  FROM catalog.expressions x JOIN catalog.entities e ON e.id=x.id WHERE x.content_unit_id IS NOT NULL AND (x.content_unit_id=$1::uuid OR x.id=$1::uuid)
 UNION ALL
 SELECT 'structure:medium_parent', x.parent_id, x.id, coalesce((e.document->>'position')::int,0), '', '{}'::jsonb, '{}'::jsonb
  FROM catalog.mediums x JOIN catalog.entities e ON e.id=x.id WHERE x.parent_id IS NOT NULL AND (x.parent_id=$1::uuid OR x.id=$1::uuid)
 UNION ALL
 SELECT 'structure:track_parent', x.parent_id, x.id, coalesce((e.document->>'position')::int,0), '', '{}'::jsonb, '{}'::jsonb
  FROM catalog.tracks x JOIN catalog.entities e ON e.id=x.id WHERE x.parent_id IS NOT NULL AND (x.parent_id=$1::uuid OR x.id=$1::uuid)
 UNION ALL
 SELECT 'structure:release_subject', x.release_id, x.work_id, x.position, x.role, '{}'::jsonb, x.attributes
  FROM catalog.release_subjects x WHERE x.release_id=$1::uuid OR x.work_id=$1::uuid
 UNION ALL
 SELECT 'structure:track_content', x.track_id, x.expression_id, x.position, '', x.locator, x.attributes
  FROM catalog.track_contents x WHERE x.track_id=$1::uuid OR x.expression_id=$1::uuid
) links`

// Both endpoint visibility checks run before pagination. Semantic links are
// limited to actual endpoints; /relations also includes attribute references.
const entityLinksPageSQL = `
SELECT l.code, l.source_id::text, l.target_id::text, l.position, l.role,
 l.locator, l.attributes, l.relation_id, l.relation_document
FROM (
 SELECT f.*, ''::text AS relation_id, NULL::jsonb AS relation_document
 FROM (` + fixedEntityLinksSQL + `) f
 UNION ALL
 SELECT 'relation:' || r.type, r.source_id::text, r.target_id::text,
  coalesce((r.document->>'position')::int,0), ''::text, '{}'::jsonb,
  coalesce(r.document->'attributes','{}'::jsonb), r.id::text, r.document
 FROM catalog.relations r WHERE r.source_id=$1::uuid OR r.target_id=$1::uuid
) l
JOIN catalog.entities source ON source.id=l.source_id::uuid
JOIN catalog.entities target ON target.id=l.target_id::uuid
WHERE ($2::boolean OR source.status='published' OR source.created_by=$3::uuid)
 AND ($2::boolean OR target.status='published' OR target.created_by=$3::uuid)
ORDER BY l.code, l.position, l.source_id, l.target_id, l.role, l.relation_id
LIMIT $4 OFFSET $5`

func (s *Store) EntityLinks(ctx context.Context, id string, limit, offset int, u *User) (EntityLinksPage, error) {
	page := EntityLinksPage{SubjectID: id, Items: []EntityLink{}, Entities: map[string]Entity{}, Limit: limit, Offset: offset}
	self, err := s.Get(ctx, id, u)
	if err != nil {
		return page, err
	}
	id = self.ID
	page.SubjectID = id
	defs, err := s.Definitions(ctx)
	if err != nil {
		return page, err
	}
	page.DefinitionETag = defs.ETag
	page.Entities[id] = self
	manage := u != nil && u.Can(PermissionLifecycleManage)
	userID := "00000000-0000-0000-0000-000000000000"
	if u != nil {
		userID = u.ID
	}
	// Apply the same historical relation-attribute check as /relations.
	// Scan bounded database windows because rejected old relations must not
	// consume a visible page slot.
	const window = 200
	seen, dbOffset := 0, 0
	for len(page.Items) <= limit {
		rows, err := s.DB.QueryContext(ctx, entityLinksPageSQL, id, manage, userID, window, dbOffset)
		if err != nil {
			return page, err
		}
		type candidate struct {
			link        EntityLink
			relationID  string
			relationDoc []byte
		}
		candidates := make([]candidate, 0, window)
		for rows.Next() {
			var link EntityLink
			var loc, attrs, relationDoc []byte
			var relationID string
			if err = rows.Scan(&link.RuleCode, &link.SourceID, &link.TargetID, &link.Position, &link.Role, &loc, &attrs, &relationID, &relationDoc); err != nil {
				rows.Close()
				return page, err
			}
			if err = json.Unmarshal(loc, &link.Locator); err != nil {
				rows.Close()
				return page, err
			}
			if err = json.Unmarshal(attrs, &link.Attributes); err != nil {
				rows.Close()
				return page, err
			}
			candidates = append(candidates, candidate{link, relationID, relationDoc})
		}
		if err = rows.Err(); err != nil {
			rows.Close()
			return page, err
		}
		rows.Close()
		for _, candidate := range candidates {
			link, relationID, relationDoc := candidate.link, candidate.relationID, candidate.relationDoc
			if relationID != "" {
				var relation Relation
				if err = json.Unmarshal(relationDoc, &relation); err != nil {
					return page, err
				}
				if rule, ok := defs.Document.Relations[relation.Type]; ok {
					if defs.Document.attributes(rule.Fields, relation.Attributes, reference(ctx, s.DB, u), true) != nil {
						continue
					}
				}
				link.Class, link.Key = "semantic", relationID
			} else {
				var ok bool
				link.Class, ok = fixedLinkClass(link.RuleCode)
				if !ok {
					return page, fmt.Errorf("unknown fixed relationship rule: %s", link.RuleCode)
				}
				link.Key = fixedLinkKey(link)
			}
			if link.SourceID == id {
				link.Direction = "outgoing"
			} else {
				link.Direction = "incoming"
			}
			if seen >= offset {
				page.Items = append(page.Items, link)
			}
			seen++
			if len(page.Items) > limit {
				page.HasMore = true
				page.Items = page.Items[:limit]
				break
			}
		}
		if page.HasMore || len(candidates) < window {
			break
		}
		dbOffset += len(candidates)
	}
	ids := make([]string, 0, len(page.Items)*2)
	for _, link := range page.Items {
		ids = append(ids, link.SourceID, link.TargetID)
	}
	peers, err := s.GetManyVisible(ctx, ids, u)
	if err != nil {
		return page, err
	}
	// Guard against a visibility change between the SQL page and endpoint fetch.
	filtered := page.Items[:0]
	for _, link := range page.Items {
		source, sourceOK := peers[link.SourceID]
		target, targetOK := peers[link.TargetID]
		if !sourceOK || !targetOK {
			continue
		}
		filtered = append(filtered, link)
		page.Entities[link.SourceID] = source
		page.Entities[link.TargetID] = target
	}
	page.Items = filtered
	return page, nil
}

func fixedLinkClass(code string) (string, bool) {
	for _, rule := range fixedRelationshipRules() {
		if rule.Code == code {
			return rule.Class, true
		}
	}
	return "", false
}

func fixedLinkKey(link EntityLink) string {
	key := link.RuleCode + ":" + link.SourceID + ":" + link.TargetID
	switch link.RuleCode {
	case "structure:release_subject":
		return key + ":" + link.Role // primary key includes role
	case "structure:track_content":
		return fmt.Sprintf("%s:%s:%d", link.RuleCode, link.SourceID, link.Position) // primary key is track + position
	default:
		return key // moving a sibling does not change the edge's identity
	}
}
