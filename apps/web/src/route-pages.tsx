import { useParams, useSearchParams } from "react-router-dom";
import { ErrorBoundary } from "@multica/ui/components/common/error-boundary";
import { IssueDetailRoute } from "@multica/views/issues/components";
import { ProjectDetail } from "@multica/views/projects/components";
import { AutopilotDetailPage } from "@multica/views/autopilots/components";
import { AgentDetailPage, AiBuilderSessionPage } from "@multica/views/agents";
import { MemberDetailPage } from "@multica/views/members";
import { RuntimeDetailPage, RuntimeSettingsPage } from "@multica/views/runtimes";
import { SkillDetailPage } from "@multica/views/skills";
import { AttachmentPreviewPage } from "@multica/views/attachments";

function requiredParam(name: string, params: Record<string, string | undefined>) {
  const value = params[name];
  if (!value) throw new Error(`Missing route parameter: ${name}`);
  return value;
}

export function IssueDetailRoutePage() {
  const params = useParams();
  const id = requiredParam("id", params);
  return (
    <ErrorBoundary resetKeys={[id]}>
      <IssueDetailRoute routeId={id} />
    </ErrorBoundary>
  );
}

export function ProjectDetailRoutePage() {
  return <ProjectDetail projectId={requiredParam("id", useParams())} />;
}

export function AutopilotDetailRoutePage() {
  return <AutopilotDetailPage autopilotId={requiredParam("id", useParams())} />;
}

export function AgentDetailRoutePage() {
  return <AgentDetailPage agentId={requiredParam("id", useParams())} />;
}

export function AiBuilderSessionRoutePage() {
  return (
    <AiBuilderSessionPage
      sessionId={requiredParam("sessionId", useParams())}
    />
  );
}

export function MemberDetailRoutePage() {
  return <MemberDetailPage userId={requiredParam("id", useParams())} />;
}

export function RuntimeDetailRoutePage() {
  return <RuntimeDetailPage runtimeId={requiredParam("id", useParams())} />;
}

export function RuntimeSettingsRoutePage() {
  const params = useParams();
  return (
    <RuntimeSettingsPage
      machineId={requiredParam("id", params)}
      runtimeId={requiredParam("runtimeId", params)}
    />
  );
}

export function SkillDetailRoutePage() {
  return <SkillDetailPage skillId={requiredParam("id", useParams())} />;
}

export function AttachmentPreviewRoutePage() {
  const id = requiredParam("id", useParams());
  const [search] = useSearchParams();
  return (
    <ErrorBoundary resetKeys={[id]}>
      <AttachmentPreviewPage
        attachmentId={id}
        filename={search.get("name") ?? undefined}
      />
    </ErrorBoundary>
  );
}
