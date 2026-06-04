import type { ReactNode } from "react";
import { View } from "react-native";
import { PickerSearchField } from "@/components/ui/picker-search-field";

interface Props {
  children: ReactNode;
  inlineSearch: boolean;
  query: string;
  setQuery: (value: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}

export function SearchablePickerScreen({
  children,
  inlineSearch,
  query,
  setQuery,
  placeholder,
  autoFocus,
}: Props) {
  if (!inlineSearch) return <>{children}</>;

  return (
    <View className="flex-1 bg-background">
      <PickerSearchField
        value={query}
        onChangeText={setQuery}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
      <View className="flex-1">{children}</View>
    </View>
  );
}
