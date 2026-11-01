package com.rllama.ollama;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

/**
 * Foreground service that keeps the bundled Ollama server alive while the app
 * is in the background, with a wake lock so long generations are not cut short
 * by the phone dozing.
 */
public class OllamaService extends Service {
    public static final String ACTION_START = "com.rllama.ollama.action.START";
    public static final String ACTION_STOP = "com.rllama.ollama.action.STOP";

    private static final int NOTIFICATION_ID = 11434;
    private static volatile boolean running;

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    private final OllamaManager.Listener listener = new OllamaManager.Listener() {
        @Override
        public void onStateChanged(OllamaManager.State state, String detail) {
            postNotification();
        }

        @Override
        public void onLogLine(String line) {
            // Only state changes need to reach the notification.
        }
    };

    public static void start(Context context) {
        Intent intent = new Intent(context, OllamaService.class).setAction(ACTION_START);
        ContextCompat.startForegroundService(context, intent);
    }

    public static void stop(Context context) {
        Intent intent = new Intent(context, OllamaService.class).setAction(ACTION_STOP);
        context.startService(intent);
    }

    /** Starts the service only when the server is not being managed already. */
    public static void ensureRunning(Context context, boolean startIfNotRunning) {
        if (!startIfNotRunning || running) {
            return;
        }
        if (OllamaManager.get(context).isRunning()) {
            return;
        }
        try {
            start(context);
        } catch (RuntimeException e) {
            android.util.Log.w("RllamaService", "could not start service: " + e.getMessage());
        }
    }

    public static boolean isRunning() {
        return running;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        OllamaManager.get(this).addListener(listener);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            OllamaManager.get(this).stop();
            stopSelf();
            return START_NOT_STICKY;
        }

        startForeground(NOTIFICATION_ID, buildNotification());
        acquireLocks();
        OllamaManager.get(this).start();
        postNotification();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        OllamaManager.get(this).removeListener(listener);
        OllamaManager.get(this).stop();
        releaseLocks();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void postNotification() {
        try {
            NotificationManagerCompat.from(this).notify(NOTIFICATION_ID, buildNotification());
        } catch (SecurityException e) {
            android.util.Log.w("RllamaService", "notification permission missing: " + e.getMessage());
        }
    }

    private Notification buildNotification() {
        OllamaManager manager = OllamaManager.get(this);
        Prefs prefs = new Prefs(this);

        String title = getString(R.string.notification_title);
        String text;
        switch (manager.state()) {
            case RUNNING:
                text = getString(R.string.notification_running, NativePayload.bindAddress(prefs));
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

        Intent openIntent = new Intent(this, TerminalActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
                this, 0, openIntent, pendingIntentFlags());

        Intent stopIntent = new Intent(this, OllamaService.class).setAction(ACTION_STOP);
        PendingIntent stopPendingIntent = PendingIntent.getService(
                this, 1, stopIntent, pendingIntentFlags());

        return new NotificationCompat.Builder(this, App.CHANNEL_SERVER)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setSmallIcon(R.drawable.ic_stat_ollama)
                .setOngoing(true)
                .setContentIntent(contentIntent)
                .addAction(0, getString(R.string.action_stop_server), stopPendingIntent)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .build();
    }

    private int pendingIntentFlags() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.FLAG_UPDATE_CURRENT;
    }

    @SuppressWarnings("deprecation")
    private void acquireLocks() {
        if (wakeLock == null) {
            PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (power != null) {
                wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "rllama:ollama");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire();
            }
        }
        if (wifiLock == null && new Prefs(this).lanEnabled()) {
            WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi != null) {
                wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "rllama:ollama-wifi");
                wifiLock.setReferenceCounted(false);
                wifiLock.acquire();
            }
        }
    }

    private void releaseLocks() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        wakeLock = null;
        if (wifiLock != null && wifiLock.isHeld()) {
            wifiLock.release();
        }
        wifiLock = null;
    }
}
