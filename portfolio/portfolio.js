/**
 * portfolio.js
 *  - scroll / swipe / keyboard switch between the card page and the portfolio
 *  - GSAP 3D choreography: the card spins away going down, and the SAME spin
 *    (same direction, mirrored in space) brings it back going up
 *  - black hole in the hero (portfolio/blackhole.js)
 *  - GitHub stats + top-starred projects
 *
 * Edit the CONFIG block below to change roles or the GitHub user.
 */
(() => {
  "use strict";

  /* ───────────── CONFIG ───────────── */
  const CONFIG = {
    githubUser: "DevZ44d",
    roles: [
      "Python Developer",
      "Telegram Bot Builder",
      "CLI & Library Author",
      "Learning ML & AI"
    ],
    maxProjects: 6,
    // Used if the GitHub API can't be reached (rate limit / offline)
    fallbackProjects: [
      { name: "HackerGPT-Telegram-Bot", language: "Python", stars: 22,
        description: "AI assistant for cybersecurity professionals, ethical hackers and pentesters — as a Telegram bot.",
        url: "https://github.com/DevZ44d/HackerGPT-Telegram-Bot" },
      { name: "HackerGpt", language: "Python", stars: 17,
        description: "Advanced AI for security professionals: vulnerability analysis, script generation and research.",
        url: "https://github.com/DevZ44d/HackerGpt" },
      { name: "TelegramDownLoader", language: "Python", stars: 8,
        description: "A bot that downloads stories and restricted content from Telegram — photos and videos.",
        url: "https://github.com/DevZ44d/TelegramDownLoader" },
      { name: "PyiMAi", language: "Python", stars: 2,
        description: "Lightweight AI-powered CLI tool to talk to an AI model from your terminal, with image support.",
        url: "https://github.com/DevZ44d/PyiMAi" },
      { name: "PyBrute", language: "Python", stars: 2,
        description: "Lightweight CLI tool for brute-forcing hashes and ZIP files with custom wordlists.",
        url: "https://github.com/DevZ44d/PyBrute" },
      { name: "ByMail", language: "Python", stars: 1,
        description: "Python library to fetch inbox messages from temporary email providers, one-shot or looping.",
        url: "https://github.com/DevZ44d/ByMail" }
    ],
    fallbackStats: { repos: 22, followers: 25, stars: null }
  };

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const body   = document.body;
  const page   = $("#portfolio");
  const loader = $("#loader");
  const modal  = $(".modal");
  if (!page) return;

  const reduce  = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const useGsap = !!window.gsap && !reduce;
  body.classList.add(useGsap ? "has-gsap" : "css-anim");

  const container = $(".container");
  const card      = $(".card");

  /* ───────────── GSAP 3D choreography ───────────── */
  let playOpen = null, playClose = null;
  let tiltOn = true, moving = false;
  let startReveals = () => {};

  if (useGsap) {
    const heroItems = $$("#pf-home .pf-reveal");
    const orb       = $("#pf-orb");
    const HERO_FROM = { y: 70, opacity: 0, rotationX: -28, transformPerspective: 900, transformOrigin: "50% 100%" };

    // resting state while the card page is showing
    gsap.set(page, { yPercent: 100, opacity: 0 });
    gsap.set(heroItems, HERO_FROM);
    if (orb) gsap.set(orb, { scale: .2, opacity: 0 });

    let active = null;
    const begin = () => {
      if (active) active.kill();
      gsap.killTweensOf([card, container, page, orb, ...heroItems]);
      moving = true;
      body.classList.add("pf-animating");
      tiltOn = false;
    };
    const finish = () => { moving = false; body.classList.remove("pf-animating"); };

    // ↓ going down: card spins 360° and flies up, portfolio rises, hero lands piece by piece
    playOpen = () => {
      begin();
      const r = ((gsap.getProperty(card, "rotationY") % 360) + 360) % 360;
      gsap.set(card, { rotationY: r });
      active = gsap.timeline({ onComplete: finish, defaults: { overwrite: "auto" } });
      active
        .to(card,      { rotationY: 360, rotationX: 12, scale: .82, duration: 1.0, ease: "power3.inOut", transformPerspective: 1400 }, 0)
        .to(container, { yPercent: -118, opacity: 0, duration: .9, ease: "power3.in" }, .08)
        .to(page,      { yPercent: 0, opacity: 1, duration: 1.0, ease: "expo.out" }, .25)
        .to(heroItems, { y: 0, opacity: 1, rotationX: 0, duration: .8, ease: "power3.out", stagger: .07 }, .55);
      if (orb) active.to(orb, { scale: 1, opacity: 1, duration: 1.0, ease: "back.out(1.5)" }, .5);
    };

    // ↑ going up: the same spin continues in the same direction and the card drops back in
    playClose = () => {
      begin();
      active = gsap.timeline({
        defaults: { overwrite: "auto" },
        onComplete() {
          gsap.set(card, { rotationY: 0, rotationX: 0, scale: 1 });
          gsap.set(page, { yPercent: 100, opacity: 0 });
          gsap.set(heroItems, HERO_FROM);
          if (orb) gsap.set(orb, { scale: .2, opacity: 0 });
          body.classList.remove("pf-visible");
          tiltOn = true;
          finish();
        }
      });
      active
        .to(heroItems, { y: 30, opacity: 0, duration: .35, ease: "power2.in" }, 0)
        .to(page,      { yPercent: 100, opacity: 0, duration: .95, ease: "power3.inOut" }, .05)
        .to(card,      { rotationY: 720, rotationX: 0, scale: 1, duration: 1.0, ease: "power3.inOut", transformPerspective: 1400 }, .15)
        .to(container, { yPercent: 0, opacity: 1, duration: .95, ease: "power3.out" }, .15);
      if (orb) active.to(orb, { scale: .2, opacity: 0, duration: .45, ease: "power2.in" }, 0);
    };

    // the rest of the sections reveal while you scroll
    const late = $$(".pf-reveal").filter((el) => !el.closest("#pf-home"));
    gsap.set(late, { opacity: 0, y: 60, rotationX: -14, transformPerspective: 900, transformOrigin: "50% 100%" });

    let revealIO = null;
    startReveals = () => {
      if (revealIO) return;
      revealIO = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const el = en.target;
          revealIO.unobserve(el);
          el.style.transition = "none";
          gsap.to(el, {
            opacity: 1, y: 0, rotationX: 0, duration: .85, ease: "power3.out",
            delay: (parseFloat(el.style.getPropertyValue("--d")) || 0) * .07,
            onComplete: () => { gsap.set(el, { clearProps: "transform,opacity" }); el.style.transition = ""; }
          });
        });
      }, { root: page, threshold: .12 });
      late.forEach((el) => revealIO.observe(el));
    };

    // 3D tilt of the card following the pointer (mouse only)
    if (window.matchMedia("(pointer: fine)").matches) {
      window.addEventListener("pointermove", (e) => {
        if (!tiltOn || moving || body.classList.contains("show-portfolio")) return;
        const r = card.getBoundingClientRect();
        const nx = (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2);
        const ny = (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2);
        gsap.to(card, {
          rotationY: gsap.utils.clamp(-1, 1, nx) * 9,
          rotationX: gsap.utils.clamp(-1, 1, ny) * -9,
          transformPerspective: 1100, duration: .6, ease: "power2.out", overwrite: "auto"
        });
      }, { passive: true });
      document.addEventListener("pointerleave", () => {
        if (tiltOn && !moving) gsap.to(card, { rotationX: 0, rotationY: 0, duration: .8, ease: "power3.out", overwrite: "auto" });
      });
    }
  }

  /* ───────────── page switching ───────────── */
  const LOCK_MS = 750;
  let lockUntil = 0;
  const isOpen = () => body.classList.contains("show-portfolio");
  const canAct = () =>
    Date.now() > lockUntil &&
    loader && loader.style.opacity === "0" &&
    !(modal && modal.classList.contains("show"));

  function openPortfolio() {
    if (isOpen() || !canAct()) return;
    lockUntil = Date.now() + LOCK_MS;
    page.scrollTo({ top: 0, behavior: "instant" });
    body.classList.add("pf-visible", "show-portfolio");
    startCounters();
    loadGithub();
    if (playOpen) { startReveals(); playOpen(); }
  }

  function closePortfolio(force) {
    if (!isOpen()) return;
    if (!force && !canAct()) return;
    lockUntil = Date.now() + LOCK_MS;
    body.classList.remove("show-portfolio");
    if (playClose) playClose();
    else setTimeout(() => body.classList.remove("pf-visible"), 950);
  }

  // when the intro loader is gone: show the hint + start the black hole
  const readyTimer = setInterval(() => {
    if (loader && loader.style.opacity === "0") {
      body.classList.add("pf-ready");
      clearInterval(readyTimer);
      initOrb();
    }
  }, 300);

  // wheel / trackpad — same gesture works in both directions
  let acc = 0, accTimer = null;
  window.addEventListener("wheel", (e) => {
    if (e.target.closest?.("#cf, .contact-form-cf")) return;
    acc += e.deltaY;
    clearTimeout(accTimer);
    accTimer = setTimeout(() => (acc = 0), 220);

    if (!isOpen() && acc > 40) { acc = 0; openPortfolio(); }
    else if (isOpen() && page.scrollTop <= 0 && acc < -45) { acc = 0; closePortfolio(); }
  }, { passive: true });

  // touch swipe
  let ty = 0, tScroll = 0, tracking = false;
  window.addEventListener("touchstart", (e) => {
    tracking = !e.target.closest?.("#cf, .contact-form-cf");
    ty = e.touches[0].clientY;
    tScroll = page.scrollTop;
  }, { passive: true });

  window.addEventListener("touchend", (e) => {
    if (!tracking) return;
    const dy = e.changedTouches[0].clientY - ty;
    if (!isOpen() && dy < -50) openPortfolio();
    else if (isOpen() && tScroll <= 0 && page.scrollTop <= 0 && dy > 70) closePortfolio();
  }, { passive: true });

  // keyboard
  window.addEventListener("keydown", (e) => {
    if (/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (!isOpen() && ["ArrowDown", "PageDown", " ", "End"].includes(e.key)) {
      if (canAct()) { e.preventDefault(); openPortfolio(); }
    } else if (isOpen()) {
      if (e.key === "Escape") closePortfolio();
      else if (["ArrowUp", "PageUp", "Home"].includes(e.key) && page.scrollTop <= 0) closePortfolio();
    }
  });

  // buttons
  $("#pf-hint")?.addEventListener("click", openPortfolio);
  $("#pf-back")?.addEventListener("click", () => closePortfolio(true));
  $$(".pf-dock [data-go]").forEach((btn) =>
    btn.addEventListener("click", () => {
      $("#" + btn.dataset.go)?.scrollIntoView({ behavior: "smooth", block: "start" });
    })
  );
  $("#pf-open-contact")?.addEventListener("click", () => {
    if (typeof window.cfClick === "function" && $("#cf")) window.cfClick();
  });

  // highlight the dock button of the section on screen
  const dockBtns = $$(".pf-dock [data-go]");
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      dockBtns.forEach((b) => b.classList.toggle("active", b.dataset.go === en.target.id));
    });
  }, { root: page, rootMargin: "-40% 0px -50% 0px" });
  $$(".pf-section").forEach((s) => io.observe(s));

  /* ───────────── typing role line ───────────── */
  (function typeRoles() {
    const el = $("#pf-role");
    if (!el) return;
    let r = 0, i = 0, del = false;
    (function tick() {
      const word = CONFIG.roles[r];
      el.textContent = word.slice(0, i);
      if (!del && i === word.length) { del = true; return setTimeout(tick, 1500); }
      if (del && i === 0) { del = false; r = (r + 1) % CONFIG.roles.length; }
      i += del ? -1 : 1;
      setTimeout(tick, del ? 35 : 75);
    })();
  })();

  /* ───────────── black hole ───────────── */
  function initOrb() {
    const holder = $("#pf-orb");
    if (!holder) return;
    const bh = window.PfBlackHole
      ? window.PfBlackHole.create(holder, { active: () => body.classList.contains("pf-visible") })
      : null;
    if (!bh) holder.classList.add("off");   // no WebGL → hide quietly
  }

  /* ───────────── stats counters ───────────── */
  const stats = { repos: null, followers: null, stars: null };

  function setStat(key, value) {
    stats[key] = value;
    const el = $(`[data-stat="${key}"]`);
    if (!el) return;
    if (value === null || value === undefined) { el.textContent = "—"; return; }
    const start = performance.now(), dur = 1000;
    (function step(now) {
      const p = Math.min(1, (now - start) / dur);
      el.textContent = Math.round(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    })(start);
  }
  function startCounters() {
    Object.entries(stats).forEach(([k, v]) => v !== null && setStat(k, v));
  }

  /* ───────────── GitHub data ───────────── */
  const LANG_ICON  = { Python: "fa-python", JavaScript: "fa-js", HTML: "fa-html5", CSS: "fa-css3-alt" };
  const LANG_COLOR = { Python: "#3776ab", JavaScript: "#f7df1e", HTML: "#e34f26", CSS: "#1572b6" };
  let githubLoaded = false;

  async function cachedJson(url, key) {
    try {
      const hit = JSON.parse(sessionStorage.getItem(key) || "null");
      if (hit && Date.now() - hit.t < 10 * 60 * 1000) return hit.d;
    } catch (_) { /* ignore */ }
    const res = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error("GitHub " + res.status);
    const data = await res.json();
    try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), d: data })); } catch (_) { /* ignore */ }
    return data;
  }

  function projectCard(p) {
    const a = document.createElement("a");
    a.className = "pf-card pf-proj";
    a.href = p.url;
    a.target = "_blank";
    a.rel = "noopener";

    const top = document.createElement("div");
    top.className = "pf-proj-top";
    const h = document.createElement("h3");
    h.textContent = p.name;
    const ic = document.createElement("i");
    ic.className = "fab " + (LANG_ICON[p.language] || "fa-github");
    if (LANG_COLOR[p.language]) ic.style.setProperty("--lc", LANG_COLOR[p.language]);
    top.append(h, ic);

    const d = document.createElement("p");
    d.textContent = p.description || "No description yet.";

    const meta = document.createElement("div");
    meta.className = "pf-proj-meta";
    if (p.language) {
      const l = document.createElement("span");
      const dot = document.createElement("span");
      dot.className = "pf-dot";
      if (LANG_COLOR[p.language]) dot.style.background = LANG_COLOR[p.language];
      l.append(dot, p.language);
      meta.append(l);
    }
    const s = document.createElement("span");
    const star = document.createElement("span");
    star.className = "pf-star";
    star.textContent = "★";
    s.append(star, " " + (p.stars || 0));
    meta.append(s);

    a.append(top, d, meta);
    return a;
  }

  function renderProjects(list) {
    $("#pf-projects").replaceChildren(...list.map(projectCard));
  }

  async function loadGithub() {
    if (githubLoaded) return;
    githubLoaded = true;
    const u = CONFIG.githubUser;
    try {
      const [user, repos] = await Promise.all([
        cachedJson(`https://api.github.com/users/${u}`, "pf-user-" + u),
        cachedJson(`https://api.github.com/users/${u}/repos?per_page=100&sort=pushed`, "pf-repos-" + u)
      ]);

      const own = repos.filter((r) => !r.fork && !r.archived);
      const stars = own.reduce((n, r) => n + r.stargazers_count, 0);
      const apply = isOpen() ? setStat : (k, v) => { stats[k] = v; };
      apply("repos", user.public_repos);
      apply("followers", user.followers);
      apply("stars", stars);

      // highest-starred first, newest activity breaks ties
      const top = own
        .sort((a, b) => b.stargazers_count - a.stargazers_count || new Date(b.pushed_at) - new Date(a.pushed_at))
        .slice(0, CONFIG.maxProjects)
        .map((r) => ({
          name: r.name, description: r.description, language: r.language,
          stars: r.stargazers_count, url: r.html_url
        }));
      renderProjects(top.length ? top : CONFIG.fallbackProjects);
    } catch (err) {
      console.warn("[portfolio] GitHub unavailable, using fallback data.", err);
      renderProjects(CONFIG.fallbackProjects);
      const f = CONFIG.fallbackStats;
      ["repos", "followers", "stars"].forEach((k) => setStat(k, f[k]));
    }
  }
})();