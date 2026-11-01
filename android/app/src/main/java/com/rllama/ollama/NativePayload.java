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
 *
 * <p>Nothing here may run on the main thread: resolving the payload starts a
 * child process to prove the binaries are executable.
 */
public final class NativePayload {
    public static final String OLLAMA_LIB_NAME = "libollama.so";
    public static final String LLAMA_SERVER_LIB_NAME = "libllama-server.so";

    private static volatile File resolvedDir;

    private NativePayload() {
    }

    /** Directory the installer extracts the packaged binaries into. */
    public static File nativeLibDir(Context context) {
        String dir = context.getApplicationContext().getApplicationInfo().nativeLibraryDir;
        return dir == null ? new File("/") : new File(dir);
    }

    /**
     * Directory holding both executables, resolved once per process.
     *
     * <p>Normally this is the native library directory. If a device refuses to
     * execute files there, the binaries are copied into
     * {@code filesDir/payload}, made executable and used from there instead.
     *
     * <p>Blocking (starts a probe process); call it from a worker thread.
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
        return new File(nativeLibDir(context), OLLAMA_LIB_NAME).isFile()
                || new File(context.getFilesDir(), "payload/" + OLLAMA_LIB_NAME).isFile();
    }

    /** Tries to make a payload file executable; returns its final state. */
    public static boolean ensureExecutable(File file) {
        if (file == null || !file.isFile()) {
            return false;
        }
        if (file.canExecute()) {
            return true;
        }
        try {
            return file.setExecutable(true, false) && file.canExecute();
        } catch (SecurityException e) {
            return false;
        }
    }

    /**
     * Runs {@code <binary> --version} to prove the file can really be executed.
     *
     * <p>Uses {@link #baseEnvironment} and never {@link #environment}, because
     * the latter resolves the payload directory and would recurse.
     */
    static boolean canRun(File binary, Context context) {
        if (binary == null || !binary.isFile() || !binary.canExecute()) {
            return false;
        }
        Process process = null;
        try {
            ProcessBuilder builder = new ProcessBuilder(binary.getAbsolutePath(), "--version");
            builder.redirectErrorStream(true);
            builder.directory(context.getApplicationContext().getFilesDir());
            builder.environment().clear();
            builder.environment().putAll(baseEnvironment(context));
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

    /** Environment fragment that does not depend on where the payload lives. */
    private static Map<String, String> baseEnvironment(Context context) {
        Context app = context.getApplicationContext();
        Map<String, String> env = new HashMap<>();
        File home = homeDir(app);
        File tmp = app.getCacheDir();
        mkdirs(home);
        mkdirs(tmp);
        env.put("HOME", home.getAbsolutePath());
        env.put("TMPDIR", tmp.getAbsolutePath());
        env.put("PATH", nativeLibDir(app).getAbsolutePath() + ":/system/bin:/system/xbin");
        env.put("LANG", "C.UTF-8");
        return env;
    }

    /**
     * The environment for the Ollama process.
     *
     * <p>Ollama's own defaults are left untouched: only the variables a desktop
     * shell also provides are set, so model storage stays at
     * {@code $HOME/.ollama/models} and the server listens on the stock
     * {@code 127.0.0.1:11434}.
     *
     * <p>Blocking (resolves the payload); call it from a worker thread.
     */
    public static Map<String, String> environment(Context context) {
        Context app = context.getApplicationContext();
        Map<String, String> env = baseEnvironment(app);
        env.put("PATH", payloadDir(app).getAbsolutePath() + ":/system/bin:/system/xbin");
        return env;
    }

    /** {@code $HOME} for the Ollama process; models land in {@code .ollama/models}. */
    public static File homeDir(Context context) {
        return new File(context.getApplicationContext().getFilesDir(), "home");
    }

    /** Where Ollama stores models, as Ollama itself resolves it. */
    public static File modelsDir(Context context) {
        return new File(homeDir(context), ".ollama/models");
    }

    /** What is actually installed, for the console. Blocking. */
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

    /** Output of {@code ollama --version}, or the reason it could not run. Blocking. */
    public static String version(Context context) {
        File binary = new File(payloadDir(context), OLLAMA_LIB_NAME);
        if (!binary.isFile()) {
            return "ollama: missing at " + binary.getAbsolutePath();
        }
        if (!ensureExecutable(binary)) {
            return "ollama: not executable at " + binary.getAbsolutePath();
        }
        Process process = null;
        try {
            ProcessBuilder builder = new ProcessBuilder(binary.getAbsolutePath(), "--version");
            builder.redirectErrorStream(true);
            builder.directory(context.getApplicationContext().getFilesDir());
            builder.environment().clear();
            builder.environment().putAll(environment(context));
            process = builder.start();
            StringBuilder out = new StringBuilder();
            InputStream in = process.getInputStream();
            byte[] buffer = new byte[512];
            int read;
            while ((read = in.read(buffer)) > 0) {
                out.append(new String(buffer, 0, read, "UTF-8"));
            }
            boolean finished = process.waitFor(20, TimeUnit.SECONDS);
            String text = out.toString().trim();
            if (!finished) {
                return "ollama: --version timed out";
            }
            if (process.exitValue() != 0) {
                return "ollama: --version exited " + process.exitValue()
                        + (text.isEmpty() ? "" : " (" + text + ")");
            }
            return text.isEmpty() ? "ollama: ok" : text.replace('\n', ' ');
        } catch (Exception e) {
            return "ollama: could not run (" + e.getClass().getSimpleName()
                    + (e.getMessage() == null ? "" : ": " + e.getMessage()) + ")";
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
        InputStream in = null;
        OutputStream out = null;
        try {
            in = new FileInputStream(from);
            out = new FileOutputStream(to);
            byte[] buffer = new byte[1 << 16];
            int read;
            while ((read = in.read(buffer)) > 0) {
                out.write(buffer, 0, read);
            }
            out.flush();
            return true;
        } catch (IOException e) {
            return false;
        } finally {
            closeQuietly(in);
            closeQuietly(out);
        }
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
