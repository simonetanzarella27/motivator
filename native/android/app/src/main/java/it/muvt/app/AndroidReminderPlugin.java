package it.muvt.app;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(name = "AndroidReminder")
public class AndroidReminderPlugin extends Plugin {
    private static final String PREFS = "motiva_full_screen_reminders";
    private static final String REMINDERS = "reminders";

    @PluginMethod
    public void setPattern(PluginCall call) {
        String channelId = call.getString("channelId");
        JSArray values = call.getArray("pattern");
        if (channelId == null || values == null) {
            call.reject("channelId e pattern sono obbligatori");
            return;
        }

        NotificationManager manager = (NotificationManager) getContext()
            .getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            call.reject("NotificationManager non disponibile");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.resolve();
            return;
        }
        NotificationChannel channel = manager.getNotificationChannel(channelId);
        if (channel == null) {
            call.reject("Canale di notifica non trovato: " + channelId);
            return;
        }
        if (values.length() == 0) {
            call.reject("Il pattern di vibrazione non può essere vuoto");
            return;
        }

        try {
            long[] pattern = new long[values.length() + 1];
            for (int i = 0; i < values.length(); i++) {
                long duration = values.getLong(i);
                if (duration < 0) {
                    call.reject("La durata della vibrazione non può essere negativa");
                    return;
                }
                pattern[i + 1] = duration;
            }
            channel.enableVibration(true);
            channel.setVibrationPattern(pattern);
            manager.createNotificationChannel(channel);
            call.resolve();
        } catch (JSONException e) {
            call.reject("Pattern di vibrazione non valido", e);
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        Context context = getContext();
        JSObject status = new JSObject();
        PowerManager power = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        status.put("batteryOptimizationIgnored", Build.VERSION.SDK_INT < Build.VERSION_CODES.M
            || (power != null && power.isIgnoringBatteryOptimizations(context.getPackageName())));

        NotificationManager notifications = (NotificationManager) context
            .getSystemService(Context.NOTIFICATION_SERVICE);
        status.put("fullScreenIntentAllowed", Build.VERSION.SDK_INT < 34
            || (notifications != null && notifications.canUseFullScreenIntent()));

        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        status.put("exactAlarmsAllowed", Build.VERSION.SDK_INT < Build.VERSION_CODES.S
            || (alarms != null && alarms.canScheduleExactAlarms()));
        call.resolve(status);
    }

    @PluginMethod
    public void requestBackgroundAccess(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            call.resolve();
            return;
        }
        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:" + getContext().getPackageName()));
        openSettings(intent, call);
    }

    @PluginMethod
    public void requestFullScreenIntentAccess(PluginCall call) {
        if (Build.VERSION.SDK_INT < 34) {
            call.resolve();
            return;
        }
        Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
            Uri.parse("package:" + getContext().getPackageName()));
        openSettings(intent, call);
    }

    private void openSettings(Intent intent, PluginCall call) {
        if (intent.resolveActivity(getContext().getPackageManager()) == null) {
            call.reject("Impostazioni Android non disponibili per questo permesso");
            return;
        }
        getActivity().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void scheduleFullScreen(PluginCall call) {
        JSArray reminders = call.getArray("notifications");
        if (reminders == null) {
            call.reject("notifications è obbligatorio");
            return;
        }

        try {
            cancelStoredReminders();
            JSONArray stored = new JSONArray();
            for (int i = 0; i < reminders.length(); i++) {
                JSONObject reminder = reminders.getJSONObject(i);
                stored.put(reminder);
            }
            getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString(REMINDERS, stored.toString()).apply();
            for (int i = 0; i < stored.length(); i++) {
                scheduleReminder(getContext(), stored.getJSONObject(i));
            }
            call.resolve();
        } catch (JSONException | SecurityException | IllegalStateException e) {
            cancelStoredReminders();
            call.reject("Impossibile programmare le notifiche a schermo intero", e);
        }
    }

    @PluginMethod
    public void cancelFullScreen(PluginCall call) {
        cancelStoredReminders();
        call.resolve();
    }

    @PluginMethod
    public void takePendingFullScreenReminder(PluginCall call) {
        Intent launch = getActivity().getIntent();
        if (launch == null || !launch.hasExtra(FullScreenReminderReceiver.EXTRA_FULL_SCREEN)) {
            call.resolve(new JSObject());
            return;
        }

        JSObject reminder = new JSObject();
        reminder.put("key", launch.getStringExtra(FullScreenReminderReceiver.EXTRA_KEY));
        reminder.put("name", launch.getStringExtra(FullScreenReminderReceiver.EXTRA_NAME));
        reminder.put("startAt", launch.getLongExtra(FullScreenReminderReceiver.EXTRA_START_AT, 0));
        reminder.put("level", launch.getIntExtra(FullScreenReminderReceiver.EXTRA_LEVEL, 0));
        launch.removeExtra(FullScreenReminderReceiver.EXTRA_FULL_SCREEN);
        JSObject result = new JSObject();
        result.put("reminder", reminder);
        call.resolve(result);
    }

    private void cancelStoredReminders() {
        Context context = getContext();
        String raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(REMINDERS, "[]");
        try {
            JSONArray reminders = new JSONArray(raw);
            for (int i = 0; i < reminders.length(); i++) {
                JSONObject reminder = reminders.getJSONObject(i);
                PendingIntent pending = FullScreenReminderReceiver.pendingIntent(context, reminder);
                AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
                if (alarms != null) alarms.cancel(pending);
                pending.cancel();
            }
        } catch (JSONException e) {
            Log.e("Motiva", "Elenco allarmi full-screen non valido", e);
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(REMINDERS).apply();
    }

    static void scheduleReminder(Context context, JSONObject reminder) throws JSONException {
        AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarms == null) throw new IllegalStateException("AlarmManager non disponibile");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarms.canScheduleExactAlarms()) {
            throw new SecurityException("Permesso allarmi esatti non concesso");
        }
        PendingIntent pending = FullScreenReminderReceiver.pendingIntent(context, reminder);
        alarms.setExactAndAllowWhileIdle(
            AlarmManager.RTC_WAKEUP, reminder.getLong("at"), pending);
    }
}
