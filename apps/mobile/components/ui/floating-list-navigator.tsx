import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

interface Props {
  canJumpUp: boolean;
  canJumpDown: boolean;
  isAtTop: boolean;
  isAtBottom: boolean;
  previousLabel: string;
  nextLabel: string;
  onJumpToTop: () => void;
  onJumpToPrevious: () => void;
  onJumpToNext: () => void;
  onJumpToBottom: () => void;
}

export function FloatingListNavigator({
  canJumpUp,
  canJumpDown,
  isAtTop,
  isAtBottom,
  previousLabel,
  nextLabel,
  onJumpToTop,
  onJumpToPrevious,
  onJumpToNext,
  onJumpToBottom,
}: Props) {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  return (
    <View
      className="absolute right-2 bottom-4 rounded-full border border-border/15 bg-background/30 px-1 py-1"
      style={{
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.02,
        shadowRadius: 4,
        elevation: 1,
      }}
    >
      <NavigatorButton
        icon="arrow-up"
        disabled={isAtTop}
        label="Scroll to top"
        onPress={onJumpToTop}
        color={theme.foreground}
      />
      <NavigatorButton
        icon="chevron-up"
        disabled={!canJumpUp}
        label={previousLabel}
        onPress={onJumpToPrevious}
        color={theme.foreground}
      />
      <NavigatorButton
        icon="chevron-down"
        disabled={!canJumpDown}
        label={nextLabel}
        onPress={onJumpToNext}
        color={theme.foreground}
      />
      <NavigatorButton
        icon="arrow-down"
        disabled={isAtBottom}
        label="Scroll to bottom"
        onPress={onJumpToBottom}
        color={theme.foreground}
      />
    </View>
  );
}

function NavigatorButton({
  icon,
  disabled,
  label,
  onPress,
  color,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  disabled: boolean;
  label: string;
  onPress: () => void;
  color: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className="mt-0.5 size-8 items-center justify-center rounded-full active:bg-background/30"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={{ opacity: disabled ? 0.32 : 1 }}
    >
      <Ionicons name={icon} size={15} color={color} />
    </Pressable>
  );
}
