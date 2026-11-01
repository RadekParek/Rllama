package com.rllama.ollama;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * The whole interface: a console for the bundled {@code ollama} binary.
 *
 * <p>Commands are run with {@code /system/bin/sh}, with the binaries on
 * {@code PATH}, so the CLI behaves exactly as it does on a desktop. The server
 * is started with the activity ({@code ollama serve}, stock defaults), which is
 * what serves the HTTP API on {@code 127.0.0.1:11434}.
 *
 * <p>Uses {@link Activity} rather than an AndroidX activity: fewer moving parts
 * at startup, and nothing theme-related to mismatch.
 */
public class TerminalActivity extends Activity implements OllamaManager.Listener {
    private static final int MAX_TEXT_CHARS = 400_000;
    private static final int TRIM_TO_CHARS = 200_000;
    private static final int REQUEST_NOTIFICATIONS = 1;

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
    private volatile boolean commandRunning;
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
        try {
            setContentView(R.layout.activity_terminal);
            getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
            setTitle(R.string.app_name);
            manager = OllamaManager.get(this);
            bindViews();
            printBanner();
            updateStatus();
            startServer();
            reportEnvironmentAsync();
            requestNotificationPermission();
        } catch (Throwable t) {
            showFatal(t);
        }
    }

    private void bindViews() {
        statusView = findViewById(R.id.terminalStatus);
        outputView = findViewById(R.id.terminalOutput);
        scrollView = findViewById(R.id.terminalScroll);
        inputView = findViewById(R.id.terminalInput);
        runButton = findViewById(R.id.terminalRun);
        stopButton = findViewById(R.id.terminalStop);

        outputView.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View v) {
                copyTranscript();
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
                cancelCommand();
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

        inputView.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {
                if (actionId == EditorInfo.IME_ACTION_DONE
                        || actionId == EditorInfo.IME_ACTION_SEND
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
                if (event.getAction() != KeyEvent.ACTION_DOWN || history.isEmpty()) {
                    return false;
                }
                if (keyCode == KeyEvent.KEYCODE_DPAD_UP) {
                    historyIndex = Math.max(0, historyIndex - 1);
                    inputView.setText(history.get(historyIndex));
                    inputView.setSelection(inputView.getText().length());
                    return true;
                }
                if (keyCode == KeyEvent.KEYCODE_DPAD_DOWN) {
                    historyIndex = Math.min(history.size(), historyIndex + 1);
                    inputView.setText(historyIndex >= history.size() ? "" : history.get(historyIndex));
                    inputView.setSelection(inputView.getText().length());
                    return true;
                }
                return false;
            }
        });
    }

    /** Shows the reason the console could not start, instead of crashing. */
    private void showFatal(Throwable t) {
        String text = "The console could not start:\n\n"
                + OllamaManager.describeThrowable(t) + "\n\n"
                + android.util.Log.getStackTraceString(t);
        try {
            LinearLayout layout = new LinearLayout(this);
            layout.setOrientation(LinearLayout.VERTICAL);
            TextView view = new TextView(this);
            view.setText(text);
            view.setTextIsSelectable(true);
            view.setPadding(32, 64, 32, 32);
            layout.addView(view);
            setContentView(layout);
        } catch (Throwable ignored) {
            // Nothing else can be done here.
        }
        android.util.Log.e("OllamaConsole", text);
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (manager != null) {
            manager.addListener(this);
            updateStatus();
        }
    }

    @Override
    protected void onStop() {
        if (manager != null) {
            manager.removeListener(this);
        }
        super.onStop();
    }

    private void startServer() {
        appendOutput("starting ollama serve…\n\n");
        OllamaService.start(this);
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return;
        }
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        try {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},
                    REQUEST_NOTIFICATIONS);
        } catch (Throwable ignored) {
            // Without the permission the server still runs; only the ongoing
            // notification is hidden.
        }
    }

    private void printBanner() {
        appendOutput("ollama " + Build.SUPPORTED_ABIS[0]
                + " · android " + Build.VERSION.RELEASE + " (api " + Build.VERSION.SDK_INT + ")\n");
        appendOutput("api http://" + OllamaManager.address() + "\n");
        String crash = App.readStoredCrash(this);
        if (crash != null && !crash.trim().isEmpty()) {
            appendOutput("\nprevious crash:\n" + crash.trim() + "\n");
        }
        appendOutput("\ntype any ollama command, e.g. ollama list / ollama pull gemma3 / ollama run gemma3\n\n");
    }

    /** Payload inspection starts a process, so it never runs on the main thread. */
    private void reportEnvironmentAsync() {
        new Thread(new Runnable() {
            @Override
            public void run() {
                String version;
                String describe;
                try {
                    version = NativePayload.version(TerminalActivity.this);
                } catch (Throwable t) {
                    version = "ollama: probe failed (" + OllamaManager.describeThrowable(t) + ")";
                }
                try {
                    describe = NativePayload.describe(TerminalActivity.this);
                } catch (Throwable t) {
                    describe = "payload: unavailable (" + OllamaManager.describeThrowable(t) + ")";
                }
                final String text = version + "\n" + describe + "\n\n";
                appendOutput(text);
            }
        }, "ollama-payload-report").start();
    }

    @Override
    public void onStateChanged(OllamaManager.State state, String detail) {
        updateStatus();
        if (state == OllamaManager.State.FAILED) {
            appendOutput("server: " + detail + "\n");
            for (String line : manager.logs()) {
                appendOutput(line + "\n");
            }
            appendOutput("\n");
        }
    }

    @Override
    public void onLogLine(String line) {
        // Server output is printed when it fails; the console stays readable.
    }

    private void updateStatus() {
        if (statusView == null) {
            return;
        }
        String text = manager.state().name().toLowerCase(Locale.US)
                + " · http://" + OllamaManager.address() + " · " + manager.detail();
        if (commandRunning) {
            text += " · input goes to the running command";
        }
        statusView.setText(text);
    }

    private void submit() {
        String text = inputView.getText().toString();
        if (commandRunning) {
            sendToStdin(text);
            return;
        }
        String command = text.trim();
        if (command.isEmpty()) {
            return;
        }
        history.add(command);
        historyIndex = history.size();
        inputView.setText("");
        appendOutput("$ " + command + "\n");
        runCommand(command);
    }

    /** Types a line into the running command, e.g. the `ollama run` prompt. */
    private void sendToStdin(String text) {
        inputView.setText("");
        appendOutput(text + "\n");
        if (!OllamaManager.writeLine(currentProcess, text)) {
            appendOutput("(no process is reading input)\n");
        }
    }

    private void runCommand(final String command) {
        cancelled = false;
        commandRunning = true;
        setRunning(true);

        final String line = ShellCommand.rewrite(command, this);
        new Thread(new Runnable() {
            @Override
            public void run() {
                int code = manager.runShell(line, new OllamaManager.OutputSink() {
                    @Override
                    public void onLine(String output) {
                        appendOutput(stripCarriageReturns(output) + "\n");
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
                if (code != 0) {
                    appendOutput("exit " + code + "\n");
                }
                appendOutput("\n");
                currentProcess = null;
                commandRunning = false;
                setRunning(false);
            }
        }, "ollama-console").start();
    }

    private static String stripCarriageReturns(String line) {
        if (line == null) {
            return "";
        }
        int index = line.lastIndexOf('\r');
        return index >= 0 && index + 1 < line.length() ? line.substring(index + 1) : line;
    }

    private void cancelCommand() {
        cancelled = true;
        Process process = currentProcess;
        if (process != null) {
            process.destroy();
            appendOutput("^C\n");
        }
    }

    private void setRunning(final boolean running) {
        handler.post(new Runnable() {
            @Override
            public void run() {
                if (runButton != null) {
                    runButton.setEnabled(!running);
                }
                if (stopButton != null) {
                    stopButton.setEnabled(running);
                }
                // A long generation must not be interrupted by the screen sleeping.
                if (running) {
                    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
                updateStatus();
            }
        });
    }

    private void appendOutput(String text) {
        if (text == null || text.isEmpty()) {
            return;
        }
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
        if (text.isEmpty() || outputView == null) {
            return;
        }
        outputView.append(text);
        if (outputView.getText().length() > MAX_TEXT_CHARS) {
            String full = outputView.getText().toString();
            outputView.setText(full.substring(full.length() - TRIM_TO_CHARS));
        }
        scrollView.post(new Runnable() {
            @Override
            public void run() {
                scrollView.fullScroll(View.FOCUS_DOWN);
            }
        });
    }

    private void copyTranscript() {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard == null || outputView == null) {
            return;
        }
        clipboard.setPrimaryClip(ClipData.newPlainText("ollama", outputView.getText().toString()));
        Toast.makeText(this, "Copied", Toast.LENGTH_SHORT).show();
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
