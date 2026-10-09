package com.spiritopapa.schoolrunner_mobile

import android.os.Environment
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val channelName = "schoolrunner_host"

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
                    else -> result.notImplemented()
                }
            }
    }
}
