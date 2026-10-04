import 'package:flutter/material.dart';

import 'theme.dart';

/// A conversation label: set automatically from the reply text, changeable by hand.
class ReplyLabel {
  const ReplyLabel(this.key, this.name, this.color, this.icon);
  final String key;
  final String name;
  final Color color;
  final IconData icon;
}

class ReplyLabels {
  static const all = [
    ReplyLabel('interested', 'Interested', SniperColors.success, Icons.thumb_up_alt_outlined),
    ReplyLabel('meeting_booked', 'Meeting booked', SniperColors.primary, Icons.event_available_outlined),
    ReplyLabel('not_interested', 'Not interested', SniperColors.danger, Icons.thumb_down_alt_outlined),
    ReplyLabel('out_of_office', 'Out of office', SniperColors.warning, Icons.beach_access_outlined),
    ReplyLabel('auto_reply', 'Auto-reply', Colors.grey, Icons.smart_toy_outlined),
    ReplyLabel('wrong_person', 'Wrong person', SniperColors.violet, Icons.person_off_outlined),
    ReplyLabel('replied', 'Replied', Colors.blueGrey, Icons.reply_rounded),
  ];

  static ReplyLabel of(String? key) => all.firstWhere((l) => l.key == key, orElse: () => all.last);
}

/// Coloured pill for a conversation label.
class LabelPill extends StatelessWidget {
  const LabelPill(this.label, {super.key, this.dense = false});
  final String? label;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final l = ReplyLabels.of(label);
    return Container(
      padding: EdgeInsets.symmetric(horizontal: dense ? 7 : 9, vertical: dense ? 2 : 4),
      decoration: BoxDecoration(color: l.color.withValues(alpha: 0.13), borderRadius: BorderRadius.circular(20)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(l.icon, size: dense ? 11 : 13, color: l.color),
        const SizedBox(width: 4),
        Text(l.name, style: TextStyle(color: l.color, fontSize: dense ? 11 : 12, fontWeight: FontWeight.w600)),
      ]),
    );
  }
}
