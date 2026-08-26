package mailer

import (
	"crypto/tls"
	"errors"
	"fmt"
	"log"
	"net"
	"net/smtp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/metafusion/metafusion-app/internal/models"
	"gorm.io/gorm"
)

// SMTPConfig 保存 SMTP 连接与发信配置
type SMTPConfig struct {
	Enabled    bool   `json:"smtp_enabled"`
	Host       string `json:"smtp_host"`
	Port       int    `json:"smtp_port"`
	Username   string `json:"smtp_username"`
	Password   string `json:"smtp_password"`
	FromName   string `json:"smtp_from_name"`
	FromEmail  string `json:"smtp_from_email"`
	Encryption string `json:"smtp_encryption"` // "ssl", "starttls", "none"
}

// Mailer 邮件发送管理服务
type Mailer struct {
	db        *gorm.DB
	mu        sync.RWMutex
	cachedCfg *SMTPConfig
	cachedAt  time.Time
}

func NewMailer(db *gorm.DB) *Mailer {
	return &Mailer{
		db: db,
	}
}

// GetConfig 从系统设置中获取最新的 SMTP 配置（带 5 秒内存缓存）
func (m *Mailer) GetConfig() SMTPConfig {
	m.mu.RLock()
	if m.cachedCfg != nil && time.Since(m.cachedAt) < 5*time.Second {
		cfg := *m.cachedCfg
		m.mu.RUnlock()
		return cfg
	}
	m.mu.RUnlock()

	var rows []models.SystemSetting
	if err := m.db.Find(&rows).Error; err != nil {
		return SMTPConfig{
			Port:       587,
			FromName:   "MetaFusion Archive",
			FromEmail:  "noreply@metafusion.org",
			Encryption: "starttls",
		}
	}

	settingMap := make(map[string]string)
	for _, r := range rows {
		settingMap[r.Key] = r.Value
	}

	port := 587
	if p, err := strconv.Atoi(settingMap["smtp_port"]); err == nil && p > 0 {
		port = p
	}

	enc := settingMap["smtp_encryption"]
	if enc == "" {
		if port == 465 {
			enc = "ssl"
		} else {
			enc = "starttls"
		}
	}

	fromName := settingMap["smtp_from_name"]
	if fromName == "" {
		fromName = "MetaFusion Archive"
	}
	fromEmail := settingMap["smtp_from_email"]
	if fromEmail == "" {
		fromEmail = settingMap["smtp_username"]
	}
	if fromEmail == "" {
		fromEmail = "noreply@metafusion.org"
	}

	cfg := SMTPConfig{
		Enabled:    settingMap["smtp_enabled"] == "true",
		Host:       settingMap["smtp_host"],
		Port:       port,
		Username:   settingMap["smtp_username"],
		Password:   settingMap["smtp_password"],
		FromName:   fromName,
		FromEmail:  fromEmail,
		Encryption: enc,
	}

	m.mu.Lock()
	m.cachedCfg = &cfg
	m.cachedAt = time.Now()
	m.mu.Unlock()

	return cfg
}

// InvalidateCache 清理配置缓存
func (m *Mailer) InvalidateCache() {
	m.mu.Lock()
	m.cachedCfg = nil
	m.mu.Unlock()
}

// loginAuth 兼容不支持 PLAIN 机制的 SMTP 服务器（如部分国内邮件服务商）
type loginAuth struct {
	username, password string
}

func LoginAuth(username, password string) smtp.Auth {
	return &loginAuth{username, password}
}

func (a *loginAuth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	return "LOGIN", []byte{}, nil
}

func (a *loginAuth) Next(fromServer []byte, more bool) ([]byte, error) {
	if more {
		prompt := strings.ToLower(string(fromServer))
		if strings.Contains(prompt, "username") || strings.Contains(prompt, "user") {
			return []byte(a.username), nil
		}
		if strings.Contains(prompt, "password") || strings.Contains(prompt, "pass") {
			return []byte(a.password), nil
		}
		return nil, errors.New("unexpected server challenge: " + string(fromServer))
	}
	return nil, nil
}

// sendMail 执行底层的 SMTP 邮件发送
func (m *Mailer) sendMail(cfg SMTPConfig, to string, subject string, bodyHTML string) error {
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)

	fromHeader := fmt.Sprintf("=?UTF-8?B?%s?= <%s>", strings.TrimSpace(cfg.FromName), cfg.FromEmail)
	msg := []byte(fmt.Sprintf(
		"From: %s\r\n"+
			"To: %s\r\n"+
			"Subject: =?UTF-8?B?%s?=\r\n"+
			"MIME-Version: 1.0\r\n"+
			"Content-Type: text/html; charset=UTF-8\r\n"+
			"\r\n"+
			"%s\r\n",
		fromHeader,
		to,
		subject,
		bodyHTML,
	))

	// 如果采用直接 SSL/TLS (如 465 端口)
	if cfg.Encryption == "ssl" || cfg.Port == 465 {
		tlsConfig := &tls.Config{
			InsecureSkipVerify: false,
			ServerName:         cfg.Host,
		}
		conn, err := tls.DialWithDialer(&net.Dialer{Timeout: 10 * time.Second}, "tcp", addr, tlsConfig)
		if err != nil {
			return fmt.Errorf("TLS dial failed: %w", err)
		}
		defer conn.Close()

		client, err := smtp.NewClient(conn, cfg.Host)
		if err != nil {
			return fmt.Errorf("SMTP client creation failed: %w", err)
		}
		defer client.Quit()

		if cfg.Username != "" && cfg.Password != "" {
			auth := smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
			if err = client.Auth(auth); err != nil {
				// 尝试 LOGIN Auth 兜底
				if errLogin := client.Auth(LoginAuth(cfg.Username, cfg.Password)); errLogin != nil {
					return fmt.Errorf("SMTP auth failed: %w (fallback: %v)", err, errLogin)
				}
			}
		}

		if err = client.Mail(cfg.FromEmail); err != nil {
			return fmt.Errorf("MAIL FROM failed: %w", err)
		}
		if err = client.Rcpt(to); err != nil {
			return fmt.Errorf("RCPT TO failed: %w", err)
		}

		w, err := client.Data()
		if err != nil {
			return fmt.Errorf("DATA command failed: %w", err)
		}
		if _, err = w.Write(msg); err != nil {
			return fmt.Errorf("write email body failed: %w", err)
		}
		return w.Close()
	}

	// 默认采用 STARTTLS (587 端口或标准端口)
	var auth smtp.Auth
	if cfg.Username != "" && cfg.Password != "" {
		auth = smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
	}

	// 尝试标准 SendMail
	err := smtp.SendMail(addr, auth, cfg.FromEmail, []string{to}, msg)
	if err != nil && (strings.Contains(err.Error(), "unencrypted") || strings.Contains(err.Error(), "authentication failed")) {
		// 尝试带 STARTTLS 定制拨号
		c, dialErr := smtp.Dial(addr)
		if dialErr != nil {
			return fmt.Errorf("SMTP dial failed: %w", dialErr)
		}
		defer c.Quit()

		tlsConfig := &tls.Config{
			ServerName: cfg.Host,
		}
		if ok, _ := c.Extension("STARTTLS"); ok {
			if err = c.StartTLS(tlsConfig); err != nil {
				return fmt.Errorf("STARTTLS negotiation failed: %w", err)
			}
		}

		if auth != nil {
			if err = c.Auth(auth); err != nil {
				if errLogin := c.Auth(LoginAuth(cfg.Username, cfg.Password)); errLogin != nil {
					return fmt.Errorf("SMTP STARTTLS auth failed: %w", err)
				}
			}
		}

		if err = c.Mail(cfg.FromEmail); err != nil {
			return fmt.Errorf("MAIL FROM failed: %w", err)
		}
		if err = c.Rcpt(to); err != nil {
			return fmt.Errorf("RCPT TO failed: %w", err)
		}
		w, err := c.Data()
		if err != nil {
			return fmt.Errorf("DATA command failed: %w", err)
		}
		if _, err = w.Write(msg); err != nil {
			return fmt.Errorf("write email body failed: %w", err)
		}
		return w.Close()
	}

	return err
}

// SendVerificationEmail 发送邮箱验证码邮件
func (m *Mailer) SendVerificationEmail(toEmail, username, code, locale string) error {
	cfg := m.GetConfig()

	// 若未开启 SMTP 或未配置 Host，在日志中优雅打印验证码（便于本地调试与无邮件服务环境）
	if !cfg.Enabled || strings.TrimSpace(cfg.Host) == "" {
		log.Printf("[MAILER MOCK/DEV] To: %s | User: %s | Verification Code: %s (SMTP not configured or disabled)", toEmail, username, code)
		return nil
	}

	isEn := locale == "en-US"
	subject := "【MetaFusion】邮箱验证码"
	if isEn {
		subject = "[MetaFusion] Email Verification Code"
	}

	bodyHTML := buildVerificationHTML(username, code, isEn)
	return m.sendMail(cfg, toEmail, subject, bodyHTML)
}

// SendTestEmail 发送管理员 SMTP 测试邮件
func (m *Mailer) SendTestEmail(toEmail, locale string) error {
	cfg := m.GetConfig()
	if !cfg.Enabled || strings.TrimSpace(cfg.Host) == "" {
		return errors.New("SMTP is not enabled or SMTP host is empty")
	}

	isEn := locale == "en-US"
	subject := "【MetaFusion】SMTP 邮件服务连接测试"
	if isEn {
		subject = "[MetaFusion] SMTP Mail Server Test"
	}

	bodyHTML := buildTestHTML(cfg, isEn)
	return m.sendMail(cfg, toEmail, subject, bodyHTML)
}

func buildVerificationHTML(username, code string, isEn bool) string {
	if isEn {
		return fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background-color:#0b0f19;color:#e2e8f0;">
  <div style="max-width:540px;margin:0 auto;background:#131b2e;border:1px solid #243049;border-radius:12px;padding:32px;box-shadow:0 8px 30px rgba(0,0,0,0.5);">
    <div style="font-size:20px;font-weight:700;color:#38bdf8;margin-bottom:16px;letter-spacing:-0.5px;">MetaFusion Archive</div>
    <div style="font-size:16px;font-weight:600;color:#f8fafc;margin-bottom:8px;">Hello, %s!</div>
    <p style="font-size:14px;color:#94a3b8;line-height:1.6;margin-bottom:24px;">
      You are verifying your email address on MetaFusion. Please use the following 6-digit verification code to complete the verification:
    </p>
    <div style="text-align:center;margin:28px 0;">
      <div style="display:inline-block;padding:14px 32px;background:#0369a1;border:1px solid #38bdf8;border-radius:8px;font-size:28px;font-weight:700;color:#ffffff;letter-spacing:6px;font-family:monospace;">
        %s
      </div>
    </div>
    <p style="font-size:12px;color:#64748b;line-height:1.5;margin-top:24px;border-top:1px solid #1e293b;padding-top:16px;">
      This verification code will expire in 15 minutes. If you did not request this email, please ignore it safely.
    </p>
  </div>
</body>
</html>
`, username, code)
	}

	return fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background-color:#0b0f19;color:#e2e8f0;">
  <div style="max-width:540px;margin:0 auto;background:#131b2e;border:1px solid #243049;border-radius:12px;padding:32px;box-shadow:0 8px 30px rgba(0,0,0,0.5);">
    <div style="font-size:20px;font-weight:700;color:#38bdf8;margin-bottom:16px;letter-spacing:-0.5px;">MetaFusion 档案库</div>
    <div style="font-size:16px;font-weight:600;color:#f8fafc;margin-bottom:8px;">您好，%s！</div>
    <p style="font-size:14px;color:#94a3b8;line-height:1.6;margin-bottom:24px;">
      您正在 MetaFusion 平台进行邮箱验证绑定，请使用以下 6 位验证码完成验证流程：
    </p>
    <div style="text-align:center;margin:28px 0;">
      <div style="display:inline-block;padding:14px 32px;background:#0369a1;border:1px solid #38bdf8;border-radius:8px;font-size:28px;font-weight:700;color:#ffffff;letter-spacing:6px;font-family:monospace;">
        %s
      </div>
    </div>
    <p style="font-size:12px;color:#64748b;line-height:1.5;margin-top:24px;border-top:1px solid #1e293b;padding-top:16px;">
      此验证码在 15 分钟内有效。如非您本人操作，请忽略此邮件。
    </p>
  </div>
</body>
</html>
`, username, code)
}

func buildTestHTML(cfg SMTPConfig, isEn bool) string {
	if isEn {
		return fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background-color:#0b0f19;color:#e2e8f0;">
  <div style="max-width:540px;margin:0 auto;background:#131b2e;border:1px solid #243049;border-radius:12px;padding:32px;">
    <div style="font-size:20px;font-weight:700;color:#10b981;margin-bottom:16px;">SMTP Test Successful</div>
    <p style="font-size:14px;color:#94a3b8;line-height:1.6;">
      Congratulations! Your MetaFusion SMTP configuration is working properly.
    </p>
    <div style="margin-top:16px;padding:12px;background:#0f172a;border-radius:6px;font-family:monospace;font-size:12px;color:#cbd5e1;">
      Host: %s:%d<br>
      From: %s &lt;%s&gt;<br>
      Encryption: %s
    </div>
  </div>
</body>
</html>
`, cfg.Host, cfg.Port, cfg.FromName, cfg.FromEmail, cfg.Encryption)
	}

	return fmt.Sprintf(`
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background-color:#0b0f19;color:#e2e8f0;">
  <div style="max-width:540px;margin:0 auto;background:#131b2e;border:1px solid #243049;border-radius:12px;padding:32px;">
    <div style="font-size:20px;font-weight:700;color:#10b981;margin-bottom:16px;">SMTP 邮件发送测试成功</div>
    <p style="font-size:14px;color:#94a3b8;line-height:1.6;">
      恭喜！MetaFusion SMTP 邮件服务配置连接正常，已成功完成发信测试。
    </p>
    <div style="margin-top:16px;padding:12px;background:#0f172a;border-radius:6px;font-family:monospace;font-size:12px;color:#cbd5e1;">
      服务器: %s:%d<br>
      发件人: %s &lt;%s&gt;<br>
      加密方式: %s
    </div>
  </div>
</body>
</html>
`, cfg.Host, cfg.Port, cfg.FromName, cfg.FromEmail, cfg.Encryption)
}
