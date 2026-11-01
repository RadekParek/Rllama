package com.rllama.ollama;

import android.content.Context;

import java.io.Closeable;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Locates the Ollama binaries that ship inside the APK and builds the
 * environment the desktop binary expects.
 *
 * <p>Android only executes files that the package manager extracted into the
 * app's native library directory, and it only extracts entries named
 * {@code lib*.so}. The APK therefore carries the Go CLI/server as
 * {@code libollama.so} and llama.cpp's server as {@code libllama-server.so},
 * side by side in {@code lib/arm64-v8a/}. This class is the only Android
 * specific part of the runtime: everything else is stock Ollama.
 */
public final class NativePayload {
    public static final String OLLAMA_LIB_NAME = "libollama.so";
    public static final String LLAMA_SERVER_LIB_NAME = "libllama-server.so";

    private static volatile File resolvedDir;

    private NativePayload() {
    }

    /** Directories that may contain the extracted binaries, in lookup order. */
    public static File nativeLibDir(Context context) {
        return new File(context.getApplicationInfo().nativeLibraryDir);
    }

    /**
     * Directory holding both executables, resolved once per process.
     *
     * <p>Normally this is the native library directory. If a device refuses to
     * execute files there (some vendor images mount {@code /data} differently),
     * the binaries are copied into {@code filesDir/payload}, made executable and
     * used from there instead.
     */
    public static File payloadDir(Context context) {
        File cached = resolvedDir;
        if (cached != null) {
            return cached;
        }
        synchronized (NativePayload.class) {
            if (resolvedDir != null) {
                return resolvedDir;
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
                        resolved = fallback;
                    }
                }
            }
            resolvedDir = resolved;
            return resolved;
        }
    }

    public static File ollamaBinary(Context context) {
        return new File(payloadDir(context), OLLAMA_LIB_NAME);
    }

    public static File llamaServerBinary(Context context) {
        return new File(payloadDir(context), LLAMA_SERVER_LIB_NAME);
    }

    public static boolean hasOllama(Context context) {
        return ollamaBinary(context).isFile();
    }

    /** Tries to make a payload file executable; returns its final state. */
    public static boolean ensureExecutable(File file) {
        if (file == null || !file.isFile()) {
            return false;
        }
        if (file.canExecute()) {
            return true;
        }
        boolean ok = file.setExecutable(true, false);
        return ok && file.canExecute();
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
            builder.environment().putAll(environment(context));
            process = builder.start();
            return process.waitFor(15, TimeUnit.SECONDS) && process.exitValue() == 0;
        } catch (Exception e) {
            return false;
        } finally {
            if (process != null) {
                process.destroy();
            }
        }
    }

    /**
     * The environment for the Ollama process.
     *
     * <p>Ollama's own defaults are left untouched: only the variables that a
     * desktop shell would also provide are set, so model storage stays at
     * {@code $HOME/.ollama/models} and the server listens on the stock
     * {@code 127.0.0.1:11434}.
     */
    public static Map<String, String> environment(Context context) {
        Context app = context.getApplicationContext();
        Map<String, String> env = new HashMap<>(System.getenv());

        File home = homeDir(app);
        File tmp = app.getCacheDir();
        mkdirs(home);
        mkdirs(tmp);

        env.put("HOME", home.getAbsolutePath());
        env.put("TMPDIR", tmp.getAbsolutePath());
        env.put("PATH", payloadDir(app).getAbsolutePath() + ":/system/bin:/system/xbin");
        // Non-ASCII model names and prompts are UTF-8 everywhere on desktop.
        env.put("LANG", "C.UTF-8");
        return env;
    }

    /** {@code $HOME} for the Ollama process; models land in {@code .ollama/models}. */
    public static File homeDir(Context context) {
        return new File(context.getApplicationContext().getFilesDir(), "home");
    }

    /** Directory holding downloaded models, as Ollama itself resolves it. */
    public static File modelsDir(Context context) {
        return new File(homeDir(context), ".ollama/models");
    }

    /** One line that describes what is actually installed, for the console. */
    public static String describe(Context context) {
        File dir = payloadDir(context);
        return "payload " + dir.getAbsolutePath()
                + "\n  " + describeFile(new File(dir, OLLAMA_LIB_NAME))
                + "\n  " + describeFile(new File(dir, LLAMA_SERVER_LIB_NAME))
                + "\n  models " + modelsDir(context).getAbsolutePath();
    }

    private static String describeFile(File file) {
        if (!file.isFile()) {
            return file.getName() + ": missing";
        }
        if (!file.canExecute()) {
            return file.getName() + ": not executable";
        }
        return file.getName() + ": ok (" + file.length() + " bytes)";
    }

    private static boolean copyFile(File from, File to) {
        if (!from.isFile()) {
            return false;
        }
        InputStream in = null;
        OutputStream out = null;
        try {
            in = new FileInputStream(from);
            out = new FileOutputStream(to);
            copy(in, out);
            return true;
        } catch (IOException e) {
            return false;
        } finally {
            closeQuietly(in);
            closeQuietly(out);
        }
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buffer = new byte[1 << 16];
        int read;
        while ((read = in.read(buffer)) > 0) {
            out.write(buffer, 0, read);
        }
        out.flush();
    }

    private static void closeQuietly(Closeable closeable) {
        if (closeable == null) {
            return;
        }
        try {
            closeable.close();
        } catch (IOException ignored) {
            // Nothing useful to do with a failed close.
        }
    }

    static boolean mkdirs(File dir) {
        return dir.isDirectory() || dir.mkdirs() || dir.isDirectory();
    }
}
