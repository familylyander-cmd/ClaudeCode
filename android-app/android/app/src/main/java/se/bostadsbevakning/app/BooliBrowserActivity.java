package se.bostadsbevakning.app;

import android.annotation.SuppressLint;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import androidx.activity.EdgeToEdge;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

/**
 * En vanlig webbläsare för booli.se. Användaren surfar själv (och klarar ev. robotkontroll);
 * när hen trycker på knappen körs booli-fetch.js i sidan och resultatet skickas till appen.
 */
public class BooliBrowserActivity extends AppCompatActivity {
    static final String EXTRA_URL = "url";
    static String pendingScript, pendingConfig, pendingLabel;

    private WebView web;
    private TextView title, status;
    private ProgressBar progress;
    private Button fetchBtn;
    private String script, config;
    private boolean running;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this);
        script = pendingScript;
        config = pendingConfig;
        int blue = Color.parseColor("#2a78d6");

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setPadding(dp(8), dp(4), dp(8), dp(4));
        Button close = new Button(this);
        close.setText("← Appen");
        close.setAllCaps(false);
        close.setOnClickListener(v -> finish());
        title = new TextView(this);
        title.setSingleLine(true);
        title.setTextColor(Color.DKGRAY);
        title.setPadding(dp(8), 0, 0, 0);
        top.addView(close);
        top.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.addJavascriptInterface(new Bridge(), "BostadsApp");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                title.setText(view.getTitle());
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int p) {
                progress.setProgress(p);
                progress.setVisibility(p < 100 ? View.VISIBLE : View.GONE);
            }
        });

        status = new TextView(this);
        status.setTextColor(Color.DKGRAY);
        status.setPadding(dp(12), dp(6), dp(12), dp(6));
        status.setText("Vänta tills Booli har laddat (klara ev. robotkontroll), tryck sedan på knappen.");

        fetchBtn = new Button(this);
        fetchBtn.setText(pendingLabel != null ? pendingLabel : "Hämta objekt från Booli");
        fetchBtn.setTextColor(Color.WHITE);
        fetchBtn.setBackgroundColor(blue);
        fetchBtn.setAllCaps(false);
        fetchBtn.setTextSize(17);
        fetchBtn.setOnClickListener(v -> runFetch());

        root.addView(top);
        root.addView(progress, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        if (script != null && config != null) {
            root.addView(status);
            root.addView(fetchBtn, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56)));
        }
        setContentView(root);

        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (web.canGoBack()) web.goBack();
                else finish();
            }
        });

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(getIntent().getStringExtra(EXTRA_URL));
    }

    private boolean onBooli() {
        String url = web.getUrl();
        if (url == null) return false;
        String host = Uri.parse(url).getHost();
        return host != null && (host.equals("booli.se") || host.endsWith(".booli.se"));
    }

    private void runFetch() {
        if (running) return;
        if (!onBooli()) {
            Toast.makeText(this, "Gå till booli.se först", Toast.LENGTH_SHORT).show();
            return;
        }
        running = true;
        fetchBtn.setEnabled(false);
        status.setText("Hämtar…");
        web.evaluateJavascript(script + "\n;BostadsFetch(" + config + ");", null);
    }

    /** Anropas från booli-fetch.js i Booli-sidan. Accepterar bara anrop medan en hämtning pågår. */
    private class Bridge {
        @JavascriptInterface
        public void progress(String text) {
            runOnUiThread(() -> { if (running) status.setText(text); });
        }

        @JavascriptInterface
        public void done(String json) {
            runOnUiThread(() -> {
                if (!running) return;
                running = false;
                if (BooliBrowserPlugin.deliver("result", "json", json)) {
                    finish();
                } else {
                    fetchBtn.setEnabled(true);
                    status.setText("Appen är inte redo – försök igen.");
                }
            });
        }

        @JavascriptInterface
        public void fail(String message) {
            runOnUiThread(() -> {
                if (!running) return;
                running = false;
                fetchBtn.setEnabled(true);
                status.setText("Fel: " + message + "\nKlara ev. robotkontroll på sidan och försök igen.");
            });
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        web.removeJavascriptInterface("BostadsApp");
        web.destroy();
        super.onDestroy();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
