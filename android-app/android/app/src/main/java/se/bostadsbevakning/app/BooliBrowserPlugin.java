package se.bostadsbevakning.app;

import android.content.Intent;
import android.widget.Toast;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Öppnar Booli i en inbyggd webbläsare och skickar sidor som användaren sparar till appen. */
@CapacitorPlugin(name = "BooliBrowser")
public class BooliBrowserPlugin extends Plugin {
    private static BooliBrowserPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url", "https://www.booli.se/");
        Intent intent = new Intent(getContext(), BooliBrowserActivity.class);
        intent.putExtra(BooliBrowserActivity.EXTRA_URL, url);
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

    /** Anropas från BooliBrowserActivity när användaren trycker "Spara objekten på sidan". */
    static boolean deliverPage(String url, String html) {
        if (instance == null) return false;
        JSObject data = new JSObject();
        data.put("url", url);
        data.put("html", html);
        instance.notifyListeners("page", data, true);
        return true;
    }
}
