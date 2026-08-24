package importer

import (
	"testing"
)

func TestDetectSource(t *testing.T) {
	tests := []struct {
		input string
		hint  string
		want  string
	}{
		{"4b9b9c02-d96a-4933-9133-149b3dc33989", "", "musicbrainz"},
		{"https://musicbrainz.org/release/4b9b9c02-d96a-4933-9133-149b3dc33989", "", "musicbrainz"},
		{"https://musicbrainz.org/release-group/c058c42a-a9e9-4458-9a3d-4952bfbcf1f6", "", "musicbrainz"},
		{"https://musicbrainz.org/artist/b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d", "", "musicbrainz"},
		{"https://musicbrainz.org/label/4b9b9c02-d96a-4933-9133-149b3dc33989", "", "musicbrainz"},
		{"tt0816692", "", "imdb"},
		{"nm0000001", "", "imdb"},
		{"https://www.imdb.com/title/tt0816692/", "", "imdb"},
		{"https://www.imdb.com/name/nm0000001/", "", "imdb"},
		{"https://www.themoviedb.org/movie/157336", "", "tmdb"},
		{"https://www.themoviedb.org/tv/1399", "", "tmdb"},
		{"https://www.themoviedb.org/person/12345", "", "tmdb"},
		{"https://www.themoviedb.org/company/420", "", "tmdb"},
		{"https://bgm.tv/subject/364450", "", "bangumi"},
		{"https://bangumi.tv/person/123", "", "bangumi"},
		{"https://bgm.tv/character/456", "", "bangumi"},
		{"https://vndb.org/v2002", "", "vndb"},
		{"v2002", "", "vndb"},
		{"s123", "", "vndb"},
		{"c456", "", "vndb"},
		{"p789", "", "vndb"},
		{"https://movie.douban.com/subject/1292052/", "", "douban"},
		{"364450", "anime", "bangumi"},
		{"157336", "movie", "tmdb"},
	}

	for _, tt := range tests {
		got := DetectSource(tt.input, tt.hint)
		if got != tt.want {
			t.Errorf("DetectSource(%q, %q) = %q, want %q", tt.input, tt.hint, got, tt.want)
		}
	}
}

func TestDetectEntityType(t *testing.T) {
	tests := []struct {
		input string
		exp   string
		want  string
	}{
		{"https://musicbrainz.org/artist/b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d", "", "artist"},
		{"https://musicbrainz.org/label/4b9b9c02-d96a-4933-9133-149b3dc33989", "", "organization"},
		{"https://www.imdb.com/name/nm0000001/", "", "artist"},
		{"nm0000001", "", "artist"},
		{"https://www.themoviedb.org/person/12345", "", "artist"},
		{"https://www.themoviedb.org/company/420", "", "organization"},
		{"https://bgm.tv/person/123", "", "artist"},
		{"https://bgm.tv/character/456", "", "character"},
		{"https://vndb.org/s123", "", "artist"},
		{"https://vndb.org/c456", "", "character"},
		{"https://vndb.org/p789", "", "organization"},
		{"https://vndb.org/v2002", "", "work"},
		{"v2002", "work", "work"},
	}

	for _, tt := range tests {
		got := DetectEntityType(tt.input, tt.exp)
		if got != tt.want {
			t.Errorf("DetectEntityType(%q, %q) = %q, want %q", tt.input, tt.exp, got, tt.want)
		}
	}
}

func TestParseVNDBID(t *testing.T) {
	entType, id, err := ParseVNDBID("https://vndb.org/v17")
	if err != nil || entType != "work" || id != "v17" {
		t.Fatalf("ParseVNDBID VN failed: entType=%s, id=%s, err=%v", entType, id, err)
	}

	entType, id, err = ParseVNDBID("s2")
	if err != nil || entType != "artist" || id != "s2" {
		t.Fatalf("ParseVNDBID staff failed: entType=%s, id=%s, err=%v", entType, id, err)
	}

	entType, id, err = ParseVNDBID("c12")
	if err != nil || entType != "character" || id != "c12" {
		t.Fatalf("ParseVNDBID character failed: entType=%s, id=%s, err=%v", entType, id, err)
	}

	entType, id, err = ParseVNDBID("p1")
	if err != nil || entType != "organization" || id != "p1" {
		t.Fatalf("ParseVNDBID producer failed: entType=%s, id=%s, err=%v", entType, id, err)
	}
}

func TestParseMusicBrainzID(t *testing.T) {
	id, isRg, err := ParseMusicBrainzID("https://musicbrainz.org/release/4b9b9c02-d96a-4933-9133-149b3dc33989")
	if err != nil || id != "4b9b9c02-d96a-4933-9133-149b3dc33989" || isRg != false {
		t.Fatalf("ParseMusicBrainzID release failed: id=%s, isRg=%v, err=%v", id, isRg, err)
	}

	id, isRg, err = ParseMusicBrainzID("https://musicbrainz.org/release-group/c058c42a-a9e9-4458-9a3d-4952bfbcf1f6")
	if err != nil || id != "c058c42a-a9e9-4458-9a3d-4952bfbcf1f6" || isRg != true {
		t.Fatalf("ParseMusicBrainzID release group failed: id=%s, isRg=%v, err=%v", id, isRg, err)
	}
}

func TestParseBangumiID(t *testing.T) {
	id, err := ParseBangumiID("https://bgm.tv/subject/364450")
	if err != nil || id != "364450" {
		t.Fatalf("ParseBangumiID URL failed: id=%s, err=%v", id, err)
	}

	id, err = ParseBangumiID("364450")
	if err != nil || id != "364450" {
		t.Fatalf("ParseBangumiID numeric failed: id=%s, err=%v", id, err)
	}

	pid, err := ParseBangumiPersonID("https://bgm.tv/person/1234")
	if err != nil || pid != "1234" {
		t.Fatalf("ParseBangumiPersonID failed: pid=%s, err=%v", pid, err)
	}

	cid, err := ParseBangumiCharacterID("https://bgm.tv/character/5678")
	if err != nil || cid != "5678" {
		t.Fatalf("ParseBangumiCharacterID failed: cid=%s, err=%v", cid, err)
	}
}

func TestParseTMDBOrIMDbID(t *testing.T) {
	isIMDb, id, mediaType, err := ParseTMDBOrIMDbID("https://www.imdb.com/title/tt0816692/", "")
	if err != nil || !isIMDb || id != "tt0816692" {
		t.Fatalf("ParseTMDBOrIMDbID IMDb failed: isIMDb=%v, id=%s, err=%v", isIMDb, id, err)
	}

	isIMDb, id, mediaType, err = ParseTMDBOrIMDbID("https://www.themoviedb.org/movie/157336", "")
	if err != nil || isIMDb || id != "157336" || mediaType != "movie" {
		t.Fatalf("ParseTMDBOrIMDbID TMDB movie failed: isIMDb=%v, id=%s, mediaType=%s, err=%v", isIMDb, id, mediaType, err)
	}

	isIMDb, id, mediaType, err = ParseTMDBOrIMDbID("https://www.themoviedb.org/tv/1399", "")
	if err != nil || isIMDb || id != "1399" || mediaType != "tv" {
		t.Fatalf("ParseTMDBOrIMDbID TMDB tv failed: isIMDb=%v, id=%s, mediaType=%s, err=%v", isIMDb, id, mediaType, err)
	}

	isIMDbPerson, pid, err := ParseTMDBOrIMDbPersonID("https://www.imdb.com/name/nm0000001/")
	if err != nil || !isIMDbPerson || pid != "nm0000001" {
		t.Fatalf("ParseTMDBOrIMDbPersonID failed: isIMDb=%v, id=%s, err=%v", isIMDbPerson, pid, err)
	}
}
