package com.rllama.ollama;

import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Minimal streaming chat client for the local server. Useful for smoke tests
 * and for confirming a model behaves before an agent connects to it.
 */
public class ChatActivity extends AppCompatActivity {
    private Prefs prefs;
    private Spinner modelSpinner;
    private LinearLayout chatContainer;
    private ScrollView chatScroll;
    private EditText chatInput;
    private Button sendButton;
    private TextView statusView;
    private TextView streamingView;

    private final List<String> models = new ArrayList<>();
    private final JSONArray messages = new JSONArray();
    private volatile boolean streaming;
    private volatile boolean cancelled;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_chat);
        setTitle("Chat");

        prefs = new Prefs(this);
        modelSpinner = findViewById(R.id.modelSpinner);
        chatContainer = findViewById(R.id.chatContainer);
        chatScroll = findViewById(R.id.chatScroll);
        chatInput = findViewById(R.id.chatInput);
        sendButton = findViewById(R.id.chatSend);
        statusView = findViewById(R.id.chatStatus);

        sendButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                send();
            }
        });
        findViewById(R.id.refreshModels).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                loadModels();
            }
        });

        loadModels();
    }

    private void loadModels() {
        statusView.setText("loading models…");
        new Thread(new Runnable() {
            @Override
            public void run() {
                final List<String> loaded = new ArrayList<>();
                String failure = null;
                try {
                    for (OllamaHttp.Model model : OllamaHttp.listModels(prefs.port())) {
                        loaded.add(model.name);
                    }
                } catch (Exception e) {
                    failure = e.getMessage();
                }
                final String error = failure;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        models.clear();
                        models.addAll(loaded);
                        ArrayAdapter<String> adapter = new ArrayAdapter<>(ChatActivity.this,
                                android.R.layout.simple_spinner_item, models);
                        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
                        modelSpinner.setAdapter(adapter);
                        if (!prefs.lastModel().isEmpty()) {
                            int index = models.indexOf(prefs.lastModel());
                            if (index >= 0) {
                                modelSpinner.setSelection(index);
                            }
                        }
                        modelSpinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
                            @Override
                            public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {
                                prefs.setLastModel(models.get(position));
                            }

                            @Override
                            public void onNothingSelected(AdapterView<?> parent) {
                            }
                        });
                        if (error != null) {
                            statusView.setText("could not load models: " + error);
                        } else if (models.isEmpty()) {
                            statusView.setText("no models yet — pull one on the Models screen");
                        } else {
                            statusView.setText(models.size() + " model(s) available");
                        }
                    }
                });
            }
        }, "chat-models").start();
    }

    private String selectedModel() {
        if (models.isEmpty()) {
            return null;
        }
        int position = modelSpinner.getSelectedItemPosition();
        if (position < 0 || position >= models.size()) {
            position = 0;
        }
        return models.get(position);
    }

    private void send() {
        if (streaming) {
            cancelled = true;
            return;
        }
        final String model = selectedModel();
        if (model == null) {
            Toast.makeText(this, "Pull a model first", Toast.LENGTH_SHORT).show();
            return;
        }
        String prompt = chatInput.getText().toString().trim();
        if (prompt.isEmpty()) {
            return;
        }
        chatInput.setText("");
        addBubble("you", prompt);
        try {
            JSONObject message = new JSONObject();
            message.put("role", "user");
            message.put("content", prompt);
            messages.put(message);
        } catch (JSONException e) {
            Toast.makeText(this, "could not build request: " + e.getMessage(), Toast.LENGTH_SHORT).show();
            return;
        }

        streamingView = addBubble(model, "");
        streaming = false;
        cancelled = false;
        setBusy(true);

        new Thread(new Runnable() {
            @Override
            public void run() {
                final StringBuilder answer = new StringBuilder();
                try {
                    JSONObject request = new JSONObject();
                    request.put("model", model);
                    request.put("messages", messages);
                    request.put("stream", true);
                    OllamaHttp.chat(prefs.port(), request, new OllamaHttp.LineListener() {
                        @Override
                        public void onLine(String line) {
                            try {
                                JSONObject chunk = new JSONObject(line);
                                JSONObject message = chunk.optJSONObject("message");
                                if (message != null) {
                                    String content = message.optString("content", "");
                                    if (!content.isEmpty()) {
                                        answer.append(content);
                                        appendToStreaming(content);
                                    }
                                }
                                if (chunk.optBoolean("done", false)) {
                                    String error = chunk.optString("error", "");
                                    if (!error.isEmpty()) {
                                        answer.append("\n[error: ").append(error).append(']');
                                    }
                                }
                            } catch (JSONException ignored) {
                                // partial or non-JSON line; skip
                            }
                        }

                        @Override
                        public boolean isCancelled() {
                            return cancelled;
                        }
                    });
                } catch (Exception e) {
                    answer.append("\n[error: ").append(e.getMessage()).append(']');
                    appendToStreaming("\n[error: " + e.getMessage() + "]");
                }

                final String text = answer.toString();
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            if (!text.isEmpty()) {
                                JSONObject reply = new JSONObject();
                                reply.put("role", "assistant");
                                reply.put("content", text);
                                messages.put(reply);
                            }
                        } catch (JSONException ignored) {
                            // keep the UI usable even if the history cannot be updated
                        }
                        setBusy(false);
                    }
                });
            }
        }, "chat-stream").start();
    }

    private TextView addBubble(String who, String text) {
        LinearLayout wrapper = new LinearLayout(this);
        wrapper.setOrientation(LinearLayout.VERTICAL);
        wrapper.setPadding(0, dp(6), 0, dp(6));

        TextView label = new TextView(this);
        label.setText(who);
        label.setTextSize(11f);
        wrapper.addView(label);

        TextView body = new TextView(this);
        body.setText(text);
        body.setTextSize(14f);
        body.setTextIsSelectable(true);
        wrapper.addView(body);

        chatContainer.addView(wrapper, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        scrollToBottom();
        return body;
    }

    private void appendToStreaming(final String text) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (streamingView != null) {
                    streamingView.append(text);
                    scrollToBottom();
                }
            }
        });
    }

    private void scrollToBottom() {
        chatScroll.post(new Runnable() {
            @Override
            public void run() {
                chatScroll.fullScroll(View.FOCUS_DOWN);
            }
        });
    }

    private void setBusy(final boolean busy) {
        streaming = busy;
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                sendButton.setText(busy ? "Stop" : getString(R.string.chat_send));
                statusView.setGravity(Gravity.START);
                statusView.setText(busy ? "generating…" : "ready");
            }
        });
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density);
    }
}
