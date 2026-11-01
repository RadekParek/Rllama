package com.rllama.ollama;

import android.content.Context;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Rewrites command lines typed in the built-in terminal so that {@code ollama}
 * and {@code llama-server} resolve to the executables bundled in the APK.
 *
 * Android apps cannot place runnable shims on PATH (the only executable
 * directory is the read-only native library directory), so the first token of
 * each command is replaced with the absolute path instead.
 */
public final class ShellCommand {
    private ShellCommand() {
    }

    public static String rewrite(String commandLine, Context context) {
        if (commandLine == null || commandLine.trim().isEmpty()) {
            return "";
        }
        String result = commandLine;
        result = replaceCommand(result, "ollama",
                NativePayload.ollamaBinary(context).getAbsolutePath());
        result = replaceCommand(result, "llama-server",
                NativePayload.llamaServerBinary(context).getAbsolutePath());
        return result;
    }

    private static String replaceCommand(String input, String name, String absolutePath) {
        // Only rewrite when the token sits in command position: at the start of
        // the line or right after a separator such as `;`, `&&`, or `|`.
        Pattern pattern = Pattern.compile(
                "(^|[;&|(]\\s*)" + Pattern.quote(name) + "(?=\\s|$|[;&|)])");
        Matcher matcher = pattern.matcher(input);
        StringBuffer out = new StringBuffer();
        while (matcher.find()) {
            String prefix = matcher.group(1);
            String replacement = prefix + quote(absolutePath);
            matcher.appendReplacement(out, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(out);
        return out.toString();
    }

    private static String quote(String path) {
        if (path.indexOf(' ') < 0 && path.indexOf('\'') < 0) {
            return path;
        }
        return "'" + path.replace("'", "'\\''") + "'";
    }
}
