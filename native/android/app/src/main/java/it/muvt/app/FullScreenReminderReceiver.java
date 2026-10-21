package it.muvt.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class FullScreenReminderReceiver extends BroadcastReceiver {
    static final String EXTRA_FULL_SCREEN = "motiva_full_screen";
    static final String EXTRA_KEY = "motiva_key";
    static final String EXTRA_NAME = "motiva_name";
    static final String EXTRA_START_AT = "motiva_start_at";
    static final String EXTRA_LEVEL = "motiva_level";

    @Override
    public void onReceive(Context context, Intent intent) {
        String channelId = intent.getStringExtra("channelId");
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        String key = intent.getStringExtra("key");
        String name = intent.getStringExtra("name");
        long startAt = intent.getLongExtra("startAt", 0);
        int level = intent.getIntExtra("level", 0);
        int id = intent.getIntExtra("id", 0);
        long[] vibration = intent.getLongArrayExtra("vibration");
        if (channelId == null || title == null || body == null || key == null || name == null) {
            Log.e("Motiva", "Promemoria full-screen incompleto");
            return;
        }

        NotificationManager manager = (NotificationManager) context
            .getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? manager.getNotificationChannel(channelId) : null;
        if ((Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && channel == null)
            || !manager.areNotificationsEnabled()) {
            Log.w("Motiva", "Canale o permesso notifiche non disponibile: " + channelId);
            return;
        }

        Intent launch = new Intent(context, MainActivity.class)
            .setAction("it.muvt.app.FULL_SCREEN_REMINDER")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP
                | Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra(EXTRA_FULL_SCREEN, true)
            .putExtra(EXTRA_KEY, key)
            .putExtra(EXTRA_NAME, name)
            .putExtra(EXTRA_START_AT, startAt)
            .putExtra(EXTRA_LEVEL, level);
        launch.setData(Uri.parse("motiva://reminder/open/" + id));
        PendingIntent activity = PendingIntent.getActivity(context, id, launch,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(context, channelId)
            : new Notification.Builder(context);
        int icon = context.getResources().getIdentifier(
            "ic_stat_muvt", "drawable", context.getPackageName());
        if (icon == 0) icon = context.getApplicationInfo().icon;
        builder.setSmallIcon(icon)
            .setContentTitle(title)
            .setContentText(body)
            .setCategory(Notification.CATEGORY_ALARM)
            .setPriority(Notification.PRIORITY_MAX)
            .setAutoCancel(true)
            .setContentIntent(activity);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            builder.setDefaults(Notification.DEFAULT_SOUND | Notification.DEFAULT_LIGHTS);
            if (vibration != null && vibration.length > 0) {
                long[] pattern = new long[vibration.length + 1];
                System.arraycopy(vibration, 0, pattern, 1, vibration.length);
                builder.setVibrate(pattern);
            } else {
                builder.setDefaults(Notification.DEFAULT_ALL);
            }
        }
        if (Build.VERSION.SDK_INT < 34 || manager.canUseFullScreenIntent()) {
            builder.setFullScreenIntent(activity, true);
        }
        manager.notify(id, builder.build());
    }

    static PendingIntent pendingIntent(Context context, JSONObject reminder) throws JSONException {
        int id = reminder.getInt("id");
        JSONArray vibrationValues = reminder.getJSONArray("vibration");
        long[] vibration = new long[vibrationValues.length()];
        for (int i = 0; i < vibrationValues.length(); i++) {
            vibration[i] = vibrationValues.getLong(i);
        }
        Intent alarm = new Intent(context, FullScreenReminderReceiver.class)
            .setAction("it.muvt.app.FIRE_FULL_SCREEN_REMINDER")
            .setData(Uri.parse("motiva://reminder/alarm/" + id))
            .putExtra("id", id)
            .putExtra("channelId", reminder.getString("channelId"))
            .putExtra("title", reminder.getString("title"))
            .putExtra("body", reminder.getString("body"))
            .putExtra("key", reminder.getString("key"))
            .putExtra("name", reminder.getString("name"))
            .putExtra("startAt", reminder.getLong("startAt"))
            .putExtra("level", reminder.getInt("level"))
            .putExtra("vibration", vibration);
        return PendingIntent.getBroadcast(context, id, alarm,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
