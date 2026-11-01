package com.rllama.ollama;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Optionally brings the server back after a reboot so the phone can act as an
 * always-available Ollama endpoint for other machines.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) {
            return;
        }
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) {
            return;
        }
        if (!new Prefs(context).startOnBoot()) {
            return;
        }
        OllamaService.start(context);
    }
}
