// Package i18n provides a minimal server-side language switch for the
// handful of user-visible strings the backend produces at runtime (probe
// results, log capture type labels, relay errors). The dashboard frontend
// already translates structured errors by code; these helpers cover the
// remaining inline strings, keyed off the Accept-Language header.
package i18n

import (
	"net/http"
	"strings"
)

// Lang returns the client language ("en" or "zh") from the request's
// Accept-Language header. A nil request or an unrecognised header yields
// "zh", matching the backend's default language.
func Lang(r *http.Request) string {
	if r == nil {
		return "zh"
	}
	return LangFromHeader(r.Header.Get("Accept-Language"))
}

// LangFromHeader parses a raw Accept-Language value ("en-US,en;q=0.9").
func LangFromHeader(al string) string {
	for _, part := range strings.Split(al, ",") {
		tag := strings.TrimSpace(part)
		if len(tag) < 2 {
			continue
		}
		switch tag[:2] {
		case "en":
			return "en"
		case "zh":
			return "zh"
		}
	}
	return "zh"
}

// S picks the string matching lang. English callers pass the two literals;
// the Chinese form is the canonical default.
func S(lang, zh, en string) string {
	if lang == "en" {
		return en
	}
	return zh
}
