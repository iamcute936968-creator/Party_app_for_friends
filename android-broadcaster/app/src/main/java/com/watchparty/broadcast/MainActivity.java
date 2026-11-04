package com.watchparty.broadcast;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.projection.MediaProjectionManager;
import android.os.*;
import android.text.InputType;
import android.view.*;
import android.widget.*;

public final class MainActivity extends Activity {
    static Intent controlsIntent(Context context) {
        return new Intent(context,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }
    private EditText invite, name;
    private TextView status;
    private Button start, stop;
    private boolean pending;
    private final BroadcastReceiver updates = new BroadcastReceiver() { @Override public void onReceive(Context context,Intent intent) { refresh(); } };
    private int dp(int value) { return (int)(value*getResources().getDisplayMetrics().density); }
    private TextView label(String text,int size,int color) {
        TextView view = new TextView(this); view.setText(text); view.setTextSize(size); view.setTextColor(color);
        view.setPadding(0,dp(8),0,dp(12)); return view;
    }
    private EditText input(String hint,int id,int type) {
        EditText view = new EditText(this); view.setId(id); view.setHint(hint); view.setTextColor(Color.WHITE); view.setHintTextColor(0xff9da5b3);
        view.setTextSize(16); view.setInputType(type); view.setSingleLine(true); view.setSaveEnabled(false);
        view.setAutofillHints((String[])null); view.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        view.setPadding(dp(14),dp(12),dp(14),dp(12));
        GradientDrawable background = new GradientDrawable(); background.setColor(0xff14191f);background.setCornerRadius(dp(8));background.setStroke(dp(1),0xff49525e);view.setBackground(background);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1,dp(56));params.bottomMargin=dp(18);view.setLayoutParams(params);return view;
    }
    private Button button(String text,int id,boolean primary) {
        Button button = new Button(this);button.setId(id);button.setText(text);button.setAllCaps(false);button.setTextSize(16);button.setTextColor(Color.WHITE);
        GradientDrawable background = new GradientDrawable();background.setColor(primary?0xffdc5545:0xff222a34);background.setCornerRadius(dp(8));button.setBackground(background);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1,dp(54));params.bottomMargin=dp(12);button.setLayoutParams(params);return button;
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        // The invitation must never be visible in a screen broadcast or recents snapshot.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        getWindow().setStatusBarColor(0xff0b0e12);getWindow().setNavigationBarColor(0xff0b0e12);
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true);scroll.setBackgroundColor(0xff0b0e12);
        LinearLayout content = new LinearLayout(this);content.setOrientation(LinearLayout.VERTICAL);content.setPadding(dp(24),dp(32),dp(24),dp(24));scroll.addView(content);setContentView(scroll);
        TextView brand=label("WATCH PARTY",14,0xffef8b7d);brand.setLetterSpacing(.16f);content.addView(brand);
        TextView title=label("Share your phone.",30,Color.WHITE);title.setTypeface(null,Typeface.BOLD);content.addView(title);
        content.addView(label("Broadcast your screen to people in your private Watch Party room.",16,0xffa4adba));
        content.addView(label("Private room invite",13,0xffc4cad3));
        invite=input("Paste the full invite link",R.id.invite_field,InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);content.addView(invite);
        content.addView(label("Your broadcaster name",13,0xffc4cad3));
        name=input("For example, Ayush phone",R.id.name_field,InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_CAP_WORDS);content.addView(name);
        content.addView(label("Use a different name from your browser participant. The room supports six participants in total.",13,0xff9da5b3));
        start=button("Start sharing",R.id.start_button,true);content.addView(start);
        stop=button("Stop sharing",R.id.stop_button,false);content.addView(stop);
        status=label("",15,0xff9ed9bc);status.setId(R.id.broadcast_status);status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);content.addView(status);
        content.addView(label("Screen video only in this version. Keep voice chat in your web room. Android asks what to capture each time; protected apps can block capture.",13,0xff9da5b3));
        content.addView(label("This screen is hidden from capture to protect your private invitation. After sharing starts, open the app or screen you want others to see.",13,0xff9da5b3));
        start.setOnClickListener(view -> begin());
        stop.setOnClickListener(view -> { pending=false;startService(new Intent(this,BroadcastService.class).setAction(BroadcastService.STOP)); });
        refresh();
    }
    private void begin() {
        if (pending || BroadcastService.isRunning()) return;
        try { Invite.parse(invite.getText().toString(),name.getText().toString().trim()); }
        catch (IllegalArgumentException error) { status.setText(error.getMessage());return; }
        pending=true;start.setEnabled(false);
        if (Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},42);
        } else requestCapture();
    }
    private void requestCapture() {
        startActivityForResult(getSystemService(MediaProjectionManager.class).createScreenCaptureIntent(),43);
    }
    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] results) {
        super.onRequestPermissionsResult(requestCode,permissions,results);if(requestCode==42 && pending) requestCapture();
    }
    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data) {
        super.onActivityResult(requestCode,resultCode,data);
        if (requestCode!=43) return;
        pending=false;
        if(resultCode!=RESULT_OK || data==null) { refresh();status.setText(R.string.capture_cancelled);return; }
        Intent service = new Intent(this,BroadcastService.class).putExtra("capture",data).putExtra("invite",invite.getText().toString()).putExtra("name",name.getText().toString().trim());
        startForegroundService(service);status.setText(R.string.connecting);
        start.setEnabled(false);stop.setEnabled(true);
    }
    private void refresh() {
        boolean active=BroadcastService.isRunning();start.setEnabled(!active&&!pending);stop.setEnabled(active);invite.setEnabled(!active&&!pending);name.setEnabled(!active&&!pending);
        status.setText(BroadcastService.currentStatus());
    }
    @Override protected void onStart() { super.onStart(); androidx.core.content.ContextCompat.registerReceiver(this,updates,new IntentFilter(BroadcastService.STATE),androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED);refresh(); }
    @Override protected void onStop() { unregisterReceiver(updates);super.onStop(); }
}
