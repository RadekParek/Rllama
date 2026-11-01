package com.rllama.ollama;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Tiny HTTP client for the local Ollama REST API. Deliberately dependency free
 * so the app stays small and does not need network permissions for anything
 * other than the loopback/LAN server.
 */
public final class OllamaHttp {
    private static final int TIMEOUT_MS = 10000;
    private static final int STREAM_TIMEOUT_MS = 0;

    public interface LineListener {
        void onLine(String line) throws IOException;

        boolean isCancelled();
    }

    public static final class Model {
        public final String name;
        public final long size;
        public final String family;
        public final String parameters;

        Model(String name, long size, String family, String parameters) {
            this.name = name;
            this.size = size;
            this.family = family;
            this.parameters = parameters;
        }

        @Override
        public String toString() {
            return name + "  (" + formatBytes(size) + ")";
        }
    }

    private OllamaHttp() {
    }

    public static String baseUrl(int port) {
        return "http://127.0.0.1:" + port;
    }

    /** GET an absolute URL (used by the connect screen to test the LAN address). */
    public static String fetchAbsolute(String absoluteUrl) throws IOException {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(absoluteUrl);
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String body = stream == null ? "" : readAll(stream);
            if (status >= 400) {
                throw new IOException("HTTP " + status + ": " + body);
            }
            return body;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    public static String get(int port, String path) throws IOException {
        return request(port, path, null);
    }

    public static String post(int port, String path, String json) throws IOException {
        return request(port, path, json);
    }

    public static boolean isServerUp(int port) {
        try {
            get(port, "/api/version");
            return true;
        } catch (IOException e) {
            return false;
        }
    }

    public static String version(int port) throws IOException {
        return get(port, "/api/version");
    }

    public static List<Model> listModels(int port) throws IOException {
        List<Model> models = new ArrayList<>();
        String body = get(port, "/api/tags");
        try {
            JSONObject root = new JSONObject(body);
            JSONArray array = root.optJSONArray("models");
            if (array == null) {
                return models;
            }
            for (int i = 0; i < array.length(); i++) {
                JSONObject item = array.optJSONObject(i);
                if (item == null) {
                    continue;
                }
                JSONObject details = item.optJSONObject("details");
                models.add(new Model(
                        item.optString("name", item.optString("model", "?")),
                        item.optLong("size", 0L),
                        details != null ? details.optString("family", "") : "",
                        details != null ? details.optString("parameter_size", "") : ""));
            }
        } catch (JSONException e) {
            throw new IOException("unexpected /api/tags response: " + e.getMessage(), e);
        }
        return models;
    }

    public static void deleteModel(int port, String name) throws IOException {
        JSONObject body = new JSONObject();
        try {
            body.put("model", name);
        } catch (JSONException e) {
            throw new IOException(e.getMessage(), e);
        }
        post(port, "/api/delete", body.toString());
    }

    public static void pullModel(int port, String name, LineListener listener) throws IOException {
        JSONObject body = new JSONObject();
        try {
            body.put("model", name);
            body.put("stream", true);
        } catch (JSONException e) {
            throw new IOException(e.getMessage(), e);
        }
        stream(port, "/api/pull", body.toString(), listener);
    }

    /**
     * Streams a chat completion, forwarding each NDJSON chunk to the listener.
     */
    public static void chat(int port, JSONObject request, LineListener listener) throws IOException {
        stream(port, "/api/chat", request.toString(), listener);
    }

    public static void stream(int port, String path, String json, LineListener listener) throws IOException {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(baseUrl(port) + path);
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Accept", "application/x-ndjson");
            connection.setDoOutput(true);
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(STREAM_TIMEOUT_MS);

            byte[] payload = json.getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(payload.length);
            OutputStream out = connection.getOutputStream();
            try {
                out.write(payload);
                out.flush();
            } finally {
                closeQuietly(out);
            }

            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (stream == null) {
                throw new IOException("HTTP " + status + " with empty body for " + path);
            }
            BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
            try {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (listener != null) {
                        listener.onLine(line);
                        if (listener.isCancelled()) {
                            break;
                        }
                    }
                }
            } finally {
                closeQuietly(reader);
            }
            if (status >= 400) {
                throw new IOException("HTTP " + status + " for " + path);
            }
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static String request(int port, String path, String json) throws IOException {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(baseUrl(port) + path);
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            if (json == null) {
                connection.setRequestMethod("GET");
            } else {
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setDoOutput(true);
                byte[] payload = json.getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(payload.length);
                OutputStream out = connection.getOutputStream();
                try {
                    out.write(payload);
                    out.flush();
                } finally {
                    closeQuietly(out);
                }
            }

            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String body = stream == null ? "" : readAll(stream);
            if (status >= 400) {
                throw new IOException("HTTP " + status + ": " + body);
            }
            return body;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static String readAll(InputStream stream) throws IOException {
        BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
        try {
            StringBuilder sb = new StringBuilder();
            char[] buffer = new char[4096];
            int read;
            while ((read = reader.read(buffer)) != -1) {
                sb.append(buffer, 0, read);
            }
            return sb.toString();
        } finally {
            closeQuietly(reader);
        }
    }

    private static void closeQuietly(java.io.Closeable closeable) {
        if (closeable == null) {
            return;
        }
        try {
            closeable.close();
        } catch (IOException ignored) {
            // best effort
        }
    }

    public static String formatBytes(long bytes) {
        if (bytes <= 0) {
            return "0 B";
        }
        String[] units = {"B", "KB", "MB", "GB", "TB"};
        double value = bytes;
        int unit = 0;
        while (value >= 1024 && unit < units.length - 1) {
            value /= 1024;
            unit++;
        }
        return String.format(java.util.Locale.US, "%.1f %s", value, units[unit]);
    }
}
