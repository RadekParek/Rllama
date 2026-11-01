package com.rllama.ollama;

import android.content.Context;

import java.io.BufferedReader;
import java.io.Closeable;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Runs the stock {@code ollama} binary: {@code ollama serve} as the background
 * server, and any other command line for the console.
 *
 * <p>There is no reimplementation of Ollama here. The processes started by this
 * class are the same Go binary that the desktop build runs, so commands, HTTP
 * routes and model handling are Ollama's own.
 */
public final class OllamaManager {
    /** Ollama's default address; the app does not change it. */
    public static final String HOST = "127.0.0.1";
    public static final int PORT = 11434;

    private static final int MAX_LOG_LINES = 2000;

    public enum State {
        STOPPED,
        STARTING,
        RUNNING,
        FAILED
    }

    /** Receives state and log updates. */
    public interface Listener {
        void onStateChanged(State state, String detail);

        void onLogLine(String line);
    }

    /** Streams process output to a caller and exposes cancellation. */
    public interface OutputSink {
        void onLine(String line);

        default void onProcess(Process process) {
        }

        default boolean isCancelled() {
            return false;
        }
    }

    private static OllamaManager instance;

    private final Context app;
    private final List<Listener> listeners = new CopyOnWriteArrayList<>();
    private final ArrayDeque<String> logBuffer = new ArrayDeque<>();

    private Process serveProcess;
    private volatile State state = State.STOPPED;
    private volatile String detail = "not running";

    private OllamaManager(Context context) {
        this.app = context.getApplicationContext();
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

    // ------------------------------------------------------------------
    // Server
    // ------------------------------------------------------------------

    /** Starts {@code ollama serve} unless something already listens on the port. */
    public synchronized void start() {
        if (state == State.STARTING || state == State.RUNNING) {
            return;
        }
        if (isServerUp()) {
            setState(State.RUNNING, "an Ollama server is already listening on " + address());
            return;
        }
        if (!NativePayload.hasOllama(app)) {
            setState(State.FAILED, "native payload missing; run scripts/build_android.sh");
            return;
        }

        setState(State.STARTING, "starting ollama serve");
        try {
            serveProcess = newProcess(new String[]{
                    prepare(NativePayload.ollamaBinary(app)).getAbsolutePath(), "serve"
            });
        } catch (IOException e) {
            setState(State.FAILED, "could not start ollama: " + e.getMessage());
            return;
        }

        Thread pump = new Thread(new Runnable() {
            @Override
            public void run() {
                pumpOutput(serveProcess);
            }
        }, "ollama-serve-log");
        pump.setDaemon(true);
        pump.start();

        Thread ready = new Thread(new Runnable() {
            @Override
            public void run() {
                awaitReady(serveProcess);
            }
        }, "ollama-serve-ready");
        ready.setDaemon(true);
        ready.start();
    }

    public synchronized void stop() {
        Process process = serveProcess;
        serveProcess = null;
        if (process != null) {
            process.destroy();
            try {
                process.waitFor();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        setState(State.STOPPED, "not running");
    }

    private void awaitReady(Process process) {
        long deadline = System.currentTimeMillis() + 120_000;
        while (System.currentTimeMillis() < deadline) {
            if (serveProcess != process) {
                return;
            }
            if (!process.isAlive()) {
                setState(State.FAILED, "ollama serve exited with code " + process.exitValue());
                return;
            }
            if (isServerUp()) {
                setState(State.RUNNING, "listening on " + address());
                return;
            }
            try {
                Thread.sleep(300);
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
        } catch (IOException ignored) {
            // The process closed its output; the state machine reports it.
        } finally {
            closeQuietly(reader);
        }
        if (serveProcess == process) {
            setState(State.FAILED, "ollama serve exited");
        }
    }

    /** {@code 127.0.0.1:11434}, Ollama's default endpoint. */
    public static String address() {
        return HOST + ":" + PORT;
    }

    /** Cheap TCP probe; no HTTP client needed. */
    public static boolean isServerUp() {
        return isServerUp(PORT);
    }

    public static boolean isServerUp(int port) {
        Socket socket = new Socket();
        try {
            socket.connect(new InetSocketAddress(HOST, port), 400);
            return true;
        } catch (IOException e) {
            return false;
        } finally {
            closeQuietly(socket);
        }
    }

    // ------------------------------------------------------------------
    // Commands
    // ------------------------------------------------------------------

    /** Runs a shell command line with the Ollama environment. */
    public int runShell(String commandLine, OutputSink sink) {
        return runProcess(new String[]{"/system/bin/sh", "-c", commandLine}, sink);
    }

    /** Runs a command, streaming merged stdout/stderr into {@code sink}. */
    public int runProcess(String[] command, OutputSink sink) {
        Process process = null;
        try {
            process = newProcess(command);
            if (sink != null) {
                sink.onProcess(process);
            }
            pumpInto(process, sink);
            int code = process.waitFor();
            return code;
        } catch (IOException e) {
            if (sink != null) {
                sink.onLine("error: " + e.getMessage());
            }
            return -1;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return -1;
        } finally {
            if (process != null) {
                process.destroy();
            }
        }
    }

    private Process newProcess(String[] command) throws IOException {
        ProcessBuilder builder = new ProcessBuilder(command);
        builder.directory(NativePayload.homeDir(app));
        builder.redirectErrorStream(true);
        Map<String, String> env = builder.environment();
        env.clear();
        env.putAll(NativePayload.environment(app));
        return builder.start();
    }

    private void pumpInto(Process process, final OutputSink sink) throws IOException {
        BufferedReader reader = null;
        try {
            reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8));
            String line;
            while ((line = reader.readLine()) != null) {
                if (sink != null) {
                    sink.onLine(line);
                }
                if (sink != null && sink.isCancelled()) {
                    process.destroy();
                    return;
                }
            }
        } finally {
            closeQuietly(reader);
        }
    }

    /** Runs the bundled CLI with separate arguments. */
    public int runCli(List<String> args, OutputSink sink) {
        List<String> command = new ArrayList<>();
        command.add(NativePayload.ollamaBinary(app).getAbsolutePath());
        command.addAll(args);
        return runProcess(command.toArray(new String[0]), sink);
    }

    /** Keeps the pipe usable when a command writes to stdin. */
    public static OutputStream stdin(Process process) {
        return process == null ? null : process.getOutputStream();
    }

    private File prepare(File binary) {
        NativePayload.ensureExecutable(binary);
        NativePayload.ensureExecutable(NativePayload.llamaServerBinary(app));
        return binary;
    }

    // ------------------------------------------------------------------
    // State and logs
    // ------------------------------------------------------------------

    private void setState(final State newState, final String newDetail) {
        state = newState;
        detail = newDetail;
        appendLog("[app] " + newDetail);
        for (final Listener listener : listeners) {
            listener.onStateChanged(newState, newDetail);
        }
    }

    private void appendLog(final String line) {
        synchronized (logBuffer) {
            logBuffer.addLast(line);
            while (logBuffer.size() > MAX_LOG_LINES) {
                logBuffer.removeFirst();
            }
        }
        for (Listener listener : listeners) {
            listener.onLogLine(line);
        }
    }

    private static void closeQuietly(Closeable closeable) {
        if (closeable == null) {
            return;
        }
        try {
            closeable.close();
        } catch (IOException ignored) {
            // Ignored.
        }
    }
}
