package app.rllama;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONException;

import java.io.File;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * The device half of Rllama.
 *
 * Three jobs, all of which a webview cannot do on its own:
 *
 *  1. Find an Ollama daemon on the local network. The browser build can only
 *     try 127.0.0.1, which on a phone means the phone itself; a phone talking to
 *     Ollama on a PC needs a subnet scan, and that has to happen natively.
 *  2. Hand shell commands to Termux through its RUN_COMMAND service, so Termux
 *     and Rllama run side by side: Termux owns the shell, Rllama owns the UI.
 *  3. List the GGUF files on shared storage, which is where models exported from
 *     PocketPal (or downloaded from Hugging Face) end up.
 */
@CapacitorPlugin(
    name = "RllamaNative",
    permissions = {
      @Permission(alias = "storage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
    }
)
public class RllamaNativePlugin extends Plugin {

  private static final String TERMUX_PACKAGE = "com.termux";
  private static final String RUN_COMMAND_PERMISSION = "com.termux.permission.RUN_COMMAND";
  private static final String ACTION_RUN_COMMAND = "com.termux.RUN_COMMAND";
  private static final String TERMUX_SERVICE = "com.termux.app.RunCommandService";
  private static final String TERMUX_BASH = "/data/data/com.termux/files/usr/bin/bash";
  private static final String TERMUX_HOME = "/data/data/com.termux/files/home";
  private static final String RESULT_BUNDLE = "com.termux.RUN_COMMAND_RESULT_BUNDLE";

  private final ExecutorService pool = Executors.newCachedThreadPool();
  private final Handler main = new Handler(Looper.getMainLooper());
  private final AtomicInteger requestCodes = new AtomicInteger(1000);

  /** requestCode -> waiting call, so a Termux result can be routed back. */
  private final java.util.Map<Integer, PluginCall> pending = new java.util.HashMap<>();
  private BroadcastReceiver termuxReceiver;

  /* ------------------------------------------------------------- Termux */

  @PluginMethod
  public void termuxStatus(PluginCall call) {
    JSObject result = new JSObject();
    boolean installed = isTermuxInstalled();
    boolean permission = getContext().checkSelfPermission(RUN_COMMAND_PERMISSION) == PackageManager.PERMISSION_GRANTED;
    result.put("installed", installed);
    result.put("canRun", installed && permission);
    if (!installed) {
      result.put("message", "Termux is not installed. Install it from F-Droid, then reopen this panel.");
    } else if (!permission) {
      result.put("message", "Termux is installed but has not granted this app the RUN_COMMAND permission.");
    }
    call.resolve(result);
  }

  @PluginMethod
  public void openTermux(PluginCall call) {
    try {
      Intent intent = getContext().getPackageManager().getLaunchIntentForPackage(TERMUX_PACKAGE);
      if (intent == null) {
        call.reject("Termux is not installed");
        return;
      }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      getContext().startActivity(intent);
      call.resolve();
    } catch (Exception error) {
      call.reject(error.getMessage());
    }
  }

  @PluginMethod
  public void termuxRun(PluginCall call) {
    String command = call.getString("command", "");
    if (command == null || command.trim().isEmpty()) {
      call.reject("No command given");
      return;
    }
    if (!isTermuxInstalled()) {
      JSObject result = new JSObject();
      result.put("ok", false);
      result.put("message", "Termux is not installed. Install it from F-Droid to run shell commands.");
      call.resolve(result);
      return;
    }

    Boolean background = call.getBoolean("background", Boolean.FALSE);
    Integer timeoutMs = call.getInt("timeoutMs", 60000);
    final boolean runInBackground = background != null && background;

    try {
      Intent intent = new Intent();
      intent.setClassName(TERMUX_PACKAGE, TERMUX_SERVICE);
      intent.setAction(ACTION_RUN_COMMAND);
      intent.putExtra("com.termux.RUN_COMMAND_PATH", TERMUX_BASH);
      intent.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[] { "-lc", command });
      intent.putExtra("com.termux.RUN_COMMAND_WORKDIR", TERMUX_HOME);
      intent.putExtra("com.termux.RUN_COMMAND_BACKGROUND", runInBackground);
      intent.putExtra("com.termux.RUN_COMMAND_SESSION_ACTION", "0");

      if (runInBackground) {
        getContext().startService(intent);
        JSObject result = new JSObject();
        result.put("ok", true);
        result.put("message", "Handed to Termux in the background.");
        call.resolve(result);
        return;
      }

      registerReceiverIfNeeded();
      final int requestCode = requestCodes.incrementAndGet();
      pending.put(requestCode, call);

      Intent callbackIntent = new Intent("app.rllama.TERMUX_RESULT");
      callbackIntent.setPackage(getContext().getPackageName());
      int flags = PendingIntentFlag();
      android.app.PendingIntent pendingIntent = android.app.PendingIntent.getBroadcast(
          getContext(), requestCode, callbackIntent, flags);
      intent.putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", pendingIntent);
      getContext().startService(intent);

      final int timeout = timeoutMs == null ? 60000 : timeoutMs;
      main.postDelayed(() -> {
        PluginCall waiting = pending.remove(requestCode);
        if (waiting != null) {
          JSObject result = new JSObject();
          result.put("ok", false);
          result.put(
              "message",
              "Termux did not answer. Open Termux once, set allow-external-apps=true in "
                  + "~/.termux/termux.properties, restart it, and try again.");
          waiting.resolve(result);
        }
      }, timeout);
    } catch (Exception error) {
      JSObject result = new JSObject();
      result.put("ok", false);
      result.put("message", error.getMessage() == null ? "Termux refused the command" : error.getMessage());
      call.resolve(result);
    }
  }

  private int PendingIntentFlag() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      return android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_MUTABLE;
    }
    return android.app.PendingIntent.FLAG_UPDATE_CURRENT;
  }

  private void registerReceiverIfNeeded() {
    if (termuxReceiver != null) {
      return;
    }
    termuxReceiver = new BroadcastReceiver() {
      @Override
      public void onReceive(Context context, Intent intent) {
        if (intent == null) {
          return;
        }
        // The request code is not shipped back, so the oldest waiting call wins.
        Integer key = pending.isEmpty() ? null : pending.keySet().iterator().next();
        PluginCall waiting = key == null ? null : pending.remove(key);
        if (waiting == null) {
          return;
        }
        Bundle bundle = intent.getBundleExtra(RESULT_BUNDLE);
        JSObject result = new JSObject();
        if (bundle == null) {
          result.put("ok", true);
          result.put("message", "Command finished (Termux sent no output bundle).");
          waiting.resolve(result);
          return;
        }
        String stdout = bundle.getString("stdout", "");
        String stderr = bundle.getString("stderr", "");
        int exitCode = bundle.getInt("exitCode", 0);
        result.put("ok", exitCode == 0);
        result.put("stdout", stdout == null ? "" : stdout);
        result.put("stderr", stderr == null ? "" : stderr);
        result.put("exitCode", exitCode);
        waiting.resolve(result);
      }
    };
    IntentFilter filter = new IntentFilter("app.rllama.TERMUX_RESULT");
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      getContext().registerReceiver(termuxReceiver, filter, Context.RECEIVER_EXPORTED);
    } else {
      getContext().registerReceiver(termuxReceiver, filter);
    }
  }

  /** `JSONArray.put(String)` is declared to throw; a bad string is not worth a crash. */
  private static void addString(JSArray array, String value) {
    try {
      array.put(value);
    } catch (Exception ignored) {
      // Nothing useful to do: an unrepresentable string is dropped.
    }
  }

  private boolean isTermuxInstalled() {
    try {
      getContext().getPackageManager().getPackageInfo(TERMUX_PACKAGE, 0);
      return true;
    } catch (Exception error) {
      return false;
    }
  }

  /* --------------------------------------------------------- LAN scanning */

  @PluginMethod
  public void scanLan(PluginCall call) {
    Integer portValue = call.getInt("port", 11434);
    final int port = portValue == null ? 11434 : portValue;

    pool.execute(() -> {
      JSObject result = new JSObject();
      JSArray hosts = new JSArray();
      JSArray interfaces = new JSArray();
      List<InetAddress> targets = new ArrayList<>();

      try {
        for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
          if (!network.isUp() || network.isLoopback() || network.isVirtual()) {
            continue;
          }
          for (InterfaceAddress address : network.getInterfaceAddresses()) {
            InetAddress local = address.getAddress();
            if (!(local instanceof Inet4Address)) {
              continue;
            }
            addString(interfaces, local.getHostAddress() + "/" + address.getNetworkPrefixLength());
            byte[] raw = local.getAddress();
            for (int host = 1; host <= 254 && targets.size() < 1024; host += 1) {
              byte[] candidate = { raw[0], raw[1], raw[2], (byte) host };
              try {
                targets.add(InetAddress.getByAddress(candidate));
              } catch (Exception ignored) {
                // Skip an address the resolver rejects.
              }
            }
          }
        }
      } catch (Exception error) {
        result.put("message", "Cannot read network interfaces: " + error.getMessage());
      }

      int workers = Math.min(48, Math.max(1, targets.size()));
      List<Thread> threads = new ArrayList<>();
      final AtomicInteger index = new AtomicInteger(0);
      for (int worker = 0; worker < workers; worker += 1) {
        Thread thread = new Thread(() -> {
          for (;;) {
            int position = index.getAndIncrement();
            if (position >= targets.size()) {
              return;
            }
            InetAddress host = targets.get(position);
            try (Socket socket = new Socket()) {
              socket.connect(new InetSocketAddress(host, port), 350);
              synchronized (hosts) {
                addString(hosts, host.getHostAddress());
              }
            } catch (Exception ignored) {
              // Closed port or unreachable host: expected.
            }
          }
        });
        thread.setDaemon(true);
        threads.add(thread);
        thread.start();
      }
      for (Thread thread : threads) {
        try {
          thread.join(9000);
        } catch (InterruptedException error) {
          Thread.currentThread().interrupt();
        }
      }

      result.put("hosts", hosts);
      result.put("interfaces", interfaces);
      call.resolve(result);
    });
  }

  /* ------------------------------------------------------------ GGUF files */

  @PluginMethod
  public void listGguf(PluginCall call) {
    if (getPermissionState("storage") != com.getcapacitor.PermissionState.GRANTED
        && Build.VERSION.SDK_INT <= Build.VERSION_CODES.S_V2) {
      requestPermissionForAlias("storage", call, "storagePermissionCallback");
      return;
    }
    resolveGguf(call);
  }

  @PermissionCallback
  private void storagePermissionCallback(PluginCall call) {
    resolveGguf(call);
  }

  private void resolveGguf(PluginCall call) {
    JSArray files = new JSArray();
    JSArray scanned = new JSArray();
    JSArray denied = new JSArray();

    List<String> directories = new ArrayList<>();
    JSArray given = call.getArray("dirs");
    if (given != null) {
      for (int index = 0; index < given.length(); index += 1) {
        try {
          directories.add(given.getString(index));
        } catch (JSONException ignored) {
          // Skip a malformed entry.
        }
      }
    }

    for (String directory : directories) {
      File root = new File(directory);
      addString(scanned, directory);
      if (!root.isDirectory()) {
        continue;
      }
      if (!root.canRead()) {
        addString(denied, directory);
        continue;
      }
      collectGguf(root, files, 0);
    }

    JSObject result = new JSObject();
    result.put("files", files);
    result.put("scanned", scanned);
    result.put("denied", denied);
    call.resolve(result);
  }

  private void collectGguf(File directory, JSArray files, int depth) {
    File[] children = directory.listFiles();
    if (children == null) {
      return;
    }
    for (File child : children) {
      if (child.isDirectory()) {
        if (depth < 1) {
          collectGguf(child, files, depth + 1);
        }
        continue;
      }
      String name = child.getName();
      if (!name.toLowerCase().endsWith(".gguf")) {
        continue;
      }
      JSObject entry = new JSObject();
      entry.put("path", child.getAbsolutePath());
      entry.put("name", name);
      entry.put("size", (double) child.length());
      files.put(entry);
    }
  }
}
