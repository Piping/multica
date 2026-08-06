import { describe, expect, it } from "vitest";
import type { Attachment, ChatMessage } from "@multica/core/types";
import { collectChatAttachments } from "./chat-tool-panel";

function attachment(id: string): Attachment {
  return {
    id,
    workspace_id: "ws-1",
    issue_id: null,
    comment_id: null,
    chat_session_id: "session-1",
    chat_message_id: "message-1",
    uploader_type: "user",
    uploader_id: "user-1",
    filename: `${id}.txt`,
    url: `/attachments/${id}`,
    download_url: `/attachments/${id}/download`,
    markdown_url: `/attachments/${id}/download`,
    content_type: "text/plain",
    size_bytes: 10,
    created_at: "2026-08-06T00:00:00Z",
  };
}

describe("collectChatAttachments", () => {
  it("collects message attachments in order and removes duplicates", () => {
    const first = attachment("first");
    const second = attachment("second");
    const messages = [
      { id: "message-1", attachments: [first, second] },
      { id: "message-2", attachments: [first] },
    ] as ChatMessage[];

    expect(collectChatAttachments(messages)).toEqual([first, second]);
  });
});
