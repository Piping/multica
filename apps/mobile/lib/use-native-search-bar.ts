/**
 * Hook for wiring an iOS native `UISearchController` (via react-native-screens
 * `headerSearchBarOptions`) into a route. Returns the current query string.
 *
 * Used by every search-enabled picker route on mobile (issue/project/label/
 * lead). Pair with `useScrollToTopOnChange` in the body to reset the list
 * scroll position when the filter changes.
 *
 * Why this exists rather than inlining `setOptions` in every route:
 *   - Cancel button contract: `cancelSearch()` clears the native text but
 *     does NOT fire `onChangeText`, so the route MUST reset query state in
 *     `onCancelButtonPress`. Easy to forget when copy-pasted.
 *   - Sensible defaults (autoCapitalize: "none", hideWhenScrolling: false)
 *     match the standard iOS picker pattern; one place to revise.
 *
 * Requires the Stack.Screen to register `headerShown: true` + a `title` in
 * the layout. See `apps/mobile/app/(app)/[workspace]/_layout.tsx` for the
 * pattern.
 */
import { useLayoutEffect, useState } from "react";
import { useNavigation } from "expo-router";
import {
  Platform,
  type NativeSyntheticEvent,
  type TextInputFocusEventData,
} from "react-native";

export function useNativeSearchBar(
  placeholder: string,
  options?: { autoFocus?: boolean },
): {
  query: string;
  setQuery: (value: string) => void;
  isInlineSearch: boolean;
} {
  const navigation = useNavigation();
  const [query, setQuery] = useState("");
  const autoFocus = options?.autoFocus;
  const isInlineSearch = Platform.OS !== "ios";

  useLayoutEffect(() => {
    if (isInlineSearch) return;
    navigation.setOptions({
      headerSearchBarOptions: {
        placeholder,
        autoCapitalize: "none",
        hideWhenScrolling: false,
        // Opt-in: pickers whose primary action is typing (assignee, label,
        // project, lead) set this so the keyboard appears on mount. Apple
        // HIG cautions against auto-keyboard for browse-first lists; pass
        // `autoFocus: true` only when the picker is search-first.
        autoFocus,
        onChangeText: (e: NativeSyntheticEvent<TextInputFocusEventData>) =>
          setQuery(e.nativeEvent.text),
        onCancelButtonPress: () => setQuery(""),
      },
    });
  }, [navigation, placeholder, autoFocus, isInlineSearch]);

  return { query, setQuery, isInlineSearch };
}
