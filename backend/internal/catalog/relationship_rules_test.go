package catalog

import "testing"

func TestStructuralRelationshipNamesFollowDefinitions(t *testing.T) {
	d := Defaults()
	medium := d.Structure["medium"]
	for i := range medium.Fields {
		if medium.Fields[i].Code == "release_id" {
			medium.Fields[i].Names = names4("收有载体", "收有載體", "媒体を収める", "Holds medium")
			medium.Fields[i].ReverseNames = names4("归于版本", "歸於版本", "版に属する", "Part of edition")
		}
	}
	d.Structure["medium"] = medium
	if err := d.Validate(); err != nil {
		t.Fatalf("editable structural names rejected: %v", err)
	}
	for _, rule := range RelationshipRules(d) {
		if rule.Code == "structure:release_medium" {
			if rule.Names["zh-CN"] != "收有载体" || rule.ReverseNames["en-US"] != "Part of edition" {
				t.Fatalf("rule did not use edited names: %+v", rule)
			}
			return
		}
	}
	t.Fatal("release-medium structural rule missing")
}

func TestStructuralRelationshipNamesRequired(t *testing.T) {
	d := Defaults()
	medium := d.Structure["medium"]
	medium.Fields[0].Names = nil
	d.Structure["medium"] = medium
	if err := d.Validate(); err == nil {
		t.Fatal("missing structural name was accepted")
	}
}
