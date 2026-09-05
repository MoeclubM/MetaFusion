package models

// 假名范围：平假名 (3040-309F)、片假名 (30A0-30FF)。
const (
	hiraganaStart = 0x3040
	katakanaEnd   = 0x30FF
)

// 繁体特有字形采样：这些字形不在简体规范集（GB2312 常用字）中，
// 出现即强烈暗示繁体文本。检测是启发式——用于把别名中的繁体标题
// 归入 zh-TW 翻译行；误判代价低（仍作为同义标题展示与检索）。
var traditionalMarkers = map[rune]bool{}

// 简体特有字形采样：与繁体标记互斥使用，避免两岸同形字符误判。
var simplifiedMarkers = map[rune]bool{}

func init() {
	for _, r := range "們會學國東車馬飛龍語書長門開關問間電腦體藝藥衛廣慶應導覽櫻榮營變還奪從鐵風鳥戰優歷圖館齊賢絲織絕繼續練總編擴權歡欄標樞機殘滅燭燈環現當發盜盡監盤眾質販購贈誌認誘說調謝證議讓貝負財貨貼貴費賀資賽賞趕跡軌軍軒輔輛轉辦辭邊達遷遠適遲遜遞遺郵鄭釀銜銷鋪錄鍵鎖鏡閉閃閒閱陽際難雲電需靜頁頂順須頗領頻題額養餐餘駐騙鳴鴻齒" {
		traditionalMarkers[r] = true
	}
	for _, r := range "们会学国东车马飞龙语书长门开关问间电脑体艺药卫广庆应导览樱荣营变铁风鸟战优历图馆齐贤丝织绝继续练总编扩权欢栏标枢机残灭烛灯环现当发盗尽监盘众质贩购赠志认诱说调谢证议让贝负财货贴贵费贺资赛赏赶迹轨军轩辅辆转办辞边达迁远适迟逊递遗邮郑酿衔销铺录键锁镜闭闪闲阅阳际难云电需静页顶顺须领频题额养餐余驻骗鸣鸿齿" {
		simplifiedMarkers[r] = true
	}
}

// DetectCJKScript 对中日文文本做粗粒度语种猜测：
// 含假名 → "ja"；含繁体特有字形且无简体特有字形 → "zh-TW"；否则 ""。
// 用于把实体级 aliases 中可识别语种的异名归入对应翻译行。
func DetectCJKScript(s string) string {
	trad, simp := false, false
	for _, r := range s {
		if r >= hiraganaStart && r <= katakanaEnd {
			return "ja"
		}
		if traditionalMarkers[r] {
			trad = true
		} else if simplifiedMarkers[r] {
			simp = true
		}
	}
	if trad && !simp {
		return "zh-TW"
	}
	return ""
}
