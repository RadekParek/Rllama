package com.rllama.ollama;

import android.app.Application;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Creates the writable directories the Ollama binary needs and records the last
 * crash, so a failure is reported in the console instead of only killing the
 * app.
 */
public class App extends Application {
    public static final String CHANNEL_SERVER = "ollama_server";
    private static final String CRASH_FILE = "last-crash.txt";

    /** Text of the previous crash, if any; shown once by the console. */
    private static volatile String lastCrash;

    @Override
    public void onCreate() {
        super.onCreate();
        installCrashHandler();
        try {
            NativePayload.mkdirs(NativePayload.homeDir(this));
            NativePayload.mkdirs(NativePayload.modelsDir(this));
        } catch (Throwable ignored) {
            // Storage problems surface in the console instead of here.
        }
        OllamaService.ensureChannel(this);
    }

    private void installCrashHandler() {
        final Thread.UncaughtExceptionHandler previous =
                Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override
            public void uncaughtException(Thread thread, Throwable error) {
                record(error, thread);
                if (previous != null) {
                    previous.uncaughtException(thread, error);
                }
            }
        });
    }

    private void record(Throwable error, Thread thread) {
        try {
            StringWriter buffer = new StringWriter();
            PrintWriter writer = new PrintWriter(buffer);
            writer.println("thread: " + (thread == null ? "?" : thread.getName()));
            writer.println("when: " + new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US)
                    .format(new Date()));
            error.printStackTrace(writer);
            writer.flush();
            lastCrash = buffer.toString();

            File file = new File(getFilesDir(), CRASH_FILE);
            FileOutputStream out = new FileOutputStream(file);
            Writer fileWriter = new OutputStreamWriter(out, "UTF-8");
            fileWriter.write(lastCrash);
            fileWriter.flush();
            fileWriter.close();
        } catch (IOException ignored) {
            // Recording a crash must never crash.
        }
    }

    /** Returns and clears the previous crash report. */
    public static String takeLastCrash() {
        String text = lastCrash;
        lastCrash = null;
        return text;
    }

    /** Reads a crash report left by an earlier process, then deletes it. */
    public static String readStoredCrash(android.content.Context context) {
        File file = new File(context.getFilesDir(), CRASH_FILE);
        if (!file.isFile()) {
            return null;
        }
        try {
            java.io.InputStream in = new java.io.FileInputStream(file);
            byte[] buffer = new byte[(int) file.length()];
            int total = 0;
            int read;
            while (total < buffer.length && (read = in.read(buffer, total, buffer.length - total)) > 0) {
                total += read;
            }
            in.close();
            file.delete();
            return new String(buffer, 0, total, "UTF-8");
        } catch (IOException e) {
            file.delete();
            return null;
        }
    }
}
