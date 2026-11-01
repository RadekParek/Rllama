package com.rllama.ollama;

import android.Manifest;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import java.util.List;

/**
 * Dashboard: start/stop the server, see where it listens, and jump into the
 * built-in terminal, chat, model manager and connection guides.
 */
public class MainActivity extends AppCompatActivity implements OllamaManager.Listener {
    private static final int REQUEST_NOTIFICATIONS = 1001;

    private OllamaManager manager;
    private Prefs prefs;

    private TextView statusText;
    private TextView endpointText;
    private TextView payloadText;
    private TextView logText;
    private ScrollView logScroll;
    private Button startButton;
    private Button stopButton;
    private boolean refreshScheduled;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        setTitle(R.string.app_name);

        manager = OllamaManager.get(this);
        prefs = new Prefs(this);

        statusText = findViewById(R.id.statusText);
        endpointText = findViewById(R.id.endpointText);
        payloadText = findViewById(R.id.payloadText);
        logText = findViewById(R.id.logText);
        logScroll = findViewById(R.id.logScroll);
        startButton = findViewById(R.id.startButton);
        stopButton = findViewById(R.id.stopButton);

        startButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startServer();
            }
        });
        stopButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                OllamaService.stop(MainActivity.this);
                toast("Stopping the Ollama server");
                v.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        refresh();
                    }
                }, 800);
            }
        });
        findViewById(R.id.restartButton).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                manager.restart();
            }
        });
        findViewById(R.id.terminalButton).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivity(new Intent(MainActivity.this, TerminalActivity.class));
            }
        });
        findViewById(R.id.chatButton).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivity(new Intent(MainActivity.this, ChatActivity.class));
            }
        });
        findViewById(R.id.modelsButton).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivity(new Intent(MainActivity.this, ModelsActivity.class));
            }
        });
        findViewById(R.id.connectButton).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivity(new Intent(MainActivity.this, ConnectActivity.class));
            }
        });
        findViewById(R.id.settingsButton).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivity(new Intent(MainActivity.this, SettingsActivity.class));
            }
        });

        endpointText.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                copyToClipboard(endpointText.getText().toString());
            }
        });
        payloadText.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View v) {
                copyToClipboard(manager.diagnostics());
                return true;
            }
        });

        refresh();
        verifyPayloadAsync();
    }

    /** One-off payload self test; spawning a process is not free. */
    private void verifyPayloadAsync() {
        new Thread(new Runnable() {
            @Override
            public void run() {
                final String result = NativePayload.verify(MainActivity.this, prefs);
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        payloadText.setText(NativePayload.describe(MainActivity.this)
                                + "\nselftest: " + result);
                    }
                });
            }
        }, "payload-verify").start();
    }

    @Override
    protected void onStart() {
        super.onStart();
        manager.addListener(this);
        refresh();
    }

    @Override
    protected void onStop() {
        manager.removeListener(this);
        super.onStop();
    }

    @Override
    protected void onResume() {
        super.onResume();
        refresh();
    }

    private void startServer() {
        if (!NativePayload.hasOllama(this)) {
            toast("Native payload missing. Build it with scripts/build_android.sh, then rebuild the APK.");
            return;
        }
        requestNotificationPermissionIfNeeded();
        OllamaService.start(this);
        toast("Starting the Ollama server");
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return;
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS},
                REQUEST_NOTIFICATIONS);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQUEST_NOTIFICATIONS) {
            // The server still works without the notification; Android just may
            // hide the foreground service notice.
        }
    }

    private void refresh() {
        if (statusText == null) {
            return;
        }
        OllamaManager.State state = manager.state();
        String line;
        switch (state) {
            case RUNNING:
                line = "● Running — " + manager.detail();
                break;
            case STARTING:
                line = "◐ Starting — " + manager.detail();
                break;
            case STOPPING:
                line = "◐ Stopping…";
                break;
            case FAILED:
                line = "■ Stopped — " + manager.detail();
                break;
            default:
                line = "○ Stopped";
                break;
        }
        statusText.setText(line);
        statusText.setTextColor(state == OllamaManager.State.RUNNING
                ? 0xFF1B7F3A
                : (state == OllamaManager.State.FAILED ? 0xFFB3261E : 0xFF666666));

        startButton.setEnabled(state != OllamaManager.State.RUNNING
                && state != OllamaManager.State.STARTING);
        stopButton.setEnabled(state == OllamaManager.State.RUNNING
                || state == OllamaManager.State.STARTING);

        StringBuilder endpoint = new StringBuilder();
        endpoint.append("local:  http://").append(NativePayload.loopbackAddress(prefs)).append('\n');
        if (prefs.lanEnabled()) {
            String ip = NetworkUtils.lanAddress(this);
            endpoint.append("lan:    http://").append(ip).append(':').append(prefs.port()).append('\n');
        } else {
            endpoint.append("lan:    disabled (Settings → allow other devices)\n");
        }
        endpoint.append("models: ").append(prefs.modelDir().getAbsolutePath());
        endpointText.setText(endpoint.toString());

        payloadText.setText(NativePayload.describe(this));

        List<String> logs = manager.logs();
        if (logs.isEmpty()) {
            logText.setText("(no log output yet)");
        } else {
            StringBuilder sb = new StringBuilder();
            int start = Math.max(0, logs.size() - 200);
            for (int i = start; i < logs.size(); i++) {
                sb.append(logs.get(i)).append('\n');
            }
            logText.setText(sb.toString());
        }
        logScroll.post(new Runnable() {
            @Override
            public void run() {
                logScroll.fullScroll(View.FOCUS_DOWN);
            }
        });
    }

    @Override
    public void onStateChanged(OllamaManager.State state, String detail) {
        refresh();
        if (state == OllamaManager.State.FAILED) {
            toast("Ollama server stopped: " + detail);
        }
    }

    @Override
    public void onLogLine(String line) {
        scheduleRefresh();
    }

    /** Log lines can arrive in bursts; coalesce them into one UI update. */
    private void scheduleRefresh() {
        if (refreshScheduled) {
            return;
        }
        refreshScheduled = true;
        statusText.postDelayed(new Runnable() {
            @Override
            public void run() {
                refreshScheduled = false;
                refresh();
            }
        }, 250);
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }

    private void copyToClipboard(String text) {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard != null) {
            clipboard.setPrimaryClip(ClipData.newPlainText("ollama", text));
            toast("Copied");
        }
    }
}
