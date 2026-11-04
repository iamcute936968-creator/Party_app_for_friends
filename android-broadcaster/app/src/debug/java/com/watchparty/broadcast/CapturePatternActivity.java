package com.watchparty.broadcast;

import android.app.Activity;
import android.os.Bundle;
import android.graphics.*;
import android.view.View;

/** Debug-only owned screen for real MediaProjection tests; never shows private phone content. */
public final class CapturePatternActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(new View(this) {
            final Paint paint=new Paint();
            @Override public void onDraw(Canvas canvas) {
                canvas.drawColor(Color.rgb(13,17,24));paint.setColor(Color.rgb(220,85,69));canvas.drawRect(0,0,getWidth(),getHeight()/3f,paint);
                paint.setColor(Color.WHITE);paint.setTextSize(42);canvas.drawText("Watch Party Android capture",20,getHeight()/2f,paint);
                canvas.drawText(Long.toString(System.currentTimeMillis()),20,getHeight()/2f+70,paint);postInvalidateDelayed(80);
            }
        });
    }
}
