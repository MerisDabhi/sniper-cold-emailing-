import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import '../labels.dart';
import '../quick_replies.dart';
import '../theme.dart';
import '../widgets.dart';

/// One conversation: the full email thread (or WhatsApp messages) and a reply box.
class ThreadScreen extends StatefulWidget {
  const ThreadScreen({super.key, required this.leadId});
  final String leadId;

  @override
  State<ThreadScreen> createState() => _ThreadScreenState();
}

class _ThreadScreenState extends State<ThreadScreen> {
  Map<String, dynamic>? _data;
  String? _error;
  List<String> _quick = [];
  final _reply = TextEditingController();
  final _scroll = ScrollController();
  bool _sending = false;
  Timer? _live;

  @override
  void initState() {
    super.initState();
    _load();
    // Keep the conversation live while it is open.
    _live = Timer.periodic(const Duration(seconds: 20), (_) => _load(quiet: true));
    QuickReplies.load().then((q) => mounted ? setState(() => _quick = q) : null);
  }

  @override
  void dispose() {
    _live?.cancel();
    _reply.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load({bool quiet = false}) async {
    try {
      final before = (_data?['messages'] as List?)?.length ?? -1;
      final d = await Api.instance.thread(widget.leadId);
      if (!mounted) return;
      setState(() => (_data = d, _error = null));
      // Jump to the newest message on first load and whenever a new one arrives.
      if ((d['messages'] as List).length != before) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent);
        });
      }
    } catch (e) {
      if (mounted && !quiet) setState(() => _error = errorText(context, e));
    }
  }

  Future<void> _pickLabel() async {
    final lead = _data?['lead'] as Map<String, dynamic>?;
    if (lead == null) return;
    final current = lead['label'] as String? ?? '';
    final picked = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: ListView(shrinkWrap: true, children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(20, 0, 20, 8),
            child: Text('Label this conversation', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
          ),
          for (final l in ReplyLabels.all)
            ListTile(
              leading: Icon(l.icon, color: l.color),
              title: Text(l.name),
              trailing: current == l.key ? const Icon(Icons.check, size: 20) : null,
              onTap: () => Navigator.pop(ctx, l.key),
            ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.auto_awesome_outlined),
            title: const Text('Label automatically'),
            subtitle: const Text('Sniper picks the label from the next reply'),
            onTap: () => Navigator.pop(ctx, ''),
          ),
        ]),
      ),
    );
    if (picked == null || !mounted) return;
    try {
      await Api.instance.setLabel(widget.leadId, picked);
      if (picked.isNotEmpty && mounted) setState(() => lead['label'] = picked);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, e))));
    }
  }

  Future<void> _markUnread() async {
    try {
      await Api.instance.setRead(widget.leadId, false);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, e))));
    }
  }

  String get _firstName {
    final name = (_data?['lead']?['name'] as String?) ?? '';
    return name.split(' ').first;
  }

  Future<void> _send() async {
    final text = _reply.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await Api.instance.reply(widget.leadId, text);
      _reply.clear();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Reply sent')));
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(context, e))));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    final lead = d?['lead'] as Map<String, dynamic>?;
    final wa = d?['channel'] == 'whatsapp';
    final accent = wa ? SniperColors.whatsapp : SniperColors.primary;
    final title = (lead?['name'] as String?)?.isNotEmpty == true ? lead!['name'] as String : (lead?['contact'] as String? ?? 'Conversation');
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: lead == null
            ? const Text('Conversation')
            : Row(children: [
                InitialsAvatar(name: title, color: accent, size: 36),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600), overflow: TextOverflow.ellipsis),
                    Text(
                      [if ((lead['company'] as String).isNotEmpty) lead['company'], lead['contact']].join(' · '),
                      style: TextStyle(fontSize: 12, color: muted(context)),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ]),
                ),
              ]),
        actions: [
          if (lead != null)
            PopupMenuButton<String>(
              onSelected: (v) {
                if (v == 'label') _pickLabel();
                if (v == 'unread') _markUnread();
                if (v == 'copy') {
                  Clipboard.setData(ClipboardData(text: lead['contact'] as String));
                  ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Copied')));
                }
              },
              itemBuilder: (_) => [
                if ((lead['label'] as String? ?? '').isNotEmpty) const PopupMenuItem(value: 'label', child: ListTile(dense: true, contentPadding: EdgeInsets.zero, leading: Icon(Icons.label_outline), title: Text('Change label'))),
                if ((lead['label'] as String? ?? '').isNotEmpty) const PopupMenuItem(value: 'unread', child: ListTile(dense: true, contentPadding: EdgeInsets.zero, leading: Icon(Icons.mark_email_unread_outlined), title: Text('Mark as unread'))),
                const PopupMenuItem(value: 'copy', child: ListTile(dense: true, contentPadding: EdgeInsets.zero, leading: Icon(Icons.copy_rounded), title: Text('Copy address'))),
              ],
            ),
        ],
      ),
      body: _error != null && d == null
          ? MessageView(icon: Icons.error_outline, title: 'Couldn’t open this conversation', text: _error, onRetry: _load)
          : d == null
              ? const Center(child: CircularProgressIndicator())
              : Column(children: [
                  _header(d, accent),
                  Expanded(
                    child: RefreshIndicator(
                      onRefresh: _load,
                      child: ListView(
                        controller: _scroll,
                        padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
                        children: [
                          if (d['warning'] != null)
                            Padding(padding: const EdgeInsets.all(8), child: Text(d['warning'] as String, style: const TextStyle(color: SniperColors.warning))),
                          if ((d['messages'] as List).isEmpty)
                            Padding(padding: const EdgeInsets.all(24), child: Text('No messages to show yet.', textAlign: TextAlign.center, style: TextStyle(color: faint(context)))),
                          for (final m in (d['messages'] as List).cast<Map<String, dynamic>>()) _MessageBubble(m: m, accent: accent),
                        ],
                      ),
                    ),
                  ),
                  _composer(accent, wa),
                ]),
    );
  }

  Widget _header(Map<String, dynamic> d, Color accent) {
    final lead = d['lead'] as Map<String, dynamic>;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
      decoration: BoxDecoration(border: Border(bottom: BorderSide(color: Theme.of(context).dividerColor))),
      child: Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
        if ((lead['label'] as String? ?? '').isNotEmpty)
          InkWell(
            borderRadius: BorderRadius.circular(20),
            onTap: _pickLabel,
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              LabelPill(lead['label'] as String?),
              Icon(Icons.arrow_drop_down, size: 18, color: faint(context)),
            ]),
          )
        else
          StatusPill(lead['status'] as String),
        if ((d['campaign'] as String).isNotEmpty) Text(d['campaign'] as String, style: TextStyle(fontSize: 12, color: muted(context))),
        if ((d['sender'] as String).isNotEmpty) Text('via ${d['sender']}', style: TextStyle(fontSize: 12, color: faint(context))),
      ]),
    );
  }

  Widget _composer(Color accent, bool wa) {
    return Material(
      color: Theme.of(context).colorScheme.surface,
      elevation: 8,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            if (_quick.isNotEmpty)
              SizedBox(
                height: 36,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: _quick.length,
                  separatorBuilder: (_, _) => const SizedBox(width: 6),
                  itemBuilder: (_, i) {
                    final text = QuickReplies.fill(_quick[i], _firstName);
                    return ActionChip(
                      avatar: Icon(Icons.bolt_rounded, size: 16, color: accent),
                      label: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 220), child: Text(text, overflow: TextOverflow.ellipsis)),
                      onPressed: () {
                        _reply.text = text;
                        _reply.selection = TextSelection.collapsed(offset: text.length);
                      },
                    );
                  },
                ),
              ),
            const SizedBox(height: 8),
            Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Expanded(
                child: TextField(
                  controller: _reply,
                  minLines: 1,
                  maxLines: 6,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: InputDecoration(hintText: wa ? 'Message on WhatsApp…' : 'Write a reply…', isDense: true),
                ),
              ),
              const SizedBox(width: 8),
              IconButton.filled(
                style: IconButton.styleFrom(backgroundColor: accent, minimumSize: const Size(46, 46)),
                onPressed: _sending ? null : _send,
                icon: _sending ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.send_rounded, color: Colors.white),
              ),
            ]),
          ]),
        ),
      ),
    );
  }
}

class _MessageBubble extends StatefulWidget {
  const _MessageBubble({required this.m, required this.accent});
  final Map<String, dynamic> m;
  final Color accent;

  @override
  State<_MessageBubble> createState() => _MessageBubbleState();
}

class _MessageBubbleState extends State<_MessageBubble> {
  bool _showQuoted = false;

  @override
  Widget build(BuildContext context) {
    final m = widget.m;
    final mine = m['fromMe'] == true;
    final scheme = Theme.of(context).colorScheme;
    final bg = mine ? widget.accent.withValues(alpha: Theme.of(context).brightness == Brightness.dark ? 0.22 : 0.09) : scheme.surface;
    final quoted = m['quoted'] as String?;
    final from = (m['from'] as String? ?? '').replaceAll(RegExp(r'<.*?>'), '').replaceAll('"', '').trim();
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 5),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.86),
        padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(14),
            topRight: const Radius.circular(14),
            bottomLeft: Radius.circular(mine ? 14 : 4),
            bottomRight: Radius.circular(mine ? 4 : 14),
          ),
          border: Border.all(color: mine ? Colors.transparent : Theme.of(context).dividerColor),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(mainAxisSize: MainAxisSize.min, children: [
            Flexible(child: Text(mine ? 'You' : (from.isEmpty ? 'Them' : from), style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: mine ? widget.accent : muted(context)), overflow: TextOverflow.ellipsis)),
            const SizedBox(width: 8),
            Text(fullDate(m['date'] as num), style: TextStyle(fontSize: 11, color: faint(context))),
          ]),
          if ((m['subject'] as String? ?? '').isNotEmpty && !mine) ...[
            const SizedBox(height: 4),
            Text(m['subject'] as String, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
          ],
          const SizedBox(height: 6),
          SelectableText((m['text'] as String?)?.isNotEmpty == true ? m['text'] as String : '(no text)', style: const TextStyle(fontSize: 14.5, height: 1.4)),
          if (quoted != null && quoted.isNotEmpty) ...[
            const SizedBox(height: 6),
            InkWell(
              onTap: () => setState(() => _showQuoted = !_showQuoted),
              child: Text(_showQuoted ? 'Hide earlier messages' : '• • •  Show earlier messages', style: TextStyle(fontSize: 12, color: faint(context))),
            ),
            if (_showQuoted) Padding(padding: const EdgeInsets.only(top: 6), child: Text(quoted, style: TextStyle(fontSize: 12.5, color: muted(context), height: 1.35))),
          ],
        ]),
      ),
    );
  }
}
