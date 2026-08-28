package config

import "testing"

func TestSuggestToolID(t *testing.T) {
	existing := []ToolMapping{{ID: "my-skills", Path: `D:\x`}}
	id := SuggestToolID(`D:\repos\my-skills`, existing)
	if id != "my-skills-2" {
		t.Fatalf("id=%q", id)
	}
	id2 := SuggestToolID(`C:\Users\a\.agents\skills`, nil)
	if id2 != "agents" {
		t.Fatalf("id2=%q", id2)
	}
}
