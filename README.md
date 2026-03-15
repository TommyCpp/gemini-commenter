# Gemini Commenter

A Chrome extension that adds **Google Docs-style inline commenting** to Gemini responses. Select any text in a Gemini response, leave a comment, and send all your comments as a single formatted message.

<!-- ![Demo](screenshots/demo.gif) -->

## Why?

When reading long Gemini responses, there's no way to annotate specific passages. You end up copy-pasting paragraphs into new messages, losing context. This extension lets you highlight and comment inline, then compose everything into one reply.

## Features

- **Select & Comment** — Highlight text in any Gemini response and add a comment via popover
- **Persistent Highlights** — Comments are saved per conversation and restored on page reload
- **Sidebar Panel** — View, edit, delete, and reorder all comments in a slide-out panel
- **Compose & Send** — Format all comments as a quoted message and inject it into Gemini's input
- **Dark Mode** — Matches Gemini's dark theme by default
- **No Dependencies** — Pure vanilla JS/CSS, no build step

## How It Works

### 1. Select text and add a comment

Select any text inside a Gemini response. A popover appears above your selection — click **Add Comment** and type your note.

<!-- ![Select and comment](screenshots/select-comment.png) -->

### 2. View comments in the sidebar

Click the floating action button (bottom-right) to open the sidebar. Each comment shows the quoted text and your note. Click a card to scroll to its highlight.

<!-- ![Sidebar](screenshots/sidebar.png) -->

### 3. Send to Gemini

Click **Send to Gemini** to compose all comments into a formatted message:

```
> "quoted text from the response"
Your comment here

> "another quoted passage"
Another comment
```

Comments are automatically cleared after sending.

## Install

1. Clone or download this repo
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the `gemini-commenter` folder
5. Navigate to [gemini.google.com](https://gemini.google.com) and start commenting

## File Structure

```
gemini-commenter/
├── manifest.json    # Manifest V3 config
├── content.js       # Core logic (selection, comments, panel, compose)
├── content.css      # All styles (dark mode default, light mode override)
├── popup.html       # Browser action popup
├── popup.js         # Popup ↔ content script messaging
└── icons/           # Extension icons (16, 48, 128px)
```

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Save comment | `Ctrl/Cmd + Enter` |
| Cancel | `Escape` |

## Permissions

- `storage` — Persist comments across sessions
- `activeTab` — Access the current Gemini tab

No data leaves your browser. Comments are stored locally via `chrome.storage.local`.

## License

MIT
