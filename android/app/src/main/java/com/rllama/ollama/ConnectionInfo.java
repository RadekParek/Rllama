package com.rllama.ollama;

import android.content.Context;

import java.util.ArrayList;
import java.util.List;

/**
 * Builds the copy/paste snippets that let coding agents (Claude Code, Codex,
 * OpenCode, …) and other clients talk to the Ollama server running on this
 * phone.
 *
 * Ollama exposes the Anthropic Messages API on {@code /v1/messages} and the
 * OpenAI Chat Completions API on {@code /v1/chat/completions}, so agents only
 * need a base URL pointing at the phone.
 */
public final class ConnectionInfo {
    /** A snippet shown on the connect screen. */
    public static final class Section {
        public final String title;
        public final String description;
        public final String body;

        Section(String title, String description, String body) {
            this.title = title;
            this.description = description;
            this.body = body;
        }
    }

    private ConnectionInfo() {
    }

    public static String loopbackUrl(Prefs prefs) {
        return "http://127.0.0.1:" + prefs.port();
    }

    public static String lanUrl(Context context, Prefs prefs) {
        return "http://" + NetworkUtils.lanAddress(context) + ":" + prefs.port();
    }

    public static List<Section> sections(Context context, Prefs prefs, String model) {
        List<Section> sections = new ArrayList<>();
        String lan = lanUrl(context, prefs);
        String loopback = loopbackUrl(prefs);
        String selected = model == null || model.trim().isEmpty() ? "qwen2.5-coder:7b" : model.trim();
        int port = prefs.port();

        sections.add(new Section(
                "Claude Code on another computer",
                "Same Wi-Fi network. Requires \"allow connections from other devices\" in Settings.",
                "export ANTHROPIC_BASE_URL=" + lan + "\n"
                        + "export ANTHROPIC_AUTH_TOKEN=ollama\n"
                        + "export ANTHROPIC_API_KEY=\n"
                        + "export ANTHROPIC_MODEL=" + selected + "\n"
                        + "claude"));

        sections.add(new Section(
                "Claude Code on this phone (Termux)",
                "Loopback is shared between apps, so Termux can use the server without opening the LAN.",
                "export ANTHROPIC_BASE_URL=" + loopback + "\n"
                        + "export ANTHROPIC_AUTH_TOKEN=ollama\n"
                        + "export ANTHROPIC_API_KEY=\n"
                        + "export ANTHROPIC_MODEL=" + selected + "\n"
                        + "claude"));

        sections.add(new Section(
                "Ollama CLI on another computer",
                "Point the desktop CLI at the phone instead of localhost.",
                "export OLLAMA_HOST=http://" + NetworkUtils.lanAddress(context) + ":" + port + "\n"
                        + "ollama list\n"
                        + "ollama run " + selected + "\n"
                        + "\n"
                        + "# or launch an integration that talks to this phone\n"
                        + "OLLAMA_HOST=http://" + NetworkUtils.lanAddress(context) + ":" + port
                        + " ollama launch claude"));

        sections.add(new Section(
                "OpenAI-compatible clients",
                "Any SDK that accepts a custom base URL can use the phone.",
                "base_url = \"" + lan + "/v1\"\n"
                        + "api_key  = \"ollama\"     # any non-empty value\n"
                        + "model    = \"" + selected + "\""));

        sections.add(new Section(
                "Verify the endpoint",
                "Quick smoke test from another machine.",
                "curl " + lan + "/api/version\n"
                        + "\n"
                        + "curl " + lan + "/v1/messages \\\n"
                        + "  -H 'content-type: application/json' \\\n"
                        + "  -d '{\"model\":\"" + selected + "\",\"max_tokens\":64,"
                        + "\"messages\":[{\"role\":\"user\",\"content\":\"hello\"}]}'"));

        sections.add(new Section(
                "Model tips for phones",
                "Coding agents need tool calling and a decent context window.",
                "ollama pull " + selected + "      # 7B, needs ~6 GB RAM\n"
                        + "ollama pull qwen2.5-coder:1.5b # small, fast\n"
                        + "ollama pull gemma3:1b          # smallest useful chat model\n\n"
                        + "# slower but higher quality if the phone can take it\n"
                        + "ollama pull qwen2.5-coder:14b\n\n"
                        + "# coding agents also want a bigger context window:\n"
                        + "# Settings -> Context length = 16384 (costs RAM)"));
        return sections;
    }

    /** Plain text version used by the {@code connect} command in the terminal. */
    public static String shellSummary(Context context, Prefs prefs) {
        StringBuilder sb = new StringBuilder();
        sb.append("Connections to this server\n");
        sb.append("--------------------------\n");
        sb.append("local:  ").append(loopbackUrl(prefs)).append('\n');
        sb.append("lan:    ").append(prefs.lanEnabled() ? lanUrl(context, prefs) : "disabled (Settings)").append('\n');
        sb.append("networks: ").append(NetworkUtils.describeNetworks(context)).append("\n\n");
        for (Section section : sections(context, prefs, null)) {
            sb.append(section.title).append('\n');
            for (String line : section.body.split("\n")) {
                sb.append("  ").append(line).append('\n');
            }
            sb.append('\n');
        }
        return sb.toString();
    }
}
