import 'package:flutter/material.dart';
import 'package:flutter_foreground_task/flutter_foreground_task.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'api.dart';
import 'labels.dart';

/// Reply notifications.
///
/// A small background service keeps running after the app is closed (and starts again after a
/// reboot) and asks the server "any new replies since X?" once a minute. Each new reply becomes
/// a notification; tapping it opens the conversation. While the app is open it also checks
/// every 30 seconds.
class Notifier {
  Notifier._();
  static final Notifier instance = Notifier._();

  static const _lastSeenKey = 'notify_last_seen';
  static const _enabledKey = 'notify_enabled';
  static const _channelId = 'replies';

  final plugin = FlutterLocalNotificationsPlugin();
  bool _ready = false;

  /// Called with the lead id when a notification is tapped.
  void Function(String leadId)? onOpen;

  Future<void> init({bool background = false}) async {
    if (_ready) return;
    const settings = InitializationSettings(android: AndroidInitializationSettings('@drawable/ic_stat_sniper'));
    await plugin.initialize(
      settings: settings,
      onDidReceiveNotificationResponse: background
          ? null
          : (response) {
              final id = response.payload;
              if (id != null && id.isNotEmpty) onOpen?.call(id);
            },
    );
    await plugin
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(const AndroidNotificationChannel(
          _channelId,
          'Replies',
          description: 'When a lead replies to your outreach',
          importance: Importance.high,
        ));
    _ready = true;
  }

  /// The lead id of the notification that launched the app (if any).
  Future<String?> launchLeadId() async {
    final details = await plugin.getNotificationAppLaunchDetails();
    if (details?.didNotificationLaunchApp ?? false) return details!.notificationResponse?.payload;
    return null;
  }

  Future<bool> requestPermission() async {
    final android = plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    return await android?.requestNotificationsPermission() ?? true;
  }

  Future<bool> enabled() async => (await SharedPreferences.getInstance()).getBool(_enabledKey) ?? true;

  Future<void> setEnabled(bool on) async {
    await (await SharedPreferences.getInstance()).setBool(_enabledKey, on);
    if (on) {
      await ReplyWatcher.start();
    } else {
      await ReplyWatcher.stop();
    }
  }

  /// Fetch replies newer than the last check and show a notification for each. Returns how many.
  Future<int> checkNow() async {
    final prefs = await SharedPreferences.getInstance();
    // The app and the background service each have their own copy of the settings — re-read
    // from disk so they agree on what has already been announced.
    await prefs.reload();
    if (!(prefs.getBool(_enabledKey) ?? true)) return 0;
    final api = Api.instance;
    await api.load();
    if (!api.signedIn) return 0;
    final since = prefs.getInt(_lastSeenKey) ?? DateTime.now().millisecondsSinceEpoch;
    if (!prefs.containsKey(_lastSeenKey)) {
      // First run: start from now, don't flood with old replies.
      await prefs.setInt(_lastSeenKey, since);
      return 0;
    }
    final data = await api.notifications(since);
    final replies = (data['replies'] as List).cast<Map<String, dynamic>>();
    var newest = since;
    for (final r in replies.reversed) {
      final at = (r['at'] as num).toInt();
      if (at > newest) newest = at;
      final who = (r['name'] as String?)?.isNotEmpty == true ? r['name'] as String : r['contact'] as String? ?? 'A lead';
      final company = (r['company'] as String?) ?? '';
      final text = ((r['text'] as String?) ?? '').trim();
      final label = ReplyLabels.of(r['label'] as String?);
      final body = text.isEmpty ? 'Tap to read and reply' : text;
      await plugin.show(
        id: (r['id'] as String).hashCode & 0x7fffffff,
        title: company.isNotEmpty ? '$who · $company' : who,
        body: body,
        notificationDetails: NotificationDetails(
          android: AndroidNotificationDetails(
            _channelId,
            'Replies',
            channelDescription: 'When a lead replies to your outreach',
            importance: Importance.high,
            priority: Priority.high,
            color: r['channel'] == 'whatsapp' ? const Color(0xFF14A44D) : const Color(0xFF3B5BFD),
            subText: label.name,
            styleInformation: BigTextStyleInformation(body),
            category: AndroidNotificationCategory.message,
          ),
        ),
        payload: r['leadId'] as String?,
      );
    }
    if (newest > since) await prefs.setInt(_lastSeenKey, newest);
    return replies.length;
  }
}

/// The always-on background service that checks for replies once a minute.
class ReplyWatcher {
  static const _serviceId = 4711;

  /// Call once at startup, before [start].
  static void configure() {
    FlutterForegroundTask.initCommunicationPort();
    FlutterForegroundTask.init(
      androidNotificationOptions: AndroidNotificationOptions(
        channelId: 'watcher',
        channelName: 'Background reply check',
        channelDescription: 'Keeps Sniper checking for replies while the app is closed',
        channelImportance: NotificationChannelImportance.MIN,
        priority: NotificationPriority.MIN,
        onlyAlertOnce: true,
        showBadge: false,
      ),
      iosNotificationOptions: const IOSNotificationOptions(showNotification: false),
      foregroundTaskOptions: ForegroundTaskOptions(
        eventAction: ForegroundTaskEventAction.repeat(60000),
        autoRunOnBoot: true,
        autoRunOnMyPackageReplaced: true,
        allowWakeLock: true,
        allowWifiLock: false,
      ),
    );
  }

  static Future<bool> get running => FlutterForegroundTask.isRunningService;

  static Future<void> start() async {
    if (await FlutterForegroundTask.isRunningService) return;
    await FlutterForegroundTask.startService(
      serviceId: _serviceId,
      serviceTypes: [ForegroundServiceTypes.remoteMessaging],
      notificationTitle: 'Watching for replies',
      notificationText: 'Sniper checks every minute, even when closed',
      notificationIcon: const NotificationIcon(metaDataName: 'com.sniper.outreach.WATCHER_ICON'),
      callback: replyWatcherCallback,
    );
  }

  static Future<void> stop() async {
    if (await FlutterForegroundTask.isRunningService) await FlutterForegroundTask.stopService();
  }

  /// Whether Android lets the app run freely in the background (needed on most phones).
  static Future<bool> get unrestricted => FlutterForegroundTask.isIgnoringBatteryOptimizations;

  static Future<bool> askUnrestricted() => FlutterForegroundTask.requestIgnoreBatteryOptimization();
}

/// Entry point of the background service (runs without the UI).
@pragma('vm:entry-point')
void replyWatcherCallback() {
  FlutterForegroundTask.setTaskHandler(_ReplyTaskHandler());
}

class _ReplyTaskHandler extends TaskHandler {
  Future<void> _check() async {
    try {
      await Notifier.instance.init(background: true);
      await Notifier.instance.checkNow();
    } catch (_) {
      // Network down or server unreachable — try again next minute.
    }
  }

  @override
  Future<void> onStart(DateTime timestamp, TaskStarter starter) => _check();

  @override
  void onRepeatEvent(DateTime timestamp) {
    _check();
  }

  @override
  Future<void> onDestroy(DateTime timestamp, bool isTimeout) async {}
}
