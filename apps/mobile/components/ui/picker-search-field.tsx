import { View } from "react-native";
import { TextField } from "@/components/ui/text-field";

interface Props {
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
  autoFocus?: boolean;
}

export function PickerSearchField({
  value,
  placeholder,
  onChangeText,
  autoFocus,
}: Props) {
  return (
    <View className="px-4 pt-3 pb-2 bg-background">
      <TextField
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        autoFocus={autoFocus}
      />
    </View>
  );
}
