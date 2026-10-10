package service

import "testing"

// TestRemotePathExprExpandsHome pins the fix for the SSH tilde bug: the
// takeover rules store paths like `~/.dsh/profiles/web/cordis.patch.yml`,
// and quoting them whole made the remote shell treat `~` literally, so
// reads always failed with "No such file or directory" even when the file
// existed. The home prefix must expand remotely; the remainder must stay
// safely quoted.
func TestRemotePathExprExpandsHome(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"tilde path", "~/.dsh/profiles/web/cordis.patch.yml", `"$HOME"'/.dsh/profiles/web/cordis.patch.yml'`},
		{"bare tilde", "~", `"$HOME"`},
		{"home var path", "$HOME/.config/opencode/opencode.json", `"$HOME"'/.config/opencode/opencode.json'`},
		{"braced home var path", "${HOME}/.codex/config.toml", `"$HOME"'/.codex/config.toml'`},
		{"braced bare home var", "${HOME}", `"$HOME"`},
		{"absolute path unchanged", "/etc/opencode.json", `'/etc/opencode.json'`},
		{"mid-path tilde untouched", "/opt/~/x", `'/opt/~/x'`},
		{"user tilde untouched", "~root/x.json", `'~root/x.json'`},
		{"embedded quote escaped", "~/a'b", `"$HOME"'/a'\''b'`},
		{"path with space", "~/my dir/x.json", `"$HOME"'/my dir/x.json'`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := remotePathExpr(tc.in); got != tc.want {
				t.Fatalf("remotePathExpr(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// TestRemoteCommandsUseHomeExpr checks the three remote command builders
// that consume user paths: read, atomic write, and the connection probe.
// Windows branches keep their cmd.exe quoting (cmd expands %VAR% inside
// double quotes by itself).
func TestRemoteCommandsUseHomeExpr(t *testing.T) {
	home := `"$HOME"'/.dsh/profiles/web/cordis.patch.yml'`

	if got, want := remoteReadCommand("mac", "~/.dsh/profiles/web/cordis.patch.yml"), "cat "+home; got != want {
		t.Fatalf("remoteReadCommand = %q, want %q", got, want)
	}
	if got, want := remoteReadCommand("windows", `%USERPROFILE%\.dsh\x.yml`), `type "%USERPROFILE%\.dsh\x.yml"`; got != want {
		t.Fatalf("remoteReadCommand(windows) = %q, want %q", got, want)
	}

	wantWrite := `sh -c 'tmp=$(mktemp) && cat > "$tmp" && mv -f "$tmp" "$1"' sh ` + home
	if got := remoteWriteCommand("other", "~/.dsh/profiles/web/cordis.patch.yml"); got != wantWrite {
		t.Fatalf("remoteWriteCommand = %q, want %q", got, wantWrite)
	}
	if got := probeReadCommand("mac", "~/.dsh/profiles/web/cordis.patch.yml"); got != "cat "+home+" && echo __OK__" {
		t.Fatalf("probeReadCommand = %q", got)
	}
	if got, want := probeReadCommand("other", "/tmp/x.json"), "cat '/tmp/x.json' && echo __OK__"; got != want {
		t.Fatalf("probeReadCommand(absolute) = %q, want %q", got, want)
	}
}
