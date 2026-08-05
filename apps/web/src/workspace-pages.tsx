import { IssuesPage } from "@multica/views/issues/components/issues-page";
import { ProjectsPage } from "@multica/views/projects/components";
import { AutopilotsPage } from "@multica/views/autopilots/components";
import {
  AgentsPage,
  AiCreateAgentPage,
  ChooseCreateMethodPage,
  ManualCreateAgentPage,
} from "@multica/views/agents";
import { BillingTestPage } from "@multica/views/billing";
import { ChatPage } from "@multica/views/chat";
import { InboxPage } from "@multica/views/inbox";
import { MyIssuesPage } from "@multica/views/my-issues";
import { RuntimesPage } from "@multica/views/runtimes";
import { SettingsPage } from "@multica/views/settings";
import { SkillsPage } from "@multica/views/skills";
import { SquadsPage, SquadDetailPage } from "@multica/views/squads";
import { DashboardPage } from "@multica/views/dashboard";

export {
  AgentsPage,
  AiCreateAgentPage,
  AutopilotsPage,
  BillingTestPage,
  ChatPage,
  ChooseCreateMethodPage,
  DashboardPage,
  InboxPage,
  IssuesPage,
  ManualCreateAgentPage,
  MyIssuesPage,
  ProjectsPage,
  SettingsPage,
  SkillsPage,
  SquadDetailPage,
  SquadsPage,
};

export function WebRuntimesPage() {
  return (
    <RuntimesPage
      cloudRuntimeEnabled={
        import.meta.env.VITE_ENABLE_CLOUD_RUNTIME === "true"
      }
    />
  );
}
