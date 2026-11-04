package com.watchparty.broadcast;

import android.content.Context;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.database.FirebaseDatabase;

final class NativeBackend {
    private static FirebaseDatabase database;
    static synchronized FirebaseDatabase database(Context context) {
        if (database == null) database = FirebaseDatabase.getInstance(app(context));
        return database;
    }
    static synchronized FirebaseApp app(Context context) {
        try { return FirebaseApp.getInstance("watch-party-broadcast"); }
        catch (IllegalStateException absent) {
            FirebaseApp app = FirebaseApp.initializeApp(context, new FirebaseOptions.Builder()
                    .setApiKey(BuildConfig.FIREBASE_API_KEY).setApplicationId(BuildConfig.FIREBASE_APP_ID)
                    .setProjectId("watch-party-app-9fc62")
                    .setDatabaseUrl("https://watch-party-app-9fc62-default-rtdb.asia-southeast1.firebasedatabase.app").build(), "watch-party-broadcast");
            app.setDataCollectionDefaultEnabled(false);
            return app;
        }
    }
}
