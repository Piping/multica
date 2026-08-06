"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, File, FileCode2, FolderOpen } from "lucide-react";
import { Button } from "@multica/ui/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select";
import { cn } from "@multica/ui/lib/utils";
import type { Attachment, ChatMessage } from "@multica/core/types";
import { HtmlPreviewBody } from "../../editor/html-preview-body";
import { useDownloadAttachment } from "../../editor/use-download-attachment";
import { useT } from "../../i18n";

type ToolView = "files" | "html";

function isHtmlAttachment(attachment: Attachment): boolean {
  const contentType = attachment.content_type.toLowerCase();
  const filename = attachment.filename.toLowerCase();
  return contentType === "text/html" || filename.endsWith(".html") || filename.endsWith(".htm");
}

export function collectChatAttachments(messages: ChatMessage[]): Attachment[] {
  const seen = new Set<string>();
  const attachments: Attachment[] = [];
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      if (seen.has(attachment.id)) continue;
      seen.add(attachment.id);
      attachments.push(attachment);
    }
  }
  return attachments;
}

export function ChatToolPanel({ messages }: { messages: ChatMessage[] }) {
  const { t } = useT("chat");
  const downloadAttachment = useDownloadAttachment();
  const attachments = useMemo(() => collectChatAttachments(messages), [messages]);
  const htmlAttachments = useMemo(
    () => attachments.filter(isHtmlAttachment),
    [attachments],
  );
  const [view, setView] = useState<ToolView>("files");
  const [selectedHtmlId, setSelectedHtmlId] = useState<string | null>(null);

  useEffect(() => {
    if (
      selectedHtmlId &&
      htmlAttachments.some((attachment) => attachment.id === selectedHtmlId)
    ) {
      return;
    }
    setSelectedHtmlId(htmlAttachments[0]?.id ?? null);
  }, [htmlAttachments, selectedHtmlId]);

  const selectedHtml =
    htmlAttachments.find((attachment) => attachment.id === selectedHtmlId) ??
    null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center border-b px-3">
        <div
          className="grid h-8 flex-1 grid-cols-2 rounded-md bg-muted p-0.5"
          role="tablist"
          aria-label={t(($) => $.tools.title)}
        >
          <button
            type="button"
            role="tab"
            aria-selected={view === "files"}
            className={cn(
              "flex min-w-0 items-center justify-center gap-1.5 rounded-sm px-2 text-caption font-medium text-muted-foreground",
              view === "files" && "bg-background text-foreground shadow-xs",
            )}
            onClick={() => setView("files")}
          >
            <FolderOpen className="size-3.5 shrink-0" />
            <span className="truncate">{t(($) => $.tools.files)}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "html"}
            className={cn(
              "flex min-w-0 items-center justify-center gap-1.5 rounded-sm px-2 text-caption font-medium text-muted-foreground",
              view === "html" && "bg-background text-foreground shadow-xs",
            )}
            onClick={() => setView("html")}
          >
            <FileCode2 className="size-3.5 shrink-0" />
            <span className="truncate">{t(($) => $.tools.html)}</span>
          </button>
        </div>
      </div>

      {view === "files" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-2" role="tabpanel">
          {attachments.length === 0 ? (
            <ToolEmpty
              icon={FolderOpen}
              title={t(($) => $.tools.no_files)}
              description={t(($) => $.tools.no_files_hint)}
            />
          ) : (
            <div className="space-y-1">
              {attachments.map((attachment) => {
                const html = isHtmlAttachment(attachment);
                return (
                  <div
                    key={attachment.id}
                    className="group flex min-w-0 items-center gap-2 rounded-md px-2 py-2 hover:bg-muted"
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => {
                        if (html) {
                          setSelectedHtmlId(attachment.id);
                          setView("html");
                        } else {
                          void downloadAttachment(attachment.id);
                        }
                      }}
                    >
                      {html ? (
                        <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <File className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-body">
                        {attachment.filename}
                      </span>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="shrink-0 text-muted-foreground"
                      aria-label={t(($) => $.tools.download_file, {
                        name: attachment.filename,
                      })}
                      onClick={() => void downloadAttachment(attachment.id)}
                    >
                      <Download className="size-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col" role="tabpanel">
          {selectedHtml ? (
            <>
              <div className="shrink-0 border-b p-2">
                <Select
                  items={htmlAttachments.map((attachment) => ({
                    value: attachment.id,
                    label: attachment.filename,
                  }))}
                  value={selectedHtml.id}
                  onValueChange={(value) => value && setSelectedHtmlId(value)}
                >
                  <SelectTrigger
                    size="sm"
                    className="w-full"
                    aria-label={t(($) => $.tools.html_file)}
                  >
                    <SelectValue>{selectedHtml.filename}</SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end">
                    {htmlAttachments.map((attachment) => (
                      <SelectItem key={attachment.id} value={attachment.id}>
                        {attachment.filename}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-h-0 flex-1">
                <HtmlPreviewBody
                  source={{
                    kind: "attachment",
                    attachmentId: selectedHtml.id,
                  }}
                  title={selectedHtml.filename}
                  className="h-full min-h-[240px]"
                  iframeClassName="rounded-none border-0"
                  placeholderClassName="h-full min-h-[240px] rounded-none border-0"
                />
              </div>
            </>
          ) : (
            <ToolEmpty
              icon={FileCode2}
              title={t(($) => $.tools.no_html)}
              description={t(($) => $.tools.no_html_hint)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ToolEmpty({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof File;
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center px-5 text-center">
      <Icon className="mb-3 size-5 text-muted-foreground" />
      <p className="text-body font-medium">{title}</p>
      <p className="mt-1 text-caption text-muted-foreground">{description}</p>
    </div>
  );
}
