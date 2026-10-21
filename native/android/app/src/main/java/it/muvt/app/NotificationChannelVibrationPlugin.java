package it.muvt.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

@CapacitorPlugin(name = "NotificationChannelVibration")
public class NotificationChannelVibrationPlugin extends Plugin {
    @PluginMethod
    public void setPattern(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve();
            return;
        }

        String channelId = call.getString("channelId");
        JSArray durations = call.getArray("pattern");
        if (channelId == null || channelId.isEmpty() || durations == null || durations.length() == 0) {
            call.reject("A notification channel and a non-empty vibration pattern are required");
            return;
        }

        NotificationManager manager = (NotificationManager) getContext()
            .getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            call.reject("Notification service is unavailable");
            return;
        }
        NotificationChannel channel = manager.getNotificationChannel(channelId);
        if (channel == null) {
            call.reject("Notification channel not found: " + channelId);
            return;
        }

        long[] pattern = new long[durations.length() + 1];
        try {
            for (int i = 0; i < durations.length(); i++) {
                long duration = durations.getLong(i);
                if (duration < 0) {
                    call.reject("Vibration durations cannot be negative");
                    return;
                }
                pattern[i + 1] = duration;
            }
        } catch (JSONException e) {
            call.reject("Invalid vibration pattern", null, e);
            return;
        }

        channel.enableVibration(true);
        channel.setVibrationPattern(pattern);
        manager.createNotificationChannel(channel);
        call.resolve();
    }
}
