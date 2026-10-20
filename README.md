# `>_` PortFolio `</zzz>`

**AhMed's personal developer portfolio** — a dark, animated single-page site live at **[zzz.is-a.dev](https://zzz.is-a.dev)**

[![Live Site](https://img.shields.io/badge/Live-zzz.is--a.dev-2ea44f?style=flat-square&logo=googlechrome&logoColor=white)](https://zzz.is-a.dev)
[![GitHub Pages](https://img.shields.io/badge/Hosted%20on-GitHub%20Pages-181717?style=flat-square&logo=github&logoColor=white)](https://pages.github.com/)
[![HTML](https://img.shields.io/badge/HTML-45.8%25-E34F26?style=flat-square&logo=html5&logoColor=white)](https://github.com/z9zzzz/zzz.github.io)
[![JavaScript](https://img.shields.io/badge/JavaScript-33.8%25-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](https://github.com/z9zzzz/zzz.github.io)
[![CSS](https://img.shields.io/badge/CSS-20.3%25-1572B6?style=flat-square&logo=css3&logoColor=white)](https://github.com/z9zzzz/zzz.github.io)
[![Python](https://img.shields.io/badge/Python-tools-3776AB?style=flat-square&logo=python&logoColor=white)](https://github.com/z9zzzz/zzz.github.io)

---

## 🧑‍💻 `>_` About

This is the source code for **AhMed's** personal portfolio — a single dark-themed landing page built with plain HTML/CSS/JS, packed with small interactive details instead of a heavy framework.

> `>_ Hello — I am AhMed.`  
> `>_ Check my repositories.`

---

## ✨ Features

### 🎨 UI & Animations
- **particles.js background** — animated particle canvas in dark mode (hexagon shapes, grab/bubble interaction) and light mode (circles, repulse interaction), toggled live without a page reload
- **Light / Dark toggle** — smooth animated switch with per-mode gradient updates for the card and follow button
- **Intro loader** — scramble-text animation that cycles random characters into the final message before fading out
- **Sleeping tab title** — browser tab animates through `Zzz → zZz → zzZ` in an infinite loop while the page is focused, pauses on blur (`"Why do you Leave?"`), and resumes on focus

### 🎁 Telegram Gift Card
- **Animated SVG panel** — Telegram-style gift preview card with a radial gradient background and a tiled symbol pattern
- **Random symbol per visit** — one icon is chosen at random from `Symbol/` on every page load (16 symbols: Baphomet, Moon-Eagle, Pegasus, Sharp-Sword, Bug, The-Eye, Money-Bag, Spooky-Cat, Voodoo-Doll, Musical-Note, Ring, Paper-Crane, Champagne, Doberman, Diamond, MapleLeaf)
- **Dynamic random gift badge** — on page load the browser fetches `GiftsJson/gifts-manifest.json` (one small file), picks a random gift, and loads **only that gift's** Lottie `.json` animation — no unused animations are downloaded
- **Gift label reveal** — the gift name badge fades in with a smooth animation after the intro loader disappears, then fades out after 7 seconds

### 🎵 Music Player
- Built-in audio player with a custom playlist (`Music/Playlist.js`)
- Custom UI controls and styles (`Music/music-player.css`, `Music/music-player.js`)
- Audio files stored in `audios/`

### 🖼️ Profile Image
- Random profile photo chosen client-side on each visit from `profiles/` (15 photos)
- Cache-busted with a timestamp query string so the browser always gets the current image

### ⏰ Clock Sub-page
- Standalone clock available at [`/clock`](https://zzz.is-a.dev/clock/) — separate page, no reload of the main site needed

### ✉️ Contact Form
- Functional contact form wired to a serverless **Cloudflare Worker** endpoint
- Script loaded from `contactform/` — zero backend setup required on GitHub Pages

### 🔗 Social Sidebar
- Slide-out sidebar with links to GitHub, PyPI, Telegram, Instagram, and the Clock page
- Hamburger toggle with fade-in/out CSS animation

### 🔒 Content Protection
- Right-click (`contextmenu`) disabled site-wide
- DevTools keyboard shortcuts blocked: F12, Ctrl+Shift+I, Ctrl+Shift+C, Ctrl+Shift+J, Ctrl+U

### 🌐 Hosting & Domain
- Hosted on **GitHub Pages**, custom domain `zzz.is-a.dev` configured via `CNAME`
- Full Open Graph and Twitter Card meta tags for rich link previews

---

## 🔨 giftsmith.py

A Python CLI tool that adds a new gift to the site in one command.

**What it does:**
1. Fetches the Telegram NFT gift page
2. Downloads the `.tgs` sticker and decompresses it in memory (no temp files)
3. Saves the Lottie `.json` to `GiftsJson/`
4. Upserts the gift entry in `GiftsJson/gifts-manifest.json` — adds it if new, updates it if the link already exists

**Usage:**
```bash
pip install requests
python giftsmith.py
# Enter Gift link: https://t.me/nft/SurgeBoard-14057
```

**Manifest entry produced:**
```json
{
    "id": 1,
    "name": "Surge Board",
    "number": 14057,
    "label": "Surge Board #14057",
    "json": "GiftsJson/SurgeBoard.json",
    "link": "https://t.me/nft/SurgeBoard-14057"
}
```

The site picks randomly from every entry in the manifest — no HTML editing needed to add a new gift.

---

## 🛠️ Tech Stack

| Layer | Tools |
|---|---|
| 🖼️ Markup / Styling | HTML5, CSS3, Google Fonts (Poppins, Cutive Mono) |
| ⚡ Interactivity | Vanilla JavaScript, particles.js, Lottie (lottie.min.js), Font Awesome |
| 🎁 Gift animations | Lottie JSON (converted from Telegram `.tgs` stickers) |
| 🐍 Gift tooling | Python 3 (`giftsmith.py`) — `requests` only |
| ✉️ Contact form | Cloudflare Worker (serverless) |
| 🌐 Hosting | GitHub Pages + custom domain via `CNAME` |

---

## 📁 Project Structure

```
zzz.github.io/
├── GiftsJson/
│   ├── gifts-manifest.json   # Gift registry — add entries here or via gift_scraper.py
│   ├── SurgeBoard.json       # Lottie animation for each gift
│   └── *.json
├── Music/
│   ├── Playlist.js           # Track list
│   ├── music-player.js       # Player logic
│   └── music-player.css      # Player styles
├── Symbol/                   # PNG icons for the SVG gift card background pattern
├── assets/                   # Favicon, particles.min.js, misc images
├── audios/                   # Audio files for the music player
├── clock/                    # Standalone clock sub-page
├── contactform/              # Contact form script + Cloudflare Worker config
├── profiles/                 # Profile photos (profile_1.jpg … profile_15.jpg)
├── src/
│   ├── style.css             # Main stylesheet
│   ├── app.js                # Main JS (particles, toggle, modal, sleep title anim)
│   └── lottie.min.js         # Lottie animation library
├── CNAME                     # Custom domain: zzz.is-a.dev
├── giftsmith.py              # CLI tool: fetch gift → convert → update manifest
├── index.html                # Main landing page
└── requirements.txt          # Python deps (requests)
```

---

## 🚀 Getting Started

### 👀 View it live

Visit **[zzz.is-a.dev](https://zzz.is-a.dev)** — no setup needed.

### ➕ Add a new gift

```bash
pip install requests
python giftsmith.py
# Enter Gift link: https://t.me/nft/YourGiftName-12345
```

That's it — the manifest updates automatically and the new gift joins the random rotation on next deploy.

---

## 🔗 Connect

[![GitHub](https://img.shields.io/badge/GitHub-z9zzzz-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/z9zzzz)
[![Telegram](https://img.shields.io/badge/Telegram-DevGit-26A5E4?style=for-the-badge&logo=telegram&logoColor=white)](https://t.me/DevGit)
[![Instagram](https://img.shields.io/badge/Instagram-z6.zzzz-E4405F?style=for-the-badge&logo=instagram&logoColor=white)](https://www.instagram.com/z6.zzzz/)
[![PyPI](https://img.shields.io/badge/PyPI-AsyncPy-3775A9?style=for-the-badge&logo=pypi&logoColor=white)](https://pypi.org/user/AsyncPy/)

---

Built with ⚡ by [z9zzzz](https://github.com/z9zzzz)