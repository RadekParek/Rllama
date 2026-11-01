package com.rllama.ollama;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

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
 * class are the same Go binary the desktop build runs, so commands, HTTP routes
 * and model handling are Ollama's own.
 *
 * <p>Threading rules, which matter on Android:
 * <ul>
 *   <li>listeners are always notified on the main thread;</li>
 *   <li>nothing here may be called on the main thread when it touches the
 *       filesystem or opens a socket, so {@link #start()} only schedules work
 *       and returns.</li>
 * </ul>
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

    /** Receives state and log updates on the main thread. */
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
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<Listener> listeners = new CopyOnWriteArrayList<>();
    private final ArrayDeque<String> logBuffer = new ArrayDeque<>();

    private Process serveProcess;
    private volatile State state = State.STOPPED;
    private volatile String detail = "not running";
    private boolean startScheduled;

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

    /**
     * Starts {@code ollama serve} unless something already listens on the port.
     *
     * <p>Safe to call from the main thread: the payload probe, the socket check
     * and the process start all happen on a worker thread.
     */
    public synchronized void start() {
        if (startScheduled || state == State.STARTING || state == State.RUNNING) {
            return;
        }
        startScheduled = true;
        setState(State.STARTING, "starting ollama serve");

        Thread thread = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    startBlocking();
                } catch (Throwable t) {
                    setState(State.FAILED, "could not start ollama: " + describeThrowable(t));
                } finally {
                    synchronized (OllamaManager.this) {
                        startScheduled = false;
                    }
                }
            }
        }, "ollama-start");
        thread.setDaemon(true);
        thread.start();
    }

    private void startBlocking() {
        if (isServerUp(PORT)) {
            setState(State.RUNNING, "an Ollama server is already listening on " + address());
            return;
        }
        if (!NativePayload.hasOllama(app)) {
            setState(State.FAILED, "native payload missing; run scripts/build_android.sh");
            return;
        }

        File binary;
        try {
            binary = NativePayload.ollamaBinary(app);
            NativePayload.ensureExecutable(binary);
            NativePayload.ensureExecutable(NativePayload.llamaServerBinary(app));
        } catch (Throwable t) {
            setState(State.FAILED, "payload not usable: " + describeThrowable(t));
            return;
        }

        Process process;
        try {
            process = newProcess(new String[]{binary.getAbsolutePath(), "serve"});
        } catch (Throwable t) {
            setState(State.FAILED, "could not start ollama serve: " + describeThrowable(t));
            appendLog("[app] " + NativePayload.describe(app));
            return;
        }

        synchronized (this) {
            serveProcess = process;
        }
        appendLog("[app] started " + binary.getAbsolutePath() + " serve");

        Thread pump = new Thread(new Runnable() {
            @Override
            public void run() {
                pumpServerOutput();
            }
        }, "ollama-serve-log");
        pump.setDaemon(true);
        pump.start();

        awaitReady(process);
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
            Process current;
            synchronized (this) {
                current = serveProcess;
            }
            if (current != process) {
                return; // Stopped or replaced.
            }
            if (!process.isAlive()) {
                setState(State.FAILED, "ollama serve exited with code " + process.exitValue());
                return;
            }
            if (isServerUp(PORT)) {
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

    private void pumpServerOutput() {
        Process process;
        synchronized (this) {
            process = serveProcess;
        }
        if (process == null) {
            return;
        }
        BufferedReader reader = null;
        try {
            reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8));
            String line;
            while ((line = reader.readLine()) != null) {
                appendLog(line);
            }
        } catch (IOException ignored) {
            // Process ended; the state machine reports it.
        } finally {
            closeQuietly(reader);
        }
        synchronized (this) {
            if (serveProcess == process) {
                serveProcess = null;
            }
        }
    }

    /** {@code 127.0.0.1:11434}, Ollama's default endpoint. */
    public static String address() {
        return HOST + ":" + PORT;
    }

    /**
     * TCP probe. Opening a socket is a network operation, so this must not be
     * called on the main thread (Android throws NetworkOnMainThreadException).
     */
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

    /** Runs a shell command line with the Ollama environment. Blocking. */
    public int runShell(String commandLine, OutputSink sink) {
        return runProcess(new String[]{"/system/bin/sh", "-c", commandLine}, sink);
    }

    /** Runs a command, streaming merged stdout/stderr into {@code sink}. Blocking. */
    public int runProcess(String[] command, OutputSink sink) {
        Process process = null;
        try {
            process = newProcess(command);
            if (sink != null) {
                sink.onProcess(process);
            }
            pumpInto(process, sink);
            return process.waitFor();
        } catch (IOException e) {
            if (sink != null) {
                sink.onLine("error: " + describeThrowable(e));
            }
            return -1;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return -1;
        } catch (Throwable t) {
            if (sink != null) {
                sink.onLine("error: " + describeThrowable(t));
            }
            return -1;
        } finally {
            if (process != null) {
                process.destroy();
            }
        }
    }

    private Process newProcess(String[] command) throws IOException {
        ProcessBuilder builder = new ProcessBuilder(command);
        File home = NativePayload.homeDir(app);
        NativePayload.mkdirs(home);
        builder.directory(home);
        builder.redirectErrorStream(true);
        Map<String, String> env = builder.environment();
        env.clear();
        env.putAll(NativePayload.environment(app));
        return builder.start();
    }

    private void pumpInto(Process process, OutputSink sink) throws IOException {
        BufferedReader reader = null;
        try {
            reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8));
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

    /** Runs the bundled CLI with separate arguments. Blocking. */
    public int runCli(List<String> args, OutputSink sink) {
        List<String> command = new ArrayList<>();
        command.add(NativePayload.ollamaBinary(app).getAbsolutePath());
        command.addAll(args);
        return runProcess(command.toArray(new String[0]), sink);
    }

    /** Writes a line to a running command's stdin, for interactive prompts. */
    public static boolean writeLine(Process process, String text) {
        if (process == null) {
            return false;
        }
        OutputStream out = process.getOutputStream();
        if (out == null) {
            return false;
        }
        try {
            out.write((text + "\n").getBytes(StandardCharsets.UTF_8));
            out.flush();
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    // ------------------------------------------------------------------
    // State and logs
    // ------------------------------------------------------------------

    private void setState(final State newState, final String newDetail) {
        state = newState;
        detail = newDetail;
        appendLog("[app] " + newDetail);
        main.post(new Runnable() {
            @Override
            public void run() {
                for (Listener listener : listeners) {
                    listener.onStateChanged(newState, newDetail);
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
        main.post(new Runnable() {
            @Override
            public void run() {
                for (Listener listener : listeners) {
                    listener.onLogLine(line);
                }
            }
        });
    }

    static String describeThrowable(Throwable t) {
        if (t == null) {
            return "unknown error";
        }
        String message = t.getMessage();
        return t.getClass().getSimpleName() + (message == null ? "" : ": " + message);
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
