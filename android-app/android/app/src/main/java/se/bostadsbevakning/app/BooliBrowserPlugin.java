package se.bostadsbevakning.app;

import android.content.Intent;
import android.widget.Toast;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Öppnar Booli i en inbyggd webbläsare. Användaren hämtar objekt med en knapp; resultatet skickas till appen. */
@CapacitorPlugin(name = "BooliBrowser")
public class BooliBrowserPlugin extends Plugin {
    private static BooliBrowserPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    @PluginMethod
    public void open(PluginCall call) {
        Intent intent = new Intent(getContext(), BooliBrowserActivity.class);
        intent.putExtra(BooliBrowserActivity.EXTRA_URL, call.getString("url", "https://www.booli.se/"));
        // Skriptet (booli-fetch.js) och dess inställningar hålls statiskt – kan vara för stort för en Intent.
        BooliBrowserActivity.pendingScript = call.getString("script");
        BooliBrowserActivity.pendingConfig = call.getString("config");
        BooliBrowserActivity.pendingLabel = call.getString("label", "Hämta objekt från Booli");
        getActivity().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void showMessage(PluginCall call) {
        String text = call.getString("text", "");
        getActivity().runOnUiThread(() ->
            Toast.makeText(getContext().getApplicationContext(), text, Toast.LENGTH_LONG).show());
        call.resolve();
    }

    static boolean deliver(String event, String key, String value) {
        if (instance == null) return false;
        JSObject data = new JSObject();
        data.put(key, value);
        instance.notifyListeners(event, data, true);
        return true;
    }
}
