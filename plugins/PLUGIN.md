# 📦 Format d'un plugin ZenBot

## Manifeste (champs racine)

| Champ | Type | Obligatoire | Description |
|---|---|---:|---|
| `name` | `string` | ✅ | Identifiant unique (lettres, chiffres, tirets) |
| `description` | `string` | recommandé | Affichée dans `!plugins` et le dashboard |
| `version` | `string` | recommandé | Format SemVer (`1.0.0`) |
| `author` | `string` | ❌ | Auteur du plugin |
| `commands` | `object` | ✅ | Les commandes — sans ce champ, le plugin est rejeté |

## Commande

| Champ | Type | Description |
|---|---|---|
| `clé` | `string` | Le déclencheur : `!macmd` ou `/macmd` |
| `desc` | `string` | Description courte (dashboard + `!help`) |
| `run` | fonction async | Logique de la commande |

### ✍️ Signature de `run()`

```js
run: async (bot, args) => { /* ... */ }
```

- `bot` — instance du bot (voir la section API ci-dessous).
- `args` — `string[]`, les mots après la commande, en minuscules.
- Exemple : avec `!choix pizza burger`, la commande `!choix` reçoit `args = ['pizza', 'burger']`.
- Valeur de retour :
  - `string` → envoyée automatiquement dans le chat.
  - rien (`undefined`, pas de `return`) → mode silencieux : la commande gère elle-même l'envoi via `bot.send()`.

## 🧠 API du bot

### Messages

```js
// Envoyer un message simple
await bot.send('Bonjour ! 👋');

// Envoyer avec une mention @ native (popup Snapchat)
await bot.send('Réveille-toi !', { mentionUser: 'pseudo' });
```

`bot.send()` est protégé contre l'auto-réponse : le bot ne réagira jamais à ses propres messages.

**Tous les messages doivent passer par `bot.send()`.** Ne pilote jamais la page Puppeteer directement depuis un plugin.

### Journalisation

```js
bot.log('info', 'Message normal');
bot.log('success', 'Opération réussie');
bot.log('warn', 'Attention');
bot.log('error', 'Une erreur');
```

Niveaux disponibles : `info`, `success`, `warn`, `error`, `send`, `recv`.

Ils sont visibles dans la console et dans le dashboard.

### Timers (rappels, jobs différés)

```js
bot.timers.push(
    setTimeout(() => bot.send('⏰ Rappel !'), 60000)
);
```

⚠️ Enregistre toujours tes `setTimeout` dans `bot.timers` : ils sont annulés proprement à l'arrêt du bot.

### Infos & état

```js
bot.stats.sent    // nombre de messages envoyés
bot.stats.cmds    // nombre de commandes exécutées
bot.uptimeStr()   // "1h 23m 45s"
bot.running       // true tant que le bot tourne
```

### Avancé (à éviter si possible)

```js
bot.page          // page Puppeteer courante
bot.plugins       // PluginManager
```

Le gestionnaire de plugins expose notamment :

```js
bot.plugins.list()
bot.plugins.reload(name)
bot.plugins.reloadAll()
bot.plugins.setEnabled(name, bool)
```

## ⚙️ Chargement & cycle de vie

- Au démarrage du bot, tous les fichiers `.js` du dossier `plugins/` sont chargés dans l'ordre alphabétique.
- Rechargement à chaud : bouton ↻ du dashboard, ou `POST /api/plugins/reload`.
- ⚠️ Le rechargement vide le cache `require` → l'état en mémoire du plugin est perdu (les variables redeviennent initiales).
- Un plugin peut être désactivé sans être supprimé (dashboard → toggle, ou `setEnabled`).

## Collisions de noms

- Les commandes système (`!ping`, `!stats`, `!help`, `!plugins`) gagnent toujours.
- Entre deux plugins : le premier chargé gagne (ordre alphabétique des fichiers).

## Conventions de préfixes

- `!` → commandes fun / générales.
- `/` → outils & utilitaires (OSINT, réseau, etc.).

## 🎯 Règles de déclenchement

- Insensible à la casse.
- Correspondance par mot complet : `!salut` ne déclenche pas sur `!salutations`.
- Les commandes les plus longues sont testées en premier.
- Une seule commande par ligne : la première qui correspond gagne.
- Cooldown global : le bot attend 1,5 s minimum entre deux réponses.
- Une même ligne ne peut pas re-déclencher une commande avant 30 s.
- Pendant l'exécution d'une commande, la lecture du chat est bloquée : garde les traitements sous ~60 s et envoie un message d'attente.

## 🛠️ Bonnes pratiques

### Commandes longues

Préviens l'utilisateur lorsqu'une opération peut prendre du temps :

```js
run: async (bot, args) => {
    await bot.send('🔎 Recherche en cours... ⏳');

    const result = await longOperation();

    return result;
}
```

### Tronquer les réponses longues

Snapchat coupe les messages trop longs :

```js
const cut = (s, n = 750) =>
    (s && s.length > n ? s.slice(0, n - 1) + '…' : s);
```

### Dépendances npm optionnelles

Une dépendance optionnelle ne doit jamais faire crasher le chargement du plugin :

```js
let maDep = null;

try {
    maDep = require('ma-dep');
} catch (_) {}

// Puis dans run :
if (!maDep) {
    return '📦 Commande non installée : npm install ma-dep';
}
```

### Requêtes HTTP

Node 18+ fournit `fetch` nativement :

```js
const r = await fetch('https://api.exemple.com', {
    signal: AbortSignal.timeout(8000)
});

if (!r.ok) return '❌ API injoignable';

const data = await r.json();
```

## Erreurs

Le noyau attrape les exceptions de `run()` et envoie :

```text
❌ Erreur dans !cmd
```

Mais les cas attendus doivent être gérés par le plugin lui-même avec des messages clairs (arguments manquants, API indisponible, etc.).

# 📚 Exemples complets

## Minimal

```js
module.exports = {
    name: 'demo',
    description: 'Plugin de démonstration',
    version: '1.0.0',

    commands: {
        '!coucou': {
            desc: 'Dit coucou',
            run: async () => 'Coucou ! 👀'
        }
    }
};
```

## Avec arguments + aléatoire

```js
const rand = (arr) =>
    arr[Math.floor(Math.random() * arr.length)];

module.exports = {
    name: 'jeux',
    description: '🎮 Mini-jeux',
    version: '1.0.0',

    commands: {
        '!de': {
            desc: 'Lance un dé',
            run: async () =>
                '🎲 ' + (1 + Math.floor(Math.random() * 6))
        },

        '!choix': {
            desc: '!choix pizza / burger / tacos',
            run: async (bot, args) => {
                const opts = args
                    .join(' ')
                    .split('/')
                    .map(s => s.trim())
                    .filter(Boolean);

                return opts.length
                    ? '👉 ' + rand(opts)
                    : 'Ex : !choix pizza / burger / sushi';
            }
        }
    }
};
```

## API HTTP — météo (Open-Meteo, sans clé)

```js
module.exports = {
    name: 'meteo',
    description: '🌤️ Météo via Open-Meteo (aucune clé requise)',
    version: '1.0.0',

    commands: {
        '!meteo': {
            desc: '!meteo Paris',

            run: async (bot, args) => {
                const ville = args.join(' ') || 'Paris';

                await bot.send(
                    '🌤️ Recherche pour "' + ville + '"... ⏳'
                );

                try {
                    const g =
                        'https://geocoding-api.open-meteo.com/v1/search' +
                        '?name=' + encodeURIComponent(ville) +
                        '&count=1&language=fr';

                    const geoResponse = await fetch(g, {
                        signal: AbortSignal.timeout(8000)
                    });

                    if (!geoResponse.ok) {
                        return '❌ API de géocodage injoignable';
                    }

                    const geoData = await geoResponse.json();
                    const geo = geoData.results?.[0];

                    if (!geo) return '❌ Ville introuvable';

                    const w =
                        'https://api.open-meteo.com/v1/forecast' +
                        '?latitude=' + geo.latitude +
                        '&longitude=' + geo.longitude +
                        '&current=temperature_2m,wind_speed_10m';

                    const metResponse = await fetch(w, {
                        signal: AbortSignal.timeout(8000)
                    });

                    if (!metResponse.ok) {
                        return '❌ API météo injoignable';
                    }

                    const metData = await metResponse.json();
                    const met = metData.current;

                    return (
                        '🌤️ ' + geo.name + ' (' + geo.country + ')' +
                        '\n🌡️ ' + met.temperature_2m + '°C' +
                        '\n💨 ' + met.wind_speed_10m + ' km/h'
                    );
                } catch (e) {
                    return '❌ API météo injoignable';
                }
            }
        }
    }
};
```

## Rappels (timers)

```js
module.exports = {
    name: 'rappels',
    description: '⏰ Rappels temporisés',
    version: '1.0.0',

    commands: {
        '!rappel': {
            desc: '!rappel 60 texte → rappel dans 60s',

            run: async (bot, args) => {
                const sec = parseInt(args[0], 10);
                const txt = args.slice(1).join(' ');

                if (!sec || sec < 1 || !txt) {
                    return 'Ex : !rappel 60 sortir le gâteau 🍰';
                }

                bot.timers.push(
                    setTimeout(
                        () => bot.send('⏰ RAPPEL : ' + txt),
                        sec * 1000
                    )
                );

                return '✅ Noté ! Rappel dans ' + sec + 's';
            }
        }
    }
};
```

## Mention native @

```js
module.exports = {
    name: 'poke',
    description: '👋 Mentionne un utilisateur',
    version: '1.0.0',

    commands: {
        '!poke': {
            desc: '!poke Pseudo → le mentionne',

            run: async (bot, args) => {
                if (!args[0]) {
                    return 'Ex : !poke Alice';
                }

                await bot.send('On te cherche 👀', {
                    mentionUser: args[0]
                });

                // Mode silencieux : ne rien retourner.
            }
        }
    }
};
```

# 🖥️ Dashboard & API HTTP

| Méthode | Route | Corps / Réponse |
|---|---|---|
| `GET` | `/api/plugins` | Liste des plugins (nom, version, actif, commandes) |
| `POST` | `/api/plugins/toggle` | `{ "name": "osint", "enabled": false }` |
| `POST` | `/api/plugins/reload` | `{ "name": "osint" }` — ou `{}` pour tout recharger |
| `GET` | `/api/commands` | Toutes les commandes (core + plugins) |
| `GET` | `/api/status` | État du bot |

# ❓ FAQ / Dépannage

### Mon plugin n'apparaît pas.

Regarde la console : une erreur `❌ Plugin ...` s'affiche si le chargement échoue.

Cause fréquente : `module.exports.commands` manquant.

### Puis-je envoyer plusieurs messages ?

Oui. Appelle plusieurs fois `await bot.send()` et ne retourne rien :

```js
run: async (bot, args) => {
    await bot.send('Message 1/2 📤');
    await bot.send('Message 2/2 📤');
}
```

### Mon plugin peut-il lire tout le chat ?

Il n'y a pas d'API publique pour ça dans le contrat décrit ici. Pour l'instant, les plugins réagissent aux commandes.

### Comment tester vite ?

1. `!ping` → le bot répond ?
2. `!plugins` → ton plugin est chargé ?
3. Lance ensuite ta commande.

### L'état est-il conservé entre les messages ?

Oui, tant que le plugin n'est pas rechargé.

Pour persister les données, utilise par exemple un fichier JSON :

```js
const fs = require('node:fs');

let state = {};

try {
    state = JSON.parse(
        fs.readFileSync('./plugin-state.json', 'utf8')
    );
} catch (_) {
    state = {};
}
```

# 📜 Template complet

```js
/*
 * plugins/mon-plugin.js — Template ZenBot
 * Description courte de ce que fait le plugin
 * Dépendances : npm install xxx (optionnel)
 */

// Dépendance optionnelle (ne fait jamais crasher le chargement)
let maDep = null;

try {
    maDep = require('ma-dep');
} catch (_) {}

const rand = (arr) =>
    arr[Math.floor(Math.random() * arr.length)];

const cut = (s, n = 750) =>
    (s && s.length > n ? s.slice(0, n - 1) + '…' : s);

module.exports = {
    name: 'mon-plugin',
    description: '🎮 Ce que fait mon plugin',
    version: '1.0.0',
    author: 'moi',

    commands: {

        // Commande simple : retourne une string, envoi automatique
        '!demo': {
            desc: 'Réponse automatique',
            run: async (bot, args) => 'Je fonctionne ! ✅'
        },

        // Avec arguments
        '!demo-args': {
            desc: '!demo-args mot1 mot2',
            run: async (bot, args) =>
                args.length
                    ? 'Tu as dit : ' + args.join(' ')
                    : 'Donne-moi des mots ! Ex : !demo-args salut toi'
        },

        // Mode silencieux : la commande envoie elle-même
        '!demo-multi': {
            desc: 'Envoie 2 messages',
            run: async (bot, args) => {
                await bot.send('Message 1/2 📤');
                await bot.send('Message 2/2 📤');
                // ⚠️ Ne rien retourner ici.
            }
        }
    }
};
```

---

**ZenBot** — bot Snapchat modulaire par snapzen67.  
Un plugin par fichier, un fichier par plugin. 👻

## Test

Depuis le dossier du bot :

```bash
cd ~/Documents/ZenBot
node server.js
```

Puis ouvre :

```text
http://localhost:3000/plugins.html
```
