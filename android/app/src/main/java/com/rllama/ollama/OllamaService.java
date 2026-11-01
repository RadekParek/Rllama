package com.rllama.ollama;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

/**
 * Keeps {@code ollama serve} alive while the app is in the background so the
 * HTTP API on {@code 127.0.0.1:11434} behaves like the desktop daemon.
 */
public class OllamaService extends Service {
    public static final String ACTION_START = "com.rllama.ollama.action.START";
    public static final String ACTION_STOP = "com.rllama.ollama.action.STOP";

    private static final int NOTIFICATION_ID = 1;

    private PowerManager.WakeLock wakeLock;
    private OllamaManager manager;

    private final OllamaManager.Listener listener = new OllamaManager.Listener() {
        @Override
        public void onStateChanged(OllamaManager.State state, String detail) {
            postNotification();
        }

        @Override
        public void onLogLine(String line) {
            // The console shows the log; the notification only needs the state.
        }
    };

    public static void start(Context context) {
        ContextCompat.startForegroundService(context,
                new Intent(context, OllamaService.class).setAction(ACTION_START));
    }

    public static void stop(Context context) {
        context.startService(new Intent(context, OllamaService.class).setAction(ACTION_STOP));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        manager = OllamaManager.get(this);
        manager.addListener(listener);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            manager.stop();
            stopSelf();
            return START_NOT_STICKY;
        }

        startForeground(NOTIFICATION_ID, buildNotification());
        acquireWakeLock();
        manager.start();
        postNotification();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        manager.removeListener(listener);
        manager.stop();
        releaseWakeLock();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void acquireWakeLock() {
        if (wakeLock != null) {
            return;
        }
        PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
        if (power == null) {
            return;
        }
        wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ollama:server");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire();
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        wakeLock = null;
    }

    private void postNotification() {
        try {
            NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, buildNotification());
        } catch (SecurityException ignored) {
            // The user denied notifications; the server keeps running regardless.
        }
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, TerminalActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(this, 0, open, flags());

        PendingIntent stop = PendingIntent.getService(this, 1,
                new Intent(this, OllamaService.class).setAction(ACTION_STOP), flags());

        String text;
        switch (manager.state()) {
            case RUNNING:
                text = getString(R.string.notification_running, OllamaManager.address());
                break;
            case STARTING:
                text = getString(R.string.notification_starting);
                break;
            case FAILED:
                text = getString(R.string.notification_failed);
                break;
            default:
                text = getString(R.string.notification_idle);
                break;
        }

        return new NotificationCompat.Builder(this, App.CHANNEL_SERVER)
                .setSmallIcon(R.drawable.ic_stat_ollama)
                .setContentTitle(getString(R.string.notification_title))
                .setContentText(text)
                .setContentIntent(content)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .addAction(0, getString(R.string.action_stop_server), stop)
                .build();
    }

    private static int flags() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.FLAG_UPDATE_CURRENT;
    }
}
