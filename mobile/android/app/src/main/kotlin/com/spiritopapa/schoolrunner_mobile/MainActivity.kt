package com.spiritopapa.schoolrunner_mobile

import android.content.Context
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.print.PrintManager
import android.webkit.WebView
import android.webkit.WebViewClient
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterActivity() {
    private val channelName = "schoolrunner_host"

    /// Hidden WebView used to render the current print job. It is kept until
    /// the next print request (instead of destroyed right away) because the
    /// system print dialog can stay open long after the page finished loading.
    private var printWebView: WebView? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // Host bridge for the WebView shell: returns an app-accessible
        // Documents folder where the app saves CSV exports and print
        // documents handed over by the web page (no permissions needed).
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "getDocumentsPath" -> {
                        val dir = getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS)
                        result.success(dir?.absolutePath ?: filesDir.absolutePath)
                    }
                    "printHtml" -> {
                        val title = call.argument<String>("title") ?: "Document"
                        val path = call.argument<String>("path") ?: ""
                        val baseUrl = call.argument<String>("baseUrl") ?: ""
                        try {
                            startSystemPrint(title, path, baseUrl)
                            result.success(null)
                        } catch (e: Exception) {
                            result.error("print_failed", e.message, null)
                        }
                    }
                    else -> result.notImplemented()
                }
            }
    }

    /**
     * Renders the HTML document at [path] in a hidden WebView and opens
     * Android's system print dialog through the [PrintManager]. "Save as PDF"
     * is the default destination and physical printers work too - this is how
     * the app produces real PDFs (window.print() is a no-op in a WebView).
     */
    private fun startSystemPrint(title: String, path: String, baseUrl: String) {
        val html = File(path).readText(Charsets.UTF_8)
        printWebView?.destroy()
        // Application context avoids leaking the Activity if anything holds on
        // to this short-lived WebView; printing does not need a themed context.
        val webView = WebView(applicationContext)
        printWebView = webView
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // Receipt logos / QR codes / student photos may be remote URLs.
            blockNetworkLoads = false
        }
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                // Give remote images a beat to finish rendering before the
                // print adapter snapshots the document.
                Handler(Looper.getMainLooper()).postDelayed({
                    try {
                        val printManager =
                            getSystemService(Context.PRINT_SERVICE) as PrintManager
                        val adapter = view.createPrintDocumentAdapter(title)
                        printManager.print(title, adapter, null)
                    } catch (_: Exception) {
                        // The web sheet shows its own "could not print" hint.
                    }
                }, 500)
            }
        }
        webView.loadDataWithBaseURL(
            if (baseUrl.isEmpty()) null else baseUrl,
            html,
            "text/html",
            "utf-8",
            null,
        )
    }
}
