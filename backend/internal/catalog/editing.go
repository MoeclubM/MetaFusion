package catalog

// 受信任编辑员协作维护已发布目录；未发布内容仍由创建者和管理员管理。
func canEditEntity(u User, e Entity) bool {
	if e.Status == "deleted" || e.Status == "merged" {
		return false
	}
	if u.Role == "admin" {
		return true
	}
	if u.Role == "editor" && e.Status == "published" {
		return true
	}
	return e.CreatedBy == u.ID && (u.Role == "editor" || u.Role == "user" && e.Status != "published")
}
