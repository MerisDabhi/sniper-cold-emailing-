import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../labels.dart';
import '../theme.dart';
import '../widgets.dart';
import 'thread.dart';

/// Conversations: people who replied (labelled automatically), and everyone you've contacted.
class InboxScreen extends StatefulWidget {
  const InboxScreen({super.key, this.onChanged});

  /// Called when something was read or relabelled, so the unread badge can update.
  final VoidCallback? onChanged;

  @override
  State<InboxScreen> createState() => InboxScreenState();
}

class InboxScreenState extends State<InboxScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(length: 2, vsync: this)..addListener(_onTab);
  final _lists = [GlobalKey<_ConversationListState>(), GlobalKey<_ConversationListState>()];
  final _search = TextEditingController();
  Timer? _debounce;
  Timer? _live;

  @override
  void initState() {
    super.initState();
    // Keep the list live while the app is open.
    _live = Timer.periodic(const Duration(seconds: 20), (_) => _lists[0].currentState?.reload(quiet: true));
  }

  void _onTab() {
    if (!_tabs.indexIsChanging) setState(() {});
  }

  /// Reload both lists (e.g. after a new reply notification).
  void refresh() {
    for (final k in _lists) {
      k.currentState?.reload(quiet: true);
    }
  }

  @override
  void dispose() {
    _tabs.dispose();
    _debounce?.cancel();
    _live?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Inbox'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(108),
          child: Column(children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: TextField(
                controller: _search,
                textInputAction: TextInputAction.search,
                decoration: InputDecoration(
                  hintText: 'Search name, company, email…',
                  prefixIcon: const Icon(Icons.search),
                  isDense: true,
                  suffixIcon: _search.text.isEmpty
                      ? null
                      : IconButton(
                          icon: const Icon(Icons.close),
                          onPressed: () {
                            _search.clear();
                            refresh();
                            setState(() {});
                          }),
                ),
                onChanged: (_) {
                  setState(() {});
                  _debounce?.cancel();
                  _debounce = Timer(const Duration(milliseconds: 400), refresh);
                },
              ),
            ),
            TabBar(controller: _tabs, tabs: const [Tab(text: 'Replies'), Tab(text: 'Sent')]),
          ]),
        ),
      ),
      body: TabBarView(controller: _tabs, children: [
        _ConversationList(key: _lists[0], filter: 'replies', query: () => _search.text, onChanged: widget.onChanged),
        _ConversationList(key: _lists[1], filter: 'sent', query: () => _search.text, onChanged: widget.onChanged),
      ]),
    );
  }
}

class _ConversationList extends StatefulWidget {
  const _ConversationList({super.key, required this.filter, required this.query, this.onChanged});
  final String filter;
  final String Function() query;
  final VoidCallback? onChanged;

  @override
  State<_ConversationList> createState() => _ConversationListState();
}

class _ConversationListState extends State<_ConversationList> with AutomaticKeepAliveClientMixin {
  final List<Map<String, dynamic>> _items = [];
  Map<String, dynamic> _counts = {};
  String _label = '';
  int _page = 1;
  int _pages = 1;
  bool _loading = false;
  bool _loaded = false;
  String? _error;
  final _scroll = ScrollController();

  bool get _replies => widget.filter == 'replies';

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(() {
      if (_scroll.position.pixels > _scroll.position.maxScrollExtent - 300) _more();
    });
    reload();
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  /// [quiet] refreshes in place without a spinner (used by the live refresh).
  Future<void> reload({bool quiet = false}) async {
    if (quiet && (_loading || _page > 1)) return;
    _page = 1;
    await _fetch(replace: true, quiet: quiet);
  }

  Future<void> _more() async {
    if (_loading || _page >= _pages) return;
    _page++;
    await _fetch();
  }

  Future<void> _fetch({bool replace = false, bool quiet = false}) async {
    if (!quiet) setState(() => _loading = true);
    try {
      final d = await Api.instance.conversations(filter: widget.filter, q: widget.query(), page: _page, label: _replies ? _label : '');
      final list = (d['conversations'] as List).cast<Map<String, dynamic>>();
      if (!mounted) return;
      setState(() {
        if (replace) _items.clear();
        _items.addAll(list);
        _pages = (d['pages'] as num).toInt();
        _counts = (d['counts'] as Map?)?.cast<String, dynamic>() ?? {};
        _error = null;
        _loaded = true;
      });
    } catch (e) {
      if (mounted && !quiet) setState(() => _error = errorText(context, e));
    } finally {
      if (mounted && !quiet) setState(() => _loading = false);
    }
  }

  void _pick(String label) {
    if (_label == label) return;
    setState(() {
      _label = label;
      _items.clear();
      _loaded = false;
    });
    reload();
  }

  Widget _chips() {
    Widget chip(String key, String name, Color color) {
      final on = _label == key;
      final n = (_counts[key.isEmpty ? 'all' : key] as num?)?.toInt() ?? 0;
      return Padding(
        padding: const EdgeInsets.only(right: 8),
        child: FilterChip(
          selected: on,
          showCheckmark: false,
          visualDensity: VisualDensity.compact,
          label: Text('$name  $n'),
          labelStyle: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: on ? color : muted(context)),
          selectedColor: color.withValues(alpha: 0.14),
          side: BorderSide(color: on ? color.withValues(alpha: 0.5) : Theme.of(context).dividerColor),
          onSelected: (_) => _pick(key),
        ),
      );
    }

    return SizedBox(
      height: 50,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(16, 8, 8, 6),
        children: [
          chip('', 'All', SniperColors.primary),
          for (final l in ReplyLabels.all)
            if (((_counts[l.key] as num?) ?? 0) > 0 || _label == l.key) chip(l.key, l.name, l.color),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return Column(children: [
      if (_replies && _loaded) _chips(),
      Expanded(child: _body()),
    ]);
  }

  Widget _body() {
    if (_error != null && _items.isEmpty) {
      return MessageView(icon: Icons.cloud_off_outlined, title: 'Couldn’t load conversations', text: _error, onRetry: reload);
    }
    if (_items.isEmpty) {
      return _loading || !_loaded
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: reload,
              child: ListView(children: [
                const SizedBox(height: 80),
                MessageView(
                  icon: _replies ? Icons.mark_email_unread_outlined : Icons.outbox_outlined,
                  title: _replies ? (_label.isEmpty ? 'No replies yet' : 'Nothing with this label') : 'Nothing sent yet',
                  text: _replies ? 'When a lead answers, it shows up here and on your phone as a notification.' : 'Emails and messages appear here once a campaign starts sending.',
                ),
              ]),
            );
    }
    return RefreshIndicator(
      onRefresh: reload,
      child: ListView.separated(
        controller: _scroll,
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(bottom: 24),
        itemCount: _items.length + (_page < _pages ? 1 : 0),
        separatorBuilder: (_, _) => const Divider(height: 1, indent: 72),
        itemBuilder: (context, i) {
          if (i >= _items.length) return const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()));
          return _tile(_items[i]);
        },
      ),
    );
  }

  Widget _tile(Map<String, dynamic> c) {
    final replied = c['repliedAt'] != null;
    final unread = c['unread'] == true;
    final name = (c['name'] as String?)?.isNotEmpty == true ? c['name'] as String : c['contact'] as String;
    final wa = c['channel'] == 'whatsapp';
    final when = replied && _replies ? (c['lastReplyAt'] ?? c['repliedAt']) : c['lastSentAt'];
    final line2 = [if ((c['company'] as String).isNotEmpty) c['company'], c['campaign']].where((x) => (x as String).isNotEmpty).join(' · ');
    final preview = replied && (c['preview'] as String).isNotEmpty
        ? cleanPreview(c['preview'] as String)
        : (c['subject'] as String).isNotEmpty
            ? c['subject'] as String
            : 'Step ${c['step']} sent';
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
      tileColor: unread ? SniperColors.primary.withValues(alpha: 0.04) : null,
      leading: Stack(clipBehavior: Clip.none, children: [
        InitialsAvatar(name: name, color: wa ? SniperColors.whatsapp : SniperColors.primary),
        Positioned(
          right: -2,
          bottom: -2,
          child: Container(
            padding: const EdgeInsets.all(2.5),
            decoration: BoxDecoration(color: Theme.of(context).scaffoldBackgroundColor, shape: BoxShape.circle),
            child: Icon(wa ? Icons.chat : Icons.mail, size: 12, color: wa ? SniperColors.whatsapp : SniperColors.primary),
          ),
        ),
      ]),
      title: Row(children: [
        Expanded(
          child: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: unread ? FontWeight.w700 : FontWeight.w600)),
        ),
        Text(timeAgo(when as num?), style: TextStyle(fontSize: 12, color: unread ? SniperColors.primary : faint(context), fontWeight: unread ? FontWeight.w600 : null)),
      ]),
      subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (line2.isNotEmpty) Text(line2, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, color: faint(context))),
        const SizedBox(height: 2),
        Text(
          preview,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(color: unread ? Theme.of(context).colorScheme.onSurface : muted(context), fontWeight: unread ? FontWeight.w500 : null),
        ),
        const SizedBox(height: 6),
        Row(children: [
          if (replied) LabelPill(c['label'] as String?, dense: true) else StatusPill(c['status'] as String),
          const Spacer(),
          if (unread) Container(width: 9, height: 9, decoration: const BoxDecoration(color: SniperColors.primary, shape: BoxShape.circle)),
        ]),
      ]),
      onTap: () async {
        setState(() => c['unread'] = false);
        await Navigator.of(context).push(MaterialPageRoute(builder: (_) => ThreadScreen(leadId: c['id'] as String)));
        if (!mounted) return;
        widget.onChanged?.call();
        reload(quiet: true);
      },
    );
  }
}
