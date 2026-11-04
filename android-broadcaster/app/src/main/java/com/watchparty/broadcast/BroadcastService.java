package com.watchparty.broadcast;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.media.projection.MediaProjection;
import android.os.*;
import android.util.DisplayMetrics;
import com.google.firebase.database.*;
import org.webrtc.*;
import java.util.*;
import static com.watchparty.broadcast.ScreenProtocol.*;

public final class BroadcastService extends Service {
    static final String STOP = "com.watchparty.broadcast.STOP";
    static final String STATE = "com.watchparty.broadcast.STATE";
    private static volatile String status = "Ready to share";
    private static volatile boolean running;
    private static boolean initialized;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, Peer> peers = new HashMap<>();
    private final Map<String, Admission> admissions = new HashMap<>();
    private final LinkedHashSet<String> seenIce = new LinkedHashSet<>();
    private final Map<String, String> requests = new HashMap<>();
    private final Map<String, Long> requestTimes = new HashMap<>();
    private final Map<String, Integer> attempts = new HashMap<>();
    private RoomClient client;
    private String shareId;
    private boolean active, published;
    private int epoch;
    private Map<String,Object> room = Map.of();
    private EglBase egl;
    private PeerConnectionFactory factory;
    private SurfaceTextureHelper texture;
    private ScreenCapturerAndroid capturer;
    private VideoSource source;
    private VideoTrack track;
    private static final class Admission { String uid; boolean allowed; Runnable unsubscribe; }
    private static final class Peer {
        String name, uid, id; PeerConnection pc; boolean applying;
        int iceSequence, failures; final ArrayList<IceCandidate> early = new ArrayList<>();
        Runnable timeout, grace;
    }
    static String currentStatus() { return status; }
    static boolean isRunning() { return running; }
    @Override public IBinder onBind(Intent intent) { return null; }
    private void update(String message) {
        status = message;
        sendBroadcast(new Intent(STATE).setPackage(getPackageName()));
        if (active) getSystemService(NotificationManager.class).notify(41, notification(message));
    }
    private Notification notification(String message) {
        var manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("broadcast", "Screen sharing", NotificationManager.IMPORTANCE_LOW));
        var stop = PendingIntent.getService(this, 1, new Intent(this,BroadcastService.class).setAction(STOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        var open = PendingIntent.getActivity(this,2,MainActivity.controlsIntent(this),PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this,"broadcast").setSmallIcon(android.R.drawable.ic_menu_camera)
                .setContentTitle("Watch Party screen sharing").setContentText(message).setContentIntent(open)
                .setOngoing(true).addAction(new Notification.Action.Builder(null,"Stop sharing",stop).build()).build();
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || STOP.equals(intent.getAction())) { finish("Screen sharing stopped"); return START_NOT_STICKY; }
        if (active) return START_NOT_STICKY;
        Intent consent = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra("capture",Intent.class) : intent.getParcelableExtra("capture");
        Invite invite;
        try { invite = Invite.parse(intent.getStringExtra("invite"),intent.getStringExtra("name")); }
        catch (IllegalArgumentException error) { finish(error.getMessage()); return START_NOT_STICKY; }
        if (consent == null) { finish("Choose a screen before starting"); return START_NOT_STICKY; }
        active = running = true; final int run = ++epoch;
        startForeground(41,notification("Connecting to your private room"),ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        update("Connecting to your private room…");
        client = new RoomClient(NativeBackend.app(this), NativeBackend.database(this), invite);
        client.join().addOnSuccessListener(ignored -> {
            if (!active || epoch != run) return;
            watch(client.room(), snapshot -> {
                room = map(snapshot.getValue());
                if (!Objects.equals(map(room.get("identities")).get(invite.name()),client.uid())) { finish("Your room identity is no longer available"); return; }
                if (published && !owns(room.get("screenShare"),client.uid(),shareId)) { finish("The room's screen share ended"); return; }
                sync();
            });
            watch(client.grant(), snapshot -> {
                Map<String,Object> grant = map(snapshot.getValue());
                if (!invite.name().equals(grant.get("name")) || !invite.secret().equals(grant.get("secret"))) finish("Room access ended. Join with a valid invitation again.");
            });
            watch(client.database.getReference(".info/connected"), snapshot -> { if (published && !Boolean.TRUE.equals(snapshot.getValue())) finish("Connection lost. Start sharing again when online."); });
            client.room().get().addOnSuccessListener(snapshot -> {
                if (!active || epoch != run) return; room = map(snapshot.getValue());
                Map<String,Object> share = map(room.get("screenShare"));
                if (activeShare(share) || (!share.isEmpty() && !share.containsKey("version") && online(map(room.get("participants")).get(share.get("owner"))))) {
                    finish("Someone is already sharing. Ask them to stop first."); return;
                }
                startCapture(consent);
            }).addOnFailureListener(error -> { if (active && epoch == run) finish("Could not read this room. Check your invitation."); });
        }).addOnFailureListener(error -> { if (active && epoch == run) finish(error instanceof RoomClient.UserError ? error.getMessage() : "Could not join. Check the full invite, connection and phone name."); });
        return START_NOT_STICKY;
    }
    private void watch(DatabaseReference reference, java.util.function.Consumer<DataSnapshot> next) {
        int run = epoch;
        client.watch(reference,new ValueEventListener() {
            @Override public void onDataChange(DataSnapshot snapshot) { if (active && epoch == run) next.accept(snapshot); }
            @Override public void onCancelled(DatabaseError error) { if (active && epoch == run) finish("Room access or signaling is unavailable. Join again."); }
        });
    }
    private void startCapture(Intent consent) {
        final int run = epoch;
        try {
            if (!initialized) { PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(this).createInitializationOptions()); initialized = true; }
            egl = EglBase.create();
            factory = PeerConnectionFactory.builder().setVideoEncoderFactory(new DefaultVideoEncoderFactory(egl.getEglBaseContext(),true,true))
                    .setVideoDecoderFactory(new DefaultVideoDecoderFactory(egl.getEglBaseContext())).createPeerConnectionFactory();
            source = factory.createVideoSource(true);
            texture = SurfaceTextureHelper.create("WatchPartyScreen",egl.getEglBaseContext());
            capturer = new ScreenCapturerAndroid(consent,new MediaProjection.Callback() { @Override public void onStop() { main.post(() -> { if (active && epoch == run) finish("Android stopped screen capture"); }); } });
            capturer.initialize(texture,getApplicationContext(),source.getCapturerObserver());
            DisplayMetrics metrics = getResources().getDisplayMetrics();
            double scale = Math.min(1,1280.0 / Math.max(metrics.widthPixels,metrics.heightPixels));
            capturer.startCapture(((int)(metrics.widthPixels*scale)/2)*2,((int)(metrics.heightPixels*scale)/2)*2,24);
            track = factory.createVideoTrack("watch-party-screen",source);
            shareId = UUID.randomUUID().toString();
            client.publishShare(shareId).addOnSuccessListener(ignored -> {
                if (!active || epoch != run) return; published = true;
                watch(client.room().child("webrtc/answers/"+client.invite.name()),this::answers);
                watch(client.room().child("webrtc/requests/"+client.invite.name()),this::requests);
                watch(client.room().child("webrtc/ice/"+client.invite.name()),this::ice);
                sync(); showConnections();
            }).addOnFailureListener(error -> { if (active && epoch == run) finish("Could not claim the screen share. Someone may already be sharing."); });
        } catch (RuntimeException error) { finish("Android could not start capture. Request screen permission again."); }
    }
    private boolean eligible(String name) {
        Admission admission = admissions.get(name);
        return active && published && admission != null && admission.allowed &&
                Objects.equals(admission.uid,map(room.get("identities")).get(name)) && online(map(room.get("participants")).get(name));
    }
    private void sync() {
        if (!active || !published) return;
        Map<String,Object> identities = map(room.get("identities")), participants = map(room.get("participants"));
        for (String name : new ArrayList<>(admissions.keySet())) {
            Admission admission = admissions.get(name);
            if (!Objects.equals(admission.uid,identities.get(name)) || !online(participants.get(name))) {
                admission.unsubscribe.run(); admissions.remove(name); closePeer(name);
            }
        }
        for (String name : identities.keySet()) {
            if (name.equals(client.invite.name()) || !online(participants.get(name)) || admissions.containsKey(name) || admissions.size() >= 5 || !(identities.get(name) instanceof String)) continue;
            Admission admission = new Admission(); admission.uid = (String)identities.get(name); admissions.put(name,admission);
            admission.unsubscribe = client.watch(client.database.getReference("roomAccess/"+client.invite.roomId()+"/"+admission.uid+"/name"),new ValueEventListener() {
                private void changed(boolean allowed) {
                    if (!active || admissions.get(name) != admission) return;
                    admission.allowed = allowed;
                    if (allowed) connect(name); else closePeer(name);
                    showConnections();
                }
                @Override public void onDataChange(DataSnapshot snapshot) { changed(name.equals(snapshot.getValue())); }
                @Override public void onCancelled(DatabaseError error) { changed(false); }
            });
        }
    }
    private boolean current(Peer peer) { return eligible(peer.name) && peers.get(peer.name) == peer && Objects.equals(peer.uid,map(room.get("identities")).get(peer.name)); }
    private void connect(String name) {
        if (!eligible(name) || peers.containsKey(name) || peers.size() >= 5) return;
        Peer peer = new Peer(); peer.name = name; peer.uid = admissions.get(name).uid; peer.id = UUID.randomUUID().toString(); peer.failures = attempts.getOrDefault(name,0); peers.put(name,peer);
        var config = new PeerConnection.RTCConfiguration(List.of(PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),PeerConnection.IceServer.builder("stun:stun.cloudflare.com:3478").createIceServer()));
        config.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN;
        peer.pc = factory.createPeerConnection(config,new PeerConnection.Observer() {
            @Override public void onIceCandidate(IceCandidate candidate) { main.post(() -> {
                if (!current(peer)) return;
                Map<String,Object> ice = new HashMap<>(); ice.put("candidate",candidate.sdp); ice.put("sdpMid",candidate.sdpMid); ice.put("sdpMLineIndex",candidate.sdpMLineIndex);
                Map<String,Object> value = envelope(peer); value.put("ice",ice);
                client.room().child("webrtc/ice/"+name+"/"+client.invite.name()+"/"+(peer.iceSequence++ % 32)).setValue(value).addOnFailureListener(error -> { if (current(peer)) retry(peer); });
            }); }
            @Override public void onConnectionChange(PeerConnection.PeerConnectionState state) { main.post(() -> {
                if (!current(peer)) return;
                if (state == PeerConnection.PeerConnectionState.CONNECTED) { clearTimers(peer); attempts.remove(name); peer.failures = 0; showConnections(); }
                else if (state == PeerConnection.PeerConnectionState.FAILED) retry(peer);
                else if (state == PeerConnection.PeerConnectionState.DISCONNECTED && peer.grace == null) {
                    peer.grace = () -> { if (current(peer) && peer.pc.connectionState() == PeerConnection.PeerConnectionState.DISCONNECTED) retry(peer); };
                    main.postDelayed(peer.grace,8000);
                }
            }); }
            @Override public void onSignalingChange(PeerConnection.SignalingState state) {}
            @Override public void onIceConnectionChange(PeerConnection.IceConnectionState state) {}
            @Override public void onIceConnectionReceivingChange(boolean receiving) {}
            @Override public void onIceGatheringChange(PeerConnection.IceGatheringState state) {}
            @Override public void onIceCandidatesRemoved(IceCandidate[] candidates) {}
            @Override public void onAddStream(MediaStream stream) {}
            @Override public void onRemoveStream(MediaStream stream) {}
            @Override public void onDataChannel(DataChannel channel) { channel.close(); }
            @Override public void onRenegotiationNeeded() {}
            @Override public void onAddTrack(RtpReceiver receiver,MediaStream[] streams) {}
        });
        if (peer.pc == null) { closePeer(name); return; }
        peer.pc.addTransceiver(track,new RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.SEND_ONLY,List.of("screen")));
        peer.timeout = () -> { if (current(peer)) retry(peer); }; main.postDelayed(peer.timeout,20000);
        peer.pc.createOffer(new SdpObserver() {
            @Override public void onCreateSuccess(SessionDescription description) { main.post(() -> {
                if (!current(peer)) return;
                peer.pc.setLocalDescription(new SdpObserver() {
                    @Override public void onSetSuccess() { main.post(() -> {
                        if (!current(peer)) return;
                        Map<String,Object> value = envelope(peer); value.put("sdp",Map.of("type","offer","sdp",description.description));
                        client.room().child("webrtc/offers/"+name).setValue(value).addOnFailureListener(error -> { if (current(peer)) retry(peer); });
                    }); }
                    @Override public void onSetFailure(String error) { main.post(() -> { if (current(peer)) retry(peer); }); }
                },description);
            }); }
            @Override public void onCreateFailure(String error) { main.post(() -> { if (current(peer)) retry(peer); }); }
        },new MediaConstraints());
    }
    private Map<String,Object> envelope(Peer peer) {
        return new HashMap<>(Map.of("from",client.invite.name(),"sessionId",shareId,"connectionId",peer.id));
    }
    private void answers(DataSnapshot snapshot) {
        for (DataSnapshot child : snapshot.getChildren()) {
            Peer peer = peers.get(child.getKey()); Map<String,Object> answer = map(child.getValue()); Map<String,Object> sdp = map(answer.get("sdp"));
            if (peer == null || !current(peer) || !matches(answer,peer.name,shareId,peer.id,peer.pc != null) || peer.pc.getRemoteDescription() != null || peer.applying ||
                    !"answer".equals(sdp.get("type")) || !(sdp.get("sdp") instanceof String) || ((String)sdp.get("sdp")).length() > 131072) continue;
            peer.applying = true;
            peer.pc.setRemoteDescription(new SdpObserver() {
                @Override public void onSetSuccess() { main.post(() -> {
                    if (!current(peer)) return; peer.applying = false;
                    for (IceCandidate candidate : peer.early) peer.pc.addIceCandidate(candidate); peer.early.clear();
                    RoomClient.transact(child.getRef(),data -> { if (!matches(data.getValue(),peer.name,shareId,peer.id)) return false; data.setValue(null); return true; });
                }); }
                @Override public void onSetFailure(String error) { main.post(() -> { if (current(peer)) retry(peer); }); }
            },new SessionDescription(SessionDescription.Type.ANSWER,(String)sdp.get("sdp")));
        }
    }
    private void requests(DataSnapshot snapshot) {
        for (DataSnapshot child : snapshot.getChildren()) {
            String name = child.getKey(); Map<String,Object> request = map(child.getValue());
            if (!eligible(name) || !name.equals(request.get("from")) || !shareId.equals(request.get("sessionId")) || !(request.get("nonce") instanceof String) || request.get("nonce").equals(requests.get(name))) continue;
            requests.put(name,(String)request.get("nonce"));
            long now = SystemClock.elapsedRealtime(); if (now - requestTimes.getOrDefault(name,-1000L) < 1000) continue; requestTimes.put(name,now);
            Peer peer = peers.get(name);
            if (peer != null && peer.pc == null) continue;
            if (peer != null && peer.pc != null && peer.pc.connectionState() != PeerConnection.PeerConnectionState.CONNECTED && peer.pc.connectionState() != PeerConnection.PeerConnectionState.FAILED) continue;
            closePeer(name); connect(name);
            RoomClient.transact(child.getRef(),data -> { if (!Objects.equals(map(data.getValue()).get("nonce"),request.get("nonce"))) return false; data.setValue(null); return true; });
        }
    }
    private void ice(DataSnapshot snapshot) {
        for (DataSnapshot sender : snapshot.getChildren()) for (DataSnapshot child : sender.getChildren()) {
            Peer peer = peers.get(sender.getKey()); Map<String,Object> value = map(child.getValue());
            if (peer == null || !current(peer) || !matches(value,peer.name,shareId,peer.id,peer.pc != null)) continue;
            Map<String,Object> data = map(value.get("ice"));
            if (!(data.get("candidate") instanceof String) || ((String)data.get("candidate")).length() > 4096 || !(data.get("sdpMLineIndex") instanceof Number)) continue;
            String key = peer.id+"/"+child.getKey()+"/"+data.get("candidate"); if (!seenIce.add(key)) continue;
            while (seenIce.size() > 256) seenIce.remove(seenIce.iterator().next());
            IceCandidate candidate = new IceCandidate((String)data.get("sdpMid"),((Number)data.get("sdpMLineIndex")).intValue(),(String)data.get("candidate"));
            if (peer.pc.getRemoteDescription() != null) peer.pc.addIceCandidate(candidate); else if (peer.early.size() < 32) peer.early.add(candidate);
            RoomClient.transact(child.getRef(),current -> { if (!map(current.getValue()).equals(value)) return false; current.setValue(null); return true; });
        }
    }
    private void retry(Peer peer) {
        if (!current(peer)) return;
        int attempt = Math.min(5,peer.failures + 1); attempts.put(peer.name,attempt); closePeer(peer.name);
        Peer waiting = new Peer(); waiting.name = peer.name; waiting.uid = peer.uid; waiting.id = peer.id; waiting.failures = attempt; peers.put(waiting.name,waiting);
        waiting.timeout = () -> { if (!current(waiting)) return; peers.remove(waiting.name); connect(waiting.name); };
        main.postDelayed(waiting.timeout,Math.min(15000,1000L << Math.min(attempt-1,4))); showConnections();
    }
    private void clearTimers(Peer peer) { if (peer.timeout != null) main.removeCallbacks(peer.timeout); if (peer.grace != null) main.removeCallbacks(peer.grace); peer.timeout = peer.grace = null; }
    private void closePeer(String name) {
        Peer peer = peers.remove(name); if (peer == null) return; clearTimers(peer);
        if (peer.pc != null) { peer.pc.close(); peer.pc.dispose(); }
    }
    private void showConnections() {
        if (!active || !published) return;
        long count = peers.values().stream().filter(peer -> peer.pc != null && peer.pc.connectionState() == PeerConnection.PeerConnectionState.CONNECTED).count();
        update("Sharing screen · "+count+(count == 1 ? " viewer" : " viewers"));
    }
    private void finish(String message) {
        active = published = running = false; ++epoch;
        main.removeCallbacksAndMessages(null);
        for (String name : new ArrayList<>(peers.keySet())) closePeer(name);
        admissions.clear(); requests.clear(); requestTimes.clear(); attempts.clear(); seenIce.clear();
        if (capturer != null) { capturer.stopCapture(); capturer.dispose(); capturer = null; }
        if (track != null) { track.dispose(); track = null; }
        if (source != null) { source.dispose(); source = null; }
        if (texture != null) { texture.dispose(); texture = null; }
        if (factory != null) { factory.dispose(); factory = null; }
        if (egl != null) { egl.release(); egl = null; }
        if (client != null) { client.close(); client = null; }
        update(message); stopForeground(STOP_FOREGROUND_REMOVE); stopSelf();
    }
    @Override public void onTaskRemoved(Intent intent) { finish("Screen sharing stopped"); }
    @Override public void onDestroy() { if (active) finish("Screen sharing stopped"); super.onDestroy(); }
    private abstract static class SdpObserver implements org.webrtc.SdpObserver {
        @Override public void onCreateSuccess(SessionDescription description) {}
        @Override public void onSetSuccess() {}
        @Override public void onCreateFailure(String error) {}
        @Override public void onSetFailure(String error) {}
    }
}
