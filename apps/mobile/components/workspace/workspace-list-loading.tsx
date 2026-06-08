import { View } from "react-native";
import { Skeleton } from "@/components/ui/skeleton";

export function WorkspaceListLoading() {
  return (
    <View className="gap-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <View
          key={index}
          className="rounded-md border border-border bg-card px-4 py-4 gap-3"
        >
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-5/6" />
        </View>
      ))}
    </View>
  );
}
