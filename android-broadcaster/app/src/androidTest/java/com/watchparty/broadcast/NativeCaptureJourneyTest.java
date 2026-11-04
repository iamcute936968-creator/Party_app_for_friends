package com.watchparty.broadcast;

import android.app.Instrumentation;
import android.content.Intent;
import android.os.Bundle;
import android.widget.EditText;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.*;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Run only with a disposable room invite and a browser receiver controlled by the QA driver. */
@RunWith(AndroidJUnit4.class)
public class NativeCaptureJourneyTest {
    private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
    private final UiDevice device = UiDevice.getInstance(instrumentation);
    private void stage(String value) { Bundle result=new Bundle();result.putString("watch_party_stage",value);instrumentation.sendStatus(2,result); }
    private void pressProjection(boolean allow) {
        if(android.os.Build.VERSION.SDK_INT>=33&&instrumentation.getTargetContext().checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED){
            UiObject2 notice=device.wait(Until.findObject(By.text(java.util.regex.Pattern.compile("(?is).*notifications.*"))),3000);
            if(notice!=null){UiObject2 notifications=device.wait(Until.findObject(By.res(java.util.regex.Pattern.compile(".*:id/permission_allow_button"))),3000);assertNotNull(notifications);notifications.click();}
        }
        if (allow) {
            UiObject2 single=device.wait(Until.findObject(By.text("A single app")),1500);
            if (single!=null) { single.click();UiObject2 entire=device.wait(Until.findObject(By.text("Entire screen")),3000);assertNotNull(entire);entire.click(); }
        }
        UiObject2 button=device.wait(Until.findObject(By.text(java.util.regex.Pattern.compile(allow?"(?i)(start now|start recording)":"(?i)cancel"))),10000);
        assertNotNull("Android capture consent button was not available",button);button.click();
    }
    @Test public void explicitConsentStreamsTheOwnedPatternAndStopEndsCapture() throws Exception {
        String invite=InstrumentationRegistry.getArguments().getString("invite");Assume.assumeNotNull(invite);
        Invite.parse(invite,"QAPhone");
        MainActivity activity=(MainActivity)instrumentation.startActivitySync(new Intent(instrumentation.getTargetContext(),MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
        assertTrue((activity.getWindow().getAttributes().flags&android.view.WindowManager.LayoutParams.FLAG_SECURE)!=0);
        instrumentation.runOnMainSync(()->{
            ((EditText)activity.findViewById(R.id.invite_field)).setText(invite);
            ((EditText)activity.findViewById(R.id.name_field)).setText("QAPhone");
            activity.findViewById(R.id.start_button).performClick();
        });
        pressProjection(false);
        UiObject2 restart=device.wait(Until.findObject(By.res("com.watchparty.broadcast","start_button").enabled(true)),5000);
        assertNotNull(restart);assertFalse(BroadcastService.isRunning());stage("capture_cancelled_without_starting");restart.click();
        pressProjection(true);
        long started=System.currentTimeMillis()+10000;while(System.currentTimeMillis()<started&&!BroadcastService.isRunning())Thread.sleep(100);
        assertTrue("Approved capture did not start the service: "+BroadcastService.currentStatus(),BroadcastService.isRunning());
        instrumentation.startActivitySync(new Intent().setClassName(instrumentation.getTargetContext(),"com.watchparty.broadcast.CapturePatternActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        long deadline=System.currentTimeMillis()+30000;
        while(System.currentTimeMillis()<deadline&&!BroadcastService.currentStatus().contains("1 viewer"))Thread.sleep(250);
        assertTrue("Native broadcaster did not connect: "+BroadcastService.currentStatus(),BroadcastService.currentStatus().contains("1 viewer"));stage("native_screen_connected");
        for(int i=0;i<60;i++){Thread.sleep(1000);assertTrue("Broadcast stopped during the owned-screen soak",BroadcastService.isRunning());}
        stage("native_capture_stable_60_seconds");
        Thread watchdog=new Thread(()->{
            try{Thread.sleep(15000);}catch(InterruptedException done){return;}
            for(var entry:Thread.getAllStackTraces().entrySet())if(entry.getKey().getName().equals("main")||entry.getKey().getName().contains("Instr"))
                stage("STOP_DIAGNOSTIC "+entry.getKey().getName()+" "+java.util.Arrays.toString(entry.getValue()));
        });watchdog.setDaemon(true);watchdog.start();
        stage("opening_stop_controls");
        var notifications=instrumentation.getTargetContext().getSystemService(android.app.NotificationManager.class).getActiveNotifications();
        var notification=java.util.Arrays.stream(notifications).filter(value->value.getId()==41).findFirst().orElseThrow();
        android.app.ActivityOptions options=android.app.ActivityOptions.makeBasic();
        // The test sends the own notification intent directly; emulate the user-initiated System UI launch grant.
        if(android.os.Build.VERSION.SDK_INT>=34)options.setPendingIntentBackgroundActivityStartMode(android.app.ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
        notification.getNotification().contentIntent.send(instrumentation.getTargetContext(),0,null,null,null,null,options.toBundle());
        UiObject2 stop=device.wait(Until.findObject(By.res("com.watchparty.broadcast","stop_button")),10000);
        assertNotNull("The notification did not open the sharing controls",stop);stage("stop_controls_opened");stop.click();stage("stop_requested");
        deadline=System.currentTimeMillis()+10000;
        while(System.currentTimeMillis()<deadline&&BroadcastService.isRunning())Thread.sleep(100);
        assertFalse(BroadcastService.isRunning());
        // Instrumentation termination kills the app process. Keep it alive until asynchronous
        // Firebase cleanup is acknowledged, as it is during an ordinary user-initiated Stop.
        var share=NativeBackend.database(instrumentation.getTargetContext()).getReference("rooms/"+Invite.parse(invite,"QAPhone").roomId()+"/screenShare");
        deadline=System.currentTimeMillis()+15000;
        while(com.google.android.gms.tasks.Tasks.await(share.get(),10,java.util.concurrent.TimeUnit.SECONDS).exists()&&System.currentTimeMillis()<deadline)Thread.sleep(250);
        assertFalse("Stop must release the room before the test process exits",com.google.android.gms.tasks.Tasks.await(share.get(),10,java.util.concurrent.TimeUnit.SECONDS).exists());
        assertEquals("Screen sharing stopped",BroadcastService.currentStatus());
        watchdog.interrupt();stage("explicit_stop_ends_capture");
    }
}
