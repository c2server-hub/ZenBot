const puppeteer = require('puppeteer');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

/* ---------- Utilitaires ---------- */
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const rand = (a) => a[Math.floor(Math.random() * a.length)];
const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const stripEmoji = (s) => (s || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2B00}-\u{2BFF}]/gu, '')
    .replace(/\s+/g, ' ').trim();
const cut = (s, n = 750) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s);

/* =========================================================
   CONFIGURATION
   ========================================================= */
const CONFIG = {
    username:  process.env.SNAP_USER || '',
    password:  process.env.SNAP_PASS || '',
    groupName: process.env.GROUP    || 'Zentest',
    botName:   'snapzen67',
    loginUrl:  'https://accounts.snapchat.com/v2/login',
    webUrl:    'https://www.snapchat.com/web',
    pluginsDir: path.join(__dirname, 'plugins'),
    checkInterval: 500,
    cooldownMs: 1500,
    userDataDir: './snap_profile',
    autoLogin: true,
    headless: false,
    debug: true,
    typingDelay: 40,
    messageSelector: null,
    ownPrefixes: ['moi'],
};

/* =========================================================
   PLUGIN MANAGER
   Format d'un plugin (fichier ./plugins/xyz.js) :

   module.exports = {
       name: 'xyz',                    // unique
       description: '...',
       version: '1.0.0',
       author: 'toi',
       commands: {
           '!macmd': { desc: '...', run: async (bot, args) => 'réponse' },
       },
   };
   ========================================================= */
class PluginManager {
    constructor(dir) {
        this.dir = dir;
        this.plugins = new Map();   // name -> { manifest, commands, file, enabled }
    }

    loadAll() {
        if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
        for (const f of fs.readdirSync(this.dir).filter(f => f.endsWith('.js'))) {
            this.load(f);
        }
    }

    load(file) {
        try {
            const full = path.join(this.dir, file);
            delete require.cache[require.resolve(full)];   // hot-reload
            const mod = require(full);
            if (!mod.commands || typeof mod.commands !== 'object') {
                throw new Error('doit exporter "commands" (objet)');
            }
            const manifest = {
                name: mod.name || file.replace(/\.js$/, ''),
                description: mod.description || '',
                version: mod.version || '1.0.0',
                author: mod.author || '?',
            };
            this.plugins.set(manifest.name, {
                manifest, commands: mod.commands, file, enabled: true,
            });
            console.log(`🔌 Plugin "${manifest.name}" v${manifest.version} chargé (${Object.keys(mod.commands).length} cmd)`);
            return true;
        } catch (e) {
            console.error(`❌ Plugin ${file} : ${e.message}`);
            return false;
        }
    }

    reloadAll() {
        const files = [...this.plugins.values()].map(p => p.file);
        this.plugins.clear();
        files.forEach(f => this.load(f));
    }

    reload(name) {
        const p = this.plugins.get(name);
        if (!p) return false;
        const f = p.file;
        this.plugins.delete(name);
        return this.load(f);
    }

    unload(name) { return this.plugins.delete(name); }

    setEnabled(name, enabled) {
        const p = this.plugins.get(name);
        if (!p) return false;
        p.enabled = !!enabled;
        return true;
    }

    /** Retourne Map: "!cmd" -> { def, plugin } (uniquement plugins actifs) */
    getCommands() {
        const out = new Map();
        for (const [name, p] of this.plugins) {
            if (!p.enabled) continue;
            for (const [cmd, def] of Object.entries(p.commands)) {
                out.set(cmd, { def, plugin: name });
            }
        }
        return out;
    }

    list() {
        return [...this.plugins.values()].map(p => ({
            ...p.manifest, file: p.file, enabled: p.enabled,
            commands: Object.keys(p.commands),
        }));
    }
}

/* =========================================================
   COMMANDES SYSTÈME (toujours disponibles, non pluginisables)
   ========================================================= */
const CORE_COMMANDS = {
    '!ping':    { desc: 'Vérifie que le bot est vivant', core: true,
                  run: (bot) => `pong 🏓 (uptime ${bot.uptimeStr()})` },

    '!stats':   { desc: 'Statistiques du bot', core: true,
                  run: (bot) => `📊 Envoyés : ${bot.stats.sent} • Commandes : ${bot.stats.cmds} • Plugins actifs : ${bot.plugins.list().filter(p => p.enabled).length} • Uptime : ${bot.uptimeStr()}` },

    '!plugins': { desc: 'Liste les plugins chargés', core: true,
                  run: (bot) => {
                      const L = bot.plugins.list();
                      if (!L.length) return 'Aucun plugin. Ajoute des fichiers .js dans ./plugins/';
                      return '🔌 Plugins :\n' + L.map(p =>
                          `${p.enabled ? '🟢' : '🔴'} ${p.name} v${p.version} — ${p.description} (${p.commands.length} cmd)`
                      ).join('\n');
                  } },

    '!help':    { desc: 'Liste toutes les commandes', core: true,
                  run: (bot) => {
                      const parts = ['🤖 Système : ' + Object.keys(CORE_COMMANDS).join(', ')];
                      // regrouper par plugin
                      const byPlugin = {};
                      for (const [cmd, { def, plugin }] of bot.plugins.getCommands()) {
                          (byPlugin[plugin] = byPlugin[plugin] || []).push(cmd);
                      }
                      for (const [plug, cmds] of Object.entries(byPlugin)) {
                          parts.push(`🔌 ${plug} : ${cmds.sort((a, b) => b.length - a.length).join(', ')}`);
                      }
                      if (!Object.keys(byPlugin).length) parts.push('(aucun plugin chargé)');
                      return cut(parts.join('\n'));
                  } },
};

/* =========================================================
   FONCTIONS PAGE — version qui marche (conservée à l'identique)
   ========================================================= */
async function saveDebug(page, tag) {
    if (!CONFIG.debug || !page) return;
    try {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        await page.screenshot({ path: `debug_${tag}_${ts}.png`, fullPage: true });
        fs.writeFileSync(`debug_${tag}_${ts}.html`, await page.content());
        console.log(`🖼️  Debug : debug_${tag}_${ts}.png / .html`);
    } catch (_) {}
}

async function findFrameWith(page, selector, timeout = 10000) {
    const start = Date.now();
    do {
        for (const frame of page.frames()) {
            try { if (await frame.$(selector)) return frame; } catch (_) {}
        }
        await wait(500);
    } while (Date.now() - start < timeout);
    return null;
}
async function anyFrameHas(page, selector) {
    for (const frame of page.frames()) {
        try { if (await frame.$(selector)) return true; } catch (_) {}
    }
    return false;
}
async function waitForGone(page, selector, timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (!(await anyFrameHas(page, selector))) return true;
        await wait(1000);
    }
    return false;
}

async function getChatLines(page) {
    if (CONFIG.messageSelector) {
        return page.evaluate((sel) =>
            [...document.querySelectorAll(sel)].map(el => el.innerText.trim()).filter(Boolean),
            CONFIG.messageSelector);
    }
    return page.evaluate(() => {
        let best = null, bestLen = 0;
        for (const el of document.querySelectorAll('div')) {
            const cs = getComputedStyle(el);
            if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.clientHeight > 150) {
                const len = (el.innerText || '').length;
                if (len > bestLen) { best = el; bestLen = len; }
            }
        }
        return (best ? best.innerText : '').split('\n').map(l => l.trim()).filter(Boolean);
    });
}

function diffLines(oldLines, newLines) {
    const max = Math.min(oldLines.length, newLines.length);
    let i = 0;
    while (i < max && oldLines[i] === newLines[i]) i++;
    return newLines.slice(i);
}

/* =========================================================
   LE BOT
   ========================================================= */
class SnapchatBot extends EventEmitter {
    constructor(cfg = {}) {
        super();
        Object.assign(CONFIG, cfg);
        this.running = false;
        this.browser = null;
        this.page = null;
        this.lastLines = [];
        this.timers = [];
        this.sentHistory = [];
        this.recentReplies = new Map();
        this.lastReplyAt = 0;
        this.stats = { sent: 0, cmds: 0, errors: 0, start: 0 };
        this.logs = [];

        this.plugins = new PluginManager(CONFIG.pluginsDir);
        this.plugins.loadAll();
    }

    /* ---------- Logs ---------- */
    log(level, msg) {
        const entry = { level, msg, time: new Date().toISOString() };
        this.logs.push(entry);
        if (this.logs.length > 300) this.logs.shift();
        console.log(`[${level}] ${msg}`);
        this.emit('log', entry);
    }

    uptimeStr() {
        const s = Math.floor((Date.now() - this.stats.start) / 1000);
        return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m ${s%60}s`;
    }
    status() {
        return {
            running: this.running, group: CONFIG.groupName,
            url: this.page ? this.page.url() : '',
            uptimeSec: this.stats.start ? Math.floor((Date.now() - this.stats.start) / 1000) : 0,
            stats: this.stats,
        };
    }
    /** Doc des commandes (core + plugins) pour le dashboard */
    commandsDoc() {
        const out = Object.entries(CORE_COMMANDS).map(([k, v]) => ({ cmd: k, desc: v.desc, plugin: 'core' }));
        for (const [cmd, { def, plugin }] of this.plugins.getCommands()) {
            out.push({ cmd, desc: def.desc || '', plugin });
        }
        return out;
    }

    /* =====================================================
       🐛 FIX AUTO-RÉPONSE — 4 couches
       ===================================================== */
    markSent(text) {
        if (!text) return;
        this.sentHistory.push({ text: norm(text), plain: norm(stripEmoji(text)), at: Date.now() });
        while (this.sentHistory.length > 40) this.sentHistory.shift();
    }
    isOwnSent(line) {
        const n = norm(line);
        if (n.length < 3) return false;
        const now = Date.now();
        for (let i = 0; i < this.sentHistory.length; i++) {
            const s = this.sentHistory[i];
            if (now - s.at > 120000) continue;
            if (s.text.length >= 3 && n.includes(s.text)) { this.sentHistory.splice(i, 1); return true; }
            if (s.plain.length >= 6 && n.includes(s.plain)) { this.sentHistory.splice(i, 1); return true; }
        }
        return false;
    }
    hasOwnPrefix(line) {
        const n = norm(line);
        if (CONFIG.botName && n.startsWith(norm(CONFIG.botName) + ' ')) return true;
        for (const p of (CONFIG.ownPrefixes || [])) {
            if (n.startsWith(p.toLowerCase() + ' ')) return true;
        }
        return false;
    }
    isDuplicate(line) {
        const t = this.recentReplies.get(norm(line));
        return t && (Date.now() - t) < 30000;
    }
    markReply(line) { this.recentReplies.set(norm(line), Date.now()); }

    /* =====================================================
       CYCLE DE VIE
       ===================================================== */
    async start() {
        if (this.running) return;
        this.running = true;
        this.stats.start = Date.now();
        this.emit('status', this.status());
        try {
            this.log('info', '🚀 Lancement du navigateur...');
            this.browser = await this.launchBrowser();
            this.page = (await this.browser.pages())[0] || await this.browser.newPage();

            await this.ensureLoggedIn();
            if (!(await this.openGroup(CONFIG.groupName))) throw new Error(`Groupe "${CONFIG.groupName}" introuvable`);

            this.lastLines = await getChatLines(this.page);
            this.log('success', `🤖 Bot en écoute dans "${CONFIG.groupName}"`);
            this.loop();
        } catch (err) {
            this.stats.errors++;
            this.log('error', '❌ Erreur fatale : ' + err.message);
            await this.stop();
        }
    }

    async launchBrowser() {
        const args = ['--start-maximized', '--no-first-run', '--no-default-browser-check',
                      '--disable-blink-features=AutomationControlled'];
        try {
            return await puppeteer.launch({ headless: CONFIG.headless, userDataDir: CONFIG.userDataDir,
                                            defaultViewport: null, args });
        } catch (e) {
            this.log('warn', 'Lancement standard échoué → tentative Chrome installé...');
            return puppeteer.launch({ headless: CONFIG.headless, userDataDir: CONFIG.userDataDir,
                                      defaultViewport: null, args, channel: 'chrome' });
        }
    }

    async stop() {
        this.running = false;
        this.timers.forEach(clearTimeout); this.timers = [];
        if (this.browser) { try { await this.browser.close(); } catch (_) {} }
        this.browser = this.page = null;
        this.log('info', '👋 Bot arrêté.');
        this.emit('status', this.status());
    }
    async restart() { await this.stop(); await wait(2000); await this.start(); }

    /* =====================================================
       CONNEXION (logique qui marche, conservée)
       ===================================================== */
    async ensureLoggedIn() {
        const page = this.page;
        this.log('info', '🔐 Ouverture de Snapchat Web...');
        await page.goto(CONFIG.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await wait(3000);

        await this.acceptCookies();

        const form = await findFrameWith(page, 'input[name="username"], input[type="password"]', 15000);

        if (!form) {
            this.log('success', '✅ Session existante détectée (aucun formulaire affiché).');
        } else if (CONFIG.autoLogin && CONFIG.username && CONFIG.password && !CONFIG.password.includes('TON_')) {
            this.log('info', '🔑 Formulaire détecté → connexion automatique...');
            const userInput = await form.$('input[name="username"]');
            if (userInput) { await userInput.click({ clickCount: 3 }); await userInput.type(CONFIG.username, { delay: CONFIG.typingDelay }); }
            const passInput = await form.$('input[type="password"]');
            if (passInput) { await passInput.click({ clickCount: 3 }); await passInput.type(CONFIG.password, { delay: CONFIG.typingDelay }); }

            await form.evaluate(() => {
                const btn = document.querySelector('button[type="submit"]')
                    || [...document.querySelectorAll('button, [role="button"]')]
                        .find(b => /se connecter|log ?in|connexion/i.test(b.textContent || ''));
                if (btn) btn.click();
            });

            const ok = await waitForGone(page, 'input[type="password"]', 30000);
            if (!ok) {
                await saveDebug(page, 'login');
                this.log('warn', '⚠️ Connexion non confirmée (code de vérification ? erreur ?).');
                this.log('warn', '👉 Connecte-toi MANUELLEMENT dans la fenêtre du navigateur.');
                if (!(await this.waitForManualLogin(180000))) throw new Error('Timeout : connexion manuelle non détectée');
            }
        } else {
            this.log('warn', '👉 Connecte-toi MANUELLEMENT dans la fenêtre du navigateur.');
            if (!(await this.waitForManualLogin(180000))) throw new Error('Timeout : connexion manuelle non détectée');
        }

        if (!page.url().includes('/web')) {
            this.log('info', '↗️ Redirection vers les chats (' + CONFIG.webUrl + ')...');
            await page.goto(CONFIG.webUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        }
        // Attendre le chargement complet au lieu d'un fixe 6s
        try {
            await page.waitForFunction(() => document.readyState === 'complete', { timeout: 30000 });
        } catch (_) {}
        this.log('success', '✅ Connecté !');
    }

    async acceptCookies() {
        const page = this.page;
        const clicked = await page.evaluate(() => {
            const sels = ['#onetrust-accept-btn-handler', 'button[data-testid="cookie-accept"]'];
            for (const s of sels) { const b = document.querySelector(s); if (b) { b.click(); return true; } }
            const b = [...document.querySelectorAll('button, [role="button"]')]
                .find(e => /tout accepter|accepter tout|accept all|j'?accepte|^accepter$|^accept$/i.test((e.textContent || '').trim()));
            if (b) { b.click(); return true; }
            return false;
        }).catch(() => false);
        if (clicked) { this.log('info', '🍪 Cookies acceptés'); await wait(1500); }
    }

    async waitForAppReady(timeoutMs = 30000) {
        const page = this.page;
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                const ready = await page.evaluate(() => {
                    if (document.readyState !== 'complete') return false;
                    const contentArea = document.querySelector('[contenteditable="true"], textarea, div[role="textbox"]');
                    return !!contentArea;
                });
                if (ready) return true;
            } catch (_) {}
            await wait(500);
        }
        return false;
    }

    async clickConversationInSidebar(groupName) {
        const page = this.page;
        const clicked = await page.evaluate((txt) => {
            const normalized = txt.toLowerCase();
            const sidebar = [...document.querySelectorAll('[role="navigation"], aside, nav, [class*="sidebar" i]')][0];
            if (!sidebar) return false;
            const items = sidebar.querySelectorAll('div, span, li, a, button, [role="button"]');
            for (const item of items) {
                const text = (item.textContent || '').trim().toLowerCase();
                if (text && text.includes(normalized)) {
                    let target = item;
                    for (let k = 0; k < 4 && target.parentElement; k++) {
                        if (target.hasAttribute('tabindex') || target.getAttribute('role') === 'button' || ['A', 'BUTTON', 'LI'].includes(target.tagName)) break;
                        target = target.parentElement;
                    }
                    target.click();
                    return true;
                }
            }
            return false;
        }, groupName);
        return clicked;
    }

    async waitForManualLogin(timeoutMs = 180000) {
        const start = Date.now();
        let lastPing = 0;
        while (Date.now() - start < timeoutMs) {
            const url = this.page.url();
            if (url.includes('/web')) return true;
            try {
                if (await this.page.$('div[contenteditable="true"][role="textbox"], div[contenteditable="true"]')) return true;
            } catch (_) {}
            if (Date.now() - lastPing > 20000) {
                lastPing = Date.now();
                this.log('warn', `⏳ En attente de connexion manuelle... (${Math.round((Date.now()-start)/1000)}s)`);
            }
            await wait(2000);
        }
        await saveDebug(this.page, 'manual-login');
        return false;
    }

    /* =====================================================
       OUVERTURE DU GROUPE (logique améliorée)
       ===================================================== */
    async openGroup(groupName) {
        const page = this.page;
        this.log('info', `🔍 Ouverture du groupe "${groupName}"...`);

        // 0) Laisser l'appli charger ( clé sur connexion lente / Ubuntu )
        await this.waitForAppReady(30000);
        // Une bannière cookies peut bloquer l'UI même après login
        await this.acceptCookies();

        // 1) Clic direct dans la sidebar (pas besoin de recherche !)
        if (await this.clickConversationInSidebar(groupName)) {
            this.log('success', `✅ Groupe "${groupName}" ouvert (sidebar).`);
            return true;
        }

        // 2) Champ de recherche déjà visible ?
        const searchSel = 'input[placeholder*="echerche" i], input[placeholder*="earch" i], input[type="search"]';
        let searchInput = await page.$(searchSel);

        // 3) Sinon : cliquer le bouton recherche (texte/aria OU icône en haut de sidebar)
        if (!searchInput) {
            await page.evaluate(() => {
                // a) bouton avec texte/aria "search"
                let btn = [...document.querySelectorAll('button, [role="button"], [aria-label]')]
                    .find(e => /recherche|search/i.test(e.getAttribute('aria-label') || e.textContent || ''));
                // b) sinon : bouton-icône (svg) en haut à gauche de la fenêtre
                if (!btn) {
                    btn = [...document.querySelectorAll('button, [role="button"]')]
                        .filter(b => {
                            const r = b.getBoundingClientRect();
                            return r.x < 420 && r.y < 140 && r.width > 20 && b.querySelector('svg');
                        })[0];
                }
                if (btn) btn.click();
            });
            await wait(1500);
            searchInput = await page.$(searchSel);
        }

        if (searchInput) {
            await searchInput.click({ clickCount: 3 });
            await searchInput.type(groupName, { delay: 60 });
            await wait(2500);

            // Cliquer le résultat (heuristique d'origine qui marchait)
            const clicked = await page.evaluate(async (txt) => {
                const norm = txt.toLowerCase();
                const candidates = [...document.querySelectorAll('div, span, p, li, a')]
                    .filter(e => {
                        const t = (e.textContent || '').trim().toLowerCase();
                        if (!t || !t.startsWith(norm)) return false;
                        return e.querySelectorAll('*').length <= 4;
                    })
                    .sort((a, b) => a.textContent.length - b.textContent.length)
                    .slice(0, 5);
                for (const el of candidates) {
                    let target = el;
                    for (let k = 0; k < 3 && target.parentElement; k++) {
                        const tag = target.tagName;
                        if (tag === 'A' || tag === 'BUTTON' || target.getAttribute('role') === 'button' || target.hasAttribute('tabindex')) break;
                        target = target.parentElement;
                    }
                    target.click(); el.click();
                    await new Promise(r => setTimeout(r, 1000));
                    if (document.querySelector('div[contenteditable="true"], textarea')) return true;
                }
                return false;
            }, groupName);

            if (clicked) { this.log('success', `✅ Groupe "${groupName}" ouvert (recherche).`); return true; }

            await page.keyboard.press('Enter');
            await wait(1500);
            if (await page.$('div[contenteditable="true"], textarea')) {
                this.log('success', `✅ Groupe "${groupName}" ouvert (via Entrée).`);
                return true;
            }
        }

        await saveDebug(page, 'open-group');
        this.log('error', `❌ Groupe "${groupName}" introuvable → regarde debug_open-group_*.png`);
        return false;
    }

    /* =====================================================
       ENVOI (+ mention @ native)
       ===================================================== */
    async send(text, { mentionUser = null } = {}) {
        const page = this.page;
        if (!page) throw new Error('Bot non démarré');
        const input = (await page.$('div[contenteditable="true"][role="textbox"]'))
                   || (await page.$('div[contenteditable="true"]'))
                   || (await page.$('textarea'));
        if (!input) throw new Error('Zone de saisie introuvable');

        await input.click();
        await wait(200);

        if (mentionUser) {
            await page.keyboard.type('@', { delay: 90 });
            await wait(900);
            await page.keyboard.type(mentionUser, { delay: 90 });
            await wait(900);
            await page.keyboard.press('Enter');
            await wait(400);
            if (text) { await input.click(); await page.keyboard.type(' ' + text, { delay: CONFIG.typingDelay }); }
            this.markSent('@' + mentionUser + (text ? ' ' + text : ''));
            this.markSent(text || '@' + mentionUser);
        } else {
            await input.type(text, { delay: CONFIG.typingDelay });
            this.markSent(text);
        }
        await page.keyboard.press('Enter');

        this.stats.sent++;
        this.lastReplyAt = Date.now();
        this.log('send', `📤 ${mentionUser ? '@' + mentionUser + ' ' : ''}${text}`);
        this.emit('status', this.status());
        return true;
    }

    /* =====================================================
       DISPATCH DES COMMANDES (core + plugins)
       ===================================================== */
    getAllCommands() {
        const map = new Map();
        for (const [k, v] of Object.entries(CORE_COMMANDS)) map.set(k, { def: v, plugin: 'core' });
        for (const [cmd, entry] of this.plugins.getCommands()) {
            if (!map.has(cmd)) map.set(cmd, entry);     // core prioritaire sur collision
        }
        return map;
    }

    async onNewLine(line) {
        if (!line || !line.trim()) return;

        // 🐛 couches anti auto-réponse
        if (this.isOwnSent(line)) return;
        if (this.hasOwnPrefix(line)) return;

        this.log('recv', `💬 ${line}`);

        if (!/[!/]/.test(line)) return;
        if (Date.now() - this.lastReplyAt < CONFIG.cooldownMs) return;
        if (this.isDuplicate(line)) return;

        const lower = norm(line);
        // tri : commandes les plus longues d'abord (évite "!salut" dans "!salutations")
        const entries = [...this.getAllCommands().entries()].sort((a, b) => b[0].length - a[0].length);

        for (const [cmd, { def, plugin }] of entries) {
            const re = new RegExp('(^|\\s)' + cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])', 'i');
            if (!re.test(lower)) continue;

            this.markReply(line);
            this.stats.cmds++;
            this.log('info', `📩 "${cmd}" détecté (plugin: ${plugin})`);
            try {
                const args = lower.split(/\s+/).slice(1);
                const out = await def.run(this, args);
                if (out) await this.send(out);
            } catch (err) {
                this.log('error', `❌ Commande ${cmd} (plugin ${plugin}) : ${err.message}`);
                try { await this.send(`❌ Erreur dans ${cmd}`); } catch (_) {}
            }
            break;   // une seule commande par ligne
        }
    }

    /* =====================================================
       BOUCLE PRINCIPALE
       ===================================================== */
    async loop() {
        let consecutiveErrors = 0;
        while (this.running) {
            await wait(CONFIG.checkInterval);
            try {
                const lines = await getChatLines(this.page);
                const newLines = diffLines(this.lastLines, lines);
                this.lastLines = lines;

                for (const line of newLines) {
                    await this.onNewLine(line);
                }
                consecutiveErrors = 0;
            } catch (err) {
                consecutiveErrors++;
                this.stats.errors++;
                this.log('error', `⚠️ Erreur boucle (${consecutiveErrors}) : ${err.message}`);
                if (consecutiveErrors >= 3) {
                    this.log('info', '♻️ Rechargement + ré-ouverture du groupe...');
                    try {
                        await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
                        await wait(5000);
                        await this.acceptCookies();
                        if (!this.page.url().includes('/web')) {
                            await this.page.goto(CONFIG.webUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                            await wait(5000);
                        }
                        await this.openGroup(CONFIG.groupName);
                        this.lastLines = await getChatLines(this.page);
                    } catch (e2) { this.log('error', '❌ Récupération impossible : ' + e2.message); }
                    consecutiveErrors = 0;
                }
            }
        }
    }
}

module.exports = SnapchatBot;
module.exports.CONFIG = CONFIG;

/* ---------- Mode autonome : node bot-core.js ---------- */
if (require.main === module) {
    const bot = new SnapchatBot();
    bot.start();
    process.on('SIGINT', async () => {
        console.log('\n👋 Arrêt du bot...');
        await bot.stop();
        process.exit(0);
    });
}