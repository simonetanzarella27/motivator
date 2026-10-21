package it.muvt.app;

import android.os.Bundle;
import android.content.Intent;
import android.os.Build;
import android.view.Window;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        if (isFullScreenLaunch(getIntent())) {
            enableFullScreenWindow();
        }
        registerPlugin(AndroidReminderPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (isFullScreenLaunch(intent)) {
            enableFullScreenWindow();
        }
    }

    private void enableFullScreenWindow() {
        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
    }

    private boolean isFullScreenLaunch(Intent intent) {
        return intent != null && intent.getBooleanExtra(
            FullScreenReminderReceiver.EXTRA_FULL_SCREEN, false);
    }
}
