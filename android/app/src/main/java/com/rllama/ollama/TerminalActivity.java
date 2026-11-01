package com.rllama.ollama;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.method.LinkMovementMethod;
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
 * The built-in terminal. Commands run through {@code /system/bin/sh} with the
 * bundled Ollama binaries and environment injected, so anything that works in
 * a normal shell on the phone works here as well — including
 * {@code ollama run}, {@code ollama pull}, {@code curl localhost:11434/...}.
 */
public class TerminalActivity extends AppCompatActivity {
    private static final int MAX_TEXT_CHARS = 400_000;
    private static final int TRIM_TO_CHARS = 200_000;

    private Prefs prefs;
    private OllamaManager manager;

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
        setTitle("Terminal");

        prefs = new Prefs(this);
        manager = OllamaManager.get(this);

        outputView = findViewById(R.id.terminalOutput);
        scrollView = findViewById(R.id.terminalScroll);
        inputView = findViewById(R.id.terminalInput);
        runButton = findViewById(R.id.terminalRun);
        stopButton = findViewById(R.id.terminalStop);

        outputView.setMovementMethod(LinkMovementMethod.getInstance());
        outputView.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View v) {
                copyToClipboard(outputView.getText().toString());
                return true;
            }
        });

        findViewById(R.id.terminalInfo).setVisibility(View.GONE);

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

    private void printBanner() {
        StringBuilder sb = new StringBuilder();
        sb.append("Rllama Ollama terminal\n");
        sb.append("------------------------\n");
        sb.append("server: ").append(manager.state()).append(" — ")
                .append("http://").append(NativePayload.loopbackAddress(prefs)).append('\n');
        sb.append("models: ").append(prefs.modelDir().getAbsolutePath()).append('\n');
        sb.append("type `help` for built-ins. `ollama` is already on PATH.\n");
        sb.append("type `connect` for copy-ready Claude Code / agent settings.\n\n");
        appendOutput(sb.toString());
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
        if (normalized.equals("server status")) {
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
        return "Built-in commands:\n"
                + "  help                 this message\n"
                + "  clear                clear the transcript\n"
                + "  env                  show the environment used for child processes\n"
                + "  server start|stop|status\n"
                + "  chat                 open the chat screen\n"
                + "  models               open the model manager\n"
                + "  connect              connection snippets for Claude Code and friends\n"
                + "\n"
                + "Everything else runs in /system/bin/sh, for example:\n"
                + "  ollama list\n"
                + "  ollama pull gemma3:1b\n"
                + "  ollama run gemma3:1b \"explain coroutines\"\n"
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
                                appendOutput(line + "\n");
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

    /**
     * Convenience: typing `ollama …` or curling the API should just work, so
     * bring the server up first when it is not listening yet.
     */
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
