package com.spiritopapa.schoolrunner_mobile

import android.content.ContentValues
import android.content.Context
import android.graphics.pdf.PdfDocument
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.print.PrintManager
import android.provider.MediaStore
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.io.FileOutputStream

class MainActivity : FlutterActivity() {
    private val channelName = "schoolrunner_host"
    private val mainHandler = Handler(Looper.getMainLooper())

    /// Hidden render view for the current PDF job. It is attached INVISIBLE on
    /// top of the Flutter view so the WebView is fully measured and laid out
    /// (required for correct PDF rendering) without ever being seen or
    /// intercepting touches. Replaced on the next print request.
    private var printContainer: FrameLayout? = null
    private var printWebView: WebView? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        // Host bridge for the WebView shell: CSV folders, PDF export, photos.
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "getDocumentsPath" -> {
                        val dir = getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS)
                        result.success(dir?.absolutePath ?: filesDir.absolutePath)
                    }
                    "printPdf" -> {
                        val title = call.argument<String>("title") ?: "Document"
                        val path = call.argument<String>("path") ?: ""
                        val baseUrl = call.argument<String>("baseUrl") ?: ""
                        try {
                            startPdfExport(title, path, baseUrl, result)
                        } catch (e: Exception) {
                            result.error("print_failed", e.message, null)
                        }
                    }
                    else -> result.notImplemented()
                }
            }
    }

    override fun onDestroy() {
        destroyPrintView()
        super.onDestroy()
    }

    /**
     * Renders the HTML document at [path] in a hidden, ATTACHED WebView and
     * produces a real PDF file:
     *
     *  1. headlessly - the laid-out WebView is drawn into an android
     *     PdfDocument and the file is written straight to the public device
     *     Downloads (no user interaction);
     *  2. if that fails, falls back to the system print dialog, whose default
     *     destination is "Save as PDF" (real printers work too).
     *
     * [result] completes with:
     *  - "saved:" + file name - PDF stored in Downloads;
     *  - "dialog"       - the system print dialog was opened;
     *  - error          - neither path was possible.
     */
    private fun startPdfExport(
        title: String,
        path: String,
        baseUrl: String,
        result: MethodChannel.Result,
    ) {
        val html = File(path).readText(Charsets.UTF_8)
        var completed = false
        val complete: (String?) -> Unit = { value ->
            if (!completed) {
                completed = true
                try {
                    if (value == null) {
                        result.error("print_failed", "PDF generation failed", null)
                    } else {
                        result.success(value)
                    }
                } catch (_: Exception) {
                    // Engine detached mid-job; nothing sensible left to do.
                }
            }
        }

        destroyPrintView()
        val webView = WebView(this)
        val container = FrameLayout(this)
        printWebView = webView
        printContainer = container
        container.addView(
            webView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        // INVISIBLE (not GONE): still measured + laid out (the print pipeline
        // needs real dimensions) but draws nothing and never eats touches.
        container.visibility = View.INVISIBLE
        addContentView(
            container,
            ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT),
        )

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            // Receipt logos / QR codes / photos may be remote URLs.
            blockNetworkLoads = false
        }

        var renderStarted = false
        val beginRender: () -> Unit = {
            if (!renderStarted) {
                renderStarted = true
                // Give remote images a beat to finish rendering first.
                mainHandler.postDelayed({ renderAndSave(webView, title, complete) }, 400)
            }
        }
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                beginRender()
            }
        }
        // Safety net: never leave the caller waiting forever.
        mainHandler.postDelayed({ beginRender() }, 10_000)

        webView.loadDataWithBaseURL(
            if (baseUrl.isEmpty()) null else baseUrl,
            html,
            "text/html",
            "utf-8",
            null,
        )
    }

    /// Headless PDF render: the hidden WebView is re-laid out to its FULL
    /// content height, then drawn page-by-page (A4-ratio slices) into an
    /// android.graphics.pdf.PdfDocument and stored in Downloads. Uses only
    /// public, unrestricted APIs (the print-adapter callbacks are
    /// package-private in recent Android SDKs). Any failure falls back to
    /// the system print dialog.
    private fun renderAndSave(webView: WebView, title: String, complete: (String?) -> Unit) {
        try {
            val width = webView.width
            if (width <= 0) {
                openPrintDialogFallback(webView, title, complete)
                return
            }
            // Re-measure + re-layout at FULL content height so the whole
            // document can be drawn (standard WebView-to-PDF technique).
            webView.measure(
                View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
            )
            webView.layout(0, 0, width, webView.measuredHeight)
            val totalHeight = webView.measuredHeight
            if (totalHeight <= 0) {
                openPrintDialogFallback(webView, title, complete)
                return
            }

            val pageWidth = width
            val pageHeight = ((pageWidth.toDouble() * 297.0) / 210.0).toInt().coerceAtLeast(1)
            val pdf = PdfDocument()
            var y = 0
            var pageNo = 1
            while (y < totalHeight && pageNo <= 200) {
                val pageInfo = PdfDocument.PageInfo.Builder(pageWidth, pageHeight, pageNo).create()
                val page = pdf.startPage(pageInfo)
                val canvas = page.canvas
                canvas.save()
                canvas.translate(0f, -y.toFloat())
                webView.draw(canvas)
                canvas.restore()
                pdf.finishPage(page)
                y += pageHeight
                pageNo += 1
            }

            val tempPdf = File(cacheDir, "sr_render_${System.currentTimeMillis()}.pdf")
            FileOutputStream(tempPdf).use { out -> pdf.writeTo(out) }
            pdf.close()

            if (tempPdf.length() > 0) {
                val saved = saveToDownloads(tempPdf, safePdfName(title))
                tempPdf.delete()
                if (saved != null) {
                    complete("saved:$saved")
                    destroyPrintView()
                    return
                }
            } else {
                tempPdf.delete()
            }
            openPrintDialogFallback(webView, title, complete)
        } catch (e: Exception) {
            openPrintDialogFallback(webView, title, complete)
        }
    }

    /// Last resort: hand the document to the system print dialog, whose
    /// default destination is "Save as PDF" (physical printers too). The
    /// hidden WebView stays alive while the dialog is open - the adapter
    /// references it - and is replaced on the next print request.
    private fun openPrintDialogFallback(
        webView: WebView,
        title: String,
        complete: (String?) -> Unit,
    ) {
        try {
            val printManager = getSystemService(Context.PRINT_SERVICE) as PrintManager
            printManager.print(title, webView.createPrintDocumentAdapter(title), null)
            complete("dialog")
        } catch (e: Exception) {
            complete(null)
            destroyPrintView()
        }
    }

    /// Stores [pdf] in the public Downloads collection - visible in the Files
    /// app and every file manager. Pre-Android 10 falls back to the
    /// app-accessible Documents folder (no storage permission needed).
    /// Returns the display name / relative location on success, null otherwise.
    private fun saveToDownloads(pdf: File, displayName: String): String? {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, displayName)
                    put(MediaStore.Downloads.MIME_TYPE, "application/pdf")
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val resolver = contentResolver
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: return null
                resolver.openOutputStream(uri)?.use { out ->
                    pdf.inputStream().use { it.copyTo(out) }
                } ?: return null
                values.clear()
                values.put(MediaStore.Downloads.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
                displayName
            } else {
                val dir = File(getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS), "SchoolRunner/Print")
                dir.mkdirs()
                val dest = File(dir, displayName)
                pdf.copyTo(dest, overwrite = true)
                "SchoolRunner/Print/$displayName"
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun safePdfName(title: String): String {
        val cleaned = title.replace(Regex("[\\\\/:*?\"<>|]"), "_").trim().ifEmpty { "Document" }
        return if (cleaned.endsWith(".pdf", ignoreCase = true)) cleaned else "$cleaned.pdf"
    }

    private fun destroyPrintView() {
        try {
            printWebView?.destroy()
        } catch (_: Exception) {
        }
        try {
            val parent = printContainer?.parent
            if (parent is ViewGroup) parent.removeView(printContainer)
        } catch (_: Exception) {
        }
        printWebView = null
        printContainer = null
    }
}

