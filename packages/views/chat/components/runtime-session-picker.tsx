"use client";

import { useState } from "react";
import { Loader2, Plus, Server } from "lucide-react";
import type { RuntimeDevice } from "@multica/core/types";
import { runtimeDisplayName } from "@multica/core/runtimes";
import { Button } from "@multica/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@multica/ui/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@multica/ui/components/ui/tooltip";
import { ProviderLogo } from "../../runtimes/components/provider-logo";
import { useT } from "../../i18n";

export function RuntimeSessionPicker({
  runtimes,
  loading,
  pending,
  onSelect,
}: {
  runtimes: RuntimeDevice[];
  loading: boolean;
  pending: boolean;
  onSelect: (runtime: RuntimeDevice) => Promise<unknown>;
}) {
  const { t } = useT("chat");
  const [open, setOpen] = useState(false);

  const select = async (runtime: RuntimeDevice) => {
    const session = await onSelect(runtime);
    if (session !== null) setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-label={t(($) => $.runtime_picker.new_session)}
                />
              }
            />
          }
        >
          <Plus />
        </TooltipTrigger>
        <TooltipContent>{t(($) => $.runtime_picker.new_session)}</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t(($) => $.runtime_picker.title)}</DialogTitle>
          <DialogDescription>{t(($) => $.runtime_picker.description)}</DialogDescription>
        </DialogHeader>
        <RuntimeChoices
          runtimes={runtimes}
          loading={loading}
          pending={pending}
          onSelect={select}
        />
      </DialogContent>
    </Dialog>
  );
}

export function RuntimeChoices({
  runtimes,
  loading,
  pending,
  onSelect,
}: {
  runtimes: RuntimeDevice[];
  loading: boolean;
  pending: boolean;
  onSelect: (runtime: RuntimeDevice) => void;
}) {
  const { t } = useT("chat");

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (runtimes.length === 0) {
    return (
      <div className="flex h-32 flex-col items-center justify-center gap-2 text-center">
        <Server className="size-7 text-faint-foreground" />
        <p className="text-body font-medium">{t(($) => $.runtime_picker.empty_title)}</p>
        <p className="max-w-xs text-caption text-muted-foreground">
          {t(($) => $.runtime_picker.empty_description)}
        </p>
      </div>
    );
  }

  return (
    <div className="max-h-80 space-y-1 overflow-y-auto">
      {runtimes.map((runtime) => (
        <button
          key={runtime.id}
          type="button"
          disabled={pending}
          onClick={() => onSelect(runtime)}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-background">
            <ProviderLogo provider={runtime.provider} className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-medium">
              {runtimeDisplayName(runtime)}
            </span>
            <span className="block truncate text-caption text-muted-foreground">
              {runtime.device_info || runtime.provider}
            </span>
          </span>
          <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
        </button>
      ))}
    </div>
  );
}
