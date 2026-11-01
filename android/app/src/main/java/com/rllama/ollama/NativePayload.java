package com.rllama.ollama;

import android.content.Context;
import android.content.pm.ApplicationInfo;

import java.io.File;
import java.util.HashMap;
import java.util.Map;

/**
 * Locates the bundled native payload and builds the environment it needs.
 *
 * The payload is shipped inside the APK as {@code libollama.so} and
 * {@code libllama-server.so}. The package manager extracts those files into the
 * app's native library directory, which is the only location modern Android
 * lets an app execute binaries from. The renamed files are still ordinary
 * executables, and Ollama finds them by name (see llm/llama_binary.go).
 */
public final class NativePayload {
    public static final String OLLAMA_LIB_NAME = "libollama.so";
    public static final String LLAMA_SERVER_LIB_NAME = "libllama-server.so";

    private NativePayload() {
    }

    public static File nativeLibDir(Context context) {
        ApplicationInfo info = context.getApplicationContext().getApplicationInfo();
        if (info.nativeLibraryDir == null) {
            return new File(context.getApplicationInfo().dataDir, "lib");
        }
        return new File(info.nativeLibraryDir);
    }

    public static File ollamaBinary(Context context) {
        return new File(nativeLibDir(context), OLLAMA_LIB_NAME);
    }

    public static File llamaServerBinary(Context context) {
        return new File(nativeLibDir(context), LLAMA_SERVER_LIB_NAME);
    }

    public static boolean hasOllama(Context context) {
        return ollamaBinary(context).isFile();
    }

    /**
     * Makes a payload file executable.
     *
     * The package manager extracts native libraries with read-only permissions
     * on some Android releases, so an explicit chmod is required before the app
     * can spawn the bundled binaries. The files live in the app's read-only
     * native library directory, but they are owned by the app uid, so the chmod
     * itself is allowed.
     */
    public static boolean ensureExecutable(File file) {
        if (file == null || !file.isFile()) {
            return false;
        }
        if (file.canExecute()) {
            return true;
        }
        boolean changed = file.setExecutable(true, false);
        if (changed && file.canExecute()) {
            return true;
        }
        try {
            android.system.Os.chmod(file.getAbsolutePath(), 0755);
        } catch (Exception e) {
            android.util.Log.w("RllamaPayload", "chmod failed for " + file + ": " + e.getMessage());
        }
        return file.canExecute();
    }

    private static volatile String cachedVerification;

    /**
     * Runs {@code ollama --version} once to prove the payload can really be
     * executed on this device. Cached because it costs a process spawn.
     */
    public static String verify(Context context, Prefs prefs) {
        String cached = cachedVerification;
        if (cached != null) {
            return cached;
        }
        File binary = ollamaBinary(context);
        if (!binary.isFile()) {
            cachedVerification = "payload missing: " + binary.getAbsolutePath();
            return cachedVerification;
        }
        if (!ensureExecutable(binary)) {
            cachedVerification = "payload not executable: " + binary.getAbsolutePath();
            return cachedVerification;
        }

        Process process = null;
        try {
            ProcessBuilder builder = new ProcessBuilder(binary.getAbsolutePath(), "--version");
            builder.redirectErrorStream(true);
            builder.directory(context.getFilesDir());
            Map<String, String> env = builder.environment();
            env.clear();
            env.putAll(environment(context, prefs));
            process = builder.start();
            java.io.BufferedReader reader = new java.io.BufferedReader(
                    new java.io.InputStreamReader(process.getInputStream()));
            StringBuilder output = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null && output.length() < 400) {
                output.append(line).append(' ');
            }
            int exit = process.waitFor();
            String text = output.toString().trim();
            if (text.isEmpty()) {
                text = "exit " + exit;
            }
            cachedVerification = text;
        } catch (Exception e) {
            cachedVerification = "cannot execute payload: " + e.getMessage();
        } finally {
            if (process != null) {
                process.destroy();
            }
        }
        return cachedVerification;
    }

    public static boolean hasLlamaServer(Context context) {
        return llamaServerBinary(context).isFile();
    }

    /** Human readable summary used by the UI and diagnostics. */
    public static String describe(Context context) {
        StringBuilder sb = new StringBuilder();
        sb.append("native libs: ").append(nativeLibDir(context).getAbsolutePath()).append('\n');
        sb.append("ollama: ").append(hasOllama(context) ? "present" : "missing").append('\n');
        sb.append("llama-server: ").append(hasLlamaServer(context) ? "present" : "missing").append('\n');
        sb.append("abi: ").append(android.os.Build.SUPPORTED_ABIS.length > 0 ? android.os.Build.SUPPORTED_ABIS[0] : "unknown");
        sb.append('\n').append("selftest: ").append(cachedVerification == null ? "(not run yet)" : cachedVerification);
        return sb.toString();
    }

    /**
     * Environment shared by every process the app spawns. Ollama's own variables
     * win over anything inherited from the Android app process.
     */
    public static Map<String, String> environment(Context context, Prefs prefs) {
        Context app = context.getApplicationContext();
        Map<String, String> env = new HashMap<>(System.getenv());

        File home = new File(app.getFilesDir(), "home");
        File models = prefs.modelDir();
        File work = prefs.workDir();
        mkdirs(home);
        mkdirs(models);
        mkdirs(work);

        String nativeDir = nativeLibDir(app).getAbsolutePath();
        env.put("HOME", home.getAbsolutePath());
        env.put("TMPDIR", app.getCacheDir().getAbsolutePath());
        env.put("XDG_CACHE_HOME", new File(home, ".cache").getAbsolutePath());
        env.put("PATH", nativeDir + ":/system/bin:/system/xbin:/vendor/bin");
        env.put("LD_LIBRARY_PATH", nativeDir);
        env.put("OLLAMA_MODELS", models.getAbsolutePath());
        env.put("OLLAMA_LIBRARY_PATH", nativeDir);
        env.put("OLLAMA_HOST", bindAddress(prefs));
        env.put("OLLAMA_NUM_PARALLEL", Integer.toString(prefs.numParallel()));
        env.put("OLLAMA_MAX_LOADED_MODELS", "1");
        env.put("OLLAMA_KEEP_ALIVE", prefs.keepAlive());
        env.put("OLLAMA_ORIGINS", "*");
        if (prefs.contextLength() > 0) {
            env.put("OLLAMA_CONTEXT_LENGTH", Integer.toString(prefs.contextLength()));
        } else {
            env.remove("OLLAMA_CONTEXT_LENGTH");
        }
        if (prefs.debugLogs()) {
            env.put("OLLAMA_DEBUG", "1");
        }
        return env;
    }

    /** {@code host:port} the server binds to. */
    public static String bindAddress(Prefs prefs) {
        String host = prefs.lanEnabled() ? "0.0.0.0" : "127.0.0.1";
        return host + ":" + prefs.port();
    }

    /** {@code host:port} used by clients running on this device. */
    public static String loopbackAddress(Prefs prefs) {
        return "127.0.0.1:" + prefs.port();
    }

    public static String[] toArray(Map<String, String> env) {
        String[] result = new String[env.size()];
        int i = 0;
        for (Map.Entry<String, String> entry : env.entrySet()) {
            result[i++] = entry.getKey() + "=" + entry.getValue();
        }
        return result;
    }

    static void mkdirs(File dir) {
        if (!dir.isDirectory() && !dir.mkdirs() && !dir.isDirectory()) {
            android.util.Log.w("RllamaPayload", "could not create " + dir);
        }
    }
}
