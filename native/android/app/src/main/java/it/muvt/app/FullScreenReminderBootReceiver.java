package it.muvt.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.app.AlarmManager;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class FullScreenReminderBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String raw = context.getSharedPreferences("motiva_full_screen_reminders", Context.MODE_PRIVATE)
            .getString("reminders", "[]");
        try {
            JSONArray reminders = new JSONArray(raw);
            AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (alarms == null) throw new IllegalStateException("AlarmManager non disponibile");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !alarms.canScheduleExactAlarms()) {
                Log.w("Motiva", "Allarmi full-screen non ripristinati: permesso allarmi esatti assente");
                return;
            }
            for (int i = 0; i < reminders.length(); i++) {
                JSONObject reminder = reminders.getJSONObject(i);
                if (reminder.getLong("at") > System.currentTimeMillis()) {
                    AndroidReminderPlugin.scheduleReminder(context, reminder);
                }
            }
        } catch (JSONException | SecurityException | IllegalStateException e) {
            Log.e("Motiva", "Ripristino allarmi full-screen non riuscito", e);
        }
    }
}
