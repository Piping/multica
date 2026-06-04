/**
 * Project picker route for the in-progress new-issue draft. Uses the same
 * native iOS Stack header + UISearchController pattern as
 * `issue/[id]/picker/project.tsx`.
 */
import { router } from "expo-router";
import { ProjectPickerBody } from "@/components/issue/pickers/project-picker-body";
import { SearchablePickerScreen } from "@/components/ui/searchable-picker-screen";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { useNativeSearchBar } from "@/lib/use-native-search-bar";

export default function NewIssueProjectPickerRoute() {
  const project = useNewIssueDraftStore((s) => s.project);
  const setProject = useNewIssueDraftStore((s) => s.setProject);
  const { query, setQuery, isInlineSearch } = useNativeSearchBar(
    "Search projects",
    { autoFocus: true },
  );

  return (
    <SearchablePickerScreen
      inlineSearch={isInlineSearch}
      query={query}
      setQuery={setQuery}
      placeholder="Search projects"
      autoFocus
    >
      <ProjectPickerBody
        value={project}
        query={query}
        onChange={(next) => {
          setProject(next);
          router.back();
        }}
      />
    </SearchablePickerScreen>
  );
}
