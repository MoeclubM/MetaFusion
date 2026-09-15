package catalog

import "testing"

// 图片时间允许空（来源未注明）与部分书目日期，拒绝非法串——多图按它排序，口径必须稳。
func TestValidPictureTime(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"", true},
		{"2020", true},
		{"2020-08", true},
		{"2020-08-07", true},
		{" 2020-08-07 ", true},
		{"2020-08-07T12:30:00Z", true},
		{"2020-13-01", false},
		{"20-08-07", false},
		{"2020/08/07", false},
		{"去年", false},
	}
	for _, c := range cases {
		if got := validPictureTime(c.in); got != c.want {
			t.Errorf("validPictureTime(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}
