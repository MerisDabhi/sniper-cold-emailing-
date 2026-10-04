import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import 'api.dart';
import 'screens/login.dart';
import 'theme.dart';

/// Back to the sign-in screen (session expired or signed out).
void goToLogin(BuildContext context) {
  Navigator.of(context, rootNavigator: true).pushAndRemoveUntil(MaterialPageRoute(builder: (_) => const LoginScreen()), (_) => false);
}

/// Turn an error into a short message; sends the user to sign in if the session expired.
String errorText(BuildContext context, Object e) {
  if (e is UnauthorizedException) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (context.mounted) goToLogin(context);
    });
    return e.toString();
  }
  if (e is ApiException) return e.message;
  return "Can't reach Sniper right now. Check your internet connection and try again.";
}

/// The Sniper crosshair mark.
class SniperLogo extends StatelessWidget {
  const SniperLogo({super.key, this.size = 32});
  final double size;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(size * 0.25),
      child: Image.asset('assets/logo.png', width: size, height: size, filterQuality: FilterQuality.medium),
    );
  }
}

/// Reply snippets arrive HTML-escaped and with the quoted original attached — tidy them for lists.
String cleanPreview(String text) => text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&')
    .replaceFirst(RegExp(r'\s+On (Mon|Tue|Wed|Thu|Fri|Sat|Sun|\d|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[\s\S]*$'), '')
    .trim();

String timeAgo(num? ms) {
  if (ms == null || ms == 0) return '';
  final d = DateTime.now().difference(DateTime.fromMillisecondsSinceEpoch(ms.toInt()));
  if (d.isNegative) {
    final f = -d.inMinutes;
    if (f < 60) return 'in ${f}m';
    if (f < 1440) return 'in ${f ~/ 60}h';
    return 'in ${f ~/ 1440}d';
  }
  if (d.inSeconds < 60) return 'now';
  if (d.inMinutes < 60) return '${d.inMinutes}m';
  if (d.inHours < 24) return '${d.inHours}h';
  if (d.inDays < 7) return '${d.inDays}d';
  return DateFormat('d MMM').format(DateTime.fromMillisecondsSinceEpoch(ms.toInt()));
}

String fullDate(num ms) => DateFormat('EEE d MMM, h:mm a').format(DateTime.fromMillisecondsSinceEpoch(ms.toInt()));

final _number = NumberFormat.decimalPattern();
String fmt(num? n) => _number.format(n ?? 0);

class ChannelIcon extends StatelessWidget {
  const ChannelIcon({super.key, required this.channel, this.size = 36});
  final String channel;
  final double size;

  @override
  Widget build(BuildContext context) {
    final wa = channel == 'whatsapp';
    final color = wa ? SniperColors.whatsapp : SniperColors.primary;
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(size * 0.3)),
      child: Icon(wa ? Icons.chat_outlined : Icons.mail_outline, color: color, size: size * 0.5),
    );
  }
}

/// Coloured pill for a lead's status.
class StatusPill extends StatelessWidget {
  const StatusPill(this.status, {super.key});
  final String status;

  static const _labels = {
    'pending': 'Queued',
    'in_progress': 'In sequence',
    'completed': 'Finished',
    'replied': 'Replied',
    'bounced': 'Bounced',
    'unsubscribed': 'Unsubscribed',
    'failed': 'Failed',
    'duplicate': 'Already contacted',
  };

  Color _color() {
    switch (status) {
      case 'replied':
        return SniperColors.success;
      case 'in_progress':
        return SniperColors.primary;
      case 'bounced':
      case 'failed':
        return SniperColors.danger;
      case 'unsubscribed':
        return SniperColors.warning;
      case 'duplicate':
        return SniperColors.violet;
      default:
        return Colors.grey;
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = _color();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: c.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
      child: Text(_labels[status] ?? status, style: TextStyle(color: c, fontSize: 11.5, fontWeight: FontWeight.w600)),
    );
  }
}

/// Full-screen message with a retry button.
class MessageView extends StatelessWidget {
  const MessageView({super.key, required this.icon, required this.title, this.text, this.onRetry});
  final IconData icon;
  final String title;
  final String? text;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 40, color: faint(context)),
            const SizedBox(height: 12),
            Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600), textAlign: TextAlign.center),
            if (text != null) ...[
              const SizedBox(height: 6),
              Text(text!, style: TextStyle(color: muted(context)), textAlign: TextAlign.center),
            ],
            if (onRetry != null) ...[
              const SizedBox(height: 16),
              OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Try again')),
            ],
          ],
        ),
      ),
    );
  }
}

/// Initials avatar for a lead.
class InitialsAvatar extends StatelessWidget {
  const InitialsAvatar({super.key, required this.name, this.color = SniperColors.primary, this.size = 40});
  final String name;
  final Color color;
  final double size;

  @override
  Widget build(BuildContext context) {
    final parts = name.split(RegExp(r'[\s@.]+')).where((p) => p.isNotEmpty).take(2);
    final initials = parts.map((p) => p[0].toUpperCase()).join();
    return CircleAvatar(
      radius: size / 2,
      backgroundColor: color.withValues(alpha: 0.14),
      child: Text(initials.isEmpty ? '?' : initials, style: TextStyle(color: color, fontWeight: FontWeight.w700, fontSize: size * 0.36)),
    );
  }
}
