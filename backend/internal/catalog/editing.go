package catalog

import (
	"context"
	"fmt"
)

// 目录编辑的权限档位。业务函数只问"持有哪个权限码能做什么"，不比角色字符串，
// 也没有角色兜底（判定只看令牌里的 permissions，见 permission.go）：
//
//   - catalog.lifecycle.manage：任意非终止态条目，含他人未发布草稿；
//   - catalog.entity.edit：公开条目可协作维护，自己创建的条目不受状态限制；
//   - 无码（仅登录）：只能改自己创建的未发布条目（自助草稿）。

// ownedBy 要求 CreatedBy 非空：匿名（ID 为空）与历史脏行（created_by 为空）不得互相认领。
func ownedBy(e Entity, u User) bool { return e.CreatedBy != "" && e.CreatedBy == u.ID }

// canEditEntity 报告 u 能否改动实体 e。
func canEditEntity(u User, e Entity) bool {
	if e.Status == "deleted" || e.Status == "merged" {
		return false
	}
	if u.Can(PermissionLifecycleManage) {
		return true
	}
	if u.Can(PermissionEntityEdit) {
		return e.Status == "published" || ownedBy(e, u)
	}
	return ownedBy(e, u) && e.Status != "published"
}

// prepareEntityWriteStatus is shared by whole-entity and status-only edits.
// Publication and demotion permissions must not depend on the payload shape.
func prepareEntityWriteStatus(old Entity, next *Entity, u User) error {
	if !u.Can(PermissionLifecycleManage) {
		if old.ID != "" && !canEditEntity(u, old) {
			return errForbidden
		}
		if !u.Can(PermissionEntityEdit) {
			if old.Status == "published" || next.Status != "draft" && next.Status != "pending_review" {
				return errForbidden
			}
		}
	}
	if next.Status == "" {
		next.Status = "draft"
	}
	if next.Status == "deleted" || next.Status == "merged" || next.RedirectID != "" ||
		old.Status == "published" && next.Status != "published" {
		return fmt.Errorf("use_lifecycle_endpoint")
	}
	return nil
}

// Published writes resolve validated references against anonymous visibility.
// Status-only edits supply full facts, including unchanged inclusions.
func entityWriteReference(ctx context.Context, q queryer, e Entity, u User) (func(string, []string) error, error) {
	reader := &u
	if e.Status == "published" {
		if len(e.Translations) == 0 {
			return nil, fmt.Errorf("translation_required")
		}
		reader = nil
	}
	return reference(ctx, q, reader), nil
}

func validateEntityStructuralReferences(e Entity, ref func(string, []string) error) error {
	for _, item := range []struct {
		id   string
		kind string
	}{
		{e.WorkID, "work"}, {e.ReleaseID, "release"}, {e.MediumID, "medium"},
		{e.ParentID, e.Kind}, {e.ContentUnitID, "content_unit"},
	} {
		if item.id != "" {
			if err := ref(item.id, []string{item.kind}); err != nil {
				return err
			}
		}
	}
	return nil
}
