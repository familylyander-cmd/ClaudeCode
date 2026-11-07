package se.bostadsbevakning.app;

import android.annotation.SuppressLint;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
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
import org.json.JSONTokener;

/**
 * En vanlig webbläsare för booli.se. Användaren surfar själv; när hen trycker
 * "Spara objekten på sidan" läses sidans innehåll och skickas till appen.
 */
public class BooliBrowserActivity extends AppCompatActivity {
    static final String EXTRA_URL = "url";
    private WebView web;
    private TextView title;
    private ProgressBar progress;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        EdgeToEdge.enable(this);
        int blue = Color.parseColor("#2a78d6");

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.CENTER_VERTICAL);
        top.setPadding(dp(8), dp(4), dp(8), dp(4));
        Button close = new Button(this);
        close.setText("← Appen");
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

        Button save = new Button(this);
        save.setText("Spara objekten på sidan");
        save.setTextColor(Color.WHITE);
        save.setBackgroundColor(blue);
        save.setAllCaps(false);
        save.setTextSize(17);
        save.setOnClickListener(v -> savePage());

        root.addView(top);
        root.addView(progress, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56));
        root.addView(save, lp);
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

    private void savePage() {
        final String url = web.getUrl();
        web.evaluateJavascript("document.documentElement.outerHTML", result -> {
            String html;
            try {
                Object v = new JSONTokener(result).nextValue();
                html = v instanceof String ? (String) v : "";
            } catch (Exception e) {
                html = "";
            }
            if (html.isEmpty()) {
                Toast.makeText(this, "Kunde inte läsa sidan", Toast.LENGTH_SHORT).show();
            } else if (!BooliBrowserPlugin.deliverPage(url, html)) {
                Toast.makeText(this, "Appen är inte redo – försök igen", Toast.LENGTH_SHORT).show();
            }
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
