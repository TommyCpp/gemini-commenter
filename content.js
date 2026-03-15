(() => {
  'use strict';

  // Avoid double-injection
  if (window.__gcCommenterLoaded) return;
  window.__gcCommenterLoaded = true;

  // =========================================================================
  // Utility
  // =========================================================================

  const RESPONSE_SELECTORS = [
    'model-response',
    '.response-container-content',
    '[class*="group/turn-messages"]',
  ];

  function getResponseElements() {
    for (const sel of RESPONSE_SELECTORS) {
      const els = document.querySelectorAll(sel);
      if (els.length) return Array.from(els);
    }
    return [];
  }

  function findResponseAncestor(node) {
    let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (el) {
      for (const sel of RESPONSE_SELECTORS) {
        try { if (el.matches(sel)) return el; } catch {}
      }
      el = el.parentElement;
    }
    return null;
  }

  function getResponseIndex(responseEl) {
    const all = getResponseElements();
    return all.indexOf(responseEl);
  }

  function getConversationKey() {
    return location.pathname;
  }

  function genId() {
    return 'gc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // =========================================================================
  // CommentStore
  // =========================================================================

  const CommentStore = (() => {
    let comments = [];
    const listeners = new Set();

    function emit() {
      listeners.forEach(fn => fn(comments));
      persist();
    }

    function persist() {
      const key = 'gc_comments_' + getConversationKey();
      chrome.storage.local.set({ [key]: comments });
    }

    async function load() {
      const key = 'gc_comments_' + getConversationKey();
      return new Promise(resolve => {
        chrome.storage.local.get(key, result => {
          comments = result[key] || [];
          emit();
          resolve(comments);
        });
      });
    }

    function add(comment) {
      comments.push(comment);
      emit();
    }

    function update(id, fields) {
      const c = comments.find(c => c.id === id);
      if (c) { Object.assign(c, fields); emit(); }
    }

    function remove(id) {
      comments = comments.filter(c => c.id !== id);
      emit();
    }

    function reorder(fromIdx, toIdx) {
      if (fromIdx === toIdx) return;
      const [item] = comments.splice(fromIdx, 1);
      comments.splice(toIdx, 0, item);
      emit();
    }

    function getAll() { return comments; }

    function clearAll() {
      comments = [];
      emit();
    }

    function onChange(fn) { listeners.add(fn); }
    function offChange(fn) { listeners.delete(fn); }

    return { load, add, update, remove, reorder, getAll, clearAll, onChange, offChange };
  })();

  // =========================================================================
  // Highlight Renderer
  // =========================================================================

  const Highlighter = (() => {

    function hasOverlap(range) {
      const frag = range.cloneContents();
      return frag.querySelector('mark.gc-highlight') !== null;
    }

    // Walk text nodes inside a response element up to a char offset, returning { node, offset }
    function resolveOffset(responseEl, charOffset, length) {
      const walker = document.createTreeWalker(responseEl, NodeFilter.SHOW_TEXT);
      let pos = 0;
      let startNode = null, startOff = 0, endNode = null, endOff = 0;
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const nodeLen = node.textContent.length;
        if (!startNode && pos + nodeLen > charOffset) {
          startNode = node;
          startOff = charOffset - pos;
        }
        if (startNode && pos + nodeLen >= charOffset + length) {
          endNode = node;
          endOff = charOffset + length - pos;
          break;
        }
        pos += nodeLen;
      }
      if (!startNode || !endNode) return null;
      return { startNode, startOff, endNode, endOff };
    }

    function wrapRange(range, commentId) {
      // For multi-node ranges, we need to wrap each text node segment individually
      const startContainer = range.startContainer;
      const endContainer = range.endContainer;

      if (startContainer === endContainer && startContainer.nodeType === Node.TEXT_NODE) {
        // Simple case: single text node
        const mark = document.createElement('mark');
        mark.className = 'gc-highlight gc-highlight--first';
        mark.dataset.commentId = commentId;
        range.surroundContents(mark);
        return [mark];
      }

      // Multi-node: collect text nodes in range
      const marks = [];
      const walker = document.createTreeWalker(
        range.commonAncestorContainer,
        NodeFilter.SHOW_TEXT
      );
      const textNodes = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (range.intersectsNode(node)) {
          textNodes.push(node);
        }
      }

      // Wrap each text node (or portion)
      for (const tNode of textNodes) {
        let wrapStart = 0;
        let wrapEnd = tNode.textContent.length;
        if (tNode === startContainer) wrapStart = range.startOffset;
        if (tNode === endContainer) wrapEnd = range.endOffset;
        if (wrapStart >= wrapEnd) continue;

        const subRange = document.createRange();
        subRange.setStart(tNode, wrapStart);
        subRange.setEnd(tNode, wrapEnd);
        const mark = document.createElement('mark');
        mark.className = 'gc-highlight' + (marks.length === 0 ? ' gc-highlight--first' : '');
        mark.dataset.commentId = commentId;
        subRange.surroundContents(mark);
        marks.push(mark);
      }
      return marks;
    }

    function applyHighlight(comment) {
      removeHighlight(comment.id);
      const responses = getResponseElements();
      const responseEl = responses[comment.responseIndex];
      if (!responseEl) return;

      const resolved = resolveOffset(responseEl, comment.textOffset, comment.selectedText.length);
      if (!resolved) return;

      const range = document.createRange();
      range.setStart(resolved.startNode, resolved.startOff);
      range.setEnd(resolved.endNode, resolved.endOff);

      // Verify text matches
      const rangeText = range.toString();
      if (rangeText !== comment.selectedText) return;

      wrapRange(range, comment.id);
    }

    function removeHighlight(commentId) {
      document.querySelectorAll(`mark.gc-highlight[data-comment-id="${commentId}"]`).forEach(mark => {
        const parent = mark.parentNode;
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
        parent.normalize();
      });
    }

    function applyAll() {
      CommentStore.getAll().forEach(c => applyHighlight(c));
    }

    function scrollToHighlight(commentId) {
      const mark = document.querySelector(`mark.gc-highlight[data-comment-id="${commentId}"]`);
      if (mark) {
        mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
        mark.classList.add('gc-highlight--pulse');
        setTimeout(() => mark.classList.remove('gc-highlight--pulse'), 1500);
      }
    }

    return { hasOverlap, wrapRange, applyHighlight, removeHighlight, applyAll, scrollToHighlight, resolveOffset };
  })();

  // =========================================================================
  // SelectionWatcher
  // =========================================================================

  const SelectionWatcher = (() => {
    let popover = null;
    let inlineInput = null;

    function removePopover() {
      if (popover) { popover.remove(); popover = null; }
    }

    function removeInlineInput() {
      if (inlineInput) { inlineInput.remove(); inlineInput = null; }
    }

    function showOverlapTooltip(x, y) {
      const tip = document.createElement('div');
      tip.className = 'gc-overlap-tooltip';
      tip.textContent = 'Cannot overlap existing highlights';
      tip.style.left = x + 'px';
      tip.style.top = (y - 32) + 'px';
      document.body.appendChild(tip);
      setTimeout(() => tip.remove(), 2000);
    }

    function showInlineInput(range, responseEl) {
      removeInlineInput();
      const rect = range.getBoundingClientRect();

      const container = document.createElement('div');
      container.className = 'gc-inline-input';
      container.style.left = rect.left + window.scrollX + 'px';
      container.style.top = (rect.bottom + window.scrollY + 8) + 'px';

      const textarea = document.createElement('textarea');
      textarea.placeholder = 'Add your comment...';

      const actions = document.createElement('div');
      actions.className = 'gc-inline-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => removeInlineInput());

      const saveBtn = document.createElement('button');
      saveBtn.className = 'gc-btn-primary';
      saveBtn.textContent = 'Save';
      saveBtn.disabled = true;

      textarea.addEventListener('input', () => {
        saveBtn.disabled = !textarea.value.trim();
      });

      textarea.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && textarea.value.trim()) {
          saveComment();
        }
        if (e.key === 'Escape') removeInlineInput();
      });

      function saveComment() {
        const commentText = textarea.value.trim();
        if (!commentText) return;

        const selectedText = range.toString();
        const responseIndex = getResponseIndex(responseEl);

        // Compute textOffset
        const walker = document.createTreeWalker(responseEl, NodeFilter.SHOW_TEXT);
        let textOffset = 0;
        let found = false;
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (node === range.startContainer) {
            textOffset += range.startOffset;
            found = true;
            break;
          }
          textOffset += node.textContent.length;
        }
        if (!found) return;

        const id = genId();
        const comment = { id, responseIndex, selectedText, textOffset, commentText };

        // Check overlap
        if (Highlighter.hasOverlap(range)) {
          const r = range.getBoundingClientRect();
          showOverlapTooltip(r.left + window.scrollX, r.top + window.scrollY);
          return;
        }

        // Apply highlight
        Highlighter.wrapRange(range, id);

        CommentStore.add(comment);
        removeInlineInput();
        window.getSelection().removeAllRanges();
      }

      saveBtn.addEventListener('click', saveComment);

      actions.appendChild(cancelBtn);
      actions.appendChild(saveBtn);
      container.appendChild(textarea);
      container.appendChild(actions);
      document.body.appendChild(container);
      inlineInput = container;
      textarea.focus();
    }

    function onMouseUp(e) {
      // Don't interfere with our own UI
      if (e.target.closest('.gc-popover, .gc-inline-input, .gc-panel, .gc-fab')) return;

      removePopover();

      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) return;

      const range = sel.getRangeAt(0);
      const responseEl = findResponseAncestor(range.startContainer);
      if (!responseEl) return;

      // Ensure end is also in same response
      const endResponseEl = findResponseAncestor(range.endContainer);
      if (endResponseEl !== responseEl) return;

      const rect = range.getBoundingClientRect();
      const pop = document.createElement('div');
      pop.className = 'gc-popover';
      pop.style.left = (rect.left + rect.width / 2 - 60 + window.scrollX) + 'px';
      pop.style.top = (rect.top + window.scrollY - 40) + 'px';

      const btn = document.createElement('button');
      btn.className = 'gc-popover-btn';
      btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2zm0 15.17L18.83 16H4V4h16v13.17zM13 5h-2v4H7v2h4v4h2v-4h4V9h-4z"/></svg> Add Comment`;

      btn.addEventListener('click', e => {
        e.stopPropagation();
        removePopover();

        // Re-check selection is still valid
        const currentSel = window.getSelection();
        if (!currentSel || currentSel.isCollapsed) return;
        const currentRange = currentSel.getRangeAt(0);
        showInlineInput(currentRange, responseEl);
      });

      pop.appendChild(btn);
      document.body.appendChild(pop);
      popover = pop;
    }

    function onMouseDown(e) {
      if (e.target.closest('.gc-popover, .gc-inline-input')) return;
      removePopover();
      if (!e.target.closest('.gc-inline-input')) {
        removeInlineInput();
      }
    }

    function init() {
      document.addEventListener('mouseup', onMouseUp);
      document.addEventListener('mousedown', onMouseDown);
    }

    return { init };
  })();

  // =========================================================================
  // PanelUI
  // =========================================================================

  const PanelUI = (() => {
    let panel = null;
    let fab = null;
    let isOpen = false;

    function createFAB() {
      fab = document.createElement('button');
      fab.className = 'gc-fab';
      fab.title = 'Gemini Commenter';
      fab.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2zm0 15.17L18.83 16H4V4h16v13.17z"/></svg>`;
      fab.addEventListener('click', toggle);
      document.body.appendChild(fab);
      updateBadge();
    }

    function updateBadge() {
      if (!fab) return;
      const count = CommentStore.getAll().length;
      let badge = fab.querySelector('.gc-fab-badge');
      if (count > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'gc-fab-badge';
          fab.appendChild(badge);
        }
        badge.textContent = count;
      } else if (badge) {
        badge.remove();
      }
    }

    function createPanel() {
      panel = document.createElement('div');
      panel.className = 'gc-panel';

      // Header
      const header = document.createElement('div');
      header.className = 'gc-panel-header';
      const title = document.createElement('span');
      title.className = 'gc-panel-title';
      title.textContent = 'Comments';
      const closeBtn = document.createElement('button');
      closeBtn.className = 'gc-panel-close';
      closeBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
      closeBtn.addEventListener('click', () => toggle(false));
      header.appendChild(title);
      header.appendChild(closeBtn);

      // List
      const list = document.createElement('div');
      list.className = 'gc-panel-list';

      // Footer
      const footer = document.createElement('div');
      footer.className = 'gc-panel-footer';

      const sendBtn = document.createElement('button');
      sendBtn.className = 'gc-send-btn';
      sendBtn.textContent = 'Send to Gemini';
      sendBtn.addEventListener('click', () => composeAndSend(autoSendCheck.checked));

      const autoSendRow = document.createElement('label');
      autoSendRow.className = 'gc-auto-send-row';
      const autoSendCheck = document.createElement('input');
      autoSendCheck.type = 'checkbox';
      autoSendRow.appendChild(autoSendCheck);
      autoSendRow.appendChild(document.createTextNode('Auto-send after inserting'));

      footer.appendChild(sendBtn);
      footer.appendChild(autoSendRow);

      panel.appendChild(header);
      panel.appendChild(list);
      panel.appendChild(footer);
      document.body.appendChild(panel);
    }

    function toggle(forceOpen) {
      isOpen = typeof forceOpen === 'boolean' ? forceOpen : !isOpen;
      if (panel) panel.classList.toggle('gc-panel--open', isOpen);
      if (isOpen) renderList();
    }

    function getIsOpen() { return isOpen; }

    function renderList() {
      if (!panel) return;
      const list = panel.querySelector('.gc-panel-list');
      const comments = CommentStore.getAll();
      const sendBtn = panel.querySelector('.gc-send-btn');
      sendBtn.disabled = comments.length === 0;

      list.innerHTML = '';
      if (comments.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'gc-panel-empty';
        empty.textContent = 'No comments yet. Select text in a Gemini response and click "Add Comment" to get started.';
        list.appendChild(empty);
        return;
      }

      comments.forEach((comment, idx) => {
        const card = document.createElement('div');
        card.className = 'gc-comment-card';
        card.draggable = true;
        card.dataset.idx = idx;

        // Drag handle
        const handle = document.createElement('span');
        handle.className = 'gc-drag-handle';
        handle.textContent = '⠿';

        // Quote
        const quote = document.createElement('div');
        quote.className = 'gc-comment-quote';
        const truncated = comment.selectedText.length > 80
          ? comment.selectedText.slice(0, 80) + '...'
          : comment.selectedText;
        quote.textContent = truncated;

        // Comment text
        const text = document.createElement('div');
        text.className = 'gc-comment-text';
        text.textContent = comment.commentText;

        // Actions
        const actions = document.createElement('div');
        actions.className = 'gc-comment-actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'gc-comment-action-btn';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', e => {
          e.stopPropagation();
          enterEditMode(card, comment);
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'gc-comment-action-btn gc-comment-action-btn--danger';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', e => {
          e.stopPropagation();
          Highlighter.removeHighlight(comment.id);
          CommentStore.remove(comment.id);
        });

        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);

        card.appendChild(handle);
        card.appendChild(quote);
        card.appendChild(text);
        card.appendChild(actions);

        // Click to scroll to highlight
        card.addEventListener('click', () => {
          Highlighter.scrollToHighlight(comment.id);
          // Show active state briefly
          list.querySelectorAll('.gc-comment-card').forEach(c => c.classList.remove('gc-comment-card--active'));
          card.classList.add('gc-comment-card--active');
        });

        // Drag & drop reorder
        card.addEventListener('dragstart', e => {
          card.classList.add('gc-dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', idx.toString());
        });

        card.addEventListener('dragend', () => {
          card.classList.remove('gc-dragging');
          list.querySelectorAll('.gc-comment-card').forEach(c => c.classList.remove('gc-drag-over'));
        });

        card.addEventListener('dragover', e => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          card.classList.add('gc-drag-over');
        });

        card.addEventListener('dragleave', () => {
          card.classList.remove('gc-drag-over');
        });

        card.addEventListener('drop', e => {
          e.preventDefault();
          card.classList.remove('gc-drag-over');
          const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
          const toIdx = parseInt(card.dataset.idx, 10);
          CommentStore.reorder(fromIdx, toIdx);
        });

        list.appendChild(card);
      });
    }

    function enterEditMode(card, comment) {
      const textEl = card.querySelector('.gc-comment-text');
      const actionsEl = card.querySelector('.gc-comment-actions');
      const original = comment.commentText;

      const textarea = document.createElement('textarea');
      textarea.className = 'gc-comment-edit-area';
      textarea.value = comment.commentText;

      const saveBtn = document.createElement('button');
      saveBtn.className = 'gc-comment-action-btn';
      saveBtn.textContent = 'Save';
      saveBtn.style.color = '#1a73e8';
      saveBtn.style.fontWeight = '500';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'gc-comment-action-btn';
      cancelBtn.textContent = 'Cancel';

      textEl.replaceWith(textarea);
      actionsEl.innerHTML = '';
      actionsEl.appendChild(saveBtn);
      actionsEl.appendChild(cancelBtn);
      textarea.focus();

      textarea.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
        if (e.key === 'Escape') cancel();
      });

      function save() {
        const newText = textarea.value.trim();
        if (newText) {
          CommentStore.update(comment.id, { commentText: newText });
        }
      }

      function cancel() {
        renderList();
      }

      saveBtn.addEventListener('click', e => { e.stopPropagation(); save(); });
      cancelBtn.addEventListener('click', e => { e.stopPropagation(); cancel(); });
    }

    function init() {
      createFAB();
      createPanel();
      CommentStore.onChange(() => {
        updateBadge();
        if (isOpen) renderList();
      });
    }

    return { init, toggle, getIsOpen, renderList };
  })();

  // =========================================================================
  // Compose & Send
  // =========================================================================

  function composeAndSend(autoSend) {
    const comments = CommentStore.getAll();
    if (comments.length === 0) return;

    const lines = comments.map(c => {
      return `> "${c.selectedText}"\n${c.commentText}`;
    });
    const message = lines.join('\n\n');

    // Find Gemini's input field
    const input = document.querySelector(
      'div[contenteditable="plaintext-only"], ' +
      'div[contenteditable="true"][role="textbox"], ' +
      '.ql-editor[contenteditable="true"], ' +
      'rich-textarea div[contenteditable]'
    );

    if (!input) {
      alert('Could not find Gemini input field. Please click on the message input first and try again.');
      return;
    }

    input.focus();

    // Try execCommand first (preserves undo)
    const inserted = document.execCommand('insertText', false, message);
    if (!inserted) {
      // Fallback: set textContent and dispatch InputEvent
      input.textContent = message;
      input.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: message,
      }));
    }

    if (autoSend) {
      setTimeout(() => {
        // Try to find and click the send button
        const sendBtn = document.querySelector(
          'button[aria-label="Send message"], ' +
          'button.send-button, ' +
          '.send-button-container button'
        );
        if (sendBtn && !sendBtn.disabled) {
          sendBtn.click();
        } else {
          // Fallback: dispatch Enter key
          input.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
          }));
        }
      }, 100);
    }

    // Clear all comments and highlights after sending
    CommentStore.getAll().forEach(c => Highlighter.removeHighlight(c.id));
    CommentStore.clearAll();
  }

  // =========================================================================
  // MutationObserver - Handle dynamic content
  // =========================================================================

  function initObserver() {
    const reapply = debounce(() => Highlighter.applyAll(), 100);

    const observer = new MutationObserver(mutations => {
      // Check if mutations affect response areas
      for (const m of mutations) {
        if (m.type === 'childList' && m.addedNodes.length) {
          const target = m.target;
          if (findResponseAncestor(target) || getResponseElements().some(r => r.contains(target))) {
            reapply();
            return;
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // SPA navigation detection
    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        CommentStore.load().then(() => Highlighter.applyAll());
      }
    }, 500);
  }

  // =========================================================================
  // Click highlight to scroll to comment in panel
  // =========================================================================

  function initHighlightClickHandler() {
    document.addEventListener('click', e => {
      const mark = e.target.closest('mark.gc-highlight');
      if (!mark) return;
      const commentId = mark.dataset.commentId;
      if (!commentId) return;

      PanelUI.toggle(true);
      // Highlight the corresponding card
      setTimeout(() => {
        const card = document.querySelector(`.gc-panel .gc-comment-card`);
        const panel = document.querySelector('.gc-panel-list');
        if (!panel) return;
        const cards = panel.querySelectorAll('.gc-comment-card');
        const comments = CommentStore.getAll();
        const idx = comments.findIndex(c => c.id === commentId);
        if (idx >= 0 && cards[idx]) {
          cards.forEach(c => c.classList.remove('gc-comment-card--active'));
          cards[idx].classList.add('gc-comment-card--active');
          cards[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 300);
    });
  }

  // =========================================================================
  // Message passing (from popup)
  // =========================================================================

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'togglePanel') {
      PanelUI.toggle();
      sendResponse({ open: PanelUI.getIsOpen() });
    } else if (msg.action === 'clearComments') {
      // Remove all highlights
      CommentStore.getAll().forEach(c => Highlighter.removeHighlight(c.id));
      CommentStore.clearAll();
      sendResponse({ ok: true });
    } else if (msg.action === 'getState') {
      sendResponse({
        commentCount: CommentStore.getAll().length,
        panelOpen: PanelUI.getIsOpen(),
      });
    }
    return true;
  });

  // =========================================================================
  // Init
  // =========================================================================

  async function init() {
    SelectionWatcher.init();
    PanelUI.init();
    initHighlightClickHandler();
    await CommentStore.load();
    Highlighter.applyAll();
    initObserver();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
