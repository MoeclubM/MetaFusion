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
		{"tt0816692", "", "imdb"},
		{"https://www.imdb.com/title/tt0816692/", "", "imdb"},
		{"https://www.themoviedb.org/movie/157336", "", "tmdb"},
		{"https://www.themoviedb.org/tv/1399", "", "tmdb"},
		{"https://bgm.tv/subject/364450", "", "bangumi"},
		{"https://bangumi.tv/subject/364450", "", "bangumi"},
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
}
