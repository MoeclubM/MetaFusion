package catalog

// 目录编辑的权限档位。业务函数只问"持有哪个权限码能做什么"，不再比角色字符串——
// 角色兜底集中在 User.Can 里（见 permission.go）：
//
//   - 审核/生命周期档（catalog.lifecycle.manage，旧 admin）：任意非终止态条目，含他人未发布草稿；
//   - 实体编辑档（catalog.entity.edit，旧 editor）：公开条目可协作维护，自己创建的条目不受状态限制；
//   - 无码（旧 user / 注册成员）：只能改自己创建的未发布条目（自助草稿）。

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
