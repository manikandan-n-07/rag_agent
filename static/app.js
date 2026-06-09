/* ═══════════════════════════════════════════════════════════
   RAG Chat — Frontend Logic  (fixed + delete/share)
   ═══════════════════════════════════════════════════════════ */
"use strict";

// ──────────────────────────────────────────────────────────
// State
// ──────────────────────────────────────────────────────────
const state = {
  currentChatId: null,
  isStreaming: false,
};

// ──────────────────────────────────────────────────────────
// Lazy DOM getter (always fresh, never cached at init)
// ──────────────────────────────────────────────────────────
const el = (id) => document.getElementById(id);

// ──────────────────────────────────────────────────────────
// Theme (Light / Dark)
// ──────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('ragchat-theme') || 'light';
  document.body.classList.toggle('dark', saved === 'dark');
}
function toggleTheme() {
  const dark = document.body.classList.toggle('dark');
  localStorage.setItem('ragchat-theme', dark ? 'dark' : 'light');
}
document.addEventListener('DOMContentLoaded', () => {
  el('themeToggle').addEventListener('click', toggleTheme);
});
initTheme();

// ──────────────────────────────────────────────────────────
// 3D Ring progress
// ──────────────────────────────────────────────────────────
const RING_C = 138.2; // 2π × r=22
function updateRing(pct) {
  const ring = el('ringFill');
  const label = el('progressPct');
  if (!ring || !label) return;
  ring.style.strokeDashoffset = RING_C - (pct / 100) * RING_C;
  label.textContent = Math.round(pct) + '%';
  const bar = el('progressBarFill');
  if (bar) bar.style.width = pct + '%';
}

// ──────────────────────────────────────────────────────────
// Toast
// ──────────────────────────────────────────────────────────
let _toastTimer;
function showToast(msg, type = 'info', ms = 3200) {
  clearTimeout(_toastTimer);
  const t = el('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  _toastTimer = setTimeout(() => { t.className = 'toast'; }, ms);
}

// ──────────────────────────────────────────────────────────
// Custom Confirm Modal
// ──────────────────────────────────────────────────────────
function showConfirm({ title, body, confirmText = 'Confirm', cancelText = 'Cancel' }) {
  return new Promise(resolve => {
    const backdrop = el('confirmBackdrop');
    el('confirmTitle').textContent = title;
    el('confirmBody').textContent = body;
    el('confirmOk').textContent = confirmText;
    el('confirmCancel').textContent = cancelText;

    // Animate in
    requestAnimationFrame(() => backdrop.classList.add('visible'));

    function close(result) {
      backdrop.classList.remove('visible');
      resolve(result);
      el('confirmOk').removeEventListener('click', onOk);
      el('confirmCancel').removeEventListener('click', onCancel);
      backdrop.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onEsc);
    }

    const onOk = () => close(true);
    const onCancel = () => close(false);
    const onBackdrop = (e) => { if (e.target === backdrop) close(false); };
    const onEsc = (e) => { if (e.key === 'Escape') close(false); };

    el('confirmOk').addEventListener('click', onOk);
    el('confirmCancel').addEventListener('click', onCancel);
    backdrop.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onEsc);
  });
}

// ──────────────────────────────────────────────────────────
// Custom Prompt Modal
// ──────────────────────────────────────────────────────────
function showPrompt({ title, body, defaultValue = '', confirmText = 'Save', cancelText = 'Cancel' }) {
  return new Promise(resolve => {
    const backdrop = el('promptBackdrop');
    const input = el('promptInput');
    el('promptTitle').textContent = title;
    el('promptBody').textContent = body;
    el('promptOk').textContent = confirmText;
    el('promptCancel').textContent = cancelText;
    input.value = defaultValue;

    // Animate in
    requestAnimationFrame(() => {
      backdrop.classList.add('visible');
      input.focus();
      input.select();
    });

    function close(result) {
      backdrop.classList.remove('visible');
      resolve(result);
      el('promptOk').removeEventListener('click', onOk);
      el('promptCancel').removeEventListener('click', onCancel);
      backdrop.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKeydown);
    }

    const onOk = () => close(input.value);
    const onCancel = () => close(null);
    const onBackdrop = (e) => { if (e.target === backdrop) close(null); };
    const onKeydown = (e) => {
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter') close(input.value);
    };

    el('promptOk').addEventListener('click', onOk);
    el('promptCancel').addEventListener('click', onCancel);
    backdrop.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKeydown);
  });
}

// ──────────────────────────────────────────────────────────
// API helpers
// ──────────────────────────────────────────────────────────
async function api(method, path, body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

// ──────────────────────────────────────────────────────────
// Sidebar toggle (Responsive overlay handling)
// ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const sidebar = el('sidebar');
  const toggleBtn = el('sidebarToggle');

  // Create backdrop if it doesn't exist
  let backdrop = el('sidebarBackdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'sidebarBackdrop';
    backdrop.className = 'sidebar-backdrop';
    document.body.appendChild(backdrop);
  }

  function isMobile() {
    return window.innerWidth <= 768;
  }

  function openSidebar() {
    sidebar.classList.add('open');
    sidebar.classList.remove('collapsed');
    backdrop.classList.add('visible');
    // Prevent scroll behind overlay on mobile
    if (isMobile()) document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    backdrop.classList.remove('visible');
    document.body.style.overflow = '';
  }

  function toggleSidebar() {
    if (isMobile()) {
      // On mobile: overlay slide-in/out
      if (sidebar.classList.contains('open')) {
        closeSidebar();
      } else {
        openSidebar();
      }
    } else {
      // On desktop: collapse/expand (push layout)
      sidebar.classList.toggle('collapsed');
    }
  }

  // Close button inside sidebar (visible on mobile only via CSS)
  const closeBtn = el('sidebarCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', closeSidebar);

  toggleBtn.addEventListener('click', toggleSidebar);
  backdrop.addEventListener('click', closeSidebar);

  // Expose closeSidebarMobile globally so chat selection etc. can close it
  window.closeSidebarMobile = closeSidebar;

  // On resize: if crossing from mobile→desktop, clean up mobile state
  let _resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => {
      if (!isMobile()) {
        sidebar.classList.remove('open');
        backdrop.classList.remove('visible');
        document.body.style.overflow = '';
      }
    }, 100);
  });
});

// ──────────────────────────────────────────────────────────
// Create New Chat  (FIX: was broken by early DOM ref)
// ──────────────────────────────────────────────────────────
async function createNewChat() {
  try {
    const chat = await api('POST', '/api/chat/new', { title: 'New Chat' });
    await loadChatList();
    await switchToChat(chat.chat_id);
    showToast('New chat created!', 'success');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  el('btnNewChat').addEventListener('click', createNewChat);
  el('btnStart').addEventListener('click', createNewChat);
});

// ──────────────────────────────────────────────────────────
// Switch to chat
// ──────────────────────────────────────────────────────────
async function switchToChat(chatId) {
  // If we were streaming in another chat, abort and reset
  if (state.isStreaming && _chatAbort) {
    _chatAbort.abort();
  }
  state.currentChatId = chatId;
  state.isStreaming = false;
  el('btnStop').style.display = 'none';
  el('btnSend').style.display = 'flex';
  document.querySelectorAll('.typing-cursor').forEach(e => e.classList.remove('typing-cursor'));

  // Show chat UI
  el('welcomeScreen').style.display = 'none';
  el('chatContainer').style.display = 'flex';
  el('chatContainer').style.flexDirection = 'column';

  // Topbar
  const chat = await api('GET', `/api/chat/${chatId}`);
  el('chatTitleDisplay').textContent = chat.title;
  el('chatIdBadge').style.display = 'flex';
  el('chatIdValue').textContent = chatId;

  // Highlight active sidebar item
  document.querySelectorAll('.chat-item').forEach(e => {
    e.classList.toggle('active', e.dataset.chatId === chatId);
  });

  await loadDocs(chatId);
  await loadHistory(chatId);
  el('questionInput').focus();
  updateSendBtn();

  if (window.closeSidebarMobile) window.closeSidebarMobile();
}

// ──────────────────────────────────────────────────────────
// Delete Chat
// ──────────────────────────────────────────────────────────
async function deleteChat(chatId, e) {
  e.stopPropagation();
  const confirmed = await showConfirm({
    title: 'Delete Chat?',
    body: 'This will permanently delete this chat and all its messages. This cannot be undone.',
    confirmText: 'Delete',
    cancelText: 'Cancel',
  });
  if (!confirmed) return;
  try {
    await api('DELETE', `/api/chat/${chatId}`);
    if (state.currentChatId === chatId) {
      state.currentChatId = null;
      el('welcomeScreen').style.display = '';
      el('chatContainer').style.display = 'none';
      el('chatIdBadge').style.display = 'none';
      el('chatTitleDisplay').textContent = 'Select or Create a Chat';
    }
    await loadChatList();
    showToast('Chat deleted.', 'info');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ──────────────────────────────────────────────────────────
// Rename Chat
// ──────────────────────────────────────────────────────────
async function renameChat(chatId, oldTitle, e) {
  e.stopPropagation();
  const newTitle = await showPrompt({
    title: 'Rename Chat',
    body: 'Enter a new name for this chat:',
    defaultValue: oldTitle,
    confirmText: 'Save',
    cancelText: 'Cancel'
  });
  if (!newTitle || newTitle.trim() === '' || newTitle === oldTitle) return;

  try {
    await api('PUT', `/api/chat/${chatId}/rename`, { title: newTitle.trim() });
    if (state.currentChatId === chatId) {
      el('chatTitleDisplay').textContent = newTitle.trim();
    }
    await loadChatList();
    showToast('Chat renamed.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ──────────────────────────────────────────────────────────
// Remove Document from chat
// ──────────────────────────────────────────────────────────
async function removeDocument(chatId, docId, filename, e) {
  e.stopPropagation();
  const confirmed = await showConfirm({
    title: `Remove "${filename}"?`,
    body: 'This will remove the document and all its indexed chunks from this chat. The chat history will be kept but answers may change.',
    confirmText: 'Remove',
    cancelText: 'Cancel',
  });
  if (!confirmed) return;
  try {
    // Animate chip out
    const chip = document.querySelector(`[data-doc-id="${docId}"]`);
    if (chip) { chip.style.transition = 'all 0.3s ease'; chip.style.opacity = '0'; chip.style.transform = 'scale(0.8)'; }
    await api('DELETE', `/api/chat/${chatId}/document/${docId}`);
    await loadDocs(chatId);
    showToast(`✓ "${filename}" removed from index.`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
    await loadDocs(chatId); // refresh anyway
  }
}

window.removeDocument = removeDocument;

async function shareChat(chatId, e) {
  e.stopPropagation();
  try {
    const data = await api('GET', `/api/chat/${chatId}/share`);
    const shareUrl = `${window.location.origin}/?chat=${data.chat_id}`;
    const shareText = `📂 ${data.title || 'RAG Chat'}\nExplore this AI chat session:\n${shareUrl}`;

    // Populate modal
    const backdrop = document.getElementById('shareBackdrop');
    document.getElementById('shareChatName').textContent = data.title || 'Untitled Chat';
    document.getElementById('shareLinkInput').value = shareUrl;
    document.getElementById('shareStatDocs').textContent = `📄 ${data.documents.length} doc${data.documents.length !== 1 ? 's' : ''}`;
    document.getElementById('shareStatMsgs').textContent = `💬 ${data.message_count} message${data.message_count !== 1 ? 's' : ''}`;
    document.getElementById('shareCopyLabel').textContent = 'Copy';

    // Show modal
    requestAnimationFrame(() => backdrop.classList.add('visible'));

    function closeShare() {
      backdrop.classList.remove('visible');
      backdrop.removeEventListener('click', onBd);
      document.removeEventListener('keydown', onEsc);
    }
    const onBd = (ev) => { if (ev.target === backdrop) closeShare(); };
    const onEsc = (ev) => { if (ev.key === 'Escape') closeShare(); };
    document.getElementById('shareClose').onclick = closeShare;
    backdrop.addEventListener('click', onBd);
    document.addEventListener('keydown', onEsc);

    // Copy link
    document.getElementById('shareCopyBtn').onclick = async () => {
      await navigator.clipboard.writeText(shareUrl);
      document.getElementById('shareCopyLabel').textContent = '✓ Copied!';
      setTimeout(() => { document.getElementById('shareCopyLabel').textContent = 'Copy'; }, 2000);
    };

    // Share buttons
    const encUrl = encodeURIComponent(shareUrl);
    const encText = encodeURIComponent(shareText);
    document.getElementById('shareWhatsapp').onclick = () => { window.open(`https://wa.me/?text=${encText}`, '_blank'); closeShare(); };
    document.getElementById('shareTelegram').onclick = () => { window.open(`https://t.me/share/url?url=${encUrl}&text=${encodeURIComponent('Check out this RAG Chat session!')}`, '_blank'); closeShare(); };
    document.getElementById('shareTwitter').onclick = () => { window.open(`https://twitter.com/intent/tweet?url=${encUrl}&text=${encodeURIComponent('Chatting with documents using local AI!')}`, '_blank'); closeShare(); };
    document.getElementById('shareLinkedin').onclick = () => { window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encUrl}`, '_blank'); closeShare(); };
    document.getElementById('shareEmail').onclick = () => { window.open(`mailto:?subject=${encodeURIComponent('Check out this RAG Chat')}&body=${encText}`, '_blank'); closeShare(); };
    document.getElementById('shareNative').onclick = async () => {
      if (navigator.share) {
        try { await navigator.share({ title: data.title || 'RAG Chat', text: 'Check out this AI chat session!', url: shareUrl }); closeShare(); }
        catch (_) { }
      } else {
        await navigator.clipboard.writeText(shareUrl);
        showToast('Link copied — share it anywhere!', 'success');
        closeShare();
      }
    };

  } catch (err) {
    showToast(err.message, 'error');
  }
}

// expose to inline onclick handlers
window.switchToChat = switchToChat;
window.deleteChat = deleteChat;
window.shareChat = shareChat;

// ──────────────────────────────────────────────────────────
// Load chat list  — always-visible three-dots (⋮) menu
// ──────────────────────────────────────────────────────────
async function loadChatList() {
  try {
    const chats = await api('GET', '/api/chats');
    const list = el('chatList');

    if (!chats.length) {
      list.innerHTML = `<div class="empty-chats">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <p>No chats yet</p>
      </div>`;
      return;
    }

    list.innerHTML = chats.map(chat => {
      const label = formatDate(new Date(chat.updated_at));
      const active = chat.chat_id === state.currentChatId ? ' active' : '';
      const safeId = chat.chat_id;
      const safeTitle = escHtml(chat.title).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `<div class="chat-item${active}" data-chat-id="${safeId}"
                   onclick="switchToChat('${safeId}')">
        <div class="chat-item-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div class="chat-item-info">
          <div class="chat-item-title">${escHtml(chat.title)}</div>
          <div class="chat-item-date">${label}</div>
        </div>
        <div class="chat-item-menu" onclick="event.stopPropagation()">
          <button class="chat-dots-btn" title="More options"
                  onclick="toggleChatMenu('${safeId}', event)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="1.8"/>
              <circle cx="12" cy="12" r="1.8"/>
              <circle cx="12" cy="19" r="1.8"/>
            </svg>
          </button>
          <div class="chat-dropdown" id="menu-${safeId}">
            <button class="chat-dd-item rename-dd"
                    onclick="renameChat('${safeId}','${safeTitle}',event);closeChatMenus()">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
              </svg>
              Rename
            </button>
            <button class="chat-dd-item share-dd"
                    onclick="shareChat('${safeId}',event);closeChatMenus()">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
              </svg>
              Share
            </button>
            <div class="chat-dd-separator"></div>
            <button class="chat-dd-item delete-dd"
                    onclick="deleteChat('${safeId}',event);closeChatMenus()">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6"/><path d="M14 11v6"/>
                <path d="M9 6V4h6v2"/>
              </svg>
              Delete
            </button>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    console.error('loadChatList:', e);
  }
}

window.toggleChatMenu = function (chatId, e) {
  e.stopPropagation();
  const menu = document.getElementById('menu-' + chatId);
  if (!menu) return;
  const isOpen = menu.classList.contains('open');
  closeChatMenus();
  if (!isOpen) {
    const btnRect = e.currentTarget.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = (btnRect.bottom + 4) + 'px';
    menu.style.left = 'auto';
    menu.style.right = (window.innerWidth - btnRect.right) + 'px';
    menu.style.bottom = 'auto';
    menu.classList.add('open');
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      if (rect.bottom > window.innerHeight - 16) {
        menu.style.top = 'auto';
        menu.style.bottom = (window.innerHeight - btnRect.top + 4) + 'px';
      }
    });
  }
};

window.closeChatMenus = function () {
  document.querySelectorAll('.chat-dropdown.open, .doc-dropdown.open')
    .forEach(m => {
      m.classList.remove('open', 'flip-up', 'flip-left');
      m.style.position = '';
      m.style.top = '';
      m.style.left = '';
      m.style.right = '';
      m.style.bottom = '';
    });
};

// Global click/scroll → close any open dropdowns
document.addEventListener('click', () => {
  if (typeof closeChatMenus === 'function') closeChatMenus();
});
document.addEventListener('scroll', () => {
  if (typeof closeChatMenus === 'function') closeChatMenus();
}, true);

// ──────────────────────────────────────────────────────────
// Load docs panel  — always-visible three-dots (⋮) per chip
// ──────────────────────────────────────────────────────────
async function loadDocs(chatId) {
  try {
    const docs = await api('GET', `/api/chat/${chatId}/documents`);
    el('docsCount').textContent = docs.length;
    if (!docs.length) {
      el('docsList').innerHTML = `<div class="docs-empty"><p>No files yet. Upload below.</p></div>`;
      return;
    }
    el('docsList').innerHTML = docs.map(d => {
      const safeFile = escHtml(d.filename).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `<div class="doc-chip" data-doc-id="${d.id}" title="${escHtml(d.filename)}">
        <span class="doc-chip-icon">${fileIcon(d.file_type)}</span>
        <div class="doc-chip-info">
          <span class="doc-chip-name">${escHtml(truncate(d.filename, 18))}</span>
          <span class="doc-chip-meta">${d.num_pages} pg · ${d.num_chunks} chunks</span>
        </div>
        <div class="doc-chip-menu" onclick="event.stopPropagation()">
          <button class="doc-dots-btn" title="More options"
                  onclick="toggleDocMenu('doc-dd-${d.id}', event)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="1.8"/>
              <circle cx="12" cy="12" r="1.8"/>
              <circle cx="12" cy="19" r="1.8"/>
            </svg>
          </button>
          <div class="doc-dropdown" id="doc-dd-${d.id}">
            <button class="doc-dd-item download-dd"
                    onclick="downloadDocument('${chatId}',${d.id},'${safeFile}',event);closeChatMenus()">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Download
            </button>
            <div class="chat-dd-separator"></div>
            <button class="doc-dd-item remove-dd"
                    onclick="removeDocument('${chatId}',${d.id},'${safeFile}',event);closeChatMenus()">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6"/><path d="M14 11v6"/>
                <path d="M9 6V4h6v2"/>
              </svg>
              Remove
            </button>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    console.error('loadDocs:', e);
  }
}

window.toggleDocMenu = function (id, e) {
  e.stopPropagation();
  const menu = document.getElementById(id);
  if (!menu) return;
  const isOpen = menu.classList.contains('open');
  closeChatMenus();
  if (!isOpen) {
    const btnRect = e.currentTarget.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = (btnRect.bottom + 4) + 'px';
    menu.style.left = 'auto';
    menu.style.right = (window.innerWidth - btnRect.right) + 'px';
    menu.style.bottom = 'auto';
    menu.classList.add('open');
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth - 12) {
        menu.style.left = 'auto';
        menu.style.right = (window.innerWidth - btnRect.right) + 'px';
      }
      if (rect.bottom > window.innerHeight - 12) {
        menu.style.top = 'auto';
        menu.style.bottom = (window.innerHeight - btnRect.top + 4) + 'px';
      }
    });
  }
};

window.downloadDocument = async function (chatId, docId, filename, e) {
  if (e) e.stopPropagation();
  try {
    showToast('Preparing download…', 'info', 2000);
    const res = await fetch(`/api/chat/${chatId}/document/${docId}/download`);
    if (!res.ok) throw new Error('Download not available from server');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    showToast(`✓ Downloaded "${filename}"`, 'success');
  } catch (err) {
    showToast('Download failed: ' + err.message, 'error');
  }
};

// ──────────────────────────────────────────────────────────
// Load history
// ──────────────────────────────────────────────────────────
async function loadHistory(chatId) {
  try {
    const msgs = await api('GET', `/api/chat/${chatId}/history`);
    el('messagesList').innerHTML = '';
    if (!msgs.length) {
      el('messagesList').innerHTML = `<div class="chat-hint" id="chatHint">
        <div class="hint-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <p>Upload a document below, then ask any question about it.</p>
      </div>`;
      return;
    }
    msgs.forEach(m => renderMessage(m.role, m.content, m.citations || []));
    scrollToBottom(true);
  } catch (e) {
    console.error('loadHistory:', e);
  }
}

// ──────────────────────────────────────────────────────────
// Render a message bubble
// ──────────────────────────────────────────────────────────


// ──────────────────────────────────────────────────────────
// Load history
// ──────────────────────────────────────────────────────────
async function loadHistory(chatId) {
  try {
    const msgs = await api('GET', `/api/chat/${chatId}/history`);
    el('messagesList').innerHTML = '';
    if (!msgs.length) {
      el('messagesList').innerHTML = `<div class="chat-hint" id="chatHint">
        <div class="hint-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <p>Upload a document below, then ask any question about it.</p>
      </div>`;
      return;
    }
    msgs.forEach(m => renderMessage(m.role, m.content, m.citations || []));
    scrollToBottom(true);
  } catch (e) {
    console.error('loadHistory:', e);
  }
}

// ──────────────────────────────────────────────────────────
// Render a message bubble
// ──────────────────────────────────────────────────────────
const _LOGO_IMG = `<img src="/static/logo.svg" alt="RAG" style="width:100%;height:100%;object-fit:contain;padding:3px;border-radius:4px;"/>`;
function renderMessage(role, content, citations = [], streaming = false) {
  const msgEl = document.createElement('div');
  msgEl.className = `message ${role}`;

  const avatarHtml = role === 'user'
    ? `<div class="avatar-container">
         <div class="avatar avatar-user">
           <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
             <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
             <circle cx="12" cy="7" r="4"></circle>
           </svg>
         </div>
         <span class="avatar-name">You</span>
       </div>`
    : `<div class="avatar-container">
         <div class="avatar avatar-ai">${_LOGO_IMG}</div>
         <span class="avatar-name">RAG Agent</span>
       </div>`;

  const bubbleId = `bubble-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const html = streaming ? content : formatMarkdown(content);

  msgEl.innerHTML = `
    <div class="message-row">
      ${avatarHtml}
      <div class="bubble${streaming ? ' typing-cursor' : ''}" id="${bubbleId}">${html}</div>
    </div>
    <div class="message-meta">${role === 'user' ? 'You' : 'AI'} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}, ${new Date().toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })}</div>`;

  if (role === 'assistant' && citations.length > 0) {
    msgEl.appendChild(buildCitationsBlock(citations));
  }

  el('messagesList').appendChild(msgEl);
  scrollToBottom(true);

  if (!streaming && window.MathJax) {
    MathJax.typesetPromise([msgEl]).catch(err => console.error('MathJax error', err));
  }

  return { el: msgEl, bubbleId, getBubble: () => document.getElementById(bubbleId) };
}

// ──────────────────────────────────────────────────────────
// Citations block
// ──────────────────────────────────────────────────────────
function buildCitationsBlock(citations) {
  const wrap = document.createElement('div');
  wrap.className = 'citations-wrapper';
  const tid = `ct-${Date.now()}`;
  const lid = `cl-${Date.now()}`;
  wrap.innerHTML = `
    <button class="citations-toggle" id="${tid}" onclick="toggleCitations('${tid}','${lid}')">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
      ${citations.length} source${citations.length > 1 ? 's' : ''} cited
    </button>
    <div class="citations-list" id="${lid}">
      ${citations.map(c => `
        <div class="citation-card">
          <div class="citation-header">
            <span class="citation-source">${escHtml(c.source)}</span>
            <span class="citation-page">Page ${c.page}</span>
            <span class="citation-type">${escHtml(c.file_type || 'doc')}</span>
            <span class="citation-score">rel: ${(c.score * 100).toFixed(0)}%</span>
          </div>
          <div class="citation-text">"${escHtml(c.text)}"</div>
        </div>`).join('')}
    </div>`;
  return wrap;
}

window.toggleCitations = (tid, lid) => {
  document.getElementById(tid).classList.toggle('open');
  document.getElementById(lid).classList.toggle('visible');
};

// ──────────────────────────────────────────────────────────
// Thinking indicator
// ──────────────────────────────────────────────────────────
function showThinking() {
  const d = document.createElement('div');
  d.className = 'message assistant';
  d.id = 'thinkingIndicator';
  d.innerHTML = `
    <div class="message-row">
      <div class="avatar-container">
        <div class="avatar avatar-ai">${_LOGO_IMG}</div>
        <span class="avatar-name">RAG Agent</span>
      </div>
      <div class="bubble thinking-bubble">
        <div class="thinking-dots"><span></span><span></span><span></span></div>
        <span class="thinking-text">Searching documents…</span>
      </div>
    </div>`;
  el('messagesList').appendChild(d);
  scrollToBottom(true);
  return d;
}
function removeThinking() {
  const d = document.getElementById('thinkingIndicator');
  if (d) d.remove();
}

// ──────────────────────────────────────────────────────────
// Send question & Stop generation
// ──────────────────────────────────────────────────────────
let _chatAbort = null;
let webSearchEnabled = false;

async function sendQuestion() {
  if (state.isStreaming || !state.currentChatId) return;
  const question = el('questionInput').value.trim();
  if (!question) return;

  // Remove hint
  const hint = document.getElementById('chatHint');
  if (hint) hint.remove();

  el('questionInput').value = '';
  el('questionInput').style.height = 'auto';
  updateSendBtn();

  state.isStreaming = true;
  el('btnSend').style.display = 'none';
  el('btnStop').style.display = 'flex';

  // Safety timeout: if streaming hangs for 3 min, auto-reset UI
  const _streamingTimeout = setTimeout(() => {
    if (state.isStreaming) {
      if (_chatAbort) _chatAbort.abort();
      state.isStreaming = false;
      el('btnStop').style.display = 'none';
      el('btnSend').style.display = 'flex';
      updateSendBtn();
      document.querySelectorAll('.typing-cursor').forEach(e => e.classList.remove('typing-cursor'));
      showToast('Response timed out. Please try again.', 'error');
    }
  }, 3 * 60 * 1000);

  _chatAbort = new AbortController();

  renderMessage('user', question);
  showThinking();

  try {
    const res = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: state.currentChatId,
        question,
        use_web_search: webSearchEnabled
      }),
      signal: _chatAbort.signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Query failed');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', citations = [], aiMsgEl = null, bubble = null, full = '';
    let isFinished = false;

    while (!isFinished) {
      const { value, done } = await reader.read();
      if (done) {
        // Flush any remaining data in the buffer before exiting
        if (buf.trim()) {
          const finalPart = buf.trim();
          if (finalPart.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(finalPart.slice(6));
              if (parsed.type === 'done') {
                if (bubble) {
                  bubble.classList.remove('typing-cursor');
                  bubble.innerHTML = formatMarkdown(full);
                  if (citations.length && aiMsgEl) aiMsgEl.appendChild(buildCitationsBlock(citations));
                  if (window.MathJax) MathJax.typesetPromise([bubble]).catch(() => { });
                  scrollToBottom();
                }
              } else if (parsed.type === 'token' && bubble) {
                full += parsed.data;
                bubble.innerHTML = formatMarkdown(full);
                bubble.classList.remove('typing-cursor');
                scrollToBottom();
              }
            } catch (_) { }
          }
        }
        break;
      }
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();

      for (const part of parts) {
        if (!part.trim()) continue;  // skip empty parts
        if (part.startsWith(':')) continue;  // skip SSE comment/keepalive lines
        if (!part.startsWith('data: ')) continue;
        let parsed;
        try { parsed = JSON.parse(part.slice(6)); } catch { continue; }

        if (parsed.type === 'error') {
          removeThinking();
          if (aiMsgEl && !full) aiMsgEl.remove();
          document.querySelectorAll('.typing-cursor').forEach(e => e.classList.remove('typing-cursor'));
          showToast(parsed.message, 'error', 5000);
          // Use isFinished+break instead of return — guarantees finally block runs
          isFinished = true;
          break;
        }

        if (parsed.type === 'citations') {
          citations = parsed.data;
          removeThinking();
          const r = renderMessage('assistant', '', [], true);
          aiMsgEl = r.el;
          bubble = r.getBubble();
          bubble.classList.add('typing-cursor');
        }

        if (parsed.type === 'token' && bubble) {
          full += parsed.data;
          bubble.innerHTML = formatMarkdown(full);
          bubble.classList.add('typing-cursor');
          scrollToBottom();
        }

        if (parsed.type === 'done') {
          if (bubble) {
            bubble.classList.remove('typing-cursor');
            bubble.innerHTML = formatMarkdown(full);
            if (citations.length && aiMsgEl) aiMsgEl.appendChild(buildCitationsBlock(citations));
            if (window.MathJax) {
              MathJax.typesetPromise([bubble]).catch(err => console.error('MathJax error', err));
            }
            scrollToBottom();
          } else {
            // Edge case: done arrived without citations/bubble — clean up any stray cursors
            document.querySelectorAll('.typing-cursor').forEach(e => e.classList.remove('typing-cursor'));
          }
          isFinished = true;
          break;
        }
      }
    }

  } catch (e) {
    if (e.name === 'AbortError') {
      removeThinking();
      const activeCursor = document.querySelector('.typing-cursor');
      if (activeCursor) activeCursor.classList.remove('typing-cursor');
      showToast('Generation stopped.', 'info');
    } else {
      removeThinking();
      showToast(e.message, 'error', 5000);
    }
  } finally {
    clearTimeout(_streamingTimeout);
    state.isStreaming = false;
    _chatAbort = null;
    document.querySelectorAll('.typing-cursor').forEach(e => e.classList.remove('typing-cursor'));
    el('btnStop').style.display = 'none';
    el('btnSend').style.display = 'flex';
    updateSendBtn();
    loadChatList().catch(() => { });
  }
}

function stopGeneration() {
  if (_chatAbort) {
    _chatAbort.abort();
  }
}

// ──────────────────────────────────────────────────────────
// File upload  (with AbortController stop button)
// ──────────────────────────────────────────────────────────
let _uploadAbort = null;  // current AbortController

async function uploadFile(file) {
  if (!state.currentChatId) {
    showToast('Please create or select a chat first.', 'error');
    return;
  }
  const allowed = ['.pdf', '.html', '.htm', '.txt', '.docx', '.md'];
  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  if (!allowed.includes(ext)) {
    showToast(`File type "${ext}" not supported.`, 'error');
    return;
  }

  const sizeLabel = file.size > 1048576
    ? (file.size / 1048576).toFixed(1) + ' MB'
    : Math.round(file.size / 1024) + ' KB';

  const progEl = el('uploadProgress');
  const statusEl = el('progressStatus');
  const sizeEl = el('progressSize');
  const iconEl = el('progressFileIcon');
  const stopBtn = el('uploadStopBtn');

  // Create abort controller for this upload
  _uploadAbort = new AbortController();

  progEl.style.display = 'flex';
  progEl.className = 'upload-progress';
  el('progressLabel').textContent = truncate(file.name, 30);
  if (iconEl) iconEl.textContent = fileIcon(ext.replace('.', ''));
  if (statusEl) statusEl.textContent = 'Uploading…';
  if (sizeEl) sizeEl.textContent = sizeLabel;
  if (stopBtn) stopBtn.style.display = 'flex';
  updateRing(0);

  let prog = 0;
  const iv = setInterval(() => {
    prog = Math.min(prog + Math.random() * 5 + 1, 88);
    updateRing(prog);
    if (statusEl) statusEl.textContent = prog < 50 ? 'Uploading…' : 'Indexing chunks…';
  }, 250);

  const fd = new FormData();
  fd.append('file', file);
  fd.append('chat_id', state.currentChatId);

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      body: fd,
      signal: _uploadAbort.signal,
    });
    clearInterval(iv);

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Upload failed');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let finalData = null;
    let buf = '';
    let isFinished = false;

    while (!isFinished) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();

      for (const part of parts) {
        if (part.startsWith('data: ')) {
          try {
            const data = JSON.parse(part.slice(6));
            if (data.type === 'error') {
              throw new Error(data.message);
            } else if (data.type === 'progress') {
              if (statusEl) statusEl.textContent = data.data.message;
              if (data.data.status === 'embedding') {
                updateRing(Math.round(data.data.progress * 100));
              } else if (data.data.status === 'chunking') {
                updateRing(20);
              } else if (data.data.status === 'extracting') {
                updateRing(10);
              }
            } else if (data.type === 'done') {
              finalData = data;
              isFinished = true;
              break;
            }
          } catch (e) {
            if (e.message && part.includes('"type": "error"')) {
              throw e;
            }
            console.error("Error parsing SSE JSON:", e, part);
          }
        }
      }
    }

    if (!finalData) throw new Error("Upload stream ended unexpectedly");

    updateRing(100);
    progEl.classList.add('success');
    if (statusEl) statusEl.textContent = `✓ ${finalData.document.num_chunks} chunks · ${finalData.document.num_pages} pages`;
    if (sizeEl) sizeEl.textContent = sizeLabel;
    if (stopBtn) stopBtn.style.display = 'none';

    await loadDocs(state.currentChatId);
    await loadChatList();
    const chat = await api('GET', `/api/chat/${state.currentChatId}`);
    el('chatTitleDisplay').textContent = chat.title;
    showToast(`✓ "${file.name}" uploaded and indexed!`, 'success');
    setTimeout(() => { progEl.style.display = 'none'; progEl.classList.remove('success'); }, 4000);

    const hint = document.getElementById('chatHint');
    if (hint) hint.remove();
    updateSendBtn();

  } catch (e) {
    clearInterval(iv);
    if (e.name === 'AbortError') {
      // User cancelled
      progEl.style.display = 'none';
      showToast('Upload cancelled.', 'info');
    } else {
      updateRing(prog);
      progEl.classList.add('error');
      if (statusEl) statusEl.textContent = `✗ ${e.message}`;
      if (stopBtn) stopBtn.style.display = 'none';
      showToast(e.message, 'error', 5000);
      setTimeout(() => { progEl.style.display = 'none'; progEl.classList.remove('error'); }, 5000);
    }
  } finally {
    _uploadAbort = null;
  }
}

// ──────────────────────────────────────────────────────────
// Input / upload event wiring  (after DOMContentLoaded)
// ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Upload modal logic
  const uploadBd = el('uploadBackdrop');
  const uploadIn = el('uploadModalInner');

  function openUploadModal() {
    requestAnimationFrame(() => uploadBd.classList.add('visible'));
  }
  function closeUploadModal() {
    uploadBd.classList.remove('visible');
    uploadIn.classList.remove('drag-over');
  }

  el('btnAttach').addEventListener('click', openUploadModal);

  const btnWebSearch = el('btnWebSearch');
  const webSearchLabel = el('webSearchLabel');
  if (btnWebSearch) {
    btnWebSearch.addEventListener('click', () => {
      webSearchEnabled = !webSearchEnabled;
      if (webSearchEnabled) {
        btnWebSearch.style.color = 'var(--accent)';
        btnWebSearch.style.background = 'var(--accent-soft)';
        btnWebSearch.title = 'Web Search (On)';
        if (webSearchLabel) webSearchLabel.style.display = 'inline';
        showToast('Web search enabled for next question.', 'success');
      } else {
        btnWebSearch.style.color = 'var(--text-muted)';
        btnWebSearch.style.background = 'transparent';
        btnWebSearch.title = 'Web Search (Off)';
        if (webSearchLabel) webSearchLabel.style.display = 'none';
        showToast('Web search disabled.', 'info');
      }
    });
  }
  el('uploadClose').addEventListener('click', closeUploadModal);
  uploadBd.addEventListener('click', e => { if (e.target === uploadBd) closeUploadModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && uploadBd.classList.contains('visible')) closeUploadModal(); });

  uploadIn.addEventListener('click', e => {
    if (e.target.tagName !== 'LABEL') el('fileInput').click();
  });

  el('fileInput').addEventListener('change', e => {
    if (e.target.files.length) {
      [...e.target.files].forEach(uploadFile);
      closeUploadModal();
    }
    e.target.value = '';
  });

  // Stop button — aborts the in-flight fetch
  el('uploadStopBtn').addEventListener('click', () => {
    if (_uploadAbort) _uploadAbort.abort();
  });

  uploadIn.addEventListener('dragover', e => {
    e.preventDefault();
    uploadIn.classList.add('drag-over');
  });
  uploadIn.addEventListener('dragleave', () => {
    uploadIn.classList.remove('drag-over');
  });
  uploadIn.addEventListener('drop', e => {
    e.preventDefault();
    uploadIn.classList.remove('drag-over');
    if (e.dataTransfer.files.length) {
      [...e.dataTransfer.files].forEach(uploadFile);
      closeUploadModal();
    }
  });

  // Global drag-and-drop to open modal or accept files directly
  document.addEventListener('dragover', e => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('Files') && !uploadBd.classList.contains('visible')) {
      openUploadModal();
    }
  });
  document.addEventListener('drop', e => {
    e.preventDefault();
    if (state.currentChatId && e.dataTransfer.files.length) {
      [...e.dataTransfer.files].forEach(uploadFile);
      closeUploadModal();
    }
  });

  el('questionInput').addEventListener('input', () => {
    const ta = el('questionInput');
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 150) + 'px';
    updateSendBtn();
  });
  el('questionInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!el('btnSend').disabled) sendQuestion();
    }
  });
  el('btnSend').addEventListener('click', sendQuestion);
  el('btnStop').addEventListener('click', stopGeneration);

  el('btnCopyId').addEventListener('click', () => {
    navigator.clipboard.writeText(state.currentChatId || '').then(() => {
      showToast('Chat ID copied!', 'success');
    });
  });
});

function updateSendBtn() {
  const has = el('questionInput').value.trim().length > 0;
  const chat = !!state.currentChatId;
  el('btnSend').disabled = !has || !chat || state.isStreaming;
}

// ──────────────────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────────────────
function scrollToBottom(force = false) {
  // Double rAF: first frame lets layout settle, second frame performs scroll
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const area = el('messagesArea');
      if (!area) return;
      const distFromBottom = area.scrollHeight - area.scrollTop - area.clientHeight;
      const isNearBottom = distFromBottom < 140;
      if (force || isNearBottom) {
        // Use smooth scroll for a nice feel; instant if forced during rapid streaming
        area.scrollTo({ top: area.scrollHeight, behavior: force ? 'instant' : 'smooth' });
      }
    });
  });
}
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
function formatDate(d) {
  const now = new Date(), diff = now - d, m = Math.floor(diff / 60000);
  if (isNaN(m)) return 'Invalid Date';
  if (m < 1) return 'just now';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  return d.toLocaleDateString();
}
function fileIcon(t) {
  return { pdf: '📄', html: '🌐', htm: '🌐', txt: '📝', docx: '📋', md: '📓' }[t] || '📁';
}
function formatMarkdown(text) {
  let h = escHtml(text);

  // Extract block and inline math to protect from markdown formatting
  const mathBlocks = [];
  let counter = 0;

  h = h.replace(/\$\$([\s\S]+?)\$\$/g, (match) => {
    mathBlocks.push(match);
    return `__MATH_BLOCK_${counter++}__`;
  });

  h = h.replace(/\$([^\s\$][^$]*?[^\s\$]|[^\s\$])\$/g, (match) => {
    mathBlocks.push(match);
    return `__MATH_BLOCK_${counter++}__`;
  });

  h = h.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  h = h.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  h = h.replace(/^# (.+)$/gm, '<h2>$1</h2>');
  h = h.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
  h = h.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
  h = h.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  h = h.replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br/>');
  h = '<p>' + h + '</p>';
  h = h.replace(/<p><\/p>/g, '');

  // Restore math
  for (let i = 0; i < counter; i++) {
    h = h.replace(`__MATH_BLOCK_${i}__`, mathBlocks[i]);
  }
  return h;
}

// ──────────────────────────────────────────────────────────
// Init — check URL for ?chat= param
// ──────────────────────────────────────────────────────────
async function init() {
  await loadChatList();
  // Auto-open chat if ?chat=<id> is in URL
  const params = new URLSearchParams(window.location.search);
  const chatParam = params.get('chat');
  if (chatParam) {
    try { await switchToChat(chatParam); } catch { }
  }
}

document.addEventListener('DOMContentLoaded', init);