package handler

import (
	"github.com/gin-gonic/gin"
)

// respondError writes a structured error response. `code` is a stable,
// machine-readable identifier the frontend maps to a translation; `message` is
// the human-readable fallback (Chinese) shown when no translation exists yet.
func respondError(c *gin.Context, status int, code, message string) {
	c.JSON(status, gin.H{"error": message, "code": code})
}

// respondErrorWithParams is respondError plus interpolation values for messages
// that embed dynamic values (e.g. a duplicate name). The frontend interpolates
// these into the translation template.
func respondErrorWithParams(c *gin.Context, status int, code, message string, params gin.H) {
	c.JSON(status, gin.H{"error": message, "code": code, "params": params})
}
