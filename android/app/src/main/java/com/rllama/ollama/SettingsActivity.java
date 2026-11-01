package com.rllama.ollama;

import androidx.appcompat.app.AlertDialog;
import android.content.DialogInterface;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import java.io.File;

/**
 * Server settings. Everything here maps onto an Ollama environment variable
 * that is applied when the child process is spawned.
 */
public class SettingsActivity extends AppCompatActivity {
    private Prefs prefs;
    private OllamaManager manager;

    private EditText portInput;
    private CheckBox lanCheck;
    private EditText contextInput;
    private EditText parallelInput;
    private EditText keepAliveInput;
    private TextView modelsDirText;
    private CheckBox debugCheck;
    private CheckBox autoStartCheck;
    private TextView diagnosticsText;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_settings);
        setTitle("Settings");

        prefs = new Prefs(this);
        manager = OllamaManager.get(this);

        portInput = findViewById(R.id.portInput);
        lanCheck = findViewById(R.id.lanCheck);
        contextInput = findViewById(R.id.contextInput);
        parallelInput = findViewById(R.id.parallelInput);
        keepAliveInput = findViewById(R.id.keepAliveInput);
        modelsDirText = findViewById(R.id.modelsDirText);
        debugCheck = findViewById(R.id.debugCheck);
        autoStartCheck = findViewById(R.id.autoStartCheck);
        diagnosticsText = findViewById(R.id.diagnosticsText);

        load();

        findViewById(R.id.saveSettings).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (save()) {
                    Toast.makeText(SettingsActivity.this,
                            "Saved. Restart the server for changes to take effect.",
                            Toast.LENGTH_LONG).show();
                }
            }
        });
        findViewById(R.id.saveAndRestart).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (save()) {
                    manager.restart();
                    Toast.makeText(SettingsActivity.this, "Restarting the server…", Toast.LENGTH_SHORT).show();
                }
            }
        });
        findViewById(R.id.resetModelsDir).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                prefs.setModelDir(null);
                load();
                Toast.makeText(SettingsActivity.this,
                        "Models directory reset. Existing blobs are not moved.",
                        Toast.LENGTH_LONG).show();
            }
        });
        modelsDirText.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                editModelsDir();
            }
        });
    }

    private void load() {
        portInput.setText(Integer.toString(prefs.port()));
        lanCheck.setChecked(prefs.lanEnabled());
        contextInput.setText(Integer.toString(prefs.contextLength()));
        parallelInput.setText(Integer.toString(prefs.numParallel()));
        keepAliveInput.setText(prefs.keepAlive());
        debugCheck.setChecked(prefs.debugLogs());
        autoStartCheck.setChecked(prefs.startOnBoot());
        modelsDirText.setText(prefs.modelDir().getAbsolutePath()
                + "\n(tap to change)");
        diagnosticsText.setText(manager.diagnostics());
    }

    private boolean save() {
        int port = parseInt(portInput.getText().toString(), prefs.port());
        if (port < 1024 || port > 65535) {
            Toast.makeText(this, "Port must be between 1024 and 65535", Toast.LENGTH_SHORT).show();
            return false;
        }
        int context = parseInt(contextInput.getText().toString(), prefs.contextLength());
        int parallel = parseInt(parallelInput.getText().toString(), prefs.numParallel());
        if (parallel < 1) {
            parallel = 1;
        }

        prefs.setPort(port);
        prefs.setLanEnabled(lanCheck.isChecked());
        prefs.setContextLength(Math.max(0, context));
        prefs.setNumParallel(parallel);
        prefs.setKeepAlive(keepAliveInput.getText().toString().trim());
        prefs.setDebugLogs(debugCheck.isChecked());
        prefs.setStartOnBoot(autoStartCheck.isChecked());
        File models = prefs.modelDir();
        NativePayload.mkdirs(models);
        load();
        return true;
    }

    private void editModelsDir() {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT);
        input.setText(prefs.modelDir().getAbsolutePath());
        new AlertDialog.Builder(this)
                .setTitle("Models directory")
                .setMessage("Use an app-specific folder on the SD card to keep multi-gigabyte "
                        + "models off the internal data partition.")
                .setView(input)
                .setPositiveButton("Save", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        String path = input.getText().toString().trim();
                        if (path.isEmpty()) {
                            prefs.setModelDir(null);
                        } else {
                            prefs.setModelDir(path);
                            File dir = new File(path);
                            if (!dir.isDirectory() && !dir.mkdirs() && !dir.isDirectory()) {
                                Toast.makeText(SettingsActivity.this,
                                        "That path is not writable; keeping the setting anyway",
                                        Toast.LENGTH_LONG).show();
                            }
                        }
                        load();
                    }
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private static int parseInt(String raw, int fallback) {
        try {
            return Integer.parseInt(raw.trim());
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (diagnosticsText != null) {
            diagnosticsText.setText(manager.diagnostics());
        }
    }
}
