import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Skeleton } from "@/components/ui/skeleton";

export function AppLaunchSkeleton() {
  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 px-6 pt-4 pb-6">
        <View className="h-12 flex-row items-center border-b border-border px-2">
          <View className="flex-1 gap-2 px-2">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-3 w-20" />
          </View>
          <View className="flex-row items-center gap-2">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="size-8 rounded-full" />
          </View>
        </View>

        <View className="flex-1 pt-6 gap-6">
          <View className="gap-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-4 w-40" />
          </View>

          <View className="gap-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <View
                key={index}
                className="rounded-md border border-border bg-card px-4 py-4 gap-3"
              >
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-3/4" />
              </View>
            ))}
          </View>

          <View className="mt-auto gap-3">
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-3 w-32 self-center" />
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}
