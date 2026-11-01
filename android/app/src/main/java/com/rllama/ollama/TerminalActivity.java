package com.rllama.ollama;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * The app's main screen: the Ollama CLI, exactly as it behaves on a PC.
 *
 * Commands run through {@code /system/bin/sh} with the bundled Ollama binaries
 * on PATH and the same environment the desktop build uses, so
 * {@code ollama list}, {@code ollama pull …}, {@code ollama run …},
 * {@code ollama serve}, {@code curl localhost:11434/api/tags} all work here the
 * same way they do in a desktop terminal. The server is started automatically
 * when the app opens, like the desktop daemon.
 */
public class TerminalActivity extends AppCompatActivity implements OllamaManager.Listener {
    private static final int MAX_TEXT_CHARS = 400_000;
    private static final int TRIM_TO_CHARS = 200_000;

    private Prefs prefs;
    private OllamaManager manager;

    private TextView statusView;
    private TextView outputView;
    private ScrollView scrollView;
    private EditText inputView;
    private Button runButton;
    private Button stopButton;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final StringBuilder pending = new StringBuilder();
    private final List<String> history = new ArrayList<>();

    private volatile boolean cancelled;
    private volatile Process currentProcess;
    private Thread worker;
    private boolean flushScheduled;
    private int historyIndex;

    private final Runnable flushRunnable = new Runnable() {
        @Override
        public void run() {
            flushScheduled = false;
            flushOutput();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_terminal);
        setTitle(R.string.app_name);

        prefs = new Prefs(this);
        manager = OllamaManager.get(this);

        statusView = findViewById(R.id.terminalStatus);
        outputView = findViewById(R.id.terminalOutput);
        scrollView = findViewById(R.id.terminalScroll);
        inputView = findViewById(R.id.terminalInput);
        runButton = findViewById(R.id.terminalRun);
        stopButton = findViewById(R.id.terminalStop);

        outputView.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View v) {
                copyToClipboard(outputView.getText().toString());
                return true;
            }
        });

        runButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                submit();
            }
        });
        stopButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                cancelRunningCommand();
            }
        });
        findViewById(R.id.terminalClear).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                outputView.setText("");
                pending.setLength(0);
                printBanner();
            }
        });

        findViewById(R.id.chipList).setOnClickListener(chip("ollama list"));
        findViewById(R.id.chipPs).setOnClickListener(chip("ollama ps"));
        findViewById(R.id.chipHelp).setOnClickListener(chip("help"));

        findViewById(R.id.navChat).setOnClickListener(navigate(ChatActivity.class));
        findViewById(R.id.navModels).setOnClickListener(navigate(ModelsActivity.class));
        findViewById(R.id.navConnect).setOnClickListener(navigate(ConnectActivity.class));
        findViewById(R.id.navServer).setOnClickListener(navigate(MainActivity.class));
        findViewById(R.id.navSettings).setOnClickListener(navigate(SettingsActivity.class));

        inputView.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {
                if (actionId == EditorInfo.IME_ACTION_DONE
                        || (event != null && event.getKeyCode() == KeyEvent.KEYCODE_ENTER)) {
                    submit();
                    return true;
                }
                return false;
            }
        });
        inputView.setOnKeyListener(new View.OnKeyListener() {
            @Override
            public boolean onKey(View v, int keyCode, KeyEvent event) {
                if (event.getAction() != KeyEvent.ACTION_DOWN) {
                    return false;
                }
                if (keyCode == KeyEvent.KEYCODE_DPAD_UP && !history.isEmpty()) {
                    historyIndex = Math.max(0, historyIndex - 1);
                    inputView.setText(history.get(historyIndex));
                    inputView.setSelection(inputView.getText().length());
                    return true;
                }
                if (keyCode == KeyEvent.KEYCODE_DPAD_DOWN && !history.isEmpty()) {
                    historyIndex = Math.min(history.size(), historyIndex + 1);
                    inputView.setText(historyIndex >= history.size() ? "" : history.get(historyIndex));
                    inputView.setSelection(inputView.getText().length());
                    return true;
                }
                return false;
            }
        });

        printBanner();
        updateStatus();
        autoStartServer();
        reportPayloadAsync();
    }

    @Override
    protected void onStart() {
        super.onStart();
        manager.addListener(this);
        updateStatus();
    }

    @Override
    protected void onStop() {
        manager.removeListener(this);
        super.onStop();
    }

    private View.OnClickListener navigate(final Class<?> target) {
        return new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivity(new Intent(TerminalActivity.this, target));
            }
        };
    }

    private View.OnClickListener chip(final String command) {
        return new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                inputView.setText(command);
                inputView.setSelection(command.length());
                submit();
            }
        };
    }

    // ------------------------------------------------------------------
    // Server lifecycle (mirrors the desktop daemon: start with the app)
    // ------------------------------------------------------------------

    private void autoStartServer() {
        if (OllamaHttp.isServerUp(prefs.port())) {
            appendOutput("[app] reusing the Ollama server on " + NativePayload.loopbackAddress(prefs) + "\n");
            return;
        }
        if (!NativePayload.hasOllama(this)) {
            appendOutput("[app] native payload missing — build it with scripts/build_android.sh\n");
            return;
        }
        appendOutput("[app] starting the ollama server…\n");
        try {
            OllamaService.start(this);
        } catch (RuntimeException e) {
            appendOutput("[app] could not start the service: " + e.getMessage() + "\n");
        }
    }

    private void reportPayloadAsync() {
        new Thread(new Runnable() {
            @Override
            public void run() {
                final String result = NativePayload.verify(TerminalActivity.this, prefs);
                final String describe = NativePayload.describe(TerminalActivity.this);
                appendOutput("[app] payload: " + result + "\n");
                appendOutput("[app] " + describe.replace("\n", "\n[app] ") + "\n\n");
            }
        }, "payload-report").start();
    }

    /** Typing an `ollama …`/`curl …` command starts the server if it is down. */
    private void ensureServerFor(String commandLine) {
        String trimmed = commandLine.trim();
        boolean needsServer = trimmed.startsWith("ollama")
                || trimmed.startsWith("curl")
                || trimmed.contains("11434");
        if (!needsServer || OllamaHttp.isServerUp(prefs.port())) {
            return;
        }
        appendOutput("[app] starting the Ollama server…\n");
        OllamaService.start(this);
        for (int i = 0; i < 120 && !cancelled; i++) {
            if (OllamaHttp.isServerUp(prefs.port())) {
                appendOutput("[app] server ready\n");
                return;
            }
            try {
                Thread.sleep(500);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
        }
        appendOutput("[app] server did not become ready; continuing anyway\n");
    }

    @Override
    public void onStateChanged(OllamaManager.State state, String detail) {
        updateStatus();
        if (state == OllamaManager.State.FAILED) {
            appendOutput("\n[app] the server stopped: " + detail + "\n");
            for (String line : manager.logs()) {
                appendOutput("[server] " + line + "\n");
            }
        } else if (state == OllamaManager.State.RUNNING) {
            appendOutput("[app] server ready: http://" + NativePayload.loopbackAddress(prefs) + "\n");
        }
    }

    @Override
    public void onLogLine(String line) {
        // The full server log lives on the Server screen; keep the transcript clean.
    }

    private void updateStatus() {
        String state = manager.state().name().toLowerCase(java.util.Locale.US);
        statusView.setText(state + "  ·  http://" + NativePayload.loopbackAddress(prefs)
                + (prefs.lanEnabled() ? "  ·  lan " + NetworkUtils.lanAddress(this) : "  ·  local only"));
    }

    // ------------------------------------------------------------------
    // Built-in commands
    // ------------------------------------------------------------------

    private void printBanner() {
        appendOutput("ollama " + android.os.Build.SUPPORTED_ABIS[0] + " · android "
                + android.os.Build.VERSION.RELEASE + "\n");
        appendOutput("models: " + prefs.modelDir().getAbsolutePath() + "\n");
        appendOutput("`ollama …` works like on a PC, `help` lists app commands.\n\n");
    }

    private void submit() {
        String command = inputView.getText().toString().trim();
        if (command.isEmpty()) {
            return;
        }
        history.add(command);
        historyIndex = history.size();
        inputView.setText("");

        appendOutput("$ " + command + "\n");
        if (handleBuiltIn(command)) {
            return;
        }
        runShellCommand(command);
    }

    /** @return true when the command was handled without spawning a process. */
    private boolean handleBuiltIn(String command) {
        String normalized = command.trim().toLowerCase(java.util.Locale.US);
        if (normalized.equals("help") || normalized.equals("?") || normalized.equals("--help")) {
            appendOutput(builtInHelp());
            return true;
        }
        if (normalized.equals("clear")) {
            outputView.setText("");
            pending.setLength(0);
            return true;
        }
        if (normalized.equals("env")) {
            appendOutput(environmentDump());
            return true;
        }
        if (normalized.equals("server status") || normalized.equals("status")) {
            appendOutput(manager.state() + " — " + manager.detail() + "\n");
            return true;
        }
        if (normalized.equals("server start") || normalized.equals("serve")) {
            OllamaService.start(this);
            appendOutput("starting the server…\n");
            return true;
        }
        if (normalized.equals("server stop")) {
            OllamaService.stop(this);
            appendOutput("stopping the server…\n");
            return true;
        }
        if (normalized.equals("chat")) {
            startActivity(new Intent(this, ChatActivity.class));
            appendOutput("opening chat…\n");
            return true;
        }
        if (normalized.equals("models")) {
            startActivity(new Intent(this, ModelsActivity.class));
            return true;
        }
        if (normalized.equals("connect") || normalized.equals("claude")) {
            appendOutput(ConnectionInfo.shellSummary(this, prefs));
            return true;
        }
        return false;
    }

    private String builtInHelp() {
        return "App commands:\n"
                + "  help                 this message\n"
                + "  clear                clear the transcript\n"
                + "  env                  environment used for child processes\n"
                + "  status               server state\n"
                + "  server start|stop    control the server\n"
                + "  chat | models        open the other screens\n"
                + "  connect              Claude Code / agent connection settings\n"
                + "\n"
                + "Everything else is the real Ollama CLI, for example:\n"
                + "  ollama list\n"
                + "  ollama pull gemma3:1b\n"
                + "  ollama run gemma3:1b \"explain coroutines\"\n"
                + "  ollama ps\n"
                + "  curl -s localhost:" + prefs.port() + "/api/tags\n";
    }

    private String environmentDump() {
        StringBuilder sb = new StringBuilder();
        Map<String, String> env = NativePayload.environment(this, prefs);
        String[] keys = {
                "HOME", "PATH", "LD_LIBRARY_PATH", "OLLAMA_HOST", "OLLAMA_MODELS",
                "OLLAMA_LIBRARY_PATH", "OLLAMA_CONTEXT_LENGTH", "OLLAMA_NUM_PARALLEL",
                "OLLAMA_KEEP_ALIVE", "OLLAMA_MAX_LOADED_MODELS", "OLLAMA_ORIGINS"
        };
        for (String key : keys) {
            String value = env.get(key);
            if (value != null) {
                sb.append(key).append('=').append(value).append('\n');
            }
        }
        return sb.toString();
    }

    // ------------------------------------------------------------------
    // Command execution
    // ------------------------------------------------------------------

    private void runShellCommand(final String commandLine) {
        cancelled = false;
        setRunning(true);
        worker = new Thread(new Runnable() {
            @Override
            public void run() {
                ensureServerFor(commandLine);
                int exitCode = manager.runShell(ShellCommand.rewrite(commandLine, TerminalActivity.this),
                        new OllamaManager.OutputSink() {
                            @Override
                            public void onLine(String line) {
                                appendOutput(stripCarriageReturns(line) + "\n");
                            }

                            @Override
                            public void onProcess(Process process) {
                                currentProcess = process;
                            }

                            @Override
                            public boolean isCancelled() {
                                return cancelled;
                            }
                        });
                appendOutput("[exit " + exitCode + "]\n\n");
                setRunning(false);
            }
        }, "ollama-terminal");
        worker.setDaemon(true);
        worker.start();
    }

    /** Progress bars rewrite a line with '\r'; keep what a terminal would show. */
    private static String stripCarriageReturns(String line) {
        if (line == null) {
            return "";
        }
        int index = line.lastIndexOf('\r');
        if (index >= 0 && index + 1 < line.length()) {
            return line.substring(index + 1);
        }
        return line;
    }

    private void cancelRunningCommand() {
        cancelled = true;
        Process process = currentProcess;
        if (process != null) {
            process.destroy();
            appendOutput("^C\n");
        } else {
            appendOutput("(nothing running)\n");
        }
    }

    private void setRunning(final boolean running) {
        handler.post(new Runnable() {
            @Override
            public void run() {
                runButton.setEnabled(!running);
                stopButton.setEnabled(running);
            }
        });
    }

    private void appendOutput(String text) {
        synchronized (pending) {
            pending.append(text);
        }
        if (!flushScheduled) {
            flushScheduled = true;
            handler.postDelayed(flushRunnable, 80);
        }
    }

    private void flushOutput() {
        String text;
        synchronized (pending) {
            text = pending.toString();
            pending.setLength(0);
        }
        if (text.isEmpty()) {
            return;
        }
        outputView.append(text);
        if (outputView.getText().length() > MAX_TEXT_CHARS) {
            String full = outputView.getText().toString();
            outputView.setText(full.substring(Math.max(0, full.length() - TRIM_TO_CHARS)));
        }
        scrollView.post(new Runnable() {
            @Override
            public void run() {
                scrollView.fullScroll(View.FOCUS_DOWN);
            }
        });
    }

    private void copyToClipboard(String text) {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard != null) {
            clipboard.setPrimaryClip(ClipData.newPlainText("terminal", text));
            Toast.makeText(this, "Transcript copied", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onDestroy() {
        cancelled = true;
        Process process = currentProcess;
        if (process != null) {
            process.destroy();
        }
        super.onDestroy();
    }
}
