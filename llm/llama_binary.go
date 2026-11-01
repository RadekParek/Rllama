package llm

import (
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"

	"github.com/ollama/ollama/ml"
)

type llamaCppBinarySearch struct {
	libOllamaPath string
	executable    string
	workingDir    string
	goos          string
	goarch        string
}

func defaultLlamaCppBinarySearch() llamaCppBinarySearch {
	executable, _ := os.Executable()
	if executable != "" {
		if eval, err := filepath.EvalSymlinks(executable); err == nil {
			executable = eval
		}
	}

	workingDir, _ := os.Getwd()
	return llamaCppBinarySearch{
		libOllamaPath: ml.LibOllamaPath,
		executable:    executable,
		workingDir:    workingDir,
		goos:          runtime.GOOS,
		goarch:        runtime.GOARCH,
	}
}

func findLlamaCppBinary(name string, search llamaCppBinarySearch) (string, []string, error) {
	candidates := llamaCppBinaryCandidates(name, search)
	for _, path := range candidates {
		if _, err := os.Stat(path); err == nil {
			return path, candidates, nil
		}
	}

	// Android apps can only execute files that the package manager extracted
	// into the app's native library directory, and it only extracts entries
	// named lib*.so. Release builds therefore ship llama-server as
	// libllama-server.so, so retry the plain candidates with that spelling
	// before reporting the payload as missing.
	sharedLibraryCandidates := llamaCppSharedLibraryCandidates(name, candidates)
	for _, path := range sharedLibraryCandidates {
		if _, err := os.Stat(path); err == nil {
			return path, append(candidates, sharedLibraryCandidates...), nil
		}
	}

	return "", append(candidates, sharedLibraryCandidates...), os.ErrNotExist
}

// llamaCppSharedLibraryCandidates rewrites every candidate to the shared
// library spelling ("llama-server" -> "libllama-server.so") used by packaging
// formats that only accept files named lib*.so, most notably Android APKs.
func llamaCppSharedLibraryCandidates(name string, candidates []string) []string {
	if filepath.Ext(name) != "" {
		// Windows binaries keep their .exe suffix and are never repackaged.
		return nil
	}

	libName := "lib" + name + ".so"
	seen := map[string]bool{}
	sharedLibraryCandidates := make([]string, 0, len(candidates))
	for _, path := range candidates {
		candidate := filepath.Join(filepath.Dir(path), libName)
		if seen[candidate] {
			continue
		}
		seen[candidate] = true
		sharedLibraryCandidates = append(sharedLibraryCandidates, candidate)
	}
	return sharedLibraryCandidates
}

func llamaCppBinaryCandidates(name string, search llamaCppBinarySearch) []string {
	goos := search.goos
	if goos == "" {
		goos = runtime.GOOS
	}
	goarch := search.goarch
	if goarch == "" {
		goarch = runtime.GOARCH
	}

	suffix := llamaCppBinaryName(name, goos)
	seen := map[string]bool{}
	var candidates []string
	add := func(dir string) {
		if dir == "" {
			return
		}
		path := filepath.Clean(filepath.Join(dir, suffix))
		if !seen[path] {
			seen[path] = true
			candidates = append(candidates, path)
		}
	}

	add(search.libOllamaPath)

	addPackagedLayoutDirs := func(base string) {
		if base == "" {
			return
		}
		switch goos {
		case "darwin":
			// macOS tarballs and apps colocate llama.cpp helpers with ollama.
			add(base)
			// Per-architecture local dist output keeps helpers under lib/ollama.
			add(filepath.Join(base, "lib", "ollama"))
			// Standard CMake installs put ollama in bin/ and helpers in ../lib/ollama/.
			add(filepath.Join(base, "..", "lib", "ollama"))
		case "linux":
			// Linux packages install ollama in bin/ and helpers in ../lib/ollama/.
			add(filepath.Join(base, "..", "lib", "ollama"))
		case "windows":
			// Windows packages keep ollama.exe at top level with lib/ as a peer.
			add(filepath.Join(base, "lib", "ollama"))
			// Standard CMake installs put ollama.exe in bin/ and helpers in ../lib/ollama/.
			add(filepath.Join(base, "..", "lib", "ollama"))
		default:
			add(filepath.Join(base, "lib", "ollama"))
			add(filepath.Join(base, "..", "lib", "ollama"))
		}
	}

	addLocalLayoutDirs := func(base string) {
		if base == "" {
			return
		}
		add(filepath.Join(base, "build", "lib", "ollama"))
		add(filepath.Join(base, "dist", goos+"-"+goarch, "lib", "ollama"))
		if goos+"_"+goarch != goos+"-"+goarch {
			add(filepath.Join(base, "dist", goos+"_"+goarch, "lib", "ollama"))
		}
		if goos == "darwin" {
			add(filepath.Join(base, "dist", "darwin"))
		}
	}

	if search.executable != "" {
		exeDir := filepath.Dir(search.executable)
		addPackagedLayoutDirs(exeDir)
		addLocalLayoutDirs(exeDir)
	}
	if search.workingDir != "" {
		addLocalLayoutDirs(search.workingDir)
	}

	addBuildOutputDirs := func(base string) {
		if base == "" {
			return
		}
		matches, _ := filepath.Glob(filepath.Join(base, "build", "llama-server-*", "bin"))
		slices.SortFunc(matches, func(a, b string) int {
			if rank := llamaCppBuildOutputRank(a) - llamaCppBuildOutputRank(b); rank != 0 {
				return rank
			}
			return strings.Compare(a, b)
		})
		for _, m := range matches {
			add(m)
		}
	}
	if search.executable != "" {
		addBuildOutputDirs(filepath.Dir(search.executable))
	}
	addBuildOutputDirs(search.workingDir)

	return candidates
}

func llamaCppBinaryName(name, goos string) string {
	if goos == "windows" && filepath.Ext(name) == "" {
		return name + ".exe"
	}
	return name
}

func llamaCppBuildOutputRank(path string) int {
	if strings.Contains(path, "llama-server-darwin") ||
		strings.Contains(path, "llama-server-cuda") ||
		strings.Contains(path, "llama-server-rocm") {
		return 0
	}
	return 1
}
