/* =========================================================
   Plugin OSINT — /username /maigret /email /phone /whois
                     /dns /exif /hostio /dork /shodan
   Dépendances : npm install exifr libphonenumber-js
   Node 18+ (fetch natif)
   Clés optionnelles : HIBP_API_KEY, SHODAN_API_KEY
   ========================================================= */
const dns = require('dns').promises;
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');

let exifr = null, libph = null;
try { exifr = require('exifr'); } catch (_) {}
try { libph = require('libphonenumber-js'); } catch (_) {}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const cut = (s, n = 750) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s);

function fetchT(url, opts = {}, ms = 8000) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    return fetch(url, { redirect: 'follow', ...opts, signal: c.signal,
                        headers: { 'User-Agent': UA, ...(opts.headers || {}) } })
        .finally(() => clearTimeout(t));
}

/* ---------- Plateformes (pour /username et fallback /maigret) ---------- */
const SITES = [
    { n: 'GitHub', u: 'https://github.com/{u}', miss: 404 },
    { n: 'GitLab', u: 'https://gitlab.com/{u}', miss: 404 },
    { n: 'Reddit', u: 'https://www.reddit.com/user/{u}', miss: 404 },
    { n: 'Instagram', u: 'https://www.instagram.com/{u}/', miss: 404 },
    { n: 'TikTok', u: 'https://www.tiktok.com/@{u}', miss: 404 },
    { n: 'Pinterest', u: 'https://www.pinterest.com/{u}/', miss: 404 },
    { n: 'Tumblr', u: 'https://{u}.tumblr.com', miss: 404 },
    { n: 'Medium', u: 'https://medium.com/@{u}', miss: 404 },
    { n: 'Dev.to', u: 'https://dev.to/{u}', miss: 404 },
    { n: 'Snapchat', u: 'https://www.snapchat.com/add/{u}', miss: 404 },
    { n: 'Telegram', u: 'https://t.me/{u}', hitBody: 'tgme_page_title' },
    { n: 'SoundCloud', u: 'https://soundcloud.com/{u}', miss: 404 },
    { n: 'LastFM', u: 'https://www.last.fm/user/{u}', miss: 404 },
    { n: 'Flickr', u: 'https://www.flickr.com/people/{u}', miss: 404 },
    { n: 'Behance', u: 'https://www.behance.net/{u}', miss: 404 },
    { n: 'Dribbble', u: 'https://dribbble.com/{u}', miss: 404 },
    { n: 'Vimeo', u: 'https://vimeo.com/{u}', miss: 404 },
    { n: 'Keybase', u: 'https://keybase.io/{u}', miss: 404 },
    { n: 'Pastebin', u: 'https://pastebin.com/u/{u}', miss: 404 },
    { n: 'Patreon', u: 'https://www.patreon.com/{u}', miss: 404 },
    { n: 'Ko-fi', u: 'https://ko-fi.com/{u}', miss: 404 },
    { n: 'BuyMeACoffee', u: 'https://www.buymeacoffee.com/{u}', miss: 404 },
    { n: 'Linktree', u: 'https://linktr.ee/{u}', miss: 404 },
    { n: 'Gravatar', u: 'https://gravatar.com/{u}', miss: 404 },
    { n: 'Chess.com', u: 'https://www.chess.com/member/{u}', miss: 404 },
    { n: 'Replit', u: 'https://replit.com/@{u}', miss: 404 },
    { n: 'npm', u: 'https://www.npmjs.com/~{u}', miss: 404 },
    { n: 'Docker Hub', u: 'https://hub.docker.com/u/{u}', miss: 404 },
    { n: 'Kaggle', u: 'https://www.kaggle.com/{u}', miss: 404 },
    { n: 'Product Hunt', u: 'https://www.producthunt.com/@{u}', miss: 404 },
    { n: 'Goodreads', u: 'https://www.goodreads.com/{u}', miss: 404 },
    { n: 'About.me', u: 'https://about.me/{u}', miss: 404 },
    { n: 'Redbubble', u: 'https://www.redbubble.com/people/{u}/shop', miss: 404 },
    { n: 'Fiverr', u: 'https://www.fiverr.com/{u}', miss: 404 },
    { n: 'Steam', u: 'https://steamcommunity.com/id/{u}', missBody: 'could not be found' },
    { n: 'HackerNews', u: 'https://news.ycombinator.com/user?id={u}', missBody: 'no such user' },
];

async function checkUsername(user) {
    const found = [];
    const CH = 12;
    for (let i = 0; i < SITES.length; i += CH) {
        const res = await Promise.all(SITES.slice(i, i + CH).map(async (s) => {
            const url = s.u.replace('{u}', encodeURIComponent(user));
            try {
                const r = await fetchT(url, {}, 6000);
                if (s.hitBody)  { const b = await r.text(); return b.includes(s.hitBody) ? s.n : null; }
                if (s.missBody) { const b = (await r.text()).toLowerCase(); return b.includes(s.missBody) ? null : s.n; }
                return r.status < 400 ? s.n : null;
            } catch (_) { return null; }
        }));
        res.forEach(n => { if (n) found.push(n); });
    }
    return found;
}

function runMaigret(user) {
    return new Promise(resolve => {
        let out = '', done = false;
        const fin = v => { if (!done) { done = true; resolve(v); } };
        try {
            const p = spawn('maigret', [user, '--no-color', '--only-found', '--timeout', '5'], { shell: true });
            const t = setTimeout(() => { try { p.kill(); } catch (_) {} fin(out || null); }, 55000);
            p.stdout.on('data', d => out += d.toString());
            p.on('error', () => { clearTimeout(t); fin(null); });
            p.on('close', () => { clearTimeout(t); fin(out || null); });
        } catch (_) { fin(null); }
    });
}

function whoisQuery(server, q) {
    return new Promise((resolve, reject) => {
        const s = net.createConnection({ port: 43, host: server });
        let d = '';
        s.setTimeout(10000);
        s.on('connect', () => s.write(q + '\r\n'));
        s.on('data', c => d += c);
        s.on('timeout', () => s.destroy());
        s.on('close', () => resolve(d));
        s.on('error', reject);
    });
}
async function whoisFull(q) {
    let d = await whoisQuery('whois.iana.org', q).catch(() => '');
    const m = d.match(/^whois:\s*(\S+)/mi);
    if (m) d = await whoisQuery(m[1], q).catch(() => d);
    return d;
}
const cleanDom = (s) => (s || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');

/* =========================================================
   EXPORT PLUGIN
   ========================================================= */
module.exports = {
    name: 'osint',
    description: '🔍 Recherche OSINT (usernames, DNS, WHOIS, EXIF, Shodan...)',
    version: '1.0.0',
    author: 'snapzen67',

    commands: {

        '/username': { desc: '/username pseudo → présence sur ~36 plateformes', run: async (b, a) => {
            const u = a[0];
            if (!u) return 'Ex : /username snapzen67';
            await b.send(`🔎 Recherche de "${u}" sur ${SITES.length} plateformes... ⏳ (10-30s)`);
            const t0 = Date.now();
            const found = await checkUsername(u);
            if (!found.length) return `🟢 "${u}" : aucun compte trouvé (ou sites bloqués).`;
            return cut(`🎯 "${u}" trouvé sur ${found.length}/${SITES.length} plateformes (⏱ ${Math.round((Date.now()-t0)/1000)}s) :\n• ${found.join('\n• ')}\n⚠️ Faux positifs possibles`);
        } },

        '/maigret': { desc: '/maigret pseudo → analyse profonde (CLI si installée)', run: async (b, a) => {
            const u = a[0];
            if (!u) return 'Ex : /maigret pseudo';
            await b.send(`🕵️ Maigret sur "${u}"... ⏳ (jusqu'à 60s)`);
            const out = await runMaigret(u);
            if (out) {
                const hits = [...out.matchAll(/\[\+\]\s*([^\s:]+):\s*(https?:\/\/\S+)/g)];
                if (hits.length) return cut(`🕵️ Maigret : ${hits.length} comptes trouvés pour "${u}" :\n` + hits.slice(0, 25).map(h => `• ${h[1]} : ${h[2]}`).join('\n'));
                return cut('🕵️ Maigret : rien trouvé.\n' + out.split('\n').slice(0, 3).join(' | '));
            }
            const found = await checkUsername(u);
            return cut(`⚙️ Maigret CLI absent → recherche rapide : ${found.length ? found.join(', ') : 'rien'}\n💡 pip install maigret = analyse complète`);
        } },

        '/email': { desc: '/email mail@site.com → MX, Gravatar, fuites (si clé HIBP)', run: async (b, a) => {
            const e = a[0];
            if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'Ex : /email contact@mail.com';
            const L = [`📧 Analyse de ${e}`];
            const dom = e.split('@')[1];
            const mx = await dns.resolveMx(dom).catch(() => null);
            L.push(mx ? `✅ MX actif : ${mx.slice(0, 2).map(m => m.exchange).join(', ')}` : '❌ Aucun MX → domaine qui ne reçoit pas de mail');
            const h = crypto.createHash('md5').update(e.trim().toLowerCase()).digest('hex');
            try {
                const r = await fetchT(`https://www.gravatar.com/avatar/${h}?d=404&s=1`, {}, 6000);
                L.push(r.status === 200 ? `👤 Gravatar actif → gravatar.com/${h}` : '👤 Pas de Gravatar public');
            } catch (_) { L.push('👤 Gravatar : vérif impossible'); }
            if (process.env.HIBP_API_KEY) {
                try {
                    const r = await fetchT(`https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(e)}`,
                        { headers: { 'hibp-api-key': process.env.HIBP_API_KEY } }, 10000);
                    if (r.status === 404) L.push('🛡️ HIBP : aucune fuite connue ✅');
                    else if (r.ok) { const br = await r.json(); L.push(`🚨 HIBP : ${br.length} fuite(s) : ${br.slice(0, 8).map(x => x.Name).join(', ')}`); }
                    else L.push('🛡️ HIBP : erreur ' + r.status);
                } catch (_) { L.push('🛡️ HIBP : inaccessible'); }
            } else L.push('🛡️ Fuites : définis HIBP_API_KEY pour activer HaveIBeenPwned');
            return cut(L.join('\n'));
        } },

        '/phone': { desc: '/phone +33612345678 → pays, validité, type', run: async (b, a) => {
            if (!a[0]) return 'Ex : /phone +33612345678';
            if (!libph) return '📦 Installe : npm install libphonenumber-js';
            const p = libph.parsePhoneNumberFromString(a.join(''));
            if (!p) return '❌ Numéro illisible. Ex : /phone +33612345678';
            const L = [`📱 ${p.formatInternational()}`];
            L.push(p.isValid() ? '✅ Numéro valide' : '⚠️ Numéro probablement invalide');
            L.push(`🌍 Pays : ${p.country || '?'} (+${p.countryCallingCode})`);
            const t = p.getType ? p.getType() : null;
            if (t) L.push(`📶 Type : ${t}`);
            return cut(L.join('\n'));
        } },

        '/whois': { desc: '/whois domaine → registrar, dates, NS, propriétaire', run: async (b, a) => {
            const dom = cleanDom(a[0]);
            if (!dom.includes('.')) return 'Ex : /whois exemple.fr';
            const d = await whoisFull(dom);
            if (!d.trim()) return '❌ WHOIS indisponible pour ce domaine.';
            const keep = /^(Registrar:|Registrar URL:|Creation Date:|Registry Expiry Date:|Updated Date:|Name Server:|Registrant Organization:|Registrant Country:|Domain Status:)/i;
            const lines = d.split('\n').map(l => l.trim()).filter(l => keep.test(l) && !l.includes('>>>'));
            return cut(`📋 WHOIS ${dom} :\n` + ([...new Set(lines)].slice(0, 14).join('\n') || d.split('\n').filter(Boolean).slice(0, 8).join('\n')));
        } },

        '/dns': { desc: '/dns domaine → A, AAAA, CNAME, MX, NS, TXT, PTR', run: async (b, a) => {
            const dom = cleanDom(a[0]);
            if (!dom.includes('.')) return 'Ex : /dns exemple.fr';
            const jobs = [
                ['A',     () => dns.resolve4(dom)],
                ['AAAA',  () => dns.resolve6(dom)],
                ['CNAME', () => dns.resolveCname(dom)],
                ['MX',    () => dns.resolveMx(dom).then(r => r.map(m => `${m.priority} ${m.exchange}`))],
                ['NS',    () => dns.resolveNs(dom)],
                ['TXT',   () => dns.resolveTxt(dom).then(r => r.map(t => t.join('')))],
                ['PTR',   () => dns.resolve4(dom).then(ips => dns.reverse(ips[0]))],
            ];
            const res = await Promise.all(jobs.map(async ([n, f]) => {
                try { return { n, v: await f() }; } catch (_) { return { n, v: null }; }
            }));
            return cut(`🗂️ DNS ${dom} :\n` + res.map(({ n, v }) => `${n} : ${v && v.length ? v.slice(0, 4).join(' | ') : '—'}`).join('\n'));
        } },

        '/exif': { desc: '/exif url_image → GPS, appareil, date, logiciel', run: async (b, a) => {
            const url = a[0];
            if (!url || !/^https?:\/\//.test(url)) return 'Ex : /exif https://site.com/photo.jpg';
            if (!exifr) return '📦 Installe : npm install exifr';
            await b.send('🔬 Téléchargement + analyse EXIF... ⏳');
            try {
                const r = await fetchT(url, {}, 20000);
                const buf = Buffer.from(await r.arrayBuffer());
                if (buf.length > 15 * 1024 * 1024) return '❌ Image trop lourde (>15 Mo).';
                const meta = await exifr.parse(buf, { tiff: true, exif: true, ifd0: true });
                if (!meta || !Object.keys(meta).length) return "🤷 Aucune métadonnée EXIF (souvent supprimées).";
                const L = ['🔬 EXIF :'];
                if (meta.Make || meta.Model) L.push(`📷 Appareil : ${[meta.Make, meta.Model].filter(Boolean).join(' ').trim()}`);
                if (meta.LensModel) L.push(`🔭 Objectif : ${meta.LensModel}`);
                if (meta.DateTimeOriginal || meta.CreateDate) L.push(`📅 Date : ${new Date(meta.DateTimeOriginal || meta.CreateDate).toLocaleString('fr-FR')}`);
                if (meta.Software) L.push(`🛠️ Logiciel : ${meta.Software}`);
                const gps = await exifr.gps(buf).catch(() => null);
                if (gps && typeof gps.latitude === 'number') L.push(`📍 GPS : ${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}\nhttps://maps.google.com/?q=${gps.latitude},${gps.longitude}`);
                else L.push('📍 GPS : absent');
                return cut(L.join('\n'));
            } catch (e) { return "❌ Lecture impossible : " + e.message; }
        } },

        '/hostio': { desc: '/hostio domaine → hébergeur, CDN, serveur web, technos', run: async (b, a) => {
            const dom = cleanDom(a[0]);
            if (!dom.includes('.')) return 'Ex : /hostio exemple.fr';
            const ips = await dns.resolve4(dom).catch(() => []);
            if (!ips.length) return '❌ Domaine non résolu.';
            const L = [`🖥️ Hébergement de ${dom}`, `🌐 IP : ${ips.join(', ')}`];
            const ptr = await dns.reverse(ips[0]).catch(() => []);
            if (ptr.length) L.push(`🔁 PTR : ${ptr[0]}`);
            try {
                const j = await (await fetchT(`https://ipinfo.io/${ips[0]}/json`, {}, 8000)).json();
                if (j.org)  L.push(`🏢 Réseau : ${j.org}`);
                if (j.city) L.push(`📌 Localisation : ${[j.city, j.region, j.country].filter(Boolean).join(', ')}`);
                if (/cloudflare|akamai|fastly|amazon|aws|google/i.test(j.org || '')) L.push('☁️ CDN/Cloud détecté → IP réelle masquée');
            } catch (_) {}
            try {
                const r = await fetchT('https://' + dom, { method: 'HEAD' }, 8000);
                const sv = r.headers.get('server'), pw = r.headers.get('x-powered-by'), gen = r.headers.get('x-generator');
                if (sv)  L.push(`⚙️ Serveur web : ${sv}`);
                if (pw)  L.push(`⚡ Techno : ${pw}`);
                if (gen) L.push(`🏗️ CMS : ${gen}`);
            } catch (_) {}
            return cut(L.join('\n'));
        } },

        '/dork': { desc: '/dork domaine → Google Dorks prêts à copier', run: async (b, a) => {
            const dom = cleanDom(a[0]);
            if (!dom.includes('.')) return 'Ex : /dork exemple.fr';
            const qs = [
                `site:${dom} inurl:admin`, `site:${dom} inurl:login`, `site:${dom} inurl:dashboard`,
                `site:${dom} intitle:"index of"`, `site:${dom} ext:sql`, `site:${dom} ext:env`,
                `site:${dom} ext:log`, `site:${dom} ext:bak`, `site:${dom} ext:xml`,
                `site:${dom} inurl:.git`, `site:${dom} inurl:wp-config`, `site:${dom} inurl:backup`,
                `site:${dom} intext:"password"`,
            ];
            return cut(`🎯 Dorks pour ${dom} :\n` + qs.map(q => `• ${q}`).join('\n')
                + `\n\nExemple cliquable :\nhttps://www.google.com/search?q=${encodeURIComponent(qs[4])}`);
        } },

        '/shodan': { desc: '/shodan IP/domaine → ports, services, CVE', run: async (b, a) => {
            const q = a[0];
            if (!q) return 'Ex : /shodan 1.2.3.4 ou /shodan exemple.fr';
            const ip = /^\d+\.\d+\.\d+\.\d+$/.test(q) ? q : (await dns.resolve4(cleanDom(q)).catch(() => []))[0];
            if (!ip) return '❌ Impossible de résoudre la cible.';
            if (process.env.SHODAN_API_KEY) {
                try {
                    const j = await (await fetchT(`https://api.shodan.io/shodan/host/${ip}?key=${process.env.SHODAN_API_KEY}`, {}, 12000)).json();
                    const L = [`🛰️ Shodan — ${ip}`, `🏢 ${j.org || '?'} | 🌍 ${[j.city, j.country_name].filter(Boolean).join(', ')}`];
                    if (j.ports?.length) L.push(`🔌 Ports : ${j.ports.join(', ')}`);
                    if (j.vulns?.length) L.push(`🚨 ${j.vulns.length} CVE : ${j.vulns.slice(0, 8).join(', ')}`);
                    for (const s of (j.data || []).slice(0, 3)) L.push(`🏷️ :${s.port} → ${(s.product || (s.banner || '').slice(0, 50) || '?')}`);
                    return cut(L.join('\n'));
                } catch (_) {}
            }
            try {
                const j = await (await fetchT(`https://internetdb.shodan.io/${ip}`, {}, 10000)).json();
                const L = [`🛰️ Shodan (gratuit) — ${ip}`];
                L.push(j.ports?.length ? `🔌 Ports ouverts : ${j.ports.join(', ')}` : '🔌 Aucun port ouvert connu');
                if (j.hostnames?.length) L.push(`🏷️ Hostnames : ${j.hostnames.slice(0, 4).join(', ')}`);
                if (j.cpes?.length) L.push(`⚙️ Technos : ${j.cpes.slice(0, 6).map(c => c.split(':')[2] || c).join(', ')}`);
                L.push(j.vulns?.length ? `🚨 ${j.vulns.length} CVE : ${j.vulns.slice(0, 8).join(', ')}` : '🛡️ Aucune CVE connue');
                if (!process.env.SHODAN_API_KEY) L.push('💡 SHODAN_API_KEY = bannières détaillées');
                return cut(L.join('\n'));
            } catch (_) { return '❌ Shodan indisponible (ou IP privée).'; }
        } },
    },
};