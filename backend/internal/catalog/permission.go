package catalog

// 目录侧授权的集中判定：以权限码为准，角色只在老令牌上兜底。
//
// 权限码由**各子系统自己声明**、由账号服务（metafusion-auth）装进权限组并随访问令牌下发
// （claims.permissions，admin 组带 * 通配）。码名必须与账号服务的权限清单逐字一致
// （metafusion-auth/internal/store/access.go 的 PermissionCatalog 与 seed_groups.go 播种的
// 系统组）：两边都只读令牌、谁也不查对方的库，唯一需要对齐的就是码的拼写。
// 组名与角色不参与判定——散落的角色比较正是「后台分配了权限组、目录侧却不认」的成因。

const (
	// PermissionEntityEdit 编辑目录实体：维护自己创建的条目，并协作维护公开条目。
	PermissionEntityEdit = "catalog.entity.edit"
	// PermissionRelationEdit 编辑实体关系：POST/PUT/DELETE /catalog/relations 的路由闸门，
	// 与实体编辑分开。两端细粒度判定（canWriteRelation/canAttachToTarget）仍按实体口径复核。
	PermissionRelationEdit = "catalog.relation.edit"
	// PermissionDefinitionsManage 管理动态定义：起草、影响面校验与发布。
	PermissionDefinitionsManage = "catalog.definitions.manage"
	// PermissionLifecycleManage 审核与生命周期：删除/合并，以及处置他人的未发布条目。
	PermissionLifecycleManage = "catalog.lifecycle.manage"
	// PermissionImportSubmit 提交外部导入：预览与落库端点同权（预览同样按载荷出站抓取），
	// 见 http.go 的 /importer 路由。
	PermissionImportSubmit = "catalog.import.submit"
	// PermissionShelvesManage 管理货架：管理端点，以及货架求值时预览未发布条目。
	PermissionShelvesManage = "catalog.shelves.manage"

	// permissionWildcard 是账号服务给的「全部权限」码（admin 组）。
	permissionWildcard = "*"
)

// catalogPermissionCodes 是本服务声明的全部目录权限码：角色兜底只认这些码，
// 不会因为角色是 admin 就放行别的子系统的码（community.* / storage.* / auth.* 归各自服务）。
var catalogPermissionCodes = []string{
	PermissionEntityEdit,
	PermissionRelationEdit,
	PermissionDefinitionsManage,
	PermissionLifecycleManage,
	PermissionImportSubmit,
	PermissionShelvesManage,
}

// Can 报告用户是否持有某权限码。
//
// 令牌带 permissions 时一律以码为准（* 通配即全权）：拆服务后这是唯一的授权来源，
// 此时角色不再额外放行，否则「角色兜底」会变成绕过权限组的后门。
// 只有令牌完全没有 permissions 声明时（老令牌，或尚未按权限组配置的实例）才按历史角色兜底：
// admin 放行全部目录码；editor 放行实体编辑（旧的受信任编辑员语义）；user 与匿名不放行。
func (u User) Can(code string) bool {
	if len(u.Permissions) > 0 {
		return contains(u.Permissions, permissionWildcard) || contains(u.Permissions, code)
	}
	switch u.Role {
	case "admin":
		return contains(catalogPermissionCodes, code)
	case "editor":
		return code == PermissionEntityEdit
	}
	return false
}
