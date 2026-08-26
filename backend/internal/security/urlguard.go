package security

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// NewSafeHTTPClient 创建具备 SSRF / DNS Rebinding 防护的安全 HTTP 客户端
func NewSafeHTTPClient(timeout time.Duration) *http.Client {
	dialer := &net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
	}
	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, err
			}
			host = strings.Trim(host, "[]")
			if err := ValidateExternalURL("http://" + host); err != nil {
				return nil, err
			}
			ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
			if err != nil {
				return nil, err
			}
			var chosenIP net.IP
			for _, ip := range ips {
				if isFakeIP(ip) || !isBlockedIP(ip) {
					chosenIP = ip
					break
				}
			}
			if chosenIP == nil {
				return nil, fmt.Errorf("all resolved IPs for host %q are blocked", host)
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(chosenIP.String(), port))
		},
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	return &http.Client{
		Transport: transport,
		Timeout:   timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return fmt.Errorf("stopped after 10 redirects")
			}
			if err := ValidateExternalURL(req.URL.String()); err != nil {
				return fmt.Errorf("redirect blocked by SSRF filter: %w", err)
			}
			return nil
		},
	}
}

// ValidateExternalURL 校验服务端将要请求的 URL。
// 约束：仅允许 http/https；拒绝 localhost、环回、私有和保留地址。
func ValidateExternalURL(raw string) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return fmt.Errorf("invalid url: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("only http/https is allowed")
	}
	if u.Host == "" {
		return fmt.Errorf("missing host")
	}
	host := u.Host
	if h, _, err := net.SplitHostPort(u.Host); err == nil {
		host = h
	}
	host = strings.Trim(host, "[]")
	lower := strings.ToLower(host)

	if lower == "localhost" || lower == "0.0.0.0" || lower == "::" {
		return fmt.Errorf("host %q is not allowed", host)
	}
	if strings.HasSuffix(lower, ".localhost") || strings.HasSuffix(lower, ".local") || strings.HasSuffix(lower, ".internal") {
		return fmt.Errorf("host %q is not allowed", host)
	}

	if ip := net.ParseIP(host); ip != nil {
		if isBlockedIP(ip) {
			return fmt.Errorf("host %q is not allowed", host)
		}
		return nil
	}

	ips, err := net.LookupIP(host)
	if err != nil {
		return fmt.Errorf("unable to resolve host %q: %w", host, err)
	}
	for _, ip := range ips {
		// 允许在 Tun/Fake-IP 代理环境下解析公网 FQDN (198.18.0.0/15 或 fd00::/8 fake-ip pool)
		if isFakeIP(ip) && strings.Contains(host, ".") && !isInternalSuffix(lower) {
			continue
		}
		if isBlockedIP(ip) {
			return fmt.Errorf("host %q resolves to blocked address %s", host, ip.String())
		}
	}
	return nil
}

func isInternalSuffix(lower string) bool {
	return strings.HasSuffix(lower, ".localhost") ||
		strings.HasSuffix(lower, ".local") ||
		strings.HasSuffix(lower, ".internal") ||
		strings.HasSuffix(lower, ".lan") ||
		strings.HasSuffix(lower, ".home.arpa")
}

func isFakeIP(ip net.IP) bool {
	if ip4 := ip.To4(); ip4 != nil {
		// RFC 2544 benchmark / Clash & Surge Fake-IP pool (198.18.0.0/15)
		return ip4[0] == 198 && (ip4[1] == 18 || ip4[1] == 19)
	}
	// IPv6 ULA fake-ip pool (e.g. fdfe:dcba:9876::/64 or fd00::/8)
	if len(ip) == 16 && (ip[0]&0xfe) == 0xfc {
		return true
	}
	return false
}

func isBlockedIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsUnspecified() || ip.IsMulticast() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return true
	}
	if ip.IsPrivate() {
		return true
	}
	if ip4 := ip.To4(); ip4 != nil {
		if ip4[0] == 10 {
			return true
		}
		if ip4[0] == 172 && ip4[1] >= 16 && ip4[1] <= 31 {
			return true
		}
		if ip4[0] == 192 && ip4[1] == 168 {
			return true
		}
		if ip4[0] == 127 {
			return true
		}
		if ip4[0] == 169 && ip4[1] == 254 {
			return true
		}
		if ip4[0] == 0 {
			return true
		}
		if ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127 {
			return true
		}
		if ip4[0] == 192 && ip4[1] == 0 && ip4[2] == 2 {
			return true
		}
		if ip4[0] == 198 && ip4[1] == 51 && ip4[2] == 100 {
			return true
		}
		if ip4[0] == 203 && ip4[1] == 0 && ip4[2] == 113 {
			return true
		}
		if ip4[0] >= 224 {
			return true
		}
	}
	if ip.To4() == nil {
		if ip.IsLoopback() {
			return true
		}
		if len(ip) == 16 {
			if ip[0] == 0xfe && (ip[1]&0xc0) == 0x80 {
				return true
			}
			if ip[0] == 0xfe && (ip[1]&0xc0) == 0xc0 {
				return true
			}
			if ip[0] == 0xff {
				return true
			}
			if ip.Equal(net.ParseIP("::")) {
				return true
			}
		}
	}
	return false
}
