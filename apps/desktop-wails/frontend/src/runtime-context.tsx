import { useEffect, useState } from "react";
import { AgentsPage } from "@multica/views/agents";
import { RuntimesPage } from "@multica/views/runtimes";

interface RuntimeContext {
  localDaemonId: string | null;
  localMachineName: string | null;
  bootstrapping: boolean;
}

interface DaemonIdentity {
  daemonId: string | null;
  deviceName: string | null;
}

type DaemonStatus = Awaited<
  ReturnType<Window["daemonAPI"]["getStatus"]>
>;

let lastIdentity: DaemonIdentity = {
  daemonId: null,
  deviceName: null,
};

function useWailsRuntimeContext(): RuntimeContext {
  const [status, setStatus] = useState<DaemonStatus>({ state: "stopped" });
  const [identity, setIdentity] = useState(lastIdentity);
  const [hostName, setHostName] = useState<string | null>(null);

  useEffect(() => {
    const apply = (next: DaemonStatus) => {
      setStatus(next);
      if (next.daemonId) {
        lastIdentity = {
          daemonId: next.daemonId,
          deviceName: next.deviceName ?? null,
        };
        setIdentity(lastIdentity);
      }
    };
    void window.daemonAPI.getStatus().then(apply);
    void window.daemonAPI
      .getHostName()
      .then((name) => setHostName(name || null));
    return window.daemonAPI.onStatusChange(apply);
  }, []);

  return {
    localDaemonId: status.daemonId ?? identity.daemonId,
    localMachineName:
      status.deviceName ?? identity.deviceName ?? hostName,
    bootstrapping:
      status.state === "installing_cli" ||
      status.state === "starting" ||
      status.state === "running",
  };
}

export function WailsAgentsPage() {
  const context = useWailsRuntimeContext();
  return (
    <AgentsPage
      localDaemonId={context.localDaemonId}
      localMachineName={context.localMachineName}
      hasLocalMachine
    />
  );
}

export function WailsRuntimesPage() {
  const context = useWailsRuntimeContext();
  return (
    <RuntimesPage
      localDaemonId={context.localDaemonId}
      localMachineName={context.localMachineName}
      hasLocalMachine
      bootstrapping={context.bootstrapping}
    />
  );
}
