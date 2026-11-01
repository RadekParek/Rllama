package ml

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFindLibOllamaPath(t *testing.T) {
	root := t.TempDir()

	tests := []struct {
		name   string
		search libOllamaPathSearch
		dirs   []string
		want   string
	}{
		{
			name: "darwin release layout",
			search: libOllamaPathSearch{
				executable: filepath.Join(root, "darwin-app", "Ollama.app", "Contents", "Resources", "ollama"),
				goos:       "darwin",
				goarch:     "arm64",
			},
			dirs: []string{filepath.Join(root, "darwin-app", "Ollama.app", "Contents", "Resources")},
			want: filepath.Join(root, "darwin-app", "Ollama.app", "Contents", "Resources"),
		},
		{
			name: "darwin standard install layout",
			search: libOllamaPathSearch{
				executable: filepath.Join(root, "darwin-install", "bin", "ollama"),
				goos:       "darwin",
				goarch:     "arm64",
			},
			dirs: []string{filepath.Join(root, "darwin-install", "lib", "ollama")},
			want: filepath.Join(root, "darwin-install", "lib", "ollama"),
		},
		{
			name: "windows release layout",
			search: libOllamaPathSearch{
				executable: filepath.Join(root, "windows-release", "ollama.exe"),
				goos:       "windows",
				goarch:     "amd64",
			},
			dirs: []string{filepath.Join(root, "windows-release", "lib", "ollama")},
			want: filepath.Join(root, "windows-release", "lib", "ollama"),
		},
		{
			name: "windows standard install layout",
			search: libOllamaPathSearch{
				executable: filepath.Join(root, "windows-install", "bin", "ollama.exe"),
				goos:       "windows",
				goarch:     "amd64",
			},
			dirs: []string{filepath.Join(root, "windows-install", "lib", "ollama")},
			want: filepath.Join(root, "windows-install", "lib", "ollama"),
		},
		{
			name: "linux standard install layout",
			search: libOllamaPathSearch{
				executable: filepath.Join(root, "linux-install", "bin", "ollama"),
				goos:       "linux",
				goarch:     "amd64",
			},
			dirs: []string{filepath.Join(root, "linux-install", "lib", "ollama")},
			want: filepath.Join(root, "linux-install", "lib", "ollama"),
		},
		{
			name: "local linux underscore dist layout",
			search: libOllamaPathSearch{
				executable: filepath.Join(root, "linux-dev", "ollama"),
				workingDir: filepath.Join(root, "linux-dev"),
				goos:       "linux",
				goarch:     "amd64",
			},
			dirs: []string{filepath.Join(root, "linux-dev", "dist", "linux_amd64", "lib", "ollama")},
			want: filepath.Join(root, "linux-dev", "dist", "linux_amd64", "lib", "ollama"),
		},
		{
			name: "mlx-only standard install layout",
			search: libOllamaPathSearch{
				executable: filepath.Join(root, "mlx-install", "bin", "ollama"),
				goos:       "linux",
				goarch:     "amd64",
			},
			dirs: []string{filepath.Join(root, "mlx-install", "lib", "ollama")},
			want: filepath.Join(root, "mlx-install", "lib", "ollama"),
		},
		{
			name: "darwin local build layout before executable directory fallback",
			search: libOllamaPathSearch{
				executable: filepath.Join(root, "darwin-dev", "ollama"),
				workingDir: filepath.Join(root, "darwin-dev"),
				goos:       "darwin",
				goarch:     "arm64",
			},
			dirs: []string{filepath.Join(root, "darwin-dev", "build", "lib", "ollama")},
			want: filepath.Join(root, "darwin-dev", "build", "lib", "ollama"),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for _, dir := range tt.dirs {
				if err := os.MkdirAll(dir, 0o755); err != nil {
					t.Fatal(err)
				}
			}

			got := findLibOllamaPath(tt.search)
			if got != tt.want {
				t.Fatalf("findLibOllamaPath() = %q, want %q; candidates: %v", got, tt.want, libOllamaPathCandidates(tt.search))
			}
		})
	}
}

func TestFindLibOllamaPathAndroidNativeLibraryDir(t *testing.T) {
	root := t.TempDir()
	nativeLibDir := filepath.Join(root, "data", "app", "~~rllama", "lib", "arm64")
	if err := os.MkdirAll(nativeLibDir, 0o755); err != nil {
		t.Fatal(err)
	}

	search := libOllamaPathSearch{
		executable: filepath.Join(nativeLibDir, "libollama.so"),
		goos:       "android",
		goarch:     "arm64",
	}
	if got := findLibOllamaPath(search); got != nativeLibDir {
		t.Fatalf("findLibOllamaPath() = %q, want %q; candidates: %v", got, nativeLibDir, libOllamaPathCandidates(search))
	}
}

func TestFindLibOllamaPathEnvOverride(t *testing.T) {
	root := t.TempDir()
	payloadDir := filepath.Join(root, "payload")
	if err := os.MkdirAll(payloadDir, 0o755); err != nil {
		t.Fatal(err)
	}

	search := libOllamaPathSearch{
		executable: filepath.Join(root, "bin", "ollama"),
		goos:       "linux",
		goarch:     "arm64",
		envPath:    payloadDir,
	}
	candidates := libOllamaPathCandidates(search)
	if len(candidates) == 0 || candidates[0] != payloadDir {
		t.Fatalf("first candidate = %v, want %q", candidates, payloadDir)
	}
	if got := findLibOllamaPath(search); got != payloadDir {
		t.Fatalf("findLibOllamaPath() = %q, want %q", got, payloadDir)
	}
}
