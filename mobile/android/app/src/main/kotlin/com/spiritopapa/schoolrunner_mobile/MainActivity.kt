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
import org.json.JSONArray

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
        // A4 render width from the start: the document lays out for the PAGE,
        // not for the phone screen - the PDF is a true A4 document.
        container.addView(
            webView,
            FrameLayout.LayoutParams(
                A4_RENDER_WIDTH,
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
                // Give the viewport reflow + remote images a beat to settle.
                mainHandler.postDelayed({ renderA4Pdf(webView, title, complete) }, 500)
            }
        }
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                // Force a device-width viewport so CSS px == view px at the A4
                // render width (docs without a viewport meta would otherwise
                // lay out at 980 CSS px and scale down - "screenshot" pages).
                view.evaluateJavascript(FORCE_VIEWPORT_JS, null)
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

    /// A4 PDF pipeline: ask the DOM for its full height at the A4 render
    /// width, re-layout the hidden WebView to that height, collect natural
    /// page-break candidates (table rows / headings), then draw page-by-page
    /// into an android PdfDocument sized in exact A4 points (595 x 842).
    private fun renderA4Pdf(webView: WebView, title: String, complete: (String?) -> Unit) {
        try {
            webView.evaluateJavascript(CONTENT_HEIGHT_JS) { raw ->
                val jsHeight = parseJsInt(raw) ?: 0
                webView.measure(
                    View.MeasureSpec.makeMeasureSpec(A4_RENDER_WIDTH, View.MeasureSpec.EXACTLY),
                    View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
                )
                val contentHeight = maxOf(jsHeight, webView.measuredHeight, 1)
                webView.layout(0, 0, A4_RENDER_WIDTH, contentHeight)

                // Let the re-layout settle before measuring break positions.
                mainHandler.postDelayed({
                    webView.evaluateJavascript(BREAKS_JS) { rawBreaks ->
                        drawA4Document(
                            webView,
                            contentHeight,
                            parseJsIntArray(rawBreaks),
                            title,
                            complete,
                        )
                    }
                }, 150)
            }
        } catch (e: Exception) {
            openPrintDialogFallback(webView, title, complete)
        }
    }

    /// Draws the laid-out WebView into true A4 pages (595 x 842 points).
    /// Page breaks snap to natural document boundaries (table rows, headings)
    /// whenever one fits on the page, so rows are never sliced in half.
    private fun drawA4Document(
        webView: WebView,
        contentHeight: Int,
        breaks: IntArray,
        title: String,
        complete: (String?) -> Unit,
    ) {
        try {
            val scale = A4_PAGE_WIDTH_PT.toFloat() / A4_RENDER_WIDTH
            val pageContentHeight = A4_PAGE_HEIGHT_PT / scale.toDouble() // content px per page

            val pdf = PdfDocument()
            var y = 0.0
            var pageNo = 1
            while (y < contentHeight && pageNo <= 300) {
                val remaining = contentHeight - y
                val limit = y + pageContentHeight
                val end: Double = if (remaining <= pageContentHeight + 0.5) {
                    contentHeight.toDouble()
                } else {
                    val fitting = breaks.lastOrNull { it > y + 8 && it <= limit }
                    val candidate = fitting?.toDouble() ?: limit
                    if (candidate - y < 8) limit else candidate
                }
                val used = (end - y).toFloat()

                val pageInfo = PdfDocument.PageInfo.Builder(A4_PAGE_WIDTH_PT, A4_PAGE_HEIGHT_PT, pageNo).create()
                val page = pdf.startPage(pageInfo)
                val canvas = page.canvas
                canvas.save()
                canvas.scale(scale, scale)
                canvas.clipRect(0f, 0f, A4_RENDER_WIDTH.toFloat(), used)
                canvas.translate(0f, -y.toFloat())
                webView.draw(canvas)
                canvas.restore()
                pdf.finishPage(page)

                y = end
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

    private fun parseJsInt(raw: String?): Int? {
        val v = raw?.trim() ?: return null
        if (v == "null" || v.isEmpty()) return null
        return v.toIntOrNull()
    }

    private fun parseJsIntArray(raw: String?): IntArray {
        if (raw.isNullOrBlank() || raw == "null") return intArrayOf()
        return try {
            val arr = JSONArray(raw)
            IntArray(arr.length()) { i -> arr.getInt(i) }
        } catch (_: Exception) {
            intArrayOf()
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

    private companion object {
        /// A4 at 96dpi: 210mm -> 794 CSS-pixel render width. Documents are
        /// laid out at this width so every PDF page is a true A4 page.
        const val A4_RENDER_WIDTH = 794

        /// Exact A4 page size in PDF points (72dpi).
        const val A4_PAGE_WIDTH_PT = 595
        const val A4_PAGE_HEIGHT_PT = 842

        /// Force a device-width viewport so CSS px == view px at the A4
        /// render width (documents without a viewport meta would otherwise
        /// lay out at 980 CSS px and scale down - "screenshot"-style pages).
        val FORCE_VIEWPORT_JS =
            "(function(){try{var m=document.querySelector('meta[name=\"viewport\"]');" +
                "if(!m){m=document.createElement('meta');m.setAttribute('name','viewport');" +
                "(document.head||document.documentElement).appendChild(m);}" +
                "m.setAttribute('content','width=device-width, initial-scale=1');}catch(e){}})()"

        /// Full document height in CSS pixels at the current layout width.
        val CONTENT_HEIGHT_JS =
            "Math.max(document.body?document.body.scrollHeight:0," +
                "document.documentElement?document.documentElement.scrollHeight:0)"

        /// Top offsets of natural page-break candidates (rows / headings).
        val BREAKS_JS =
            "JSON.stringify((function(){var o=[],e=document.querySelectorAll(" +
                "'tr,thead,h1,h2,h3,h4,li');" +
                "for(var i=0;i<e.length;i++){var r=e[i].getBoundingClientRect();" +
                "var t=Math.round(r.top+(window.pageYOffset||document.documentElement.scrollTop||0));" +
                "if(t>0)o.push(t);}o.sort(function(a,b){return a-b;});" +
                "var u=[];for(var j=0;j<o.length;j++){if(j===0||o[j]!==o[j-1])u.push(o[j]);}" +
                "return u;})())"
    }
}

