const App = {
  state: {
    sessionId: localStorage.getItem('session_id') || null,
    bots: [],
    botsBySection: {},
    sections: [],
    currentBot: null,
    messages: [],
    chatId: localStorage.getItem('chat_id') || null,
    streaming: false,
    abortCtrl: null,
    ollamaEnabled: false,
    ollamaModels: [],
    conversations: [],
    pendingImage: null,
    screen: 'welcome',
  },

  els: {},

  async init() {
    this.cacheEls();
    this.bindEvents();
    if (this.state.sessionId) {
      await this.loadBots();
      await this.loadConversations();
      this.showScreen('explore');
    } else {
      this.showScreen('welcome');
    }
  },

  cacheEls() {
    const $ = (id) => document.getElementById(id);
    this.els = {
      welcomeScreen: $('welcomeScreen'),
      mainApp: $('mainApp'),
      welcomeCta: $('welcomeCta'),
      topBar: $('topBar'),
      exploreView: $('exploreView'),
      chatView: $('chatView'),
      menuBtn: $('menuBtn'),
      editBtn: $('editBtn'),
      botTrigger: $('botTrigger'),
      botLabel: $('botLabel'),
      newChatBtn: $('newChatBtn'),
      historyChips: $('historyChips'),
      promptCards: $('promptCards'),
      backBtn: $('backBtn'),
      chatTitle: $('chatTitle'),
      chatMessages: $('chatMessages'),
      streamingBar: $('streamingBar'),
      stopBtn: $('stopBtn'),
      chatInput: $('chatInput'),
      attachBtn: $('attachBtn'),
      sendBtn: $('sendBtn'),
      imgPreviewBar: $('imgPreviewBar'),
      imgPreview: $('imgPreview'),
      removeImg: $('removeImg'),
      modalContainer: $('modalContainer'),
      toastContainer: $('toastContainer'),
    };
  },

  bindEvents() {
    this.els.welcomeCta.onclick = () => this.authAnon();
    this.els.menuBtn.onclick = () => this.toggleMenu();
    this.els.editBtn.onclick = () => this.toggleOllama();
    this.els.botTrigger.onclick = () => this.showModal();
    this.els.newChatBtn.onclick = () => this.newChat();
    this.els.backBtn.onclick = () => this.showScreen('explore');
    this.els.sendBtn.onclick = () => this.send();
    this.els.attachBtn.onclick = () => this.pickImage();
    this.els.removeImg.onclick = () => this.clearImage();
    this.els.stopBtn.onclick = () => this.stopStream();

    this.els.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
    });

    document.addEventListener('paste', (e) => {
      const f = e.clipboardData?.items?.[0]?.getAsFile();
      if (f && f.type.startsWith('image/')) this.handleImage(f);
    });
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f && f.type.startsWith('image/')) this.handleImage(f);
    });

    // Prompt card clicks
    this.els.promptCards.querySelectorAll('.prompt-card').forEach(card => {
      card.addEventListener('click', () => {
        const text = card.dataset.prompt;
        if (text) { this.newChat(); this.els.chatInput.value = text; this.send(); }
      });
    });
  },

  showScreen(screen) {
    this.state.screen = screen;
    if (screen === 'welcome') {
      this.els.welcomeScreen.style.display = 'flex';
      this.els.mainApp.style.display = 'none';
    } else {
      this.els.welcomeScreen.style.display = 'none';
      this.els.mainApp.style.display = 'flex';
      if (screen === 'explore') {
        this.els.exploreView.style.display = 'block';
        this.els.chatView.style.display = 'none';
        this.els.topBar.style.display = 'flex';
        this.loadConversations();
      } else if (screen === 'chat') {
        this.els.exploreView.style.display = 'none';
        this.els.chatView.style.display = 'flex';
        this.els.topBar.style.display = 'none';
        setTimeout(() => this.els.chatInput.focus(), 100);
      }
    }
  },

  async authAnon() {
    this.els.welcomeCta.disabled = true;
    this.els.welcomeCta.textContent = 'Connecting...';
    try {
      const res = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail);
      this.state.sessionId = d.session_id;
      localStorage.setItem('session_id', d.session_id);
      await this.loadBots();
      await this.loadConversations();
      this.showScreen('explore');
    } catch (e) {
      this.toast('Auth: ' + e.message);
    }
    this.els.welcomeCta.disabled = false;
    this.els.welcomeCta.innerHTML = 'Lest chat now<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>';
  },

  async loadBots() {
    if (!this.state.sessionId) return;
    try {
      const res = await fetch('/api/bots', { headers: { 'X-Session-Id': this.state.sessionId } });
      if (res.status === 401) { await this.authAnon(); return this.loadBots(); }
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail);
      this.state.bots = d.bots;
      this.state.sections = d.sections;
      const by = {};
      for (const s of d.sections) by[s] = [];
      for (const b of d.bots) {
        const sec = b._section || 'other';
        if (!by[sec]) by[sec] = [];
        by[sec].push(b);
      }
      this.state.botsBySection = by;
      const saved = localStorage.getItem('bot_id');
      let found = saved ? this.state.bots.find(b => b.bot_id === saved || b._id === saved) : null;
      if (!found) found = this.state.bots[0];
      if (found) this.selectBot(found);
    } catch (e) {
      this.toast('Bots: ' + e.message);
    }
  },

  selectBot(bot) {
    this.state.currentBot = bot;
    localStorage.setItem('bot_id', bot.bot_id || bot._id);
    this.els.botLabel.textContent = (bot.name || 'AI Chat');
    this.els.chatTitle.textContent = (bot.name || 'AI Chat');
    const img = bot.mime_support && bot.mime_support.length > 0;
    this.els.attachBtn.title = img ? 'Attach image' : 'Attach';
  },

  async loadConversations() {
    if (!this.state.sessionId || this.state.screen === 'welcome') return;
    try {
      const res = await fetch('/api/conversations', { headers: { 'X-Session-Id': this.state.sessionId } });
      if (res.status === 401) { await this.authAnon(); return this.loadConversations(); }
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail);
      this.state.conversations = d.conversations || [];
      this.renderChips();
    } catch (e) {
      console.warn('Convs:', e.message);
    }
  },

  renderChips() {
    const el = this.els.historyChips;
    el.innerHTML = '';
    if (!this.state.conversations.length) {
      el.innerHTML = '<div class="chip-empty">Start a chat to see history</div>';
      return;
    }
    for (const c of this.state.conversations.slice(0, 8)) {
      const id = c._id || '';
      const title = c.title || `Chat ${id.slice(0, 8)}`;
      const chip = document.createElement('span');
      chip.className = 'history-chip';
      chip.textContent = title;
      chip.onclick = () => this.switchConv(id);
      el.appendChild(chip);
    }
  },

  async switchConv(chatId) {
    this.state.chatId = chatId;
    localStorage.setItem('chat_id', chatId);
    this.state.messages = [];
    this.state.pendingImage = null;
    this.els.chatMessages.innerHTML = '';
    this.showScreen('chat');
    const conv = this.state.conversations.find(c => c._id === chatId);
    this.els.chatTitle.textContent = conv ? (conv.title || 'Chat') : 'Chat';
    this.addMessage('ai', 'Continue chatting...');
  },

  newChat() {
    this.state.messages = [];
    this.state.chatId = null;
    this.state.pendingImage = null;
    localStorage.removeItem('chat_id');
    this.els.chatMessages.innerHTML = '';
    this.els.imgPreviewBar.style.display = 'none';
    this.els.chatTitle.textContent = this.state.currentBot?.name || 'New conversation';
    this.showScreen('chat');
  },

  addMessage(role, content, img) {
    const c = this.els.chatMessages;
    const empty = c.querySelector('.chat-empty');
    if (empty) c.innerHTML = '';

    const el = document.createElement('div');
    el.className = 'msg ' + role;

    const avatar = role === 'user'
      ? '<div class="msg-avatar">👤</div>'
      : '<div class="msg-avatar">🌸</div>';
    const label = role === 'user'
      ? '<div class="msg-label">Me</div>'
      : '<div class="msg-label">🌸 ChaTin</div>';
    const im = img ? `<img src="${this.escUrl(img)}" class="msg-img" onclick="App.viewImg('${this.escUrl(img)}')">` : '';
    const inner = content ? this.md(content) : '';
    el.innerHTML = `${avatar}<div class="msg-bubble">${label}<div class="msg-bubble-inner"><div class="msg-text">${im}${inner}</div></div></div>`;
    c.appendChild(el);
    this.scroll();
    return el;
  },

  updateLast(content) {
    const els = this.els.chatMessages.querySelectorAll('.msg.ai');
    if (!els.length) { this.addMessage('ai', ''); return; }
    const bubble = els[els.length - 1].querySelector('.msg-text');
    if (bubble) {
      bubble.innerHTML = content ? this.md(content) : '';
      const cur = bubble.querySelector('.cur');
      if (cur) cur.remove();
    }
    this.scroll();
  },

  addCursor() {
    const els = this.els.chatMessages.querySelectorAll('.msg.ai');
    if (!els.length) { this.addMessage('ai', ''); return this.addCursor(); }
    const bubble = els[els.length - 1].querySelector('.msg-text');
    if (bubble) {
      bubble.innerHTML = '<span class="cur"></span>';
    }
  },

  scroll() {
    requestAnimationFrame(() => { this.els.chatMessages.scrollTop = this.els.chatMessages.scrollHeight; });
  },

  showStreaming(show) {
    this.els.streamingBar.style.display = show ? 'flex' : 'none';
  },

  stopStream() {
    if (this.state.abortCtrl) {
      this.state.abortCtrl.abort();
      this.state.abortCtrl = null;
    }
    this.state.streaming = false;
    this.showStreaming(false);
    this.els.sendBtn.disabled = false;
    const cur = this.els.chatMessages.querySelector('.cur');
    if (cur) cur.remove();
  },

  async send() {
    const text = this.els.chatInput.value.trim();
    const img = this.state.pendingImage;
    if (!text && !img) return;
    if (this.state.streaming) return;
    if (!this.state.currentBot && !this.state.ollamaEnabled) { this.toast('Select a model'); return; }

    this.clearImage();
    this.els.chatInput.value = '';

    this.addMessage('user', text || '(sending image)', img);
    this.addMessage('ai', '');
    this.addCursor();

    this.state.streaming = true;
    this.showStreaming(true);
    this.els.sendBtn.disabled = true;

    try {
      if (this.state.ollamaEnabled) {
        await this.sendOllama(text, img);
      } else {
        await this.sendChat(text, img);
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        this.updateLast('Error: ' + e.message);
      }
    }

    this.state.streaming = false;
    this.showStreaming(false);
    this.els.sendBtn.disabled = false;
    const cur = this.els.chatMessages.querySelector('.cur');
    if (cur) cur.remove();
    this.loadConversations();
  },

  async sendChat(text, img) {
    const bot = this.state.currentBot;
    this.state.abortCtrl = new AbortController();

    const res = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Session-Id': this.state.sessionId },
      body: JSON.stringify({
        message: text || 'Analyze this image',
        model: bot.model,
        service: bot.service,
        bot_id: bot.bot_id || bot._id,
        chat_id: this.state.chatId,
        image: img || null,
      }),
      signal: this.state.abortCtrl.signal,
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'HTTP ' + res.status); }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', full = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t || !t.startsWith('data: ')) continue;
        const d = t.slice(6);
        if (d === '[DONE]') continue;
        try {
          const p = JSON.parse(d);
          if (p.error) throw new Error(p.error);
          if (p.chat_id) {
            this.state.chatId = p.chat_id;
            localStorage.setItem('chat_id', p.chat_id);
          }
          if (p.type === 'json' && p.content) {
            this.updateLast(p.content);
            if (p.chat_id) { this.state.chatId = p.chat_id; localStorage.setItem('chat_id', p.chat_id); }
            continue;
          }
          if (p.text) {
            full += p.text;
            this.updateLast(full);
          }
        } catch (e) {
          if (e.message !== 'Unexpected end of JSON input') throw e;
        }
      }
    }
  },

  async sendOllama(text, img) {
    const res = await fetch('/api/ollama/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text || 'Analyze this image',
        model: this.state.ollamaModels[0] || 'llama3',
        image: img || null,
      }),
    });
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'HTTP ' + res.status); }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t || !t.startsWith('data: ')) continue;
        const d = t.slice(6);
        if (d === '[DONE]') continue;
        try {
          const p = JSON.parse(d);
          if (p.text) { full += p.text; this.updateLast(full); }
        } catch (e) {}
      }
    }
  },

  toggleMenu() {
    const existing = document.querySelector('.menu-dropdown');
    if (existing) { existing.remove(); return; }
    const dd = document.createElement('div');
    dd.className = 'menu-dropdown';
    dd.innerHTML = `
      <button class="menu-item" id="menuOllama">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a8 8 0 0 0-8 8c0 2.5.8 4.8 2.2 6.7L12 22l5.8-5.3A9.9 9.9 0 0 0 20 10a8 8 0 0 0-8-8z"/></svg>
        ${this.state.ollamaEnabled ? '✓ Ollama' : 'Ollama'}
      </button>
      <button class="menu-item" id="menuTheme">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
        Theme
      </button>
      <button class="menu-item" id="menuAbout" disabled style="opacity:.4;cursor:default">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
        v1.0
      </button>
    `;
    dd.querySelector('#menuOllama').onclick = () => { this.toggleOllama(); dd.remove(); };
    dd.querySelector('#menuTheme').onclick = () => { this.toggleTheme(); dd.remove(); };
    document.addEventListener('click', function rem(e) { if (!dd.contains(e.target) && e.target !== this.els.menuBtn) { dd.remove(); document.removeEventListener('click', rem); } }.bind(this), { once: true });
    this.els.topBar.appendChild(dd);
  },

  pickImage() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = (e) => { const f = e.target.files?.[0]; if (f) this.handleImage(f); };
    inp.click();
  },

  handleImage(file) {
    if (!file.type.startsWith('image/')) return;
    const r = new FileReader();
    r.onload = (e) => {
      this.state.pendingImage = e.target.result;
      this.els.imgPreview.src = e.target.result;
      this.els.imgPreviewBar.style.display = 'flex';
      this.els.chatInput.focus();
    };
    r.readAsDataURL(file);
  },

  clearImage() {
    this.state.pendingImage = null;
    this.els.imgPreview.src = '';
    this.els.imgPreviewBar.style.display = 'none';
  },

  toggleOllama() {
    this.state.ollamaEnabled = !this.state.ollamaEnabled;
    this.toast(this.state.ollamaEnabled ? 'Local Ollama enabled' : 'Cloud API');
    if (this.state.ollamaEnabled) this.checkOllama();
  },

  async checkOllama() {
    try { const r = await fetch('/api/ollama/health'); const d = await r.json(); if (d.status !== 'ok') this.toast('Ollama unreachable'); }
    catch (e) { this.toast('Ollama unreachable'); }
  },

  toggleTheme() {
    const html = document.documentElement;
    const dark = html.getAttribute('data-theme') === 'dark';
    html.setAttribute('data-theme', dark ? 'light' : 'dark');
    localStorage.setItem('dark_mode', !dark);
  },

  showModal() {
    if (!this.state.bots.length) return;
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.innerHTML = `<div class="modal"><div class="modal-head"><h2>Select Model</h2><button class="modal-close">✕</button></div><div class="modal-search"><input type="text" placeholder="Search models..." id="ms"></div><div class="modal-body" id="mb"></div></div>`;
    const close = () => ov.remove();
    ov.querySelector('.modal-close').onclick = close;
    ov.onclick = (e) => { if (e.target === ov) close(); };
    const inp = ov.querySelector('#ms');
    const body = ov.querySelector('#mb');
    const render = (q) => {
      body.innerHTML = '';
      const query = (q || '').toLowerCase();
      for (const section of this.state.sections) {
        const bots = this.state.botsBySection[section] || [];
        const f = query ? bots.filter(b => (b.name||'').toLowerCase().includes(query)||(b.model||'').toLowerCase().includes(query)||(b.service||'').toLowerCase().includes(query)) : bots;
        if (!f.length) continue;
        const h = document.createElement('div'); h.className = 'modal-sec'; h.textContent = section.replace(/_/g, ' ').replace(/\b\w/g,c=>c.toUpperCase());
        body.appendChild(h);
        for (const b of f) {
          const o = document.createElement('div');
          o.className = 'bot-opt' + ((b.bot_id||b._id) === (this.state.currentBot?.bot_id||this.state.currentBot?._id) ? ' sel' : '');
          const bg = [];
          if (b.is_vip) bg.push('<span class="badge badge-vip">VIP</span>');
          if (b.mime_support) bg.push('<span class="badge badge-img">📷</span>');
          o.innerHTML = `<div class="info"><div class="name">${this.esc(b.name||'?')}</div><div class="detail"><span>${this.esc(b.service||'')}</span><span>${this.esc(b.model||'')}</span></div></div><div class="badges">${bg.join(' ')}</div>`;
          o.onclick = () => { this.selectBot(b); close(); this.toast(b.name); };
          body.appendChild(o);
        }
      }
      if (!body.children.length) body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted);">No models</div>';
    };
    inp.oninput = () => render(inp.value);
    render('');
    setTimeout(() => inp.focus(), 100);
    document.body.appendChild(ov);
  },

  viewImg(src) {
    const ov = document.createElement('div');
    ov.className = 'img-view';
    ov.innerHTML = '<img src="' + this.escUrl(src) + '">';
    ov.onclick = () => ov.remove();
    document.body.appendChild(ov);
  },

  escUrl(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  },

  md(text) {
    if (!text) return '';
    text = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    text = text.replace(/(https?:\/\/[^\s]+?\.(?:png|jpg|jpeg|webp|gif|bmp)(?:\?[^\s]*)?)/gi, (u) => '![image](' + u + ')');
    return marked.parse(text, { breaks: true, gfm: true });
  },

  esc(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; },

  toast(msg) {
    const x = document.querySelector('.toast');
    if (x) x.remove();
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
