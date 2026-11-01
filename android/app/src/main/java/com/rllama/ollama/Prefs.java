package com.rllama.ollama;

import android.content.Context;
import android.content.SharedPreferences;

import java.io.File;

/**
 * Persisted user settings for the embedded Ollama server.
 */
public final class Prefs {
    private static final String FILE = "rllama_ollama_settings";

    private final Context appContext;
    private final SharedPreferences prefs;

    public Prefs(Context context) {
        this.appContext = context.getApplicationContext();
        this.prefs = appContext.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    public int port() {
        int value = prefs.getInt("port", 11434);
        if (value < 1024 || value > 65535) {
            return 11434;
        }
        return value;
    }

    public void setPort(int port) {
        prefs.edit().putInt("port", port).apply();
    }

    /** Bind to 0.0.0.0 so other devices on the network (and Termux) can connect. */
    public boolean lanEnabled() {
        return prefs.getBoolean("lan", true);
    }

    public void setLanEnabled(boolean enabled) {
        prefs.edit().putBoolean("lan", enabled).apply();
    }

    /** 0 keeps the Ollama default (chosen from available memory). */
    public int contextLength() {
        return prefs.getInt("context_length", 8192);
    }

    public void setContextLength(int value) {
        prefs.edit().putInt("context_length", Math.max(0, value)).apply();
    }

    public int numParallel() {
        int value = prefs.getInt("num_parallel", 1);
        return value < 1 ? 1 : value;
    }

    public void setNumParallel(int value) {
        prefs.edit().putInt("num_parallel", Math.max(1, value)).apply();
    }

    public String keepAlive() {
        String value = prefs.getString("keep_alive", "5m");
        return value == null || value.trim().isEmpty() ? "5m" : value.trim();
    }

    public void setKeepAlive(String value) {
        prefs.edit().putString("keep_alive", value == null ? "5m" : value.trim()).apply();
    }

    public boolean debugLogs() {
        return prefs.getBoolean("debug", false);
    }

    public void setDebugLogs(boolean value) {
        prefs.edit().putBoolean("debug", value).apply();
    }

    public boolean startOnBoot() {
        return prefs.getBoolean("start_on_boot", false);
    }

    public void setStartOnBoot(boolean value) {
        prefs.edit().putBoolean("start_on_boot", value).apply();
    }

    public String lastModel() {
        String value = prefs.getString("last_model", "");
        return value == null ? "" : value;
    }

    public void setLastModel(String model) {
        prefs.edit().putString("last_model", model == null ? "" : model).apply();
    }

    /**
     * Where model blobs live. App-specific external storage is the default so
     * multi-gigabyte models do not fill up the internal data partition.
     */
    public File modelDir() {
        String stored = prefs.getString("models_dir", null);
        if (stored != null && !stored.trim().isEmpty()) {
            return new File(stored.trim());
        }
        File external = appContext.getExternalFilesDir(null);
        File base = external != null ? new File(external, "models") : new File(appContext.getFilesDir(), "models");
        return base;
    }

    public void setModelDir(String path) {
        if (path == null) {
            prefs.edit().remove("models_dir").apply();
        } else {
            prefs.edit().putString("models_dir", path).apply();
        }
    }

    /** Directory used for scratch work (imports, Modelfiles, logs). */
    public File workDir() {
        return new File(appContext.getFilesDir(), "work");
    }
}
