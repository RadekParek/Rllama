package com.rllama.ollama;

import androidx.appcompat.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Model manager: list, pull, delete, and import a GGUF file straight from the
 * phone's storage (handy when the model is already downloaded, or when the
 * device has no working DNS for the registry).
 */
public class ModelsActivity extends AppCompatActivity {
    private static final int REQUEST_GGUF = 2001;

    private Prefs prefs;
    private OllamaManager manager;
    private ListView listView;
    private TextView statusView;
    private final List<OllamaHttp.Model> models = new ArrayList<>();
    private ArrayAdapter<String> adapter;
    private volatile boolean busy;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_models);
        setTitle("Models");

        prefs = new Prefs(this);
        manager = OllamaManager.get(this);
        listView = findViewById(R.id.modelsList);
        statusView = findViewById(R.id.modelsStatus);

        adapter = new ArrayAdapter<>(this, android.R.layout.simple_list_item_1, new ArrayList<String>());
        listView.setAdapter(adapter);

        listView.setOnItemLongClickListener(new AdapterView.OnItemLongClickListener() {
            @Override
            public boolean onItemLongClick(AdapterView<?> parent, View view, int position, long id) {
                if (position >= 0 && position < models.size()) {
                    confirmDelete(models.get(position).name);
                }
                return true;
            }
        });

        findViewById(R.id.modelsRefresh).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                refresh();
            }
        });
        findViewById(R.id.modelsPull).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                promptPull();
            }
        });
        findViewById(R.id.modelsImport).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                pickGguf();
            }
        });

        refresh();
    }

    private void refresh() {
        statusView.setText("loading…");
        new Thread(new Runnable() {
            @Override
            public void run() {
                final List<OllamaHttp.Model> loaded = new ArrayList<>();
                String error = null;
                try {
                    loaded.addAll(OllamaHttp.listModels(prefs.port()));
                } catch (Exception e) {
                    error = e.getMessage();
                }
                final String finalError = error;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        models.clear();
                        models.addAll(loaded);
                        adapter.clear();
                        for (OllamaHttp.Model model : models) {
                            adapter.add(model.name + "  ·  " + OllamaHttp.formatBytes(model.size)
                                    + (model.parameters.isEmpty() ? "" : "  ·  " + model.parameters));
                        }
                        adapter.notifyDataSetChanged();
                        if (finalError != null) {
                            statusView.setText("server not reachable: " + finalError);
                        } else if (models.isEmpty()) {
                            statusView.setText("no models installed — pull one or import a GGUF");
                        } else {
                            statusView.setText(models.size() + " model(s). Long-press to delete.");
                        }
                    }
                });
            }
        }, "models-refresh").start();
    }

    private void promptPull() {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT);
        input.setHint("gemma3:1b");
        new AlertDialog.Builder(this)
                .setTitle("Pull model")
                .setView(input)
                .setPositiveButton("Pull", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        String name = input.getText().toString().trim();
                        if (!name.isEmpty()) {
                            pull(name);
                        }
                    }
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void pull(final String name) {
        if (busy) {
            Toast.makeText(this, "another operation is running", Toast.LENGTH_SHORT).show();
            return;
        }
        busy = true;
        statusView.setText("pulling " + name + "…");
        new Thread(new Runnable() {
            @Override
            public void run() {
                final StringBuilder last = new StringBuilder();
                try {
                    OllamaHttp.pullModel(prefs.port(), name, new OllamaHttp.LineListener() {
                        @Override
                        public void onLine(String line) {
                            try {
                                JSONObject chunk = new JSONObject(line);
                                String status = chunk.optString("status", "");
                                long completed = chunk.optLong("completed", 0);
                                long total = chunk.optLong("total", 0);
                                String text = status;
                                if (total > 0) {
                                    text += " " + OllamaHttp.formatBytes(completed) + " / "
                                            + OllamaHttp.formatBytes(total);
                                }
                                last.setLength(0);
                                last.append(text);
                                setStatus(text);
                            } catch (Exception ignored) {
                                setStatus(line);
                            }
                        }

                        @Override
                        public boolean isCancelled() {
                            return false;
                        }
                    });
                    setStatus("pulled " + name);
                } catch (Exception e) {
                    setStatus("pull failed: " + e.getMessage());
                }
                busy = false;
                refresh();
            }
        }, "models-pull").start();
    }

    private void confirmDelete(final String name) {
        new AlertDialog.Builder(this)
                .setTitle("Delete model")
                .setMessage("Remove " + name + " from this phone?")
                .setPositiveButton("Delete", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        delete(name);
                    }
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void delete(final String name) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    OllamaHttp.deleteModel(prefs.port(), name);
                    setStatus("deleted " + name);
                } catch (Exception e) {
                    setStatus("delete failed: " + e.getMessage());
                }
                refresh();
            }
        }, "models-delete").start();
    }

    private void pickGguf() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        try {
            startActivityForResult(intent, REQUEST_GGUF);
        } catch (RuntimeException e) {
            Toast.makeText(this, "no file picker available", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_GGUF || resultCode != RESULT_OK || data == null) {
            return;
        }
        Uri uri = data.getData();
        if (uri == null) {
            return;
        }
        importGguf(uri);
    }

    private void importGguf(final Uri uri) {
        if (busy) {
            Toast.makeText(this, "another operation is running", Toast.LENGTH_SHORT).show();
            return;
        }
        busy = true;
        final String displayName = queryDisplayName(uri);
        setStatus("importing " + displayName + "…");

        new Thread(new Runnable() {
            @Override
            public void run() {
                File importDir = new File(prefs.workDir(), "imports");
                NativePayload.mkdirs(importDir);
                String safeName = sanitizeName(displayName);
                File target = new File(importDir, safeName);
                try {
                    copyUri(uri, target);
                } catch (IOException e) {
                    setStatus("import failed: " + e.getMessage());
                    busy = false;
                    return;
                }

                String modelName = stripGgufSuffix(safeName).toLowerCase(Locale.US);
                File modelfile = new File(prefs.workDir(), "Modelfile." + modelName);
                try {
                    writeText(modelfile, "FROM " + target.getAbsolutePath() + "\n");
                } catch (IOException e) {
                    setStatus("could not write Modelfile: " + e.getMessage());
                    busy = false;
                    return;
                }

                final List<String> args = new ArrayList<>();
                args.add("create");
                args.add(modelName);
                args.add("-f");
                args.add(modelfile.getAbsolutePath());
                setStatus("creating " + modelName + "…");
                int exit = manager.runCli(args, new OllamaManager.OutputSink() {
                    @Override
                    public void onLine(String line) {
                        if (!line.trim().isEmpty()) {
                            setStatus(line);
                        }
                    }
                });
                if (exit == 0) {
                    prefs.setLastModel(modelName);
                    setStatus("imported " + modelName);
                } else {
                    setStatus("ollama create failed (exit " + exit + ")");
                }
                busy = false;
                refresh();
            }
        }, "models-import").start();
    }

    private String queryDisplayName(Uri uri) {
        String name = null;
        try (android.database.Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    name = cursor.getString(index);
                }
            }
        } catch (RuntimeException ignored) {
            // fall back to the path segment below
        }
        if (name == null || name.trim().isEmpty()) {
            String path = uri.getLastPathSegment();
            name = path == null ? "imported.gguf" : path;
        }
        return name;
    }

    private void copyUri(Uri uri, File target) throws IOException {
        InputStream in = getContentResolver().openInputStream(uri);
        if (in == null) {
            throw new IOException("could not open " + uri);
        }
        OutputStream out = new FileOutputStream(target);
        try {
            byte[] buffer = new byte[1 << 16];
            long copied = 0;
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
                copied += read;
                if (copied % (64L << 20) < (1 << 16)) {
                    setStatus("copying… " + OllamaHttp.formatBytes(copied));
                }
            }
            out.flush();
        } finally {
            try {
                in.close();
            } catch (IOException ignored) {
                // best effort
            }
            out.close();
        }
    }

    private static void writeText(File file, String text) throws IOException {
        try (OutputStream out = new FileOutputStream(file)) {
            out.write(text.getBytes(StandardCharsets.UTF_8));
        }
    }

    private static String sanitizeName(String name) {
        String cleaned = name.replaceAll("[^A-Za-z0-9._-]", "_");
        return cleaned.isEmpty() ? "imported.gguf" : cleaned;
    }

    private static String stripGgufSuffix(String name) {
        String lower = name.toLowerCase(Locale.US);
        if (lower.endsWith(".gguf")) {
            return name.substring(0, name.length() - 5);
        }
        return name;
    }

    private void setStatus(final String text) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                statusView.setText(text);
            }
        });
    }
}
