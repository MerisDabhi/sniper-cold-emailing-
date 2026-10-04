import 'package:flutter/material.dart';

import 'api.dart';
import 'notify.dart';
import 'screens/home.dart';
import 'screens/login.dart';
import 'screens/thread.dart';
import 'theme.dart';

final navigatorKey = GlobalKey<NavigatorState>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Api.instance.load();
  String? launchLead;
  // Notifications are a bonus: if anything about them fails, the app must still open.
  try {
    await Notifier.instance.init();
    ReplyWatcher.configure();
    Notifier.instance.onOpen = openConversation;
    launchLead = await Notifier.instance.launchLeadId();
  } catch (e) {
    debugPrint('Notifications unavailable: $e');
  }
  runApp(SniperApp(launchLeadId: launchLead));
}

/// Open a conversation from anywhere (e.g. a tapped notification).
void openConversation(String leadId) {
  navigatorKey.currentState?.push(MaterialPageRoute(builder: (_) => ThreadScreen(leadId: leadId)));
}

class SniperApp extends StatelessWidget {
  const SniperApp({super.key, this.launchLeadId});
  final String? launchLeadId;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Sniper',
      navigatorKey: navigatorKey,
      debugShowCheckedModeBanner: false,
      theme: buildTheme(Brightness.light),
      darkTheme: buildTheme(Brightness.dark),
      home: Api.instance.signedIn ? HomeScreen(openLeadId: launchLeadId) : const LoginScreen(),
    );
  }
}
