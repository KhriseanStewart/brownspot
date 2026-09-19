import 'package:flutter/material.dart';

import 'placeholder_screen.dart';

/// Bottom-nav shell with placeholder tabs.
class MainShell extends StatefulWidget {
  const MainShell({super.key});

  static const routeName = '/home';

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _index = 0;

  static const _tabs = [
    PlaceholderScreen(
      title: 'Home',
      icon: Icons.home_outlined,
      subtitle: 'Feed and activity will land here.',
    ),
    PlaceholderScreen(
      title: 'Explore',
      icon: Icons.explore_outlined,
      subtitle: 'Discover placeholder screen.',
    ),
    PlaceholderScreen(
      title: 'Messages',
      icon: Icons.chat_bubble_outline,
      subtitle: 'Conversations placeholder.',
    ),
    PlaceholderScreen(
      title: 'Profile',
      icon: Icons.person_outline,
      subtitle: 'Account settings placeholder.',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(switch (_index) {
          0 => 'Home',
          1 => 'Explore',
          2 => 'Messages',
          _ => 'Profile',
        }),
      ),
      body: IndexedStack(index: _index, children: _tabs),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.explore_outlined), selectedIcon: Icon(Icons.explore), label: 'Explore'),
          NavigationDestination(icon: Icon(Icons.chat_bubble_outline), selectedIcon: Icon(Icons.chat_bubble), label: 'Messages'),
          NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Profile'),
        ],
      ),
    );
  }
}
