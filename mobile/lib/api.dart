import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

/// Thrown when the server says the session is no longer valid.
class UnauthorizedException implements Exception {
  @override
  String toString() => 'Your session expired. Please sign in again.';
}

class ApiException implements Exception {
  ApiException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// Talks to Sniper's cloud API (a Supabase Edge Function), so the app works anywhere —
/// no laptop or cable needed. This address is public; it holds no secrets. Signing in with
/// your Sniper username and password gives the app a token, kept in the phone's secure storage.
class Api {
  Api._();
  static final Api instance = Api._();

  static const baseUrl = 'https://tdyrsekoicnmiytyulzn.supabase.co/functions/v1/mobile';
  static const _tokenKey = 'session_token';

  final _secure = const FlutterSecureStorage();
  String? _token;

  Future<void> load() async {
    _token = await _secure.read(key: _tokenKey);
  }

  String get server => 'Sniper Cloud';
  bool get signedIn => _token != null && _token!.isNotEmpty;

  Future<void> signOut() async {
    _token = null;
    await _secure.delete(key: _tokenKey);
  }

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        if (_token != null) 'Authorization': 'Bearer $_token',
      };

  Uri _uri(String path, [Map<String, String>? query]) => Uri.parse('$baseUrl$path').replace(queryParameters: query);

  Future<Map<String, dynamic>> _decode(http.Response res) async {
    if (res.statusCode == 401) {
      await signOut();
      throw UnauthorizedException();
    }
    Map<String, dynamic> body;
    try {
      body = jsonDecode(res.body) as Map<String, dynamic>;
    } catch (_) {
      throw ApiException('Unexpected response from Sniper (${res.statusCode}).');
    }
    if (res.statusCode >= 400) throw ApiException(body['error']?.toString() ?? 'Request failed (${res.statusCode})');
    return body;
  }

  Future<Map<String, dynamic>> get(String path, [Map<String, String>? query]) async {
    final res = await http.get(_uri(path, query), headers: _headers).timeout(const Duration(seconds: 40));
    return _decode(res);
  }

  Future<Map<String, dynamic>> post(String path, Map<String, dynamic> body, {Duration timeout = const Duration(seconds: 40)}) async {
    final res = await http.post(_uri(path), headers: _headers, body: jsonEncode(body)).timeout(timeout);
    return _decode(res);
  }

  /// Sign in with the same username and password as the web app.
  Future<void> signIn(String username, String password) async {
    final res = await http
        .post(_uri('/login'), headers: {'Content-Type': 'application/json'}, body: jsonEncode({'username': username, 'password': password}))
        .timeout(const Duration(seconds: 40));
    Map<String, dynamic> body = {};
    try {
      body = jsonDecode(res.body) as Map<String, dynamic>;
    } catch (_) {}
    if (res.statusCode != 200 || body['token'] == null) {
      throw ApiException(body['error']?.toString() ?? 'Sign-in failed (${res.statusCode})');
    }
    _token = body['token'] as String;
    await _secure.write(key: _tokenKey, value: _token);
  }

  // ─── Endpoints ──────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> analytics({String? channel}) => get('/analytics', {
        'tz': _ianaTimezoneGuess(),
        'channel': ?channel,
      });

  Future<Map<String, dynamic>> conversations({required String filter, String q = '', int page = 1, String label = ''}) =>
      get('/conversations', {'filter': filter, 'q': q, 'page': '$page', if (label.isNotEmpty) 'label': label});

  /// Set a conversation's label by hand ('' hands it back to automatic labelling).
  Future<void> setLabel(String leadId, String label) => post('/thread/$leadId/label', {'label': label});

  Future<void> setRead(String leadId, bool read) => post('/thread/$leadId/read', {'read': read});

  Future<Map<String, dynamic>> thread(String leadId) => get('/thread/$leadId');

  Future<void> reply(String leadId, String text) => post('/thread/$leadId/reply', {'text': text}, timeout: const Duration(seconds: 75));

  Future<Map<String, dynamic>> notifications(int since) => get('/notifications', {'since': '$since'});

  Future<Map<String, dynamic>> me() => get('/me');
}

/// Dart can't read the device's IANA timezone without a plugin; derive one from the UTC offset
/// (good enough for bucketing chart days).
String _ianaTimezoneGuess() {
  final offset = DateTime.now().timeZoneOffset;
  const known = {330: 'Asia/Kolkata', 0: 'UTC', 60: 'Europe/Paris', 120: 'Europe/Athens', 240: 'Asia/Dubai', 480: 'Asia/Singapore', -300: 'America/New_York', -480: 'America/Los_Angeles'};
  final name = known[offset.inMinutes];
  if (name != null) return name;
  final h = offset.inHours;
  // Etc/GMT zones use the inverted sign.
  return h == 0 ? 'UTC' : 'Etc/GMT${h > 0 ? '-' : '+'}${h.abs()}';
}
