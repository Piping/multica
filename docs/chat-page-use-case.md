# Chat Page Use Case

## Summary

This document captures the approved IA and interaction model for turning Chat from a floating overlay into a first-class workspace page.

- Route: `/{workspaceSlug}/chat`
- Main app sidebar: add `Chat` above `Inbox`
- Chat becomes a persistent workspace page, not a floating window
- Chat page gets its own secondary sidebar for session management

## Problem

The floating chat window is useful for quick prompts, but it breaks down once chat becomes a primary workspace workflow:

- session switching is cramped
- cross-session unread / running state is easy to miss
- chat history management is buried in a dropdown
- the overlay competes with issue / project pages instead of behaving like a real destination

## Goals

- Make Chat a normal workspace destination alongside Inbox, Issues, and Projects
- Put session history in a dedicated secondary sidebar
- Preserve the existing chat runtime behavior, drafts, uploads, and realtime updates
- Keep the main message area visually quiet
- Support desktop and mobile without inventing different mental models

## Information Architecture

### Primary navigation

- Add `Chat` to the main workspace sidebar
- Position it above `Inbox`
- Add the same destination to command/search navigation

### Secondary chat sidebar

The Chat page gets a second-level sidebar whose primary job is session management.

- Top area contains:
  - `New chat`
  - agent picker
- Main list contains all chat sessions in one mixed list
- Sessions are not pre-grouped by agent
- Archived sessions remain in the same list for now
- Per-session actions live in a hover menu on each row:
  - rename
  - delete

### Main chat pane

- Keep the message area minimal
- Do not add a heavy page header above messages
- Existing compose-time context sharing remains in the input area

## Session Behavior

- Default entry when opening Chat: the last active session
- If no prior session exists, land in a new-chat state
- Creating a new chat defaults to the first available agent
- Session rows continue to show unread and running indicators
- Selecting a session implicitly switches the active agent when needed

## Responsive Behavior

### Desktop

- Secondary sidebar is visible by default
- Secondary sidebar is collapsible

### Mobile

- Secondary sidebar opens from a button into a sheet / drawer
- Main chat pane remains the default visible surface

## Migration Notes

- Remove the floating `ChatWindow` and `ChatFab` mounts from dashboard layouts
- Reuse the existing chat store state where it still applies:
  - `activeSessionId`
  - `selectedAgentId`
  - input drafts
  - focus mode
- Floating-window-only state can remain temporarily if it is no longer read, but it is no longer part of the product model

## Non-goals

- No separate archived section yet
- No agent-grouped session tree
- No heavy page-level analytics or reporting UI inside Chat
