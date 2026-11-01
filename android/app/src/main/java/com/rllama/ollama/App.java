package com.rllama.ollama;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;

/**
 * Creates the long lived notification channel used by {@link OllamaService}
 * and makes sure the working directories exist before anything else runs.
 */
public class App extends Application {
    public static final String CHANNEL_SERVER = "ollama_server";

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels();
        Prefs prefs = new Prefs(this);
        NativePayload.mkdirs(prefs.modelDir());
        NativePayload.mkdirs(prefs.workDir());
    }

    private void createChannels() {
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
