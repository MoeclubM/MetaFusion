package catalog

import "testing"

func TestMergeSeedDefinitionsFillsMissingBonusSemantic(t *testing.T) {
	seed := Defaults()
	role := seed.Vocabularies["role"]
	supplement := role.Terms["supplement"]
	if supplement.IsBonus == nil || !*supplement.IsBonus {
		t.Fatal("seed supplement role must be marked as bonus content")
	}

	legacyTerms := make(map[string]Term, len(role.Terms))
	for code, term := range role.Terms {
		term.IsBonus = nil
		legacyTerms[code] = term
	}
	current := Definitions{
		Types:        map[string]TypeDefinition{},
		Fields:       map[string]Field{},
		Vocabularies: map[string]Vocabulary{"role": {Names: role.Names, Terms: legacyTerms}},
		Relations:    map[string]RelationDefinition{},
		Templates:    map[string]Template{},
		Schemes:      map[string]Scheme{},
	}

	merged, added := mergeSeedDefinitions(current, seed)
	got := merged.Vocabularies["role"].Terms["supplement"].IsBonus
	if got == nil || !*got {
		t.Fatal("missing legacy semantic should be filled from seed")
	}
	if !contains(added, "vocabularies.role.terms.supplement.is_bonus") {
		t.Fatalf("semantic update should be reported: %v", added)
	}
	_, again := mergeSeedDefinitions(merged, seed)
	if contains(again, "vocabularies.role.terms.supplement.is_bonus") {
		t.Fatalf("semantic backfill should be idempotent: %v", again)
	}

	// Explicit false is a GUI decision and must survive later seed merges.
	falseValue := false
	explicit := current
	explicitRole := role
	explicitRole.Terms = make(map[string]Term, len(legacyTerms))
	for code, term := range legacyTerms {
		explicitRole.Terms[code] = term
	}
	term := explicitRole.Terms["supplement"]
	term.IsBonus = &falseValue
	explicitRole.Terms["supplement"] = term
	explicit.Vocabularies = map[string]Vocabulary{"role": explicitRole}
	kept, _ := mergeSeedDefinitions(explicit, seed)
	got = kept.Vocabularies["role"].Terms["supplement"].IsBonus
	if got == nil || *got {
		t.Fatal("explicit false semantic must not be overwritten")
	}
}
