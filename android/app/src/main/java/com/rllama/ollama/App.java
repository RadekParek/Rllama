package com.rllama.ollama;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;

/**
 * Creates the notification channel and the writable directories the Ollama
 * binary needs. Nothing else happens here; the app is a thin host for the
 * bundled binary.
 */
public class App extends Application {
    public static final String CHANNEL_SERVER = "ollama_server";

    @Override
    public void onCreate() {
        super.onCreate();
        NativePayload.mkdirs(NativePayload.homeDir(this));
        NativePayload.mkdirs(NativePayload.modelsDir(this));
        createChannel();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_SERVER,
                getString(R.string.channel_server),
                NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(getString(R.string.channel_server_description));
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }
}
