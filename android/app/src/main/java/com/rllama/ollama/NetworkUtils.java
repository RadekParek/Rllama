package com.rllama.ollama;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.wifi.WifiManager;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Best-effort discovery of the IPv4 address other machines can use to reach
 * this phone. Falls back to loopback when no network is up.
 */
public final class NetworkUtils {
    private static final long ADDRESS_CACHE_MS = 30000L;

    private static volatile String cachedAddress;
    private static volatile long cachedAt;

    private NetworkUtils() {
    }

    /**
     * Cached because the dashboard refreshes frequently and querying Wi-Fi
     * state on every refresh is wasteful.
     */
    public static String lanAddress(Context context) {
        long now = System.currentTimeMillis();
        String cached = cachedAddress;
        if (cached != null && now - cachedAt < ADDRESS_CACHE_MS) {
            return cached;
        }

        String address = wifiAddress(context);
        if (address == null) {
            for (String candidate : allLanAddresses()) {
                address = candidate;
                break;
            }
        }
        if (address == null) {
            address = "127.0.0.1";
        }
        cachedAddress = address;
        cachedAt = now;
        return address;
    }

    @SuppressWarnings("deprecation")
    private static String wifiAddress(Context context) {
        try {
            WifiManager wifi = (WifiManager) context.getApplicationContext()
                    .getSystemService(Context.WIFI_SERVICE);
            if (wifi == null) {
                return null;
            }
            int ip = wifi.getConnectionInfo().getIpAddress();
            if (ip == 0) {
                return null;
            }
            return String.format(java.util.Locale.US, "%d.%d.%d.%d",
                    (ip & 0xff), (ip >> 8) & 0xff, (ip >> 16) & 0xff, (ip >> 24) & 0xff);
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** Every non-loopback IPv4 address, newest networks first. */
    public static List<String> allLanAddresses() {
        List<String> addresses = new ArrayList<>();
        try {
            for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nif.isUp() || nif.isLoopback()) {
                    continue;
                }
                String name = nif.getName();
                if (name != null && name.startsWith("rmnet")) {
                    // Cellular interfaces are not reachable from the LAN.
                    continue;
                }
                for (InetAddress address : Collections.list(nif.getInetAddresses())) {
                    if (address instanceof Inet4Address && !address.isLoopbackAddress()) {
                        String host = address.getHostAddress();
                        if (host != null && !host.startsWith("169.254.")) {
                            addresses.add(host);
                        }
                    }
                }
            }
        } catch (Exception ignored) {
            // permission or transient failure; caller falls back to loopback
        }
        return addresses;
    }

    /** Link-local address reporting helper used by the connect screen. */
    public static String describeNetworks(Context context) {
        StringBuilder sb = new StringBuilder();
        List<String> addresses = allLanAddresses();
        if (addresses.isEmpty()) {
            return "no LAN address detected (Wi-Fi off?)";
        }
        for (String address : addresses) {
            sb.append(address);
            if (addresses.indexOf(address) != addresses.size() - 1) {
                sb.append(", ");
            }
        }
        ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm != null) {
            Network active = cm.getActiveNetwork();
            LinkProperties props = active == null ? null : cm.getLinkProperties(active);
            if (props != null) {
                List<LinkAddress> linkAddresses = props.getLinkAddresses();
                if (!linkAddresses.isEmpty()) {
                    sb.append(" (").append(props.getInterfaceName()).append(')');
                }
            }
        }
        return sb.toString();
    }
}
