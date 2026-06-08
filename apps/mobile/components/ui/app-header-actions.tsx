import { router } from "expo-router";
import { IconButton } from "@/components/ui/icon-button";
import { useWorkspaceStore } from "@/data/workspace-store";

type HeaderActionKind = "search" | "new-issue" | "new-project";

interface Props {
  actions: HeaderActionKind[];
}

/**
 * Header utility buttons for tab-root screens.
 *
 * Important: this component is intentionally configured by the caller.
 * Earlier shape hard-coded `search + new issue`, which made the same `+`
 * icon mean wildly different things across surfaces: acceptable in My
 * Issues, misleading in Today and Workspace. Keep action meaning tied to
 * the current tab's job.
 */
export function HeaderActions({ actions }: Props) {
  const slug = useWorkspaceStore((s) => s.currentWorkspaceSlug);

  const onSearch = () => {
    if (slug) router.push(`/${slug}/search`);
  };

  const onNewIssue = () => {
    if (slug) router.push(`/${slug}/new-issue`);
  };

  const onNewProject = () => {
    if (slug) router.push(`/${slug}/project/new`);
  };

  return (
    <>
      {actions.includes("search") ? (
        <IconButton
          name="search"
          onPress={onSearch}
          accessibilityLabel="Search"
        />
      ) : null}
      {actions.includes("new-issue") ? (
        <IconButton
          name="add"
          iconSize={24}
          onPress={onNewIssue}
          accessibilityLabel="New issue"
        />
      ) : null}
      {actions.includes("new-project") ? (
        <IconButton
          name="add"
          iconSize={24}
          onPress={onNewProject}
          accessibilityLabel="New project"
        />
      ) : null}
    </>
  );
}
