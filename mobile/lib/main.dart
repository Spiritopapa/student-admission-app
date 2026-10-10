import 'dart:async';
import 'dart:convert';
import 'dart:core';
import 'dart:io';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path/path.dart' as p;
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

/// Public URL of the deployed SchoolRunner web app (Vercel).
///
/// This app is a thin native shell around the React web app. Point this
/// at your live deployment: all features (Supabase, SMS, QR verification)
/// keep working because they run on the hosted site.
const String kAppUrl = 'https://schoolrunner.vercel.app';

/// Root font size the site is scaled to. Tailwind sizes text in rem, so
/// changing the `html` root font-size scales everything down a little
/// (16px -> 14px is a ~12.5% reduction). Raise/lower to taste.
const double kWebFontSizePx = 14;

void main() {
  runApp(const SchoolRunnerApp());
}

class SchoolRunnerApp extends StatelessWidget {
  const SchoolRunnerApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'SchoolRunner',
      theme: ThemeData(
        colorScheme: .fromSeed(seedColor: Colors.indigo),
      ),
      home: const _HomePage(),
    );
  }
}

class _HomePage extends StatefulWidget {
  const _HomePage();

  @override
  State<_HomePage> createState() => _HomePageState();
}

enum _Phase { splash, ready, error }

class _HomePageState extends State<_HomePage> {
  WebViewController? _controller;
  _Phase _phase = _Phase.splash;
  bool _started = false;
  String _error = '';

  /// True once the hosted app finished loading successfully at least once.
  /// Network/HTTP errors reported by the WebView are only fatal BEFORE this
  /// (i.e. the initial "can't reach the server" load). After the app is up,
  /// a failing image, API response or fetch must never replace a live
  /// session with the full-screen error panel - that used to abort fee
  /// payments with "the SchoolRunner server is not responding".
  bool _loadedOnce = false;

  /// URL of the main-frame document currently loading (used to tell a real
  /// page-load HTTP error apart from sub-resource errors, which the plugin
  /// reports without a main-frame flag).
  String _loadingUrl = '';

  @override
  Widget build(BuildContext context) {
    if (_phase == _Phase.error) {
      return Scaffold(
        body: Center(child: _buildErrorPanel(context)),
      );
    }
    if (_phase == _Phase.ready && _controller != null) {
      return Scaffold(
        // White behind the WebView so the safe-area strip under the status
        // bar never looks black/dark.
        backgroundColor: Colors.white,
        body: _buildWebView(context),
      );
    }
    // Splash while the native WebView initializes.
    _start();
    return Scaffold(body: Center(child: _buildSplash(context)));
  }

  /// Shows the branded splash for a moment, then creates the WebView.
  void _start() {
    if (_started) return;
    _started = true;
    Timer.run(() async {
      await Future.delayed(Duration(milliseconds: 450));
      await _initWebView();
    });
  }

  Future<void> _initWebView() async {
    final controller = WebViewController();
    await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
    // Bridge for print / CSV-download / photo-pick handled natively.
    await controller.addJavaScriptChannel(
      'flutterHost',
      onMessageReceived: (JavaScriptMessage message) {
        _handleHostMessage(message);
      },
    );
    await controller.setNavigationDelegate(NavigationDelegate(
      onPageStarted: (String url) {
        _loadingUrl = url;
      },
      onPageFinished: (String url) {
        // Best-effort page polish: smaller root font, etc.
        _applyUiTweaks(controller);
        _loadedOnce = true;
        if (_phase == _Phase.ready) return;
        setState(() {
          _phase = _Phase.ready;
        });
      },
      onWebResourceError: (WebResourceError error) {
        // Sub-resource failures (images, fetch/XHR, iframes...) are reported
        // here too. Only a MAIN FRAME failure while the app is still loading
        // means the server itself is unreachable.
        if (error.isForMainFrame != true) return;
        if (_loadedOnce) return;
        _fail(
          'Could not reach the SchoolRunner server.\n'
          'Check your internet connection and try again.',
        );
      },
      onHttpError: (HttpResponseError error) {
        // NOTE: onReceivedHttpError fires for EVERY resource (broken receipt
        // logos, /api/* responses, subframes...). Reacting to those used to
        // replace the whole app with this error screen in the middle of e.g.
        // a fee payment. Only an HTTP error on the MAIN DOCUMENT while it is
        // still loading (before the first successful page load) is fatal.
        if (_loadedOnce) return;
        final String uri = error.request?.uri.toString() ?? '';
        String strip(String u) =>
            u.length > 1 && u.endsWith('/') ? u.substring(0, u.length - 1) : u;
        // onPageStarted only fires for the main document, so a match means
        // this error IS the page load itself - not a sub-resource/API call.
        if (_loadingUrl.isEmpty || strip(uri) != strip(_loadingUrl)) return;
        _fail(
          'The SchoolRunner server returned an unexpected response.\n'
          'Please try again in a moment.',
        );
      },
    ));
    await controller.loadRequest(Uri.parse(kAppUrl));
    _controller = controller;
    if (_phase != _Phase.error) {
      setState(() {
        _phase = _Phase.ready;
      });
    }
  }

  /// Builds the WebView widget. On Android we explicitly request the Hybrid
  /// Composition display mode (instead of the default texture-layer mode)
  /// because the default can render a black/nothing view on some devices.
  ///
  /// The WebView is also pushed below the status bar / notch inset
  /// (MediaQuery padding) so the site's own top navigation is never hidden
  /// behind the system bars - making upper-screen taps easy.
  Widget _buildWebView(BuildContext context) {
    final topInset = MediaQuery.paddingOf(context).top;
    final Widget web;
    if (WebViewPlatform.instance is AndroidWebViewPlatform) {
      final params = AndroidWebViewWidgetCreationParams(
        controller: _controller!.platform,
        displayWithHybridComposition: true,
      );
      web = WebViewWidget.fromPlatformCreationParams(params: params);
    } else {
      web = WebViewWidget(controller: _controller!);
    }
    return Padding(
      padding: EdgeInsets.only(top: topInset),
      child: SizedBox.expand(child: web),
    );
  }

  /// Best-effort polishing of the loaded site. Currently scales the root
  /// font down a little so all text reads smaller (Tailwind rem units make
  /// this scale the whole page). Runs on every page load; errors ignored.
  Future<void> _applyUiTweaks(WebViewController controller) async {
    try {
      final size = '${kWebFontSizePx}px';
      await controller.runJavaScript(
        "(() => {"
        "  const root = document.querySelector('html');"
        "  if (root && root.style.fontSize !== '$size') {"
        "    root.style.fontSize = '$size';"
        "  }"
        "})();",
      );
    } catch (_) {
      // Best effort only - the page may still be mid-load.
    }
  }

  /// Dispatches a message posted by the web app through the `flutterHost`
  /// JavaScript channel. All native actions run off the build pass.
  void _handleHostMessage(JavaScriptMessage message) {
    final Object decoded;
    try {
      decoded = jsonDecode(message.message);
    } catch (_) {
      return;
    }
    if (decoded is! Map) return;
    final Map root = decoded;
    final String cmd = '${root['cmd'] ?? ''}';
    Timer.run(() async {
      try {
        switch (cmd) {
          case 'download':
            await _hostSaveToDocuments(root, 'Downloads');
            break;
          case 'print':
            await _hostSaveToDocuments(root, 'Print');
            break;
          case 'printPdf':
            await _hostNativePrint(root);
            break;
          case 'pickImage':
            await _hostPickImage();
            break;
        }
      } catch (_) {
        // Best effort - the web page shows its own error handling.
      }
    });
  }

  /// Saves a file delivered by the web app (CSV downloads, print documents)
  /// into the device's Documents/SchoolRunner/`folder`, then confirms to the
  /// page so it can show a "saved" message.
  Future<void> _hostSaveToDocuments(Map root, String folder) async {
    final filename = _safeName('${root['filename'] ?? 'file.txt'}');
    final content = '${root['content'] ?? ''}';
    final docs = await _documentsPath();
    final dir = Directory(p.join(docs, 'SchoolRunner', folder));
    dir.createSync(recursive: true);
    File(p.join(dir.path, filename)).writeAsStringSync(content);
    await _runPageJs(
      "(() => {"
      "  const f = window.__schoolrunnerOnAction;"
      "  if (f) f('${folder == 'Downloads' ? 'download' : 'print'}', ${jsonEncode(filename)});"
      "})();",
    );
  }

  /// Returns an app-accessible Documents folder, resolved by the native
  /// MainActivity (see android/.../MainActivity.kt). Falls back to the app's
  /// temporary directory if the channel is unavailable.
  Future<String> _documentsPath() async {
    const MethodChannel channel = MethodChannel('schoolrunner_host');
    try {
      final Object? path = await channel.invokeMethod<String>('getDocumentsPath');
      if (path is String && path.isNotEmpty) return path;
    } catch (_) {
      // ignore - fall through to temp
    }
    return Directory.systemTemp.path;
  }

  /// Hands a standalone print document (a full HTML document) to the native
  /// print pipeline. MainActivity renders it in a hidden WebView and opens
  /// the system print dialog, whose default destination is "Save as PDF"
  /// (real printers work too) - the only reliable way to produce a real PDF
  /// from inside the WebView shell.
  Future<void> _hostNativePrint(Map root) async {
    final String title = ('${root['title'] ?? 'Document'}').trim();
    final String html = '${root['html'] ?? ''}';
    // The document travels as a temp file so large reports never hit the
    // platform channel's transaction size limit.
    final File file = File(
      p.join(
        Directory.systemTemp.path,
        'sr_print_${DateTime.now().millisecondsSinceEpoch}.html',
      ),
    );
    file.writeAsStringSync(html, flush: true);
    const MethodChannel channel = MethodChannel('schoolrunner_host');
    try {
      await channel.invokeMethod('printHtml', <String, Object?>{
        'title': title.isEmpty ? 'Document' : title,
        'path': file.path,
        'baseUrl': kAppUrl,
      });
      await _runPageJs(
        "(() => { const f = window.__schoolrunnerOnAction;"
        " if (f) f('printPdf', 'opened'); })();",
      );
    } catch (_) {
      await _runPageJs(
        "(() => { const f = window.__schoolrunnerOnAction;"
        " if (f) f('printPdf', 'failed'); })();",
      );
    } finally {
      // The native side already read the file synchronously.
      try {
        file.deleteSync();
      } catch (_) {}
    }
  }

  /// Asks the user to choose a photo with the native device picker, then
  /// hands the bytes back to the page as a File (base64 over JS).
  Future<void> _hostPickImage() async {
    final XFile? picked = await openFile(
      acceptedTypeGroups: const [
        XTypeGroup(
          label: 'Photos',
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'bmp'],
        ),
      ],
    );
    if (picked == null) return; // cancelled
    final bytes = await picked.readAsBytes();
    final name = picked.name;
    final mime = picked.mimeType ?? _mimeFor(name);
    await _runPageJs(
      "(() => {"
      "  const f = window.__schoolrunnerPickImage;"
      "  if (f) f(${jsonEncode(base64Encode(bytes))}, ${jsonEncode(name)}, ${jsonEncode(mime)});"
      "})();",
    );
  }

  String _safeName(String input) {
    var cleaned = input.replaceAll(RegExp(r'[\\/:*?"<>|]'), '_').trim();
    return cleaned.length > 90 ? cleaned.substring(cleaned.length - 90) : cleaned;
  }

  String _mimeFor(String name) {
    final ext = name.contains('.') ? name.split('.').last.toLowerCase() : '';
    switch (ext) {
      case 'png':
        return 'image/png';
      case 'gif':
        return 'image/gif';
      case 'webp':
        return 'image/webp';
      case 'bmp':
        return 'image/bmp';
      case 'heic':
        return 'image/heic';
      default:
        return 'image/jpeg';
    }
  }

  Future<void> _runPageJs(String javascript) async {
    final controller = _controller;
    if (controller == null) return;
    try {
      await controller.runJavaScript(javascript);
    } catch (_) {
      // The page may not be ready; the caller decides if that matters.
    }
  }

  void _fail(String message) {
    if (_phase == _Phase.error) return;
    _error = message;
    setState(() {
      _phase = _Phase.error;
    });
  }

  void _retry() {
    _controller = null;
    _started = false;
    _loadedOnce = false;
    _loadingUrl = '';
    setState(() {
      _phase = _Phase.splash;
    });
    _start();
  }

  Widget _buildSplash(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      mainAxisAlignment: .center,
      crossAxisAlignment: .center,
      spacing: 28,
      children: [
        Icon(Icons.school, size: 56, color: Colors.indigo),
        Column(
          mainAxisAlignment: .center,
          spacing: 6,
          children: [
            Text('SchoolRunner', style: theme.textTheme.headlineMedium),
            Text(
              'Streamline. Manage. Excel.',
              style: theme.textTheme.bodyMedium,
            ),
          ],
        ),
        CircularProgressIndicator(),
      ],
    );
  }

  Widget _buildErrorPanel(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      mainAxisAlignment: .center,
      crossAxisAlignment: .center,
      spacing: 20,
      children: [
        Icon(Icons.wifi, size: 56, color: Colors.indigo),
        Text("Can't connect", style: theme.textTheme.titleLarge),
        Text(_error, style: theme.textTheme.bodyMedium),
        FilledButton(onPressed: _retry, child: Text('Try again')),
      ],
    );
  }
}