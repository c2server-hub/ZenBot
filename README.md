# 👻 ZenBot — Bot Snapchat modulaire

> Bot Snapchat Web automatisé avec **Node.js + Puppeteer**, système de **plugins à chaud**, dashboard web et commandes OSINT intégrées.

![Version](https://img.shields.io/badge/version-1.0.0-yellow)
![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey)

---

## ✨ Fonctionnalités

- 🤖 **Bot de chat Snapchat** — écoute un groupe et répond aux commandes.
- 🧩 **Système de plugins** — ajoute un fichier dans `plugins/` pour ajouter des commandes.
- ♻️ **Rechargement à chaud** — recharge les plugins sans redémarrer le bot.
- 🖥️ **Dashboard web** — démarre, arrête et redémarre le bot, envoie des messages et gère les plugins.
- 📡 **Console en direct** — affichage des logs en temps réel via SSE.
- 🔍 **Plugin OSINT intégré** — `/username`, `/whois`, `/dns`, `/shodan`, `/exif` et autres commandes.
- 🔐 **Session persistante** — le profil Chrome est réutilisé après la première connexion.
- 🛡️ **Anti auto-réponse** — le bot évite de répondre à ses propres messages.
- ♻️ **Auto-récupération** — reload et réouverture du groupe en cas d'erreur.

---

## 📸 Aperçu

Le dashboard est accessible à l'adresse :

```text
http://localhost:3000
```

Il permet notamment de :

- contrôler le bot ;
- consulter les statistiques ;
- envoyer des messages ;
- gérer les plugins ;
- consulter les logs en temps réel.

> 💡 Tu peux ajouter des captures d'écran dans un dossier `screenshots/` pour présenter l'interface du bot.

---

## 🗂️ Structure du projet

```text
ZenBot/
├── bot-core.js              # Moteur du bot + commandes système
├── server.js                # API HTTP + dashboard Express
│
├── public/
│   ├── dashboard.html       # Interface web de contrôle
│   └── plugins.html         # Guide interactif des plugins
│
├── plugins/
│   ├── osint.js             # Commandes OSINT
│   └── fun.js               # Commandes fun
│
├── snap_profile/            # Profil Chrome / session sauvegardée
│                              # ⚠️ À ne jamais publier sur GitHub
│
└── PLUGINS.md               # Documentation pour créer des plugins
```

> [!IMPORTANT]
> Le noyau (`bot-core.js`) ne contient **aucune commande métier**.
>
> Les fonctionnalités sont ajoutées sous forme de plugins.
>
> Consulte [`PLUGINS.md`](PLUGINS.md) pour créer tes propres extensions.

---

# 🚀 Installation

## Prérequis

- **Node.js 18+**
- **Google Chrome**
- Git

---

## 🐧 Ubuntu / Debian

### 1. Installer Google Chrome

```bash
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb

sudo apt install -y ./google-chrome-stable_current_amd64.deb
```

### 2. Cloner le projet

```bash
git clone https://github.com/TON-PSEUDO/ZenBot.git

cd ZenBot
```

### 3. Installer les dépendances

```bash
npm install express puppeteer exifr libphonenumber-js
```

---

## 🪟 Windows

### 1. Cloner le projet

```powershell
git clone https://github.com/TON-PSEUDO/ZenBot.git

cd ZenBot
```

### 2. Installer les dépendances

```powershell
npm install express puppeteer exifr libphonenumber-js
```

---

# ⚙️ Configuration

La configuration principale se trouve dans `CONFIG` en haut de `bot-core.js`.

Elle peut également utiliser des variables d'environnement.

| Variable | Env | Description |
|---|---|---|
| `groupName` | `GROUP` | Nom du groupe à surveiller |
| `username` | `SNAP_USER` | Pseudo Snapchat |
| `password` | `SNAP_PASS` | Mot de passe Snapchat |
| `botName` | — | Pseudo du bot utilisé pour l'anti auto-réponse |
| `headless` | — | `false` = fenêtre Chrome visible |
| `autoLogin` | — | `false` = connexion manuelle |

### 🔐 Première connexion

Pour la première connexion, il est recommandé de laisser :

```js
headless: false
```

Connecte-toi ensuite dans la fenêtre Chrome.

La session est sauvegardée dans :

```text
snap_profile/
```

Les prochaines exécutions peuvent ainsi réutiliser la session.

> [!WARNING]
> Ne publie jamais `snap_profile/` sur GitHub : ce dossier contient les données de session.

---

## 🔑 Clés API optionnelles

Le plugin OSINT peut utiliser certaines clés API.

```bash
HIBP_API_KEY=xxx
SHODAN_API_KEY=xxx
```

| Variable | Utilisation |
|---|---|
| `HIBP_API_KEY` | `/email` — recherche de fuites avec HaveIBeenPwned |
| `SHODAN_API_KEY` | `/shodan` — informations détaillées sur les services |

Sans clé, les fonctionnalités disponibles sans authentification peuvent continuer à fonctionner.

---

# ▶️ Utilisation

## 🖥️ Avec le dashboard

Lancement recommandé :

```bash
node server.js
```

Puis ouvre :

```text
http://localhost:3000
```

---

## 💻 Sans dashboard

Pour lancer uniquement le bot :

```bash
node bot-core.js
```

---

# 💬 Commandes

Exemples de commandes système :

```text
!ping
```

> Répond avec `pong 🏓`

```text
!help
```

> Affiche les commandes disponibles.

```text
!plugins
```

> Affiche l'état des plugins.

Exemples de commandes OSINT :

```text
/dns google.com
```

> Informations DNS.

```text
/whois github.com
```

> Informations sur un domaine.

```text
/username pseudo
```

> Recherche de présence sur différentes plateformes.

---

# 🧩 Créer un plugin

Un plugin correspond à **un fichier `.js`** placé dans le dossier `plugins/`.

Exemple minimal :

```js
module.exports = {
    name: 'monplugin',
    description: 'Ma première extension',
    version: '1.0.0',

    commands: {
        '!coucou': {
            desc: 'Dit coucou',

            run: async (bot, args) => {
                return 'Coucou ! 👀';
            }
        }
    }
};
```

Après avoir créé ou modifié le plugin :

1. sauvegarde le fichier ;
2. ouvre le dashboard ;
3. utilise le bouton **↻** pour recharger le plugin ;
4. utilise ensuite la commande.

📖 Documentation complète :

[`PLUGINS.md`](PLUGINS.md)

Cette documentation décrit l'API des plugins, les commandes, les timers, les messages, les erreurs et fournit plusieurs exemples.

---

# 🌐 API HTTP

Le serveur expose plusieurs routes HTTP.

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/api/status` | État du bot, uptime et statistiques |
| `GET` | `/api/commands` | Toutes les commandes |
| `GET` | `/api/plugins` | Liste des plugins |
| `POST` | `/api/plugins/toggle` | Activer/désactiver un plugin |
| `POST` | `/api/plugins/reload` | Recharger un plugin ou tous les plugins |
| `POST` | `/api/start` | Démarrer le bot |
| `POST` | `/api/stop` | Arrêter le bot |
| `POST` | `/api/restart` | Redémarrer le bot |
| `POST` | `/api/send` | Envoyer un message |
| `POST` | `/api/mention` | Envoyer un message avec une mention |
| `GET` | `/api/events` | Flux SSE des événements et logs |

---

# 🛠️ Dépannage

| Problème | Solution |
|---|---|
| `Could not find Google Chrome executable` | Installe Google Chrome |
| Bouton de recherche introuvable | Vérifie les fichiers `debug_open-group_*.png` et attends le chargement |
| Le bot ne répond pas | Vérifie `botName` et `groupName` dans `CONFIG` |
| Plugin absent | Vérifie la console et `module.exports.commands` |
| Session perdue | Supprime `snap_profile/` puis reconnecte-toi |

---

# 🔒 Sécurité

Ne publie jamais les données sensibles du bot.

Ajoute notamment ceci dans `.gitignore` :

```gitignore
node_modules/

snap_profile/

debug_*.png
debug_*.html

data/

*.log

.env
```

> [!CAUTION]
> Vérifie toujours `git status` avant de faire un `git push`, particulièrement si tu utilises des identifiants ou des clés API dans `.env`.

---

# ⚠️ Avertissement

> [!WARNING]
> Ce projet est fourni **à des fins éducatives**.
>
> L'automatisation de Snapchat peut enfreindre leurs conditions d'utilisation.
>
> Les outils OSINT doivent être utilisés uniquement sur **ton propre périmètre** ou dans un cadre **légalement autorisé**, par exemple un audit ou un pentest avec autorisation.
>
> L'auteur décline toute responsabilité concernant l'utilisation du projet.

---

# 📄 Licence

Ce projet est distribué sous licence **MIT**.

Voir [`LICENSE`](LICENSE).

---

## 📌 Avant de publier sur GitHub

### 1. Vérifier `.gitignore`

Assure-toi que les éléments sensibles ne seront pas envoyés :

```gitignore
node_modules/
snap_profile/
debug_*.png
debug_*.html
data/
*.log
.env
```

### 2. Remplacer les placeholders

Remplace :

```text
TON-PSEUDO
```

par ton véritable pseudo GitHub dans les liens du README.

### 3. Ajouter des screenshots

Tu peux créer :

```text
screenshots/
├── dashboard.png
└── plugins.png
```

Puis ajouter les images au README.

---

<p align="center">

👻 **ZenBot**

*Un plugin par fichier, un fichier par plugin.*

Made with 👻 by **snapzen67**

</p>