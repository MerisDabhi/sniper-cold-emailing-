import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../api.dart';
import '../notify.dart';
import '../quick_replies.dart';
import '../widgets.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _notify = true;
  bool _unrestricted = true;
  List<String> _quick = [];
  String? _owner;

  @override
  void initState() {
    super.initState();
    Notifier.instance.enabled().then((v) => mounted ? setState(() => _notify = v) : null);
    _checkBackground();
    QuickReplies.load().then((q) => mounted ? setState(() => _quick = q) : null);
    Api.instance.me().then((m) {
      final o = m['owner'] as Map<String, dynamic>?;
      if (mounted && o != null) setState(() => _owner = o['email'] as String?);
    }).catchError((_) {});
  }

  Future<void> _checkBackground() async {
    try {
      final ok = await ReplyWatcher.unrestricted;
      if (mounted) setState(() => _unrestricted = ok);
    } catch (_) {}
  }

  Future<void> _allowBackground() async {
    try {
      await ReplyWatcher.askUnrestricted();
    } catch (_) {}
    await _checkBackground();
  }

  Future<void> _editQuick([int? index]) async {
    final ctrl = TextEditingController(text: index == null ? '' : _quick[index]);
    final result = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(index == null ? 'New quick reply' : 'Edit quick reply'),
        content: TextField(
          controller: ctrl,
          autofocus: true,
          minLines: 3,
          maxLines: 6,
          decoration: const InputDecoration(helperText: '{first_name} is replaced with the lead\'s first name'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, ctrl.text.trim()), child: const Text('Save')),
        ],
      ),
    );
    if (result == null || result.isEmpty) return;
    setState(() => index == null ? _quick.add(result) : _quick[index] = result);
    await QuickReplies.save(_quick);
  }

  Future<void> _testNotification() async {
    await Notifier.instance.requestPermission();
    await Notifier.instance.plugin.show(
      id: 1,
      title: 'Alex Taylor · Acme Inc replied',
      body: 'Sounds interesting — can we talk on Thursday?',
      notificationDetails: const NotificationDetails(
        android: AndroidNotificationDetails('replies', 'Replies', importance: Importance.high, priority: Priority.high),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
        children: [
          _section('Account'),
          Card(
            child: Column(children: [
              const ListTile(leading: Icon(Icons.cloud_done_outlined), title: Text('Connected to Sniper Cloud'), subtitle: Text('Works anywhere — no laptop needed')),
              if (_owner != null) ListTile(leading: const Icon(Icons.account_circle_outlined), title: const Text('Workspace'), subtitle: Text(_owner!)),
              ListTile(
                leading: const Icon(Icons.logout, color: Colors.redAccent),
                title: const Text('Sign out', style: TextStyle(color: Colors.redAccent)),
                onTap: () async {
                  await Api.instance.signOut();
                  if (context.mounted) goToLogin(context);
                },
              ),
            ]),
          ),
          _section('Notifications'),
          Card(
            child: Column(children: [
              SwitchListTile(
                secondary: const Icon(Icons.notifications_active_outlined),
                title: const Text('Reply notifications'),
                subtitle: const Text('Sniper keeps checking every minute, even when the app is closed'),
                value: _notify,
                onChanged: (v) async {
                  setState(() => _notify = v);
                  await Notifier.instance.setEnabled(v);
                },
              ),
              if (_notify && !_unrestricted)
                ListTile(
                  leading: const Icon(Icons.battery_alert_outlined, color: Colors.orange),
                  title: const Text('Allow running in the background'),
                  subtitle: const Text('Your phone may stop Sniper to save battery. Tap to allow it, so notifications always arrive.'),
                  onTap: _allowBackground,
                ),
              ListTile(leading: const Icon(Icons.notifications_outlined), title: const Text('Send a test notification'), onTap: _testNotification),
            ]),
          ),
          _section('Quick replies'),
          Card(
            child: Column(children: [
              for (var i = 0; i < _quick.length; i++)
                ListTile(
                  leading: const Icon(Icons.bolt_rounded),
                  title: Text(_quick[i], maxLines: 2, overflow: TextOverflow.ellipsis),
                  onTap: () => _editQuick(i),
                  trailing: IconButton(
                    icon: const Icon(Icons.delete_outline),
                    onPressed: () async {
                      setState(() => _quick.removeAt(i));
                      await QuickReplies.save(_quick);
                    },
                  ),
                ),
              ListTile(leading: const Icon(Icons.add), title: const Text('Add quick reply'), onTap: () => _editQuick()),
            ]),
          ),
        ],
      ),
    );
  }

  Widget _section(String title) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 18, 4, 8),
        child: Text(title.toUpperCase(), style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, letterSpacing: 0.8, color: Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.5))),
      );
}
