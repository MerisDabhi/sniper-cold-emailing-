import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../notify.dart';
import '../widgets.dart';
import 'dashboard.dart';
import 'inbox.dart';
import 'settings.dart';
import 'thread.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, this.openLeadId});

  /// Conversation to open right away (app launched from a notification).
  final String? openLeadId;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  int _tab = 0;
  int _unread = 0;
  Timer? _poll;
  final _inboxKey = GlobalKey<InboxScreenState>();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _startNotifications();
    if (widget.openLeadId != null) {
      WidgetsBinding.instance.addPostFrameCallback(
        (_) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ThreadScreen(leadId: widget.openLeadId!))),
      );
    }
  }

  Future<void> _startNotifications() async {
    final n = Notifier.instance;
    await n.requestPermission();
    // The background watcher keeps checking after the app is closed.
    try {
      if (await n.enabled()) await ReplyWatcher.start();
    } catch (_) {}
    _check();
    _poll = Timer.periodic(const Duration(seconds: 30), (_) => _check());
  }

  Future<void> _check() async {
    try {
      final count = await Notifier.instance.checkNow();
      if (count > 0) _inboxKey.currentState?.refresh();
      final d = await Api.instance.conversations(filter: 'replies');
      final unread = ((d['counts'] as Map?)?['unread'] as num?)?.toInt() ?? 0;
      if (mounted && unread != _unread) setState(() => _unread = unread);
    } on UnauthorizedException {
      _signedOut();
    } catch (_) {}
  }

  void _signedOut() {
    if (mounted) goToLogin(context);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _check();
  }

  @override
  void dispose() {
    _poll?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final pages = [const DashboardScreen(), InboxScreen(key: _inboxKey, onChanged: _check), const SettingsScreen()];
    return Scaffold(
      body: IndexedStack(index: _tab, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) {
          setState(() => _tab = i);
          if (i == 1) _check();
        },
        destinations: [
          const NavigationDestination(icon: Icon(Icons.insights_outlined), selectedIcon: Icon(Icons.insights), label: 'Analytics'),
          NavigationDestination(
            icon: Badge.count(count: _unread, isLabelVisible: _unread > 0, child: const Icon(Icons.forum_outlined)),
            selectedIcon: Badge.count(count: _unread, isLabelVisible: _unread > 0, child: const Icon(Icons.forum)),
            label: 'Inbox',
          ),
          const NavigationDestination(icon: Icon(Icons.settings_outlined), selectedIcon: Icon(Icons.settings), label: 'Settings'),
        ],
      ),
    );
  }
}
