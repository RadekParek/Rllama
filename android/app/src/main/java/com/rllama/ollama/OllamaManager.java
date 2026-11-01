package com.rllama.ollama;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Owns the {@code ollama serve} child process and exposes a small command
 * runner that the built-in terminal uses.
 *
 * Everything runs inside the app's own process tree: the bundled executable is
 * started from the native library directory with a fully specified environment,
 * which keeps behaviour identical to running Ollama from a shell.
 */
public final class OllamaManager {
    private static final String TAG = "RllamaOllama";
    private static final int MAX_LOG_LINES = 4000;

    public enum State {
        STOPPED,
        STARTING,
        RUNNING,
        STOPPING,
        FAILED
    }

    /** Implemented by UI that wants state and log updates. */
    public interface Listener {
        void onStateChanged(State state, String detail);

        void onLogLine(String line);
    }

    private static OllamaManager instance;

    private final Context app;
    private final Prefs prefs;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final List<Listener> listeners = new CopyOnWriteArrayList<>();
    private final ArrayDeque<String> logBuffer = new ArrayDeque<>();

    private Process serveProcess;
    private Thread outputPump;
    private Thread readinessThread;
    private volatile State state = State.STOPPED;
    private volatile String detail = "";
    private boolean attachedToExternalServer;

    private OllamaManager(Context context) {
        this.app = context.getApplicationContext();
        this.prefs = new Prefs(this.app);
    }

    public static synchronized OllamaManager get(Context context) {
        if (instance == null) {
            instance = new OllamaManager(context);
        }
        return instance;
    }

    public State state() {
        return state;
    }

    public String detail() {
        return detail;
    }

    public boolean isRunning() {
        return state == State.RUNNING;
    }

    public boolean isAttachedToExternalServer() {
        return attachedToExternalServer;
    }

    public synchronized void addListener(Listener listener) {
        if (listener != null && !listeners.contains(listener)) {
            listeners.add(listener);
        }
    }

    public synchronized void removeListener(Listener listener) {
        listeners.remove(listener);
    }

    public synchronized List<String> logs() {
        return new ArrayList<>(logBuffer);
    }

    public void clearLogs() {
        synchronized (logBuffer) {
            logBuffer.clear();
        }
    }

    // ------------------------------------------------------------------
    // Server lifecycle
    // ------------------------------------------------------------------

    /**
     * Starts {@code ollama serve} unless something already answers on the port
     * (for example a server the user started from the built-in terminal).
     */
    public synchronized void start() {
        if (state == State.STARTING || state == State.RUNNING) {
            return;
        }

        final int port = prefs.port();
        if (OllamaHttp.isServerUp(port)) {
            attachedToExternalServer = true;
            setState(State.RUNNING, "attached to an Ollama server already listening on port " + port);
            appendLog("[app] reusing the Ollama server already running on 127.0.0.1:" + port);
            return;
        }

        File binary = NativePayload.ollamaBinary(app);
        if (!binary.isFile()) {
            attachedToExternalServer = false;
            setState(State.FAILED, "native payload missing: " + binary.getAbsolutePath()
                    + "\nbuild it with scripts/build_android.sh");
            return;
        }

        attachedToExternalServer = false;
        prepareBinaries();
        setState(State.STARTING, "starting ollama serve on " + NativePayload.bindAddress(prefs));

        try {
            ProcessBuilder builder = new ProcessBuilder(binary.getAbsolutePath(), "serve");
            builder.directory(app.getFilesDir());
            builder.redirectErrorStream(true);
            Map<String, String> env = builder.environment();
            env.clear();
            env.putAll(NativePayload.environment(app, prefs));

            serveProcess = builder.start();
            appendLog("[app] started " + binary.getName() + " serve (pid " + processId(serveProcess) + ")");
        } catch (IOException e) {
            setState(State.FAILED, "could not start ollama: " + e.getMessage());
            return;
        }

        outputPump = new Thread(new Runnable() {
            @Override
            public void run() {
                pumpOutput(serveProcess);
            }
        }, "ollama-serve-output");
        outputPump.setDaemon(true);
        outputPump.start();

        readinessThread = new Thread(new Runnable() {
            @Override
            public void run() {
                awaitReady(serveProcess, port);
            }
        }, "ollama-serve-ready");
        readinessThread.setDaemon(true);
        readinessThread.start();
    }

    public synchronized void stop() {
        if (serveProcess == null) {
            if (state != State.STOPPED) {
                setState(State.STOPPED, "not running");
            }
            return;
        }
        setState(State.STOPPING, "stopping");
        Process process = serveProcess;
        serveProcess = null;
        attachedToExternalServer = false;
        process.destroy();
        try {
            process.waitFor();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        appendLog("[app] ollama serve stopped");
        setState(State.STOPPED, "stopped");
    }

    public void restart() {
        final Context context = app;
        new Thread(new Runnable() {
            @Override
            public void run() {
                stop();
                try {
                    Thread.sleep(500);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                start();
                // Keep the foreground service in sync when the user restarts from the UI.
                OllamaService.ensureRunning(context, true);
            }
        }, "ollama-restart").start();
    }

    private void awaitReady(Process process, int port) {
        long deadline = System.currentTimeMillis() + 90000;
        while (System.currentTimeMillis() < deadline) {
            if (serveProcess != process) {
                return;
            }
            if (!process.isAlive()) {
                int code = process.exitValue();
                setState(State.FAILED, "ollama serve exited with code " + code);
                return;
            }
            if (OllamaHttp.isServerUp(port)) {
                setState(State.RUNNING, "listening on " + NativePayload.bindAddress(prefs));
                appendLog("[app] server ready: http://" + NativePayload.loopbackAddress(prefs));
                return;
            }
            try {
                Thread.sleep(400);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
        setState(State.FAILED, "server did not become ready in time");
    }

    private void pumpOutput(Process process) {
        if (process == null) {
            return;
        }
        BufferedReader reader = null;
        try {
            reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8));
            String line;
            while ((line = reader.readLine()) != null) {
                appendLog(line);
            }
        } catch (IOException e) {
            Log.w(TAG, "server output closed: " + e.getMessage());
        } finally {
            closeQuietly(reader);
        }

        if (serveProcess == process) {
            // The process we were tracking ended unexpectedly.
            setState(State.FAILED, "ollama serve exited");
        }
    }

    // ------------------------------------------------------------------
    // Command execution (used by the built-in terminal and model screens)
    // ------------------------------------------------------------------

    /** Runs the bundled CLI with the given arguments, blocking until it exits. */
    public int runCli(List<String> args, OutputSink sink) {
        List<String> command = new ArrayList<>();
        command.add(NativePayload.ollamaBinary(app).getAbsolutePath());
        command.addAll(args);
        return runProcess(command, sink);
    }

    /** Runs an arbitrary command line through {@code /system/bin/sh -c}. */
    public int runShell(String commandLine, OutputSink sink) {
        List<String> command = new ArrayList<>();
        command.add("/system/bin/sh");
        command.add("-c");
        command.add(commandLine);
        return runProcess(command, sink);
    }

    /**
     * Executes a command with the Ollama environment, streaming combined
     * stdout/stderr into {@code sink}. Returns the exit code, or -1 on error.
     */
    public int runProcess(List<String> command, OutputSink sink) {
        prepareBinaries();
        ProcessBuilder builder = new ProcessBuilder(command);
        builder.directory(app.getFilesDir());
        builder.redirectErrorStream(true);
        Map<String, String> env = builder.environment();
        env.clear();
        env.putAll(NativePayload.environment(app, prefs));

        Process process;
        try {
            process = builder.start();
        } catch (IOException e) {
            if (sink != null) {
                sink.onLine("error: could not run " + command.get(0) + ": " + e.getMessage());
            }
            return -1;
        }

        if (sink != null) {
            sink.onProcess(process);
        }

        BufferedReader reader = null;
        try {
            reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8));
            String line;
            while ((line = reader.readLine()) != null) {
                if (sink != null) {
                    sink.onLine(line);
                    if (sink.isCancelled()) {
                        process.destroy();
                        break;
                    }
                }
            }
        } catch (IOException e) {
            if (sink != null) {
                sink.onLine("error: " + e.getMessage());
            }
        } finally {
            closeQuietly(reader);
        }

        try {
            return process.waitFor();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            process.destroy();
            return -1;
        }
    }

    /** Writes text to a running command's stdin (interactive prompts). */
    public static void writeStdin(Process process, String text) {
        if (process == null) {
            return;
        }
        try {
            OutputStream out = process.getOutputStream();
            out.write((text + "\n").getBytes(StandardCharsets.UTF_8));
            out.flush();
        } catch (IOException e) {
            Log.w(TAG, "could not write to stdin: " + e.getMessage());
        }
    }

    public interface OutputSink {
        void onLine(String line);

        default void onProcess(Process process) {
        }

        default boolean isCancelled() {
            return false;
        }
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /**
     * The package manager does not always leave the payload executable, and
     * every command needs both binaries runnable, so normalise the mode first.
     */
    private void prepareBinaries() {
        NativePayload.ensureExecutable(NativePayload.ollamaBinary(app));
        NativePayload.ensureExecutable(NativePayload.llamaServerBinary(app));
    }

    private void setState(State newState, String newDetail) {
        state = newState;
        detail = newDetail == null ? "" : newDetail;
        Log.i(TAG, "state=" + newState + " " + detail);
        final State notifyState = newState;
        final String notifyDetail = detail;
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                for (Listener listener : listeners) {
                    try {
                        listener.onStateChanged(notifyState, notifyDetail);
                    } catch (RuntimeException e) {
                        Log.w(TAG, "listener failed", e);
                    }
                }
            }
        });
    }

    private void appendLog(final String line) {
        if (line == null) {
            return;
        }
        synchronized (logBuffer) {
            logBuffer.addLast(line);
            while (logBuffer.size() > MAX_LOG_LINES) {
                logBuffer.removeFirst();
            }
        }
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                for (Listener listener : listeners) {
                    try {
                        listener.onLogLine(line);
                    } catch (RuntimeException e) {
                        Log.w(TAG, "listener failed", e);
                    }
                }
            }
        });
    }

    private static int processId(Process process) {
        try {
            java.lang.reflect.Method method = process.getClass().getMethod("pid");
            Object value = method.invoke(process);
            if (value instanceof Long) {
                return (int) ((Long) value).longValue();
            }
        } catch (Exception ignored) {
            // not available on every API level
        }
        return -1;
    }

    private static void closeQuietly(java.io.Closeable closeable) {
        if (closeable == null) {
            return;
        }
        try {
            closeable.close();
        } catch (IOException ignored) {
            // best effort
        }
    }

    /** Convenience for diagnostics screens. */
    public String diagnostics() {
        StringBuilder sb = new StringBuilder();
        sb.append("state: ").append(state).append('\n');
        sb.append("detail: ").append(detail).append('\n');
        sb.append("bind: ").append(NativePayload.bindAddress(prefs)).append('\n');
        sb.append("models: ").append(prefs.modelDir().getAbsolutePath()).append('\n');
        sb.append(NativePayload.describe(app));
        return sb.toString();
    }

    static List<String> splitCommandLine(String commandLine) {
        List<String> parts = new ArrayList<>();
        for (String token : commandLine.trim().split("\\s+")) {
            if (!token.isEmpty()) {
                parts.add(token);
            }
        }
        return parts;
    }

    static String joinArgs(List<String> args) {
        StringBuilder sb = new StringBuilder();
        for (String arg : args) {
            if (sb.length() > 0) {
                sb.append(' ');
            }
            sb.append(arg);
        }
        return sb.toString();
    }

    static String describeCommand(String[] command) {
        return Arrays.toString(command);
    }
}
