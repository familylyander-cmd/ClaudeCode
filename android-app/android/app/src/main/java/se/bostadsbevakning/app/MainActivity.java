package se.bostadsbevakning.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BooliBrowserPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
