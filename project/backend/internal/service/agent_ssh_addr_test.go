package service

import "testing"

// TestSshDialAddressNormalizesPastedHosts covers the host shapes operators
// paste from tunnel providers / ssh URLs: scheme prefixes, embedded ports,
// user@, IPv6 with or without brackets, and trailing slashes.
func TestSshDialAddressNormalizesPastedHosts(t *testing.T) {
	cases := []struct {
		name string
		host string
		port int
		want string
	}{
		{"plain host", "192.168.1.100", 22, "192.168.1.100:22"},
		{"tcp scheme from tunnel provider", "tcp://998pkkg09745.vicp.fun", 34604, "998pkkg09745.vicp.fun:34604"},
		{"ssh url with user and port", "ssh://wooh@192.168.31.200:2222", 22, "192.168.31.200:2222"},
		{"embedded port overrides field", "gateway.example.com:2200", 22, "gateway.example.com:2200"},
		{"trailing slash", "tcp://host.example/", 22, "host.example:22"},
		{"bracketed ipv6 with port", "[2001:db8::1]:2200", 22, "[2001:db8::1]:2200"},
		{"bracketed ipv6 without port", "[2001:db8::1]", 22, "[2001:db8::1]:22"},
		{"bare ipv6", "2001:db8::1", 22, "[2001:db8::1]:22"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := sshDialAddress(tc.host, tc.port); got != tc.want {
				t.Fatalf("sshDialAddress(%q, %d) = %q, want %q", tc.host, tc.port, got, tc.want)
			}
		})
	}
}
