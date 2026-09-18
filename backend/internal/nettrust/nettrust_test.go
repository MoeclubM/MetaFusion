package nettrust

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestParse(t *testing.T) {
	cases := []struct {
		name      string
		raw       string
		want      []string
		wantNone  bool
		wantError bool
	}{
		{name: "未配置走保守默认", raw: "", want: strings.Split(Default, ",")},
		{name: "空白等同未配置", raw: "   ", want: strings.Split(Default, ",")},
		{name: "显式声明无代理", raw: "none", wantNone: true},
		{name: "大小写不敏感的 none", raw: "NONE", wantNone: true},
		{name: "单 IP 归一成 /32", raw: "203.0.113.7", want: []string{"203.0.113.7/32"}},
		{name: "CIDR 归一掉主机位", raw: "10.0.0.1/8", want: []string{"10.0.0.0/8"}},
		{name: "IPv6 单地址归一成 /128", raw: "2001:db8::1", want: []string{"2001:db8::1/128"}},
		{name: "多项混合并忽略空项", raw: " 10.1.0.0/16 , ,203.0.113.7 ", want: []string{"10.1.0.0/16", "203.0.113.7/32"}},
		{name: "非法项报错", raw: "10.0.0.0/8,not-an-ip", wantError: true},
		{name: "非法 CIDR 报错", raw: "10.0.0.0/33", wantError: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, none, err := Parse(tc.raw)
			if tc.wantError {
				if err == nil {
					t.Fatalf("期望报错，实际 got=%v none=%v", got, none)
				}
				return
			}
			if err != nil {
				t.Fatalf("Parse(%q) 报错: %v", tc.raw, err)
			}
			if none != tc.wantNone {
				t.Fatalf("none = %v，期望 %v", none, tc.wantNone)
			}
			if !tc.wantNone && strings.Join(got, ",") != strings.Join(tc.want, ",") {
				t.Fatalf("解析结果 = %v，期望 %v", got, tc.want)
			}
		})
	}
}

// clientIPFor 起一个只回 ClientIP() 的引擎，用来钉住"谁被信"。
func clientIPFor(t *testing.T, raw, remoteAddr string, headers map[string]string) string {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	if _, err := Apply(r, raw); err != nil {
		t.Fatalf("Apply(%q) 报错: %v", raw, err)
	}
	var got string
	r.GET("/probe", func(c *gin.Context) { got = c.ClientIP() })
	req := httptest.NewRequest(http.MethodGet, "/probe", nil)
	req.RemoteAddr = remoteAddr
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	r.ServeHTTP(httptest.NewRecorder(), req)
	return got
}

func TestClientIPTrustBoundary(t *testing.T) {
	cases := []struct {
		name       string
		raw        string
		remoteAddr string
		headers    map[string]string
		want       string
	}{
		{
			name:       "不可信对端的伪造 XFF 被忽略",
			remoteAddr: "198.51.100.7:51000",
			headers:    map[string]string{"X-Forwarded-For": "1.2.3.4"},
			want:       "198.51.100.7",
		},
		{
			name:       "不可信对端的伪造 X-Real-IP 同样被忽略",
			remoteAddr: "198.51.100.7:51000",
			headers:    map[string]string{"X-Real-IP": "1.2.3.4"},
			want:       "198.51.100.7",
		},
		{
			name:       "可信网关转发：取最右侧不可信地址（客户端, 客户端 的既有形状）",
			remoteAddr: "172.18.0.9:51000",
			headers:    map[string]string{"X-Forwarded-For": "203.0.113.9, 203.0.113.9"},
			want:       "203.0.113.9",
		},
		{
			name:       "可信网关转发：客户端自己伪造的前缀不会被采纳",
			remoteAddr: "172.18.0.9:51000",
			headers:    map[string]string{"X-Forwarded-For": "1.2.3.4, 203.0.113.9"},
			want:       "203.0.113.9",
		},
		{
			name:       "多级可信代理：跳过链上的私网代理取到客户端",
			remoteAddr: "10.5.0.4:51000",
			headers:    map[string]string{"X-Forwarded-For": "203.0.113.9, 172.18.0.9"},
			want:       "203.0.113.9",
		},
		{
			name:       "可信对端但无 XFF 时回退 RemoteAddr",
			remoteAddr: "172.18.0.9:51000",
			want:       "172.18.0.9",
		},
		{
			name:       "显式 none：即使对端像代理也不采信头",
			raw:        "none",
			remoteAddr: "172.18.0.9:51000",
			headers:    map[string]string{"X-Forwarded-For": "203.0.113.9"},
			want:       "172.18.0.9",
		},
		{
			name:       "显式只信某个网段：其它私网对端不受信",
			raw:        "10.1.0.0/16",
			remoteAddr: "172.18.0.9:51000",
			headers:    map[string]string{"X-Forwarded-For": "203.0.113.9"},
			want:       "172.18.0.9",
		},
		{
			name:       "显式只信某个网段：该网段对端受信",
			raw:        "10.1.0.0/16",
			remoteAddr: "10.1.2.3:51000",
			headers:    map[string]string{"X-Forwarded-For": "203.0.113.9"},
			want:       "203.0.113.9",
		},
		{
			name:       "XFF 里混入非法片段时整体回退 RemoteAddr",
			remoteAddr: "172.18.0.9:51000",
			headers:    map[string]string{"X-Forwarded-For": "203.0.113.9, garbage"},
			want:       "172.18.0.9",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := clientIPFor(t, tc.raw, tc.remoteAddr, tc.headers); got != tc.want {
				t.Fatalf("ClientIP() = %q，期望 %q", got, tc.want)
			}
		})
	}
}

func TestApplyRejectsInvalidConfig(t *testing.T) {
	gin.SetMode(gin.TestMode)
	if _, err := Apply(gin.New(), "10.0.0.0/8,oops"); err == nil {
		t.Fatal("非法配置必须报错（静默退化会被当成正常）")
	}
}

func TestDefaultDoesNotTrustEveryone(t *testing.T) {
	proxies, _, err := Parse(Default)
	if err != nil {
		t.Fatalf("默认值必须可解析: %v", err)
	}
	for _, p := range proxies {
		if p == "0.0.0.0/0" || p == "::/0" {
			t.Fatalf("默认信任范围不能是全网（任何人伪造 XFF 都能换限流桶）: %v", proxies)
		}
	}
}
