package com.rllama.ollama;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import java.util.List;

/**
 * Shows everything needed to point Claude Code, the Ollama CLI, or any
 * OpenAI-compatible client at the server running on this phone.
 */
public class ConnectActivity extends AppCompatActivity {
    private LinearLayout container;
    private Prefs prefs;
    private TextView statusView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_connect);
        setTitle("Connect");

        prefs = new Prefs(this);
        container = findViewById(R.id.connectContainer);
        buildUi();
    }

    private void buildUi() {
        container.removeAllViews();

        addHeading("Connection details");
        String detail = "local:  " + ConnectionInfo.loopbackUrl(prefs) + "\n"
                + "lan:    " + (prefs.lanEnabled()
                ? ConnectionInfo.lanUrl(this, prefs)
                : "disabled — enable “allow connections from other devices” in Settings")
                + "\nnetworks: " + NetworkUtils.describeNetworks(this)
                + "\nmodels: " + prefs.modelDir().getAbsolutePath();
        addCode(detail);

        statusView = new TextView(this);
        statusView.setTextSize(12f);
        statusView.setPadding(0, dp(8), 0, dp(8));
        container.addView(statusView);

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        Button testButton = new Button(this);
        testButton.setText("Test LAN endpoint");
        testButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                testEndpoint();
            }
        });
        actions.addView(testButton, new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        Button settingsButton = new Button(this);
        settingsButton.setText("Settings");
        settingsButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivity(new android.content.Intent(ConnectActivity.this, SettingsActivity.class));
            }
        });
        actions.addView(settingsButton, new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        container.addView(actions);

        List<ConnectionInfo.Section> sections = ConnectionInfo.sections(this, prefs, prefs.lastModel());
        for (ConnectionInfo.Section section : sections) {
            addSection(section);
        }

        TextView footnote = new TextView(this);
        footnote.setText("Tip: keep the server running in the background so agents stay connected — "
                + "start it from the dashboard and leave the notification in place.");
        footnote.setTextSize(11f);
        footnote.setPadding(0, dp(16), 0, 0);
        container.addView(footnote);
    }

    private void addSection(final ConnectionInfo.Section section) {
        addHeading(section.title);

        TextView description = new TextView(this);
        description.setText(section.description);
        description.setTextSize(12f);
        description.setPadding(0, 0, 0, dp(4));
        container.addView(description);

        addCode(section.body);

        Button copy = new Button(this);
        copy.setText("Copy");
        copy.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                copyToClipboard(section.body);
            }
        });
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.bottomMargin = dp(16);
        container.addView(copy, params);
    }

    private void testEndpoint() {
        final String url = ConnectionInfo.lanUrl(this, prefs) + "/api/version";
        statusView.setText("Testing " + url + " …");
        new Thread(new Runnable() {
            @Override
            public void run() {
                String message;
                try {
                    String body = OllamaHttp.fetchAbsolute(url);
                    message = "OK: " + body;
                } catch (Exception e) {
                    message = "Failed: " + e.getMessage()
                            + "\nCheck that the server is running and that LAN access is enabled.";
                }
                final String finalMessage = message;
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        statusView.setText(finalMessage);
                    }
                });
            }
        }, "connect-test").start();
    }

    private void addHeading(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(17f);
        view.setPadding(0, dp(20), 0, dp(4));
        container.addView(view);
    }

    private void addCode(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTypeface(android.graphics.Typeface.MONOSPACE);
        view.setTextSize(12f);
        view.setTextIsSelectable(true);
        view.setBackgroundColor(0x14808080);
        int padding = dp(8);
        view.setPadding(padding, padding, padding, padding);
        container.addView(view);
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density);
    }

    private void copyToClipboard(String text) {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard != null) {
            clipboard.setPrimaryClip(ClipData.newPlainText("ollama", text));
            Toast.makeText(this, "Copied", Toast.LENGTH_SHORT).show();
        }
    }
}
