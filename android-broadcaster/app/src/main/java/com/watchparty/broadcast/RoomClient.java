package com.watchparty.broadcast;

import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.TaskCompletionSource;
import com.google.android.gms.tasks.Tasks;
import com.google.firebase.FirebaseApp;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.database.*;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CancellationException;
import java.util.function.Function;

/** Native adapter for the existing browser room and screen-share contracts. */
final class RoomClient {
    final FirebaseDatabase database;
    final Invite invite;
    private final FirebaseAuth auth;
    private final String presenceId = UUID.randomUUID().toString();
    private final ArrayList<Runnable> subscriptions = new ArrayList<>();
    private volatile boolean closed;
    private String shareId;
    RoomClient(FirebaseApp app, FirebaseDatabase database, Invite invite) {
        this.database = database; this.auth = FirebaseAuth.getInstance(app); this.invite = invite;
    }
    String uid() { return auth.getCurrentUser() == null ? null : auth.getCurrentUser().getUid(); }
    DatabaseReference room() { return database.getReference("rooms/"+invite.roomId()); }
    DatabaseReference grant() { return database.getReference("roomAccess/"+invite.roomId()+"/"+uid()); }
    private DatabaseReference presence() { return room().child("participants/"+invite.name()+"/connections/"+presenceId); }
    private void checkActive() { if (closed) throw new CancellationException("Broadcast cancelled"); }
    static final class UserError extends RuntimeException { UserError(String message) { super(message); } }
    Task<Void> join() {
        Task<?> signedIn = auth.getCurrentUser() != null ? Tasks.forResult(auth.getCurrentUser()) : auth.signInAnonymously();
        return signedIn.continueWithTask(task -> {
            if (!task.isSuccessful()) throw task.getException(); checkActive(); return grant().get();
        }).continueWithTask(task -> {
            if (!task.isSuccessful()) throw task.getException(); checkActive();
            String previous = task.getResult().child("name").getValue(String.class);
            if (previous != null && !previous.equals(invite.name())) {
                return room().child("identities/"+previous).get().continueWithTask(identity -> {
                    if (!identity.isSuccessful()) throw identity.getException(); checkActive();
                    if (uid().equals(identity.getResult().getValue())) throw new UserError("Use your previous name in this room.");
                    return grant().setValue(Map.of("name",invite.name(),"secret",invite.secret()));
                });
            }
            return grant().setValue(Map.of("name",invite.name(),"secret",invite.secret()));
        }).continueWithTask(task -> {
            if (!task.isSuccessful()) throw task.getException(); checkActive(); return room().child("identities/"+invite.name()).get();
        }).continueWithTask(task -> {
            if (!task.isSuccessful()) throw task.getException(); checkActive();
            Object owner = task.getResult().getValue();
            if (owner != null && !owner.equals(uid())) throw new UserError("That name is already in use. Choose another name for this phone.");
            return room().child("seats").get();
        }).continueWithTask(task -> {
            if (!task.isSuccessful()) throw task.getException(); checkActive();
            for (DataSnapshot seat : task.getResult().getChildren()) if (uid().equals(seat.child("uid").getValue())) return claimSeat(Integer.parseInt(seat.getKey()));
            return claimSeat(0);
        }).continueWithTask(task -> {
            if (!task.isSuccessful()) throw task.getException(); checkActive();
            if (!task.getResult()) throw new UserError("This room has reached its six-person limit.");
            return transact(room().child("identities/"+invite.name()), data -> {
                if (data.getValue() != null && !uid().equals(data.getValue())) return false;
                data.setValue(uid()); return true;
            });
        }).continueWithTask(task -> {
            if (!task.isSuccessful()) throw task.getException(); checkActive();
            if (!task.getResult()) throw new UserError("That name is already in use. Choose another name for this phone.");
            return presence().onDisconnect().removeValue();
        }).continueWithTask(task -> {
            if (!task.isSuccessful()) throw task.getException(); checkActive(); return presence().setValue(true);
        }).continueWithTask(task -> {
            if (!task.isSuccessful()) throw task.getException();
            if (closed) { presence().removeValue(); throw new CancellationException(); }
            return Tasks.forResult(null);
        });
    }
    private Task<Boolean> claimSeat(int slot) {
        checkActive(); if (slot > 5) return Tasks.forResult(false);
        return transact(room().child("seats/"+slot), data -> {
            if (data.getValue() != null && !uid().equals(data.child("uid").getValue())) return false;
            data.setValue(Map.of("uid",uid(),"name",invite.name())); return true;
        }).continueWithTask(task -> {
            if (!task.isSuccessful()) throw task.getException(); checkActive();
            return task.getResult() ? Tasks.forResult(true) : claimSeat(slot+1);
        });
    }
    Task<Void> publishShare(String id) {
        checkActive(); shareId = id;
        return room().child("screenShare/connections/"+id).onDisconnect().removeValue().continueWithTask(task -> {
            if (!task.isSuccessful()) throw task.getException(); checkActive();
            HashMap<String,Object> patch = new HashMap<>();
            patch.put("screenShare",Map.of("version",2,"id",id,"owner",invite.name(),"ownerUid",uid(),"connections",Map.of(id,true)));
            patch.put("mediaSelectionId",UUID.randomUUID().toString()); patch.put("videoId",null); patch.put("videoSource","youtube");
            patch.put("playbackState","PAUSED"); patch.put("anchorTime",0); patch.put("updatedAt",ServerValue.TIMESTAMP); patch.put("isPlaying",false); patch.put("currentTime",0);
            return room().updateChildren(patch);
        }).continueWithTask(task -> {
            if (!task.isSuccessful()) throw task.getException();
            if (closed) return stopShare(id).continueWithTask(cleaned -> Tasks.forException(new CancellationException()));
            return Tasks.forResult(null);
        });
    }
    Task<Void> stopShare(String id) {
        return transact(room().child("screenShare"), data -> {
            if (!ScreenProtocol.canClearShare(data.getValue(),uid(),id)) return false;
            data.setValue(null); return true;
        }).continueWithTask(task -> {
            if (!task.isSuccessful()) throw task.getException();
            return room().child("screenShare/connections/"+id).onDisconnect().cancel();
        });
    }
    Runnable watch(DatabaseReference reference, ValueEventListener listener) {
        checkActive(); reference.addValueEventListener(listener);
        Runnable[] cleanup = new Runnable[1];
        cleanup[0] = () -> { reference.removeEventListener(listener); subscriptions.remove(cleanup[0]); };
        subscriptions.add(cleanup[0]); return cleanup[0];
    }
    static Task<Boolean> transact(DatabaseReference reference, Function<MutableData,Boolean> operation) {
        TaskCompletionSource<Boolean> result = new TaskCompletionSource<>();
        reference.runTransaction(new Transaction.Handler() {
            @Override public Transaction.Result doTransaction(MutableData data) { return operation.apply(data) ? Transaction.success(data) : Transaction.abort(); }
            @Override public void onComplete(DatabaseError error, boolean committed, DataSnapshot snapshot) {
                if (error != null) result.setException(error.toException()); else result.setResult(committed);
            }
        }, false);
        return result.getTask();
    }
    void close() {
        if (closed) return; closed = true;
        for (Runnable unsubscribe : new ArrayList<>(subscriptions)) unsubscribe.run(); subscriptions.clear();
        if (uid() != null) {
            presence().removeValue().addOnSuccessListener(ignored -> presence().onDisconnect().cancel());
            if (shareId != null) stopShare(shareId);
        }
    }
}
