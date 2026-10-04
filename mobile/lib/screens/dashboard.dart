import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../api.dart';
import '../theme.dart';
import '../widgets.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  String _channel = 'all';
  Map<String, dynamic>? _data;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await Api.instance.analytics(channel: _channel == 'all' ? null : _channel);
      if (mounted) setState(() => (_data = d, _error = null));
    } catch (e) {
      if (mounted) setState(() => _error = errorText(context, e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final d = _data;
    return Scaffold(
      appBar: AppBar(
        title: const Row(children: [SniperLogo(size: 28), SizedBox(width: 10), Text('Analytics')]),
        actions: [IconButton(onPressed: _load, icon: const Icon(Icons.refresh))],
      ),
      body: _error != null && d == null
          ? MessageView(icon: Icons.cloud_off_outlined, title: 'Couldn’t load analytics', text: _error, onRetry: _load)
          : d == null
              ? const Center(child: CircularProgressIndicator())
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                    children: [
                      SegmentedButton<String>(
                        segments: const [
                          ButtonSegment(value: 'all', label: Text('All')),
                          ButtonSegment(value: 'email', label: Text('Email')),
                          ButtonSegment(value: 'whatsapp', label: Text('WhatsApp', maxLines: 1, softWrap: false)),
                        ],
                        selected: {_channel},
                        showSelectedIcon: false,
                        onSelectionChanged: (s) {
                          setState(() => _channel = s.first);
                          _load();
                        },
                      ),
                      const SizedBox(height: 16),
                      _stats(d),
                      const SizedBox(height: 16),
                      _chart(d),
                      const SizedBox(height: 16),
                      _senders(d),
                    ],
                  ),
                ),
    );
  }

  Widget _stats(Map<String, dynamic> d) {
    final t = d['totals'] as Map<String, dynamic>;
    final wa = _channel == 'whatsapp';
    final items = [
      ('Sent', fmt(t['sent']), '${fmt(d['sentToday'])} in 24h', Icons.send_rounded, SniperColors.primary),
      ('Replies', fmt(t['replied']), '${t['replyRate']}% reply rate', Icons.reply_rounded, SniperColors.success),
      ('Contacted', fmt(t['contacted']), 'of ${fmt(t['leads'])} leads', Icons.people_alt_outlined, SniperColors.violet),
      (wa ? 'Not on WhatsApp' : 'Bounced', fmt(t['bounced']), '${t['bounceRate']}%', Icons.undo_rounded, SniperColors.danger),
      ('Unsubscribed', fmt(t['unsubscribed']), '${t['unsubRate']}%', Icons.unsubscribe_outlined, SniperColors.warning),
      if (!wa) ('Opens', fmt(t['opened']), '${t['openRate']}% open rate', Icons.visibility_outlined, SniperColors.violet),
    ];
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 10,
      crossAxisSpacing: 10,
      childAspectRatio: 1.55,
      children: [
        for (final (label, value, sub, icon, color) in items)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(children: [
                    Expanded(child: Text(label, style: TextStyle(color: muted(context), fontSize: 13, fontWeight: FontWeight.w500))),
                    Container(
                      padding: const EdgeInsets.all(5),
                      decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(8)),
                      child: Icon(icon, size: 14, color: color),
                    ),
                  ]),
                  Text(value, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w700, height: 1)),
                  Text(sub, style: TextStyle(color: faint(context), fontSize: 12), maxLines: 1, overflow: TextOverflow.ellipsis),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _chart(Map<String, dynamic> d) {
    final days = (d['daily'] as List).cast<Map<String, dynamic>>();
    final sent = [for (var i = 0; i < days.length; i++) FlSpot(i.toDouble(), (days[i]['sent'] as num).toDouble())];
    final replies = [for (var i = 0; i < days.length; i++) FlSpot(i.toDouble(), (days[i]['replies'] as num).toDouble())];
    final maxY = [...sent, ...replies].fold<double>(0, (m, s) => s.y > m ? s.y : m);
    LineChartBarData line(List<FlSpot> spots, Color c) => LineChartBarData(
          spots: spots,
          isCurved: true,
          preventCurveOverShooting: true,
          color: c,
          barWidth: 2.5,
          dotData: const FlDotData(show: false),
          belowBarData: BarAreaData(show: true, color: c.withValues(alpha: 0.12)),
        );
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 14, 18, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              const Expanded(child: Text('Last 30 days', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 15))),
              _legend('Sent', SniperColors.primary),
              const SizedBox(width: 12),
              _legend('Replies', SniperColors.success),
            ]),
            const SizedBox(height: 16),
            SizedBox(
              height: 180,
              child: LineChart(LineChartData(
                minY: 0,
                maxY: maxY < 4 ? 4 : maxY * 1.15,
                gridData: FlGridData(
                  drawVerticalLine: false,
                  getDrawingHorizontalLine: (_) => FlLine(color: Theme.of(context).dividerColor, strokeWidth: 1),
                ),
                borderData: FlBorderData(show: false),
                titlesData: FlTitlesData(
                  topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                  leftTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      reservedSize: 28,
                      getTitlesWidget: (v, meta) => v % 1 == 0 ? Text(v.toInt().toString(), style: TextStyle(fontSize: 10, color: faint(context))) : const SizedBox(),
                    ),
                  ),
                  bottomTitles: AxisTitles(
                    sideTitles: SideTitles(
                      showTitles: true,
                      reservedSize: 22,
                      interval: 1,
                      getTitlesWidget: (v, meta) {
                        final i = v.toInt();
                        // A label every 7 days, plus today — skipping any that would collide with today's.
                        final last = days.length - 1;
                        final show = i == last || (i % 7 == 0 && last - i >= 4);
                        if (i < 0 || i >= days.length || !show) return const SizedBox();
                        return Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Text(days[i]['label'] as String, style: TextStyle(fontSize: 10, color: faint(context))),
                        );
                      },
                    ),
                  ),
                ),
                lineBarsData: [line(sent, SniperColors.primary), line(replies, SniperColors.success)],
              )),
            ),
          ],
        ),
      ),
    );
  }

  Widget _legend(String label, Color c) => Row(children: [
        Container(width: 8, height: 8, decoration: BoxDecoration(color: c, shape: BoxShape.circle)),
        const SizedBox(width: 5),
        Text(label, style: TextStyle(fontSize: 12, color: muted(context))),
      ]);

  Widget _senders(Map<String, dynamic> d) {
    final senders = (d['accounts'] as List).cast<Map<String, dynamic>>();
    return Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 4),
            child: Row(children: [
              const Expanded(child: Text('Senders', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 15))),
              Text('${fmt(d['sentToday'])} / ${fmt(d['capacity'])} today', style: TextStyle(fontSize: 12, color: muted(context))),
            ]),
          ),
          if (senders.isEmpty) Padding(padding: const EdgeInsets.all(14), child: Text('No senders connected.', style: TextStyle(color: faint(context)))),
          for (final s in senders)
            ListTile(
              dense: true,
              leading: ChannelIcon(channel: s['channel'] as String? ?? 'email', size: 32),
              title: Text(s['email'] as String? ?? '', maxLines: 1, overflow: TextOverflow.ellipsis),
              subtitle: Padding(
                padding: const EdgeInsets.only(top: 6),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: ((s['sentToday'] as num) / ((s['dailyLimit'] as num?) ?? 1).clamp(1, 100000)).clamp(0, 1).toDouble(),
                    minHeight: 5,
                    color: s['channel'] == 'whatsapp' ? SniperColors.whatsapp : SniperColors.primary,
                    backgroundColor: Theme.of(context).dividerColor,
                  ),
                ),
              ),
              trailing: Text('${s['sentToday']}/${s['dailyLimit']}', style: TextStyle(color: muted(context), fontSize: 12)),
            ),
          const SizedBox(height: 6),
        ],
      ),
    );
  }
}
