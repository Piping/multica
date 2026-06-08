/**
 * Bottom tab bar — JS `<Tabs>` from expo-router (react-navigation under the
 * hood). The tabs are real destinations, not action triggers: Chat for direct
 * handoff, My Issues for personal work, Today for attention-worthy work, and
 * Workspace for projects / agents / pins / settings.
 *
 * Active / inactive tint colors are derived from the current colour scheme via
 * THEME so dark mode picks contrasting values automatically.
 */
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import {
  useChatUnreadSessionCount,
  useTodayBadgeCount,
} from "@/lib/unread-counts";

export const unstable_settings = {
  initialRouteName: "chat",
} as const;

// Only override backgroundColor — @react-navigation/elements Badge internally
// sets borderRadius = size/2, height = size, minWidth = size, so a single
// character renders as a perfect circle. Overriding minWidth/fontSize here
// breaks that geometry. Text color is auto-derived from backgroundColor
// luminance by Badge itself (white on brand blue).
const BADGE_STYLE = {
  backgroundColor: THEME.light.brand,
};

export default function TabsLayout() {
  const { colorScheme } = useColorScheme();
  const t = THEME[colorScheme];

  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const todayCount = useTodayBadgeCount(wsId);
  const chatUnread = useChatUnreadSessionCount(wsId);

  // Truncation aligned with web: inbox 99+, chat 9+ (matches sidebar +
  // ChatFab respectively). `undefined` makes React Navigation hide the
  // badge, so zero-count is a free no-op.
  const todayBadge =
    todayCount > 0 ? (todayCount > 99 ? "99+" : String(todayCount)) : undefined;
  const chatBadge =
    chatUnread > 0 ? (chatUnread > 9 ? "9+" : String(chatUnread)) : undefined;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.foreground,
        tabBarInactiveTintColor: t.mutedForeground,
        tabBarHideOnKeyboard: true,
        tabBarStyle: { backgroundColor: t.background },
        tabBarLabelStyle: { fontSize: 11 },
      }}
    >
        <Tabs.Screen
          name="chat"
          options={{
            title: "Chat",
            tabBarBadge: chatBadge,
            tabBarBadgeStyle: BADGE_STYLE,
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? "chatbubble" : "chatbubble-outline"}
                color={color}
                size={size}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="my-issues"
          options={{
            title: "My Issues",
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? "list" : "list-outline"}
                color={color}
                size={size}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="inbox"
          options={{
            title: "Today",
            tabBarBadge: todayBadge,
            tabBarBadgeStyle: BADGE_STYLE,
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? "today" : "today-outline"}
                color={color}
                size={size}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="more"
          options={{
            title: "Workspace",
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? "briefcase" : "briefcase-outline"}
                color={color}
                size={size}
              />
            ),
          }}
        />
    </Tabs>
  );
}
