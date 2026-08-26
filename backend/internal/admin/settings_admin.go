package admin

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	backendi18n "github.com/metafusion/metafusion-app/internal/i18n"
	"github.com/metafusion/metafusion-app/internal/models"
	"github.com/metafusion/metafusion-app/internal/ratelimit"
)

type SystemSettingsResponse struct {
	RegistrationEnabled          bool              `json:"registration_enabled"`
	InviteRequired               bool              `json:"invite_required"`
	RequireEmailVerification     bool              `json:"require_email_verification"`
	EmailVerificationEnabled     bool              `json:"email_verification_enabled"`
	RateLimitEnabled             bool              `json:"rate_limit_enabled"`
	AuthRateLimitEnabled         bool              `json:"auth_rate_limit_enabled"`
	RateLimitAnonPerMin          int               `json:"rate_limit_anon_per_min"`
	RateLimitAuthPerMin          int               `json:"rate_limit_auth_per_min"`
	RateLimitAuthEndpointPerMin  int               `json:"rate_limit_auth_endpoint_per_min"`
	SmtpEnabled                  bool              `json:"smtp_enabled"`
	SmtpHost                     string            `json:"smtp_host"`
	SmtpPort                     int               `json:"smtp_port"`
	SmtpUsername                 string            `json:"smtp_username"`
	SmtpPassword                 string            `json:"smtp_password"`
	SmtpFromName                 string            `json:"smtp_from_name"`
	SmtpFromEmail                string            `json:"smtp_from_email"`
	SmtpEncryption               string            `json:"smtp_encryption"`
	Raw                          map[string]string `json:"raw"`
}

func parseBoolDefault(m map[string]string, key string, def bool) bool {
	if v, ok := m[key]; ok {
		return v == "true"
	}
	return def
}

func parseIntDefault(m map[string]string, key string, def int) int {
	if v, ok := m[key]; ok {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}

func (s *AdminService) GetSystemSettings(c *gin.Context) {
	var rows []models.SystemSetting
	if err := s.db.Find(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	m := map[string]string{}
	for _, r := range rows {
		m[r.Key] = r.Value
	}

	res := SystemSettingsResponse{
		RegistrationEnabled:         parseBoolDefault(m, "registration_enabled", true),
		InviteRequired:              parseBoolDefault(m, "invite_required", true),
		RequireEmailVerification:    parseBoolDefault(m, "require_email_verification", false),
		EmailVerificationEnabled:    parseBoolDefault(m, "email_verification_enabled", true),
		RateLimitEnabled:            parseBoolDefault(m, "rate_limit_enabled", true),
		AuthRateLimitEnabled:        parseBoolDefault(m, "auth_rate_limit_enabled", true),
		RateLimitAnonPerMin:         parseIntDefault(m, "rate_limit_anon_per_min", 60),
		RateLimitAuthPerMin:         parseIntDefault(m, "rate_limit_auth_per_min", 600),
		RateLimitAuthEndpointPerMin: parseIntDefault(m, "rate_limit_auth_endpoint_per_min", 15),
		SmtpEnabled:                 parseBoolDefault(m, "smtp_enabled", false),
		SmtpHost:                    m["smtp_host"],
		SmtpPort:                    parseIntDefault(m, "smtp_port", 587),
		SmtpUsername:                m["smtp_username"],
		SmtpPassword:                m["smtp_password"],
		SmtpFromName:                m["smtp_from_name"],
		SmtpFromEmail:               m["smtp_from_email"],
		SmtpEncryption:              m["smtp_encryption"],
		Raw:                         m,
	}
	if res.SmtpEncryption == "" {
		if res.SmtpPort == 465 {
			res.SmtpEncryption = "ssl"
		} else {
			res.SmtpEncryption = "starttls"
		}
	}
	if res.SmtpFromName == "" {
		res.SmtpFromName = "MetaFusion Archive"
	}
	if res.SmtpFromEmail == "" && res.SmtpUsername != "" {
		res.SmtpFromEmail = res.SmtpUsername
	}

	c.JSON(http.StatusOK, res)
}

func (s *AdminService) UpdateSystemSettings(c *gin.Context) {
	var input map[string]interface{}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	allowedBools := map[string]bool{
		"registration_enabled":       true,
		"invite_required":            true,
		"require_email_verification": true,
		"email_verification_enabled": true,
		"rate_limit_enabled":         true,
		"auth_rate_limit_enabled":    true,
		"smtp_enabled":               true,
	}

	allowedInts := map[string]bool{
		"rate_limit_anon_per_min":          true,
		"rate_limit_auth_per_min":          true,
		"rate_limit_auth_endpoint_per_min": true,
		"smtp_port":                        true,
	}

	allowedStrings := map[string]bool{
		"smtp_host":        true,
		"smtp_username":    true,
		"smtp_password":    true,
		"smtp_from_name":   true,
		"smtp_from_email":  true,
		"smtp_encryption":  true,
	}

	updates := map[string]string{}
	for k, v := range input {
		if allowedBools[k] {
			var strVal string
			switch vv := v.(type) {
			case bool:
				if vv {
					strVal = "true"
				} else {
					strVal = "false"
				}
			case string:
				low := strings.ToLower(strings.TrimSpace(vv))
				if low == "true" || low == "1" || low == "yes" {
					strVal = "true"
				} else if low == "false" || low == "0" || low == "no" {
					strVal = "false"
				} else {
					c.JSON(http.StatusBadRequest, gin.H{"error": "invalid value for " + k + ": must be boolean"})
					return
				}
			default:
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid value type for " + k})
				return
			}
			updates[k] = strVal
		} else if allowedInts[k] {
			var n int
			switch vv := v.(type) {
			case float64:
				n = int(vv)
			case int:
				n = vv
			case string:
				parsed, err := strconv.Atoi(strings.TrimSpace(vv))
				if err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"error": "invalid integer for " + k})
					return
				}
				n = parsed
			default:
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid integer type for " + k})
				return
			}
			if n < 0 {
				c.JSON(http.StatusBadRequest, gin.H{"error": k + " must be non-negative"})
				return
			}
			updates[k] = strconv.Itoa(n)
		} else if allowedStrings[k] {
			strVal, ok := v.(string)
			if !ok {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid string type for " + k})
				return
			}
			updates[k] = strings.TrimSpace(strVal)
		}
	}

	if len(updates) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no valid settings provided"})
		return
	}

	for k, v := range updates {
		rec := models.SystemSetting{Key: k, Value: v, UpdatedAt: time.Now()}
		if err := s.db.Save(&rec).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	ratelimit.InvalidateCache()
	if s.mailer != nil {
		s.mailer.InvalidateCache()
	}

	// 记录审计日志 (脱敏 password)
	auditUpdates := map[string]interface{}{}
	for k, v := range updates {
		if k == "smtp_password" {
			auditUpdates[k] = "******"
		} else {
			auditUpdates[k] = v
		}
	}
	writeAudit(s.db, c, "system.settings.update", "system_setting", "", map[string]interface{}{"updates": auditUpdates})

	// 返回最新完整配置
	s.GetSystemSettings(c)
}

// TestSendEmail 测试 SMTP 邮件发信
func (s *AdminService) TestSendEmail(c *gin.Context) {
	var req struct {
		ToEmail string `json:"to_email" binding:"required,email"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid target email address"})
		return
	}

	if s.mailer == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Mailer service not available"})
		return
	}

	locale := backendi18n.LocaleFromContext(c)
	err := s.mailer.SendTestEmail(req.ToEmail, locale)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Failed to send test email: %v", err)})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":  "Test email sent successfully",
		"to_email": req.ToEmail,
	})
}
