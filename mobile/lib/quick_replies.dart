import 'package:shared_preferences/shared_preferences.dart';

/// Saved one-tap replies. `{first_name}` is replaced with the lead's first name.
class QuickReplies {
  static const _key = 'quick_replies';

  static const defaults = [
    'Thanks for getting back to me, {first_name}! Would you have 15 minutes this week for a quick call?',
    'Great to hear from you, {first_name}. What day and time works best for you?',
    'Happy to share more details — what\'s the best number to reach you on?',
    'Totally understand, thanks for letting me know. I won\'t follow up again.',
  ];

  static Future<List<String>> load() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getStringList(_key) ?? List.of(defaults);
  }

  static Future<void> save(List<String> items) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setStringList(_key, items);
  }

  static String fill(String template, String firstName) =>
      template.replaceAll('{first_name}', firstName.isEmpty ? 'there' : firstName);
}
