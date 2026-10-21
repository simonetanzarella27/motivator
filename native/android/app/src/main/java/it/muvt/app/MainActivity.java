package it.muvt.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NotificationChannelVibrationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
