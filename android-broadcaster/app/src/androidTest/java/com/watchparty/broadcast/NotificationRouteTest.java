package com.watchparty.broadcast;

import android.content.Intent;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Instrumented unit test: verifies only the control notification's public Intent contract. */
@RunWith(AndroidJUnit4.class)
public class NotificationRouteTest {
    @Test public void controlNotificationReturnsToControlsInsteadOfLeavingTheCaptureScreenOnTop() {
        Intent intent=MainActivity.controlsIntent(InstrumentationRegistry.getInstrumentation().getTargetContext());
        assertEquals(MainActivity.class.getName(),intent.getComponent().getClassName());
        assertTrue((intent.getFlags()&Intent.FLAG_ACTIVITY_CLEAR_TOP)!=0);
        assertTrue((intent.getFlags()&Intent.FLAG_ACTIVITY_SINGLE_TOP)!=0);
        assertEquals(0,intent.getFlags()&Intent.FLAG_ACTIVITY_MULTIPLE_TASK);
    }
}
