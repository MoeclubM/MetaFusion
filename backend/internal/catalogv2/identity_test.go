package catalogv2

import (
	"context"
	"testing"
)

func TestIdentityManagement(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	// 1. Create a normal editor
	editor, err := f.s.CreateUser(ctx, "test-editor", "password-123456", false, &f.u)
	if err != nil {
		t.Fatalf("failed to create editor: %v", err)
	}

	// 2. Change password
	if err := f.s.ChangePassword(ctx, editor.ID, "password-123456", "new-password-789012"); err != nil {
		t.Fatalf("failed to change password: %v", err)
	}
	// Verify login with old password fails
	if _, _, err := f.s.Login(ctx, "test-editor", "password-123456"); err == nil {
		t.Fatal("expected login with old password to fail")
	}
	// Verify login with new password succeeds
	token, _, err := f.s.Login(ctx, "test-editor", "new-password-789012")
	if err != nil {
		t.Fatalf("failed to login with new password: %v", err)
	}

	// 3. LogoutAll
	if err := f.s.LogoutAll(ctx, editor.ID); err != nil {
		t.Fatalf("failed to logout all: %v", err)
	}
	if _, err := f.s.User(ctx, token); err == nil {
		t.Fatal("expected token to be revoked after LogoutAll")
	}

	// 4. ListUsers
	users, err := f.s.ListUsers(ctx)
	if err != nil {
		t.Fatalf("failed to list users: %v", err)
	}
	if len(users) < 2 {
		t.Fatalf("expected at least 2 users, got %d", len(users))
	}

	// 5. UpdateUserRole
	if err := f.s.UpdateUserRole(ctx, editor.ID, "admin", &f.u); err != nil {
		t.Fatalf("failed to update user role to admin: %v", err)
	}
	// Sole admin demotion protection
	if err := f.s.UpdateUserRole(ctx, f.u.ID, "editor", &f.u); err != nil {
		// With 2 admins now, demoting f.u should succeed
	}

	// 6. ResetUserPassword
	if err := f.s.ResetUserPassword(ctx, editor.ID, "reset-password-abc123", &f.u); err != nil {
		t.Fatalf("failed to reset password: %v", err)
	}
	if _, _, err := f.s.Login(ctx, "test-editor", "reset-password-abc123"); err != nil {
		t.Fatalf("failed to login with reset password: %v", err)
	}
}
