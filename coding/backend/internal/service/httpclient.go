package service

import (
	"net"
	"net/http"
	"sync"
	"time"
)

// HTTP client pool for upstream requests.
// Reference: New API service/http_client.go - MaxIdleConns=500, Transport.Clone() for proxy variants.

var (
	defaultClient     *http.Client
	defaultClientOnce sync.Once

	streamingClient     *http.Client
	streamingClientOnce sync.Once
)

// DefaultClient returns a shared HTTP client for non-streaming upstream requests.
// Connection pool is tuned for high-concurrency relay workloads.
func DefaultClient() *http.Client {
	defaultClientOnce.Do(func() {
		defaultClient = &http.Client{
			Transport: newTransport(),
			Timeout:   60 * time.Second,
		}
	})
	return defaultClient
}

// StreamingClient returns a shared HTTP client for SSE/streaming requests.
// No overall timeout; streams are bounded by context cancellation instead.
func StreamingClient() *http.Client {
	streamingClientOnce.Do(func() {
		streamingClient = &http.Client{
			Transport: newTransport(),
			Timeout:   0,
		}
	})
	return streamingClient
}

func newTransport() *http.Transport {
	return &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		MaxIdleConns:          500,
		MaxIdleConnsPerHost:   100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		ForceAttemptHTTP2:     true,
	}
}
