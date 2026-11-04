package com.watchparty.broadcast;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.database.FirebaseDatabase;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ExecutionException;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class RoomClientIntegrationTest {
    private final Map<FirebaseApp,FirebaseDatabase> databases = new java.util.IdentityHashMap<>();
    @org.junit.Before public void showOwnedTestScreen() {
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        context.startActivity(new android.content.Intent().setClassName(context,"com.watchparty.broadcast.CapturePatternActivity")
                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK|android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP));
    }
    private FirebaseApp app() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        FirebaseApp app = FirebaseApp.initializeApp(context, new FirebaseOptions.Builder()
                .setProjectId("demo-watch-party").setApiKey("demo-local-key").setApplicationId("1:123:android:123")
                .setDatabaseUrl("https://demo-watch-party-default-rtdb.firebaseio.com").build(), UUID.randomUUID().toString());
        FirebaseAuth.getInstance(app).useEmulator("127.0.0.1", 9099);
        FirebaseDatabase database=FirebaseDatabase.getInstance(app);
        database.useEmulator("127.0.0.1", 9000);
        databases.put(app,database);
        return app;
    }
    private void seed(String room) throws Exception {
        seed(room,"Host");
    }
    private void seed(String room,String host) throws Exception {
        var connection = (HttpURLConnection) new URL("http://127.0.0.1:9000/rooms/"+room+".json?ns=demo-watch-party-default-rtdb").openConnection();
        connection.setRequestMethod("PUT"); connection.setRequestProperty("Authorization", "Bearer owner"); connection.setDoOutput(true);
        var value = new JSONObject(Map.ofEntries(Map.entry("id",room), Map.entry("secret","fixture-private-secret"), Map.entry("roomSecret","fixture-private-secret"),
                Map.entry("host",host), Map.entry("hostUid","host-uid"), Map.entry("roomName","Native integration"), Map.entry("createdAt",1),
                Map.entry("identities",Map.of(host,"host-uid")), Map.entry("seats",Map.of("0",Map.of("uid","host-uid","name",host))),
                Map.entry("participants",Map.of(host,Map.of("connections",Map.of("host",true)))),
                Map.entry("playbackState","PAUSED"),Map.entry("anchorTime",0),Map.entry("updatedAt",0),Map.entry("currentTime",0),Map.entry("isPlaying",false),Map.entry("videoSource","youtube")));
        connection.getOutputStream().write(value.toString().getBytes(StandardCharsets.UTF_8)); assertEquals(200,connection.getResponseCode());connection.disconnect();
    }
    private static <T> T await(com.google.android.gms.tasks.Task<T> task) throws Exception { return Tasks.await(task, 20, TimeUnit.SECONDS); }
    @Test public void joinsThroughRealRulesClaimsAndReleasesOnlyItsOwnBroadcast() throws Exception {
        String room = "NATIVE"+UUID.randomUUID().toString().replace("-","").substring(0,8); seed(room);
        FirebaseApp app=app(); RoomClient client = new RoomClient(app, databases.get(app), Invite.parse("https://partyapp-fun.netlify.app/?room="+room+"&s=fixture-private-secret", "Phone"));
        try {
            await(FirebaseAuth.getInstance(app).signInAnonymously());
            await(client.join());
            await(client.publishShare("native-share"));
            var share = await(client.room().child("screenShare").get()).getValue();
            assertTrue(ScreenProtocol.activeShare(share)); assertTrue(ScreenProtocol.owns(share,client.uid(),"native-share"));
            await(client.stopShare("wrong-session"));
            assertTrue(ScreenProtocol.activeShare(await(client.room().child("screenShare").get()).getValue()));
            await(client.stopShare("native-share"));
            assertFalse(await(client.room().child("screenShare").get()).exists());
        } finally { client.close(); }
    }
    @Test public void closeReleasesShareWithoutAnActiveRoomListener() throws Exception {
        String room="NATIVE"+UUID.randomUUID().toString().replace("-","").substring(0,8);seed(room);
        FirebaseApp app=app();RoomClient client=new RoomClient(app,databases.get(app),Invite.parse("https://partyapp-fun.netlify.app/?room="+room+"&s=fixture-private-secret","Phone"));
        await(client.join());await(client.publishShare("close-share"));client.close();
        long deadline=System.currentTimeMillis()+5000;
        while(await(client.room().child("screenShare").get()).exists()&&System.currentTimeMillis()<deadline)Thread.sleep(100);
        assertFalse("Close must remove an owned share with a cold transaction cache",await(client.room().child("screenShare").get()).exists());
    }
    @Test public void refusesWrongInvitesAndCompetingActiveBroadcasts() throws Exception {
        String room = "NATIVE"+UUID.randomUUID().toString().replace("-","").substring(0,8); seed(room);
        FirebaseApp b=app();
        RoomClient second=new RoomClient(b,databases.get(b),Invite.parse("https://partyapp-fun.netlify.app/?room="+room+"&s=wrong","Second"));
        try {
            await(FirebaseAuth.getInstance(b).signInAnonymously());
            RoomClient invalid=second;ExecutionException denied=assertThrows(ExecutionException.class,()->await(invalid.join()));
            assertTrue(denied.getCause() instanceof com.google.firebase.database.DatabaseException);
            FirebaseDatabase configured=second.database;
            second.close(); second=new RoomClient(b,databases.get(b),Invite.parse("https://partyapp-fun.netlify.app/?room="+room+"&s=fixture-private-secret","Second"));
            assertSame("A retry must retain the configured emulator database",configured,second.database);
            await(second.join());
            // The other broadcaster is a real database fixture, not a second SDK app in this process.
            var connection=(HttpURLConnection)new URL("http://127.0.0.1:9000/rooms/"+room+"/screenShare.json?ns=demo-watch-party-default-rtdb").openConnection();
            connection.setRequestMethod("PUT");connection.setRequestProperty("Authorization","Bearer owner");connection.setDoOutput(true);
            connection.getOutputStream().write(new JSONObject(Map.of("version",2,"id","first","owner","Host","ownerUid","host-uid","connections",Map.of("first",true))).toString().getBytes(StandardCharsets.UTF_8));
            assertEquals(200,connection.getResponseCode());connection.disconnect();
            RoomClient rival=second;ExecutionException rejected=assertThrows(ExecutionException.class,()->await(rival.publishShare("rival")));
            assertTrue(rejected.getCause() instanceof com.google.firebase.database.DatabaseException);
            await(second.stopShare("first"));
            assertTrue(ScreenProtocol.owns(await(second.room().child("screenShare").get()).getValue(),"host-uid","first"));
        } finally { second.close(); }
    }
    @Test public void numericParticipantNamesKeepTheirFirebaseArrayKeys() throws Exception {
        String room="NATIVE"+UUID.randomUUID().toString().replace("-","").substring(0,8);seed(room,"0");
        FirebaseApp app=app();RoomClient client=new RoomClient(app,databases.get(app),Invite.parse("https://partyapp-fun.netlify.app/?room="+room+"&s=fixture-private-secret","1"));
        try {
            await(client.join());await(client.publishShare("numeric"));
            var value=ScreenProtocol.map(await(client.room().get()).getValue());
            assertTrue(value.get("identities") instanceof java.util.List);
            assertEquals(client.uid(),ScreenProtocol.map(value.get("identities")).get("1"));
            assertTrue(ScreenProtocol.online(ScreenProtocol.map(value.get("participants")).get("1")));
            await(client.stopShare("numeric"));
        }finally{client.close();}
    }
}
