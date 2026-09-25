package catalog

import (
	"fmt"
	"testing"
)

// 多图契约的服务端一侧：pictures 是数组，**数组顺序就是展示顺序、pictures[0] 就是封面**，
// 服务端不重排；role 是"这张图充当什么"的用途码（picture_role 词表），asset_id 指向
// 存储服务里的自托管对象。本文件守住三条线：用途码合法、同实体内不重复、数量封顶，
// 并且确认存量形态（没有 role/asset_id 键）照常放行——800+ 张历史封面全是那个形状。

func pictureOnlyEntity(pics ...Picture) Entity {
	return Entity{Kind: "work", Title: "W", Status: "draft", Pictures: pics}
}

func testPicture(url string) Picture {
	return Picture{
		URL:    url,
		Source: Source{Kind: "url", Citation: "test", URL: url},
	}
}

func TestPictureRoleVocabularySeeded(t *testing.T) {
	d := Defaults()
	v, ok := d.Vocabularies[pictureRoleVocabulary]
	if !ok {
		t.Fatalf("种子定义必须自带 %s 词表", pictureRoleVocabulary)
	}
	if len(v.Terms) == 0 {
		t.Fatal("picture_role 词表不能是空的：没有词条时 role 字段等于不可写")
	}
	for code, term := range v.Terms {
		if !term.Enabled {
			t.Fatalf("种子词条 %s 必须默认启用（后台可自行停用，但种子不能带停用项）", code)
		}
		for _, loc := range []string{"zh-CN", "zh-TW", "en-US"} {
			if term.Names[loc] == "" {
				t.Fatalf("词条 %s 缺 %s 名称：词表标签要四语解析，不能留英文占位", code, loc)
			}
		}
		if term.Names["ja"] == "" && term.Names["ja-JP"] == "" {
			t.Fatalf("词条 %s 缺日文名称", code)
		}
	}
}

func TestPictureRoleIsValidatedAgainstVocabulary(t *testing.T) {
	d := Defaults()
	legal := testPicture("https://example.test/a.png")
	legal.Role = "key_visual"
	if err := d.validateEntityContent(pictureOnlyEntity(legal), allowAllRef, false); err != nil {
		t.Fatalf("词表内且启用的用途码必须放行：%v", err)
	}

	unknown := testPicture("https://example.test/a.png")
	unknown.Role = "fan_art"
	if err := d.validateEntityContent(pictureOnlyEntity(unknown), allowAllRef, false); err == nil || err.Error() != "invalid_term" {
		t.Fatalf("词表外的用途码必须报 invalid_term，实际 %v", err)
	}

	// 词表被管理员整个删掉时，role 不能"没人管就随便写"：报的是定义缺失而不是放行。
	noVocab := Defaults()
	delete(noVocab.Vocabularies, pictureRoleVocabulary)
	if err := noVocab.validateEntityContent(pictureOnlyEntity(legal), allowAllRef, false); err == nil || err.Error() != "unknown_vocabulary" {
		t.Fatalf("词表缺失时必须报 unknown_vocabulary，实际 %v", err)
	}
	// 同一个文档下 role 为空的存量形态仍必须可写（不能因为词表没了就整体拒写封面）。
	if err := noVocab.validateEntityContent(pictureOnlyEntity(testPicture("https://example.test/a.png")), allowAllRef, false); err != nil {
		t.Fatalf("词表缺失不应影响未声明用途的封面：%v", err)
	}
}

// 存量形态回归：只有 url/caption/taken_at/source 四个键的历史封面必须照常通过，
// 新加的 role/asset_id 都是可选键，不是新的必填项。
func TestLegacyPictureShapeStillPasses(t *testing.T) {
	d := Defaults()
	legacy := Picture{
		URL:     "https://example.test/legacy.jpg",
		Caption: Names{"zh-CN": "封面", "zh-TW": "封面", "en-US": "Cover", "ja-JP": "カバー"},
		TakenAt: "2024-05-01",
		Source:  Source{Kind: "url", Citation: "官方页", URL: "https://example.test/page"},
	}
	for _, historical := range []bool{true, false} {
		if err := d.validateEntityContent(pictureOnlyEntity(legacy), allowAllRef, historical); err != nil {
			t.Fatalf("historical=%v 时存量封面形态必须放行：%v", historical, err)
		}
	}
}

func TestPictureURLsMustNotRepeatWithinEntity(t *testing.T) {
	d := Defaults()
	dup := testPicture("https://example.test/same.jpg")
	dup.Role = "cover_art"
	other := testPicture("https://example.test/same.jpg")
	if err := d.validateEntityContent(pictureOnlyEntity(dup, other), allowAllRef, true); err == nil || err.Error() != "duplicate_picture" {
		t.Fatalf("同一实体内重复 URL 必须报 duplicate_picture，实际 %v", err)
	}
	// 跨实体共用同一 URL 不在这里管：那是选图标注意的口径问题（复审报告里的 B 类），
	// 服务端按实体校验，没有"全局唯一"可言。
	if err := d.validateEntityContent(pictureOnlyEntity(dup, testPicture("https://example.test/other.jpg")), allowAllRef, true); err != nil {
		t.Fatalf("不同 URL 必须放行：%v", err)
	}
}

func TestPictureCountIsCapped(t *testing.T) {
	d := Defaults()
	pics := make([]Picture, 0, maxPictures+1)
	for i := 0; i < maxPictures; i++ {
		pics = append(pics, testPicture(fmt.Sprintf("https://example.test/%02d.jpg", i)))
	}
	if err := d.validateEntityContent(pictureOnlyEntity(pics...), allowAllRef, true); err != nil {
		t.Fatalf("恰好到上限必须放行（上限是写放大护栏，不是数量口径）：%v", err)
	}
	pics = append(pics, testPicture("https://example.test/overflow.jpg"))
	if err := d.validateEntityContent(pictureOnlyEntity(pics...), allowAllRef, true); err == nil || err.Error() != "too_many_pictures" {
		t.Fatalf("超过 maxPictures 必须报 too_many_pictures，实际 %v", err)
	}
}

func TestPictureAssetIDMustBeAddressable(t *testing.T) {
	d := Defaults()
	good := testPicture("https://findverse.cc/api/storage/assets/01a0aae4-38d1-7938-881b-d943ca67291b/content")
	good.AssetID = "01a0aae4-38d1-7938-881b-d943ca67291b"
	good.Role = "cover_art"
	if err := d.validateEntityContent(pictureOnlyEntity(good), allowAllRef, false); err != nil {
		t.Fatalf("合法 asset_id 必须放行：%v", err)
	}
	bad := testPicture("https://example.test/a.jpg")
	bad.AssetID = "not-a-uuid"
	if err := d.validateEntityContent(pictureOnlyEntity(bad), allowAllRef, false); err == nil || err.Error() != "invalid_picture_asset" {
		t.Fatalf("非 UUID 的 asset_id 必须报 invalid_picture_asset，实际 %v", err)
	}
}

// 顺序即契约：校验不得原地重排调用方给的顺序。
// 前端曾按 taken_at 重排过，那会让"作者把哪张放首位"失效，所以这条要钉住。
func TestValidationDoesNotReorderPictures(t *testing.T) {
	d := Defaults()
	first := testPicture("https://example.test/newer.jpg")
	first.TakenAt = "2026-01-01"
	second := testPicture("https://example.test/older.jpg")
	second.TakenAt = "2019-01-01"
	pics := []Picture{first, second}
	if err := d.validateEntityContent(pictureOnlyEntity(pics...), allowAllRef, true); err != nil {
		t.Fatalf("多图必须放行：%v", err)
	}
	if pics[0].URL != first.URL || pics[1].URL != second.URL {
		t.Fatalf("服务端不得按 taken_at 重排：期望 [%s %s]，实际 [%s %s]", first.URL, second.URL, pics[0].URL, pics[1].URL)
	}
}
