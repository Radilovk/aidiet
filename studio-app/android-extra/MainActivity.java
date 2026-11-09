package com.biocode.studios;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * The app over the lock screen ONLY when a reminder opened it full screen (the "xbFullScreen" mark on its intent):
 * then the page shows "Твоята тренировка". Any other start — and every return after the screen went off — needs
 * the phone to be unlocked as usual, so nothing else of the app is ever seen without unlocking.
 */
public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(FullScreenPlugin.class);
        super.onCreate(savedInstanceState);
        overLock(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        overLock(intent);
    }

    @Override
    public void onStop() {
        super.onStop();
        overLock(null);
    }

    private void overLock(Intent intent) {
        boolean on = intent != null && intent.getBooleanExtra("xbFullScreen", false);
        if (intent != null) intent.removeExtra("xbFullScreen");
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(on);
            setTurnScreenOn(on);
        }
    }
}
