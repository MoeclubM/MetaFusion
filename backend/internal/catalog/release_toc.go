package catalog

import (
	"context"
	"database/sql"
	"fmt"
	"sort"

	"github.com/google/uuid"
)

// ReleaseTOC 在一次一致性读取中装配发行、载体、曲目和被收录的表达。
// 每个实体自带 version；客户端编辑仍使用各实体的 expected_version。
type ReleaseTOC struct {
	Release           Entity             `json:"release"`
	Media             []ReleaseTOCMedium `json:"media"`
	Expressions       map[string]Entity  `json:"expressions"`
	DefinitionVersion int64              `json:"definition_version"`
}

type ReleaseTOCMedium struct {
	Medium Entity   `json:"medium"`
	Tracks []Entity `json:"tracks"`
}

func (s *Store) ReleaseTableOfContents(ctx context.Context, id string, u *User) (ReleaseTOC, error) {
	var out ReleaseTOC
	if _, err := uuid.Parse(id); err != nil {
		return out, fmt.Errorf("invalid_id")
	}
	tx, err := s.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()

	release, err := get(ctx, tx, id)
	if err != nil {
		return out, err
	}
	if !visible(release, u) {
		return out, sql.ErrNoRows
	}
	if release.Kind != "release" {
		return out, fmt.Errorf("not_release")
	}
	out.Release = release
	if err = tx.QueryRowContext(ctx, "SELECT id FROM catalog.definitions WHERE state='published'").Scan(&out.DefinitionVersion); err != nil {
		return out, err
	}

	rows, err := tx.QueryContext(ctx, `SELECT m.id::text,coalesce(t.id::text,'')
		FROM catalog.mediums m LEFT JOIN catalog.tracks t ON t.medium_id=m.id
		WHERE m.release_id=$1`, id)
	if err != nil {
		return out, err
	}
	mediumIDs := []string{}
	trackIDs := []string{}
	seenMedium := map[string]bool{}
	for rows.Next() {
		var mediumID, trackID string
		if err = rows.Scan(&mediumID, &trackID); err != nil {
			rows.Close()
			return out, err
		}
		if !seenMedium[mediumID] {
			seenMedium[mediumID] = true
			mediumIDs = append(mediumIDs, mediumID)
		}
		if trackID != "" {
			trackIDs = append(trackIDs, trackID)
		}
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return out, err
	}
	rows.Close()

	ids := append(mediumIDs, trackIDs...)
	children, err := getManyFrom(ctx, tx, ids, u)
	if err != nil {
		return out, err
	}
	expressionIDs := []string{}
	for _, trackID := range trackIDs {
		track, ok := children[trackID]
		if !ok || track.Kind != "track" {
			continue
		}
		if medium, ok := children[track.MediumID]; !ok || medium.Kind != "medium" {
			continue
		}
		for _, content := range track.Contents {
			expressionIDs = append(expressionIDs, content.ExpressionID)
		}
	}
	out.Expressions, err = getManyFrom(ctx, tx, expressionIDs, u)
	if err != nil {
		return out, err
	}
	out.Media = []ReleaseTOCMedium{}
	tracksByMedium := map[string][]Entity{}
	for _, mediumID := range mediumIDs {
		medium, ok := children[mediumID]
		if !ok || medium.Kind != "medium" {
			continue
		}
		tracksByMedium[mediumID] = []Entity{}
	}
	for _, trackID := range trackIDs {
		track, ok := children[trackID]
		if !ok || track.Kind != "track" {
			continue
		}
		if _, ok := tracksByMedium[track.MediumID]; !ok {
			continue
		}
		contents := make([]Inclusion, 0, len(track.Contents))
		for _, content := range track.Contents {
			if _, ok := out.Expressions[content.ExpressionID]; ok {
				contents = append(contents, content)
			}
		}
		track.Contents = contents
		tracksByMedium[track.MediumID] = append(tracksByMedium[track.MediumID], track)
	}
	for _, mediumID := range mediumIDs {
		medium, ok := children[mediumID]
		if !ok || medium.Kind != "medium" {
			continue
		}
		group := ReleaseTOCMedium{Medium: medium, Tracks: tracksByMedium[mediumID]}
		sort.Slice(group.Tracks, func(i, j int) bool {
			if group.Tracks[i].Position != group.Tracks[j].Position {
				return group.Tracks[i].Position < group.Tracks[j].Position
			}
			return group.Tracks[i].ID < group.Tracks[j].ID
		})
		out.Media = append(out.Media, group)
	}
	sort.Slice(out.Media, func(i, j int) bool {
		if out.Media[i].Medium.Position != out.Media[j].Medium.Position {
			return out.Media[i].Medium.Position < out.Media[j].Medium.Position
		}
		return out.Media[i].Medium.ID < out.Media[j].Medium.ID
	})
	if err = tx.Commit(); err != nil {
		return ReleaseTOC{}, err
	}
	return out, nil
}
