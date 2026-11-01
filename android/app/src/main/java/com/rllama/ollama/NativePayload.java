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

    private static volatile File resolvedPayloadDir;

    /**
     * Directory that actually holds runnable copies of the binaries.
     *
     * Normally that is the app's native library directory. A few devices refuse
     * to execute anything there (or extract the files without the exec bit and
     * block the chmod), so as a last resort the payload is copied into the app's
     * private files directory, which older Android releases allow to execute.
     */
    public static File payloadDir(Context context) {
        File cached = resolvedPayloadDir;
        if (cached != null) {
            return cached;
        }
        synchronized (NativePayload.class) {
            if (resolvedPayloadDir != null) {
                return resolvedPayloadDir;
            }
            Context app = context.getApplicationContext();
            File nativeDir = nativeLibDir(app);
            File ollama = new File(nativeDir, OLLAMA_LIB_NAME);
            File llama = new File(nativeDir, LLAMA_SERVER_LIB_NAME);
            ensureExecutable(ollama);
            ensureExecutable(llama);

            File resolved = nativeDir;
            if (ollama.isFile() && !canRun(ollama, app)) {
                File fallback = new File(app.getFilesDir(), "payload");
                File fallbackOllama = new File(fallback, OLLAMA_LIB_NAME);
                File fallbackLlama = new File(fallback, LLAMA_SERVER_LIB_NAME);
                if (mkdirs(fallback)
                        && copyFile(ollama, fallbackOllama)
                        && copyFile(llama, fallbackLlama)) {
                    ensureExecutable(fallbackOllama);
                    ensureExecutable(fallbackLlama);
                    if (canRun(fallbackOllama, app)) {
                        android.util.Log.i("RllamaPayload", "using writable payload copy in " + fallback);
                        resolved = fallback;
                    }
                }
            }
            resolvedPayloadDir = resolved;
            return resolved;
        }
    }

    public static File ollamaBinary(Context context) {
        return new File(payloadDir(context), OLLAMA_LIB_NAME);
    }

    public static File llamaServerBinary(Context context) {
        return new File(payloadDir(context), LLAMA_SERVER_LIB_NAME);
    }

    /** Runs {@code <binary> --version} to prove the file can really be executed. */
    static boolean canRun(File binary, Context context) {
        if (binary == null || !binary.isFile() || !binary.canExecute()) {
            return false;
        }
        Process process = null;
        try {
            ProcessBuilder builder = new ProcessBuilder(binary.getAbsolutePath(), "--version");
            builder.redirectErrorStream(true);
            builder.environment().put("HOME", new File(context.getFilesDir(), "home").getAbsolutePath());
            process = builder.start();
            // Bound the probe so a wedged binary can never hang the UI.
            return process.waitFor(10, java.util.concurrent.TimeUnit.SECONDS) && process.exitValue() == 0;
        } catch (Exception e) {
            android.util.Log.w("RllamaPayload", "cannot execute " + binary + ": " + e.getMessage());
            return false;
        } finally {
            if (process != null) {
                process.destroy();
            }
        }
    }

    private static boolean copyFile(File from, File to) {
        if (!from.isFile()) {
            return false;
        }
        java.io.InputStream in = null;
        java.io.OutputStream out = null;
        try {
            in = new java.io.FileInputStream(from);
            out = new java.io.FileOutputStream(to);
            byte[] buffer = new byte[1 << 16];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
            out.flush();
            return true;
        } catch (Exception e) {
            android.util.Log.w("RllamaPayload", "copy failed: " + e.getMessage());
            return false;
        } finally {
            closeQuietly(in);
            closeQuietly(out);
        }
    }

    private static void closeQuietly(java.io.Closeable closeable) {
        if (closeable == null) {
            return;
        }
        try {
            closeable.close();
        } catch (Exception ignored) {
            // best effort
        }
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
        File payload = payloadDir(context);
        File ollama = new File(payload, OLLAMA_LIB_NAME);
        File llama = new File(payload, LLAMA_SERVER_LIB_NAME);
        StringBuilder sb = new StringBuilder();
        sb.append("android: ").append(android.os.Build.VERSION.RELEASE)
                .append(" (api ").append(android.os.Build.VERSION.SDK_INT).append(")\n");
        sb.append("abi: ").append(android.os.Build.SUPPORTED_ABIS.length > 0
                ? android.os.Build.SUPPORTED_ABIS[0] : "unknown").append('\n');
        sb.append("payload: ").append(payload.getAbsolutePath()).append('\n');
        sb.append("  ").append(OLLAMA_LIB_NAME).append(": ").append(describeFile(ollama)).append('\n');
        sb.append("  ").append(LLAMA_SERVER_LIB_NAME).append(": ").append(describeFile(llama)).append('\n');
        sb.append("selftest: ").append(cachedVerification == null ? "(not run yet)" : cachedVerification);
        return sb.toString();
    }

    private static String describeFile(File file) {
        if (!file.isFile()) {
            return "missing";
        }
        return (file.canExecute() ? "ok (" : "not executable (") + file.length() + " bytes)";
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

        String nativeDir = payloadDir(app).getAbsolutePath();
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

    static boolean mkdirs(File dir) {
        if (dir.isDirectory()) {
            return true;
        }
        if (!dir.mkdirs() && !dir.isDirectory()) {
            android.util.Log.w("RllamaPayload", "could not create " + dir);
            return false;
        }
        return true;
    }
}
