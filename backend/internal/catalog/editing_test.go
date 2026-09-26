package catalog

import "testing"

func TestSharedEditingRoles(t *testing.T) {
	for _, tc := range []struct {
		role, status, owner string
		allowed             bool
	}{
		{"editor", "published", "other", true},
		{"editor", "draft", "other", false},
		{"editor", "pending_review", "other", false},
		{"editor", "draft", "self", true},
		{"user", "published", "self", false},
		{"user", "draft", "self", true},
		{"user", "draft", "other", false},
		{"admin", "pending_review", "other", true},
		{"editor", "merged", "self", false},
		{"admin", "deleted", "other", false},
	} {
		u := User{ID: "self"}
		switch tc.role {
		case "admin":
			u.Permissions = []string{permissionWildcard}
		case "editor":
			u.Permissions = []string{PermissionEntityEdit}
		}
		e := Entity{Status: tc.status, CreatedBy: tc.owner}
		if canEditEntity(u, e) != tc.allowed || canWriteRelation(u, e) != tc.allowed {
			t.Errorf("role=%s status=%s owner=%s want=%v", tc.role, tc.status, tc.owner, tc.allowed)
		}
	}
	if canAttachToTarget(User{ID: "self"}, Entity{Status: "published", CreatedBy: "other"}) {
		t.Fatal("ordinary user must not gain shared relationship editing")
	}
}
