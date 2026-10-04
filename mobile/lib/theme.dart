import 'package:flutter/material.dart';

/// Colors shared with the web app.
class SniperColors {
  static const primary = Color(0xFF3B5BFD);
  static const whatsapp = Color(0xFF14A44D);
  static const success = Color(0xFF12A36A);
  static const warning = Color(0xFFD98A00);
  static const danger = Color(0xFFE5484D);
  static const violet = Color(0xFF8B5CF6);
}

ThemeData buildTheme(Brightness brightness) {
  final dark = brightness == Brightness.dark;
  final scheme = ColorScheme.fromSeed(
    seedColor: SniperColors.primary,
    brightness: brightness,
    primary: dark ? const Color(0xFF5B78FF) : SniperColors.primary,
    surface: dark ? const Color(0xFF111419) : Colors.white,
  );
  final bg = dark ? const Color(0xFF0A0C10) : const Color(0xFFF7F8FA);
  final border = dark ? const Color(0xFF22272F) : const Color(0xFFE6E8EC);
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: bg,
    dividerColor: border,
    appBarTheme: AppBarTheme(
      backgroundColor: bg,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      titleTextStyle: TextStyle(fontSize: 20, fontWeight: FontWeight.w600, color: scheme.onSurface),
    ),
    cardTheme: CardThemeData(
      color: scheme.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: BorderSide(color: border)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: scheme.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: border)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: border)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: scheme.primary, width: 1.5)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 46),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        textStyle: const TextStyle(fontWeight: FontWeight.w600),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: scheme.surface,
      indicatorColor: scheme.primary.withValues(alpha: 0.12),
      surfaceTintColor: Colors.transparent,
    ),
    chipTheme: ChipThemeData(shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8))),
  );
}

/// Subtle text color for secondary information.
Color muted(BuildContext context) => Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.6);
Color faint(BuildContext context) => Theme.of(context).colorScheme.onSurface.withValues(alpha: 0.42);
