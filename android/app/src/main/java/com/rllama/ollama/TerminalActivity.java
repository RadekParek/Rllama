package com.rllama.ollama;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
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

/**
 * The whole interface: a console for the bundled {@code ollama} binary.
 *
 * <p>Commands are run with {@code /system/bin/sh}, with the binaries on
 * {@code PATH}, so the CLI behaves exactly as it does on a desktop. The server
 * is started with the activity ({@code ollama serve}, stock defaults), which is
 * what serves the HTTP API on {@code 127.0.0.1:11434}.
 */
public class TerminalActivity extends AppCompatActivity implements OllamaManager.Listener {
    private static final int MAX_TEXT_CHARS = 400_000;
    private static final int TRIM_TO_CHARS = 200_000;

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

        printBanner();
        updateStatus();
        startServer();
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

    private void startServer() {
        if (OllamaManager.isServerUp()) {
            appendOutput("server already running on " + OllamaManager.address() + "\n\n");
            return;
        }
        appendOutput("starting " + "ollama serve" + "…\n\n");
        try {
            OllamaService.start(this);
        } catch (RuntimeException e) {
            appendOutput("could not start the service: " + e.getMessage() + "\n\n");
        }
    }

    private void printBanner() {
        appendOutput("ollama " + android.os.Build.SUPPORTED_ABIS[0]
                + " · android " + android.os.Build.VERSION.RELEASE + "\n");
        appendOutput(NativePayload.describe(this) + "\n");
        appendOutput("api " + "http://" + OllamaManager.address() + "\n");
        appendOutput("type any ollama command, e.g. ollama list / ollama pull gemma3 / ollama run gemma3\n\n");
    }

    @Override
    public void onStateChanged(OllamaManager.State state, String detail) {
        updateStatus();
        if (state == OllamaManager.State.FAILED) {
            appendOutput("server: " + detail + "\n");
            for (String line : manager.logs()) {
                appendOutput(line + "\n");
            }
        }
    }

    @Override
    public void onLogLine(String line) {
        // Server output is shown when it fails; the console stays readable.
    }

    private void updateStatus() {
        statusView.setText(manager.state().name().toLowerCase(java.util.Locale.US)
                + " · http://" + OllamaManager.address());
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

        cancelled = false;
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
                currentProcess = null;
                appendOutput(code == 0 ? "" : "exit " + code + "\n");
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
                runButton.setEnabled(!running);
                stopButton.setEnabled(running);
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
        if (text.isEmpty()) {
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
        if (clipboard != null) {
            clipboard.setPrimaryClip(ClipData.newPlainText("ollama", outputView.getText().toString()));
            Toast.makeText(this, "Copied", Toast.LENGTH_SHORT).show();
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
