package com.rllama.ollama;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Keeps {@code ollama serve} alive while the app is in the background so the
 * HTTP API on {@code 127.0.0.1:11434} behaves like the desktop daemon.
 *
 * <p>Uses platform notification APIs only (minSdk is 26), so the app has no
 * AndroidX dependencies and nothing extra to crash at startup.
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

    /** Starts the service; safe from any thread and never throws. */
    public static void start(Context context) {
        try {
            Intent intent = new Intent(context, OllamaService.class).setAction(ACTION_START);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Throwable ignored) {
            // The console still works with a server started from the CLI.
        }
    }

    public static void stop(Context context) {
        try {
            context.startService(new Intent(context, OllamaService.class).setAction(ACTION_STOP));
        } catch (Throwable ignored) {
            // Nothing to do.
        }
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

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, buildNotification(),
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(NOTIFICATION_ID, buildNotification());
            }
        } catch (Throwable t) {
            // e.g. ForegroundServiceStartNotAllowedException on Android 12+ when
            // the system restarts the service in the background. Never crash:
            // the server simply keeps running without the notification.
            stopSelf();
            return START_NOT_STICKY;
        }

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
        try {
            PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
            if (power == null) {
                return;
            }
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ollama:server");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
        } catch (Throwable ignored) {
            wakeLock = null;
        }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Throwable ignored) {
            // Already released.
        }
        wakeLock = null;
    }

    private void postNotification() {
        try {
            NotificationManager notificationManager =
                    (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (notificationManager == null) {
                return;
            }
            notificationManager.notify(NOTIFICATION_ID, buildNotification());
        } catch (Throwable ignored) {
            // Missing POST_NOTIFICATIONS or a vendor restriction: the server
            // keeps running regardless.
        }
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, TerminalActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(this, 0, open, flags());

        PendingIntent stopAction = PendingIntent.getService(this, 1,
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

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, App.CHANNEL_SERVER)
                : new Notification.Builder(this);
        return builder
                .setSmallIcon(R.drawable.ic_stat_ollama)
                .setContentTitle(getString(R.string.notification_title))
                .setContentText(text)
                .setContentIntent(content)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(Notification.PRIORITY_LOW)
                .addAction(0, getString(R.string.action_stop_server), stopAction)
                .build();
    }

    private static int flags() {
        return PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
    }

    /** Creates the notification channel; called by {@link App} as well. */
    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager =
                (NotificationManager) context.getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
                App.CHANNEL_SERVER,
                context.getString(R.string.channel_server),
                NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(context.getString(R.string.channel_server_description));
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }
}
