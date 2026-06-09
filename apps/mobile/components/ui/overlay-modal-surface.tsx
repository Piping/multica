import type { ReactNode } from "react";
import { Modal, Pressable, View, type ModalProps } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { cn } from "@/lib/utils";

interface Props {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  animationType?: ModalProps["animationType"];
  backdropClassName?: string;
  contentContainerClassName?: string;
  safeAreaEdges?: Edge[];
}

/**
 * One seam for mobile transparent overlays that still want native Modal
 * semantics: visibility, outside-tap dismissal, dim backdrop, and optional
 * safe-area padding live here. Callers own only placement and content.
 */
export function OverlayModalSurface({
  visible,
  onClose,
  children,
  animationType = "fade",
  backdropClassName,
  contentContainerClassName,
  safeAreaEdges = [],
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType={animationType}
      onRequestClose={onClose}
    >
      <View className={cn("flex-1 bg-black/40", backdropClassName)}>
        <Pressable className="absolute inset-0" onPress={onClose} />
        <SafeAreaView className="flex-1" edges={safeAreaEdges}>
          <View className={cn("flex-1", contentContainerClassName)}>
            {children}
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
