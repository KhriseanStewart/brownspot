import 'package:flutter/material.dart';

import 'screens/auth_screen.dart';
import 'screens/main_shell.dart';

void main() {
  runApp(const BrownDotApp());
}

class BrownDotApp extends StatelessWidget {
  const BrownDotApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'BrownDot',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF8B5A2B),
          brightness: Brightness.light,
        ),
        useMaterial3: true,
      ),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF8B5A2B),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
      ),
      initialRoute: AuthScreen.routeName,
      routes: {
        AuthScreen.routeName: (_) => const AuthScreen(),
        MainShell.routeName: (_) => const MainShell(),
      },
    );
  }
}
