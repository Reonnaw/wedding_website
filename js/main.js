/* ==========================================================================
   Storybook zoom

   Every chapter is a watercolour painting cut into depth layers
   (assets/scenes/<chapter>/far|mid|near.webp). Each chapter hides the next one
   inside a floral wreath; scrolling flies the camera through the layers and
   into the wreath, which opens onto the next chapter — an endless zoom.
   ========================================================================== */
(() => {
  'use strict';

  const root = document.documentElement;
  const use3D = root.classList.contains('js-3d');

  const PAD = 0.07;          // bleed margin baked into every layer by tools/build_scenes.py
  const REACH = 0.75;        // how far towards the camera a depth-1 layer stands (0–1)
  const SEG = 1.4;           // viewport heights of scrolling per chapter
  const DWELL = 0.16;        // share of a chapter's scroll spent at rest at either end
  const CHAPTER_MS = 6500;   // autoplay pace

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const ease = (f) => {
    const t = clamp((f - DWELL) / (1 - 2 * DWELL), 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
  };
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

  const cover = document.getElementById('cover');
  const openBtn = document.getElementById('openStory');
  const main = document.querySelector('main');
  const story = document.getElementById('story');
  const stage = document.getElementById('stage');
  const finale = document.getElementById('finale');
  const playBtn = document.getElementById('playToggle');
  const chapterLabel = document.getElementById('chapterLabel');
  const scrollCue = document.getElementById('scrollCue');
  const replayBtn = document.getElementById('replayStory');

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  /* ---------- Cover ------------------------------------------------------ */
  main.inert = true;

  function whenReady(imgs, timeout) {
    const loads = imgs.map((img) => (img.decode ? img.decode() : Promise.resolve()).catch(() => {}));
    return Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, timeout))]);
  }

  const firstImages = [...document.querySelectorAll('.scene:nth-of-type(-n+2) .layer')];
  whenReady(firstImages, 6000).then(() => {
    openBtn.disabled = false;
    openBtn.querySelector('.btn-storybook__label').textContent = 'Open the storybook';
    // fetch the remaining chapters now that the first ones are in
    document.querySelectorAll('.layer[loading="lazy"]').forEach((img) => { img.loading = 'eager'; });
  });

  /* ---------- Music ------------------------------------------------------ */
  const song = document.getElementById('song');
  const musicBtn = document.getElementById('musicToggle');
  const SONG_VOLUME = 0.7;
  const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'];
  let wantMusic = true;      // the song plays unless the guest switches it off
  let fading = 0;

  // iOS ignores volume changes, so there the song simply starts and stops.
  function fadeTo(target, ms, done) {
    cancelAnimationFrame(fading);
    const from = song.volume;
    const start = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - start) / ms);
      song.volume = clamp(from + (target - from) * k, 0, 1);
      if (k < 1) fading = requestAnimationFrame(step);
      else if (done) done();
    };
    fading = requestAnimationFrame(step);
  }

  function startSong() {
    if (!song.paused) {           // caught mid fade-out: just swell back up
      fadeTo(SONG_VOLUME, 600);
      return Promise.resolve();
    }
    cancelAnimationFrame(fading);
    song.volume = 0;
    return song.play().then(() => fadeTo(SONG_VOLUME, 2500));
  }

  // Browsers usually refuse sound until the guest has interacted with the page,
  // so try straight away and, if refused, again on their first tap or key press.
  function onFirstGesture(ev) {
    if (ev.target instanceof Element && ev.target.closest('.music-toggle')) return;
    if (!wantMusic || !song.paused) {
      waitForGesture(false);
      return;
    }
    startSong().then(() => waitForGesture(false), () => {});
  }

  function waitForGesture(on) {
    for (const type of GESTURES) {
      if (on) window.addEventListener(type, onFirstGesture, { capture: true, passive: true });
      else window.removeEventListener(type, onFirstGesture, { capture: true });
    }
  }

  function autoplay() {
    if (wantMusic) startSong().catch(() => waitForGesture(true));
  }

  function playMusic() {
    wantMusic = true;
    startSong().catch(() => {});
  }

  function pauseMusic() {
    wantMusic = false;
    waitForGesture(false);
    fadeTo(0, 400, () => song.pause());
  }

  const showMusicState = (on) => {
    musicBtn.classList.toggle('is-playing', on);
    musicBtn.setAttribute('aria-pressed', String(on));
  };
  song.addEventListener('play', () => showMusicState(true));
  song.addEventListener('pause', () => showMusicState(false));
  song.addEventListener('error', () => { musicBtn.hidden = true; });
  musicBtn.addEventListener('click', () => (wantMusic && !song.paused ? pauseMusic() : playMusic()));

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) song.pause();
    else autoplay();
  });

  autoplay();

  openBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    cover.classList.add('is-open');
    root.classList.remove('cover-open');
    main.inert = false;
    setTimeout(() => { cover.hidden = true; }, use3D ? 2100 : 0);
    if (use3D) {
      playBtn.focus({ preventScroll: true });
      setTimeout(() => setAuto(true), 1500);
    }
  });

  if (!use3D) {
    replayBtn.addEventListener('click', () => story.scrollIntoView({ behavior: 'smooth' }));
    return;
  }

  /* ---------- Scenes ----------------------------------------------------- */
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const nums = (s) => (s || '').trim().split(/\s+/).map(Number);

  const scenes = [...stage.querySelectorAll('.scene')].map((el) => {
    const imgs = [...el.querySelectorAll('.layer')];
    const s = {
      el,
      caption: el.querySelector('.scene__caption'),
      title: el.querySelector('.scene__title').textContent.trim(),
      layers: imgs.map((img, i) => ({ el: img, depth: parseFloat(img.dataset.depth) || 0, index: i })),
      cw: parseFloat(imgs[0].getAttribute('width')),
      ch: parseFloat(imgs[0].getAttribute('height')),
      focus: nums(el.dataset.focus),
      portal: el.dataset.portal ? nums(el.dataset.portal) : null,
      c: { x: 0, y: 0 },
      live: false,
      inset: null,
    };

    s.paper = document.createElement('div');
    s.paper.className = 'scene__paper';
    el.prepend(s.paper);

    if (s.portal) {
      s.wreath = document.createElementNS(SVG_NS, 'svg');
      s.wreath.setAttribute('class', 'wreath');
      s.wreath.setAttribute('viewBox', '-100 -100 200 200');
      s.wreath.setAttribute('aria-hidden', 'true');
      const use = document.createElementNS(SVG_NS, 'use');
      use.setAttribute('href', '#wreath-art');
      s.wreath.append(use);
      el.append(s.wreath);
    }
    return s;
  });
  const N = scenes.length;

  /* ---------- Layout ----------------------------------------------------- */
  let vw = 0, vh = 0, diag = 0, K = 8, portalD = 160, storyTop = 0, storyLen = 0;

  function layout() {
    vw = stage.clientWidth;
    vh = stage.clientHeight;
    diag = Math.hypot(vw, vh);
    portalD = clamp(Math.min(vw, vh) * 0.24, 96, 240);
    K = diag / portalD;               // zoom between chapters: the wreath grows to wrap the screen
    storyLen = (N - 1) * SEG * vh;
    story.style.height = `${storyLen + vh}px`;
    storyTop = story.getBoundingClientRect().top + window.scrollY;

    const portrait = vh > vw;
    for (const s of scenes) {
      const W = s.cw / (1 + 2 * PAD);
      const H = s.ch / (1 + 2 * PAD);
      const [fx0, fy0, fx1, fy1] = s.focus;
      const cover = Math.max(vw / W, vh / H);
      const fit = Math.min((vw * 0.94) / ((fx1 - fx0) * W), (vh * (portrait ? 0.6 : 0.76)) / ((fy1 - fy0) * H));
      const k = Math.max(Math.min(cover, fit), Math.min(vw / W, vh / H) * 0.86);
      const dw = W * k;
      const dh = H * k;
      let x = vw / 2 - ((fx0 + fx1) / 2) * dw;
      let y = vh * 0.42 - ((fy0 + fy1) / 2) * dh;
      x = dw > vw ? clamp(x, vw - dw, 0) : (vw - dw) / 2;
      y = dh > vh ? clamp(y, vh - dh, 0) : (vh - dh) * 0.38;

      const left = x - PAD * dw;
      const top = y - PAD * dh;
      const ox = vw / 2 - left;
      const oy = vh / 2 - top;
      for (const L of s.layers) {
        Object.assign(L.el.style, {
          left: `${left}px`,
          top: `${top}px`,
          width: `${s.cw * k}px`,
          height: `${s.ch * k}px`,
          transformOrigin: `${ox}px ${oy}px`,
        });
      }
      s.clipLayer = `circle(${diag / 2}px at ${ox}px ${oy}px)`;

      Object.assign(s.paper.style, {
        left: `${(vw - diag) / 2}px`,
        top: `${(vh - diag) / 2}px`,
        width: `${diag}px`,
        height: `${diag}px`,
      });
      s.clipPaper = `circle(${diag / 2}px at 50% 50%)`;

      if (s.portal) {
        s.c = { x: (s.portal[0] - 0.5) * vw, y: (s.portal[1] - 0.5) * vh };
        // drawn at the size it reaches when it wraps the screen, so it stays crisp while zooming
        const size = portalD * 1.6 * K;
        Object.assign(s.wreath.style, {
          left: `${(vw - size) / 2}px`,
          top: `${(vh - size) / 2}px`,
          width: `${size}px`,
          height: `${size}px`,
        });
      }
      s.inset = null;                 // force clip paths to be re-applied
    }
    sparkles.resize();
  }

  /* ---------- Drawing ---------------------------------------------------- */
  function put(el, x, y, scale, opacity, z) {
    el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(5)})`;
    if (el._op !== opacity) {
      el._op = opacity;
      el.style.opacity = opacity;
      el.style.visibility = opacity > 0.002 ? '' : 'hidden';
    }
    if (el._z !== z) {
      el._z = z;
      el.style.zIndex = z;
    }
  }

  function setInset(s, on) {
    if (s.inset === on) return;
    s.inset = on;
    for (const L of s.layers) L.el.style.clipPath = on ? s.clipLayer : '';
    s.paper.style.clipPath = on ? s.clipPaper : '';
  }

  function setCaption(s, amount) {
    const o = +amount.toFixed(3);
    if (s.caption._op === o) return;
    s.caption._op = o;
    s.caption.style.opacity = o;
    s.caption.style.transform = `translateY(${((1 - o) * 14).toFixed(1)}px)`;
  }

  const sway = { x: 0, y: 0 };
  const pointer = { x: 0, y: 0 };

  // Active chapter: a camera at depth 1/S moving towards the wreath.
  // A layer at depth h sits (1 - h) of the way back, pre-shrunk so all layers line up at rest.
  function drawActive(s, S, e, still) {
    const lead = (K / (K - 1)) * (1 - 1 / S);
    const X = { x: s.c.x * lead, y: s.c.y * lead };
    const O = { x: -X.x * S, y: -X.y * S };

    setInset(s, false);
    put(s.paper, O.x, O.y, S, 1, 1);
    for (const L of s.layers) {
      const h = L.depth * REACH;
      const den = 1 / S - h;
      if (den < 0.04) {
        put(L.el, 0, 0, 1, 0, 2);
        continue;
      }
      const A = (1 - h) / den;
      const handheld = (1 / den - S) * still;
      const opacity = h > 0 ? 1 - smooth(1.9, 3.2, A) : 1;
      put(L.el, -X.x / den - sway.x * handheld, -X.y / den - sway.y * handheld, A, opacity, h > 0 ? 300 + L.index : 2);
    }
    if (s.wreath) {
      put(s.wreath, O.x + S * s.c.x, O.y + S * s.c.y, S / K, 1, 300);
      s.wreath.style.setProperty('--glow', (1 - smooth(0.3, 0.9, e)).toFixed(3));
    }
    return O;
  }

  // A chapter still inside a wreath: a flat painting, clipped to the wreath's opening.
  function drawInset(s, S, O, slot, swayIn) {
    const back = slot === 1 ? 100 : 200;
    const front = slot === 1 ? 250 : 240;
    setInset(s, true);
    put(s.paper, O.x, O.y, S, 1, back);
    for (const L of s.layers) {
      const h = L.depth * REACH;
      const handheld = (h / (1 - h)) * S * swayIn;
      put(L.el, O.x - sway.x * handheld, O.y - sway.y * handheld, S, 1, h > 0 ? front + 1 + L.index : back + 1);
    }
    if (s.wreath) {
      put(s.wreath, O.x + S * s.c.x, O.y + S * s.c.y, S / K, 1, front);
      s.wreath.style.setProperty('--glow', '1');
    }
  }

  let current = -1;
  let portalOnScreen = null;

  function draw(progress) {
    const t = clamp(progress, 0, N - 1);
    let a = Math.floor(t);
    let e = ease(t - a);
    if (a >= N - 1) {
      a = N - 1;
      e = 0;
    }

    const s0 = scenes[a];
    const S0 = s0.portal ? Math.pow(K, e) : 1;
    const still = 1 - smooth(0, 0.3, e);
    const O0 = drawActive(s0, S0, e, still);
    const live = new Set([s0]);
    setCaption(s0, 1 - smooth(0.02, 0.22, e));

    portalOnScreen = null;
    if (s0.portal && a + 1 < N) {
      const s1 = scenes[a + 1];
      const S1 = S0 / K;
      const O1 = { x: O0.x + S0 * s0.c.x, y: O0.y + S0 * s0.c.y };
      drawInset(s1, S1, O1, 1, smooth(0.7, 1, e));
      setCaption(s1, smooth(0.82, 0.98, e));
      live.add(s1);
      portalOnScreen = { x: vw / 2 + O1.x, y: vh / 2 + O1.y, r: (portalD / 2) * S0, alpha: 1 - smooth(0.05, 0.35, e) };

      if (s1.portal && a + 2 < N) {
        const s2 = scenes[a + 2];
        drawInset(s2, S1 / K, { x: O1.x + S1 * s1.c.x, y: O1.y + S1 * s1.c.y }, 2, 0);
        setCaption(s2, 0);
        live.add(s2);
      }
    }

    for (const s of scenes) {
      const on = live.has(s);
      if (on !== s.live) {
        s.live = on;
        s.el.classList.toggle('is-live', on);
        if (!on) setCaption(s, 0);
      }
    }

    const shown = e < 0.5 ? a : Math.min(a + 1, N - 1);
    if (shown !== current) {
      current = shown;
      const title = document.createElement('span');
      title.className = 'visually-hidden';
      title.textContent = `: ${scenes[shown].title}`;
      chapterLabel.replaceChildren(`Chapter ${ROMAN[shown] || shown + 1} of ${ROMAN[N - 1] || N}`, title);
    }
    scrollCue.classList.toggle('is-visible', !auto && e === 0 && a < N - 1 && !root.classList.contains('cover-open'));
  }

  /* ---------- Sparkles --------------------------------------------------- */
  const sparkles = (() => {
    const canvas = document.getElementById('sparkles');
    const ctx = canvas.getContext('2d');
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 64;
    const sctx = sprite.getContext('2d');
    const grad = sctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255, 246, 220, 1)');
    grad.addColorStop(0.25, 'rgba(240, 210, 140, .75)');
    grad.addColorStop(1, 'rgba(220, 185, 110, 0)');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 64, 64);

    let w = 0, h = 0;
    const motes = [];
    const spawn = (m, anywhere) => Object.assign(m, {
      x: Math.random() * w,
      y: anywhere ? Math.random() * h : h + 12,
      r: 0.8 + Math.random() * 2,
      vx: (Math.random() - 0.5) * 8,
      vy: -(6 + Math.random() * 16),
      phase: Math.random() * Math.PI * 2,
      rate: 0.8 + Math.random() * 1.8,
    });

    function star(x, y, r) {
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.quadraticCurveTo(x, y, x, y + r);
      ctx.quadraticCurveTo(x, y, x - r, y);
      ctx.quadraticCurveTo(x, y, x, y - r);
      ctx.fill();
    }

    return {
      resize() {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        w = vw;
        h = vh;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const count = Math.round(clamp((w * h) / 20000, 24, 70));
        motes.length = 0;
        for (let i = 0; i < count; i++) motes.push(spawn({}, true));
      },
      draw(dt, now, portal) {
        ctx.clearRect(0, 0, w, h);
        for (const m of motes) {
          m.x += m.vx * dt;
          m.y += m.vy * dt;
          if (m.y < -12 || m.x < -12 || m.x > w + 12) spawn(m, false);
          ctx.globalAlpha = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(now * 0.001 * m.rate * 3 + m.phase));
          const d = m.r * 8;
          ctx.drawImage(sprite, m.x - d / 2, m.y - d / 2, d, d);
        }
        if (portal && portal.alpha > 0.01) {
          ctx.fillStyle = '#f7e6b5';
          for (let i = 0; i < 14; i++) {
            const ang = now * 0.00035 + (i / 14) * Math.PI * 2;
            const rr = portal.r * (1.16 + 0.07 * Math.sin(now * 0.0013 + i * 1.7));
            const tw = 0.5 + 0.5 * Math.sin(now * 0.004 + i * 2.3);
            ctx.globalAlpha = portal.alpha * (0.25 + 0.75 * tw);
            star(portal.x + Math.cos(ang) * rr, portal.y + Math.sin(ang) * rr, 2 + 4 * tw);
          }
        }
        ctx.globalAlpha = 1;
      },
    };
  })();

  /* ---------- Autoplay --------------------------------------------------- */
  let auto = false;
  let autoPos = 0;
  let toFinale = 0;

  function setAuto(on) {
    auto = on;
    autoPos = window.scrollY;
    clearTimeout(toFinale);
    playBtn.setAttribute('aria-pressed', String(on));
    playBtn.textContent = on ? 'Pause' : 'Play story';
  }

  function stepAuto(dt) {
    if (Math.abs(window.scrollY - autoPos) > 3) {
      setAuto(false);             // someone scrolled by hand
      return;
    }
    const end = storyTop + storyLen;
    autoPos = Math.min(end, autoPos + ((SEG * vh) / CHAPTER_MS) * dt);
    window.scrollTo({ top: autoPos, behavior: 'instant' });
    if (autoPos >= end) {
      setAuto(false);
      toFinale = setTimeout(() => finale.scrollIntoView({ behavior: 'smooth' }), 2600);
    }
  }

  playBtn.addEventListener('click', () => {
    if (!auto && window.scrollY >= storyTop + storyLen - 2) window.scrollTo({ top: storyTop, behavior: 'instant' });
    setAuto(!auto);
  });

  replayBtn.addEventListener('click', () => {
    window.scrollTo({ top: storyTop, behavior: 'instant' });
    setAuto(true);
  });

  // Reading by hand takes over from autoplay; the buttons manage it themselves.
  const handOver = (ev) => {
    if (ev.target instanceof Element && ev.target.closest('button')) return;
    if (auto) setAuto(false);
    clearTimeout(toFinale);
  };
  window.addEventListener('wheel', handOver, { passive: true });
  window.addEventListener('touchstart', handOver, { passive: true });
  window.addEventListener('keydown', (ev) => {
    if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(ev.key)) handOver(ev);
  });

  stage.addEventListener('pointermove', (ev) => {
    if (ev.pointerType !== 'mouse') return;
    pointer.x = (ev.clientX / vw - 0.5) * 2;
    pointer.y = (ev.clientY / vh - 0.5) * 2;
  });
  stage.addEventListener('pointerleave', () => { pointer.x = pointer.y = 0; });

  /* ---------- Loop ------------------------------------------------------- */
  let running = false;
  let last = 0;

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.064, (now - last) / 1000 || 0);
    last = now;

    if (auto) stepAuto(dt * 1000);

    const amp = Math.min(vw, vh) * 0.02;
    const tx = pointer.x * amp + Math.sin(now / 2900) * amp * 0.55;
    const ty = pointer.y * amp * 0.6 + Math.cos(now / 3700) * amp * 0.35;
    sway.x += (tx - sway.x) * 0.06;
    sway.y += (ty - sway.y) * 0.06;

    const y = auto ? autoPos : window.scrollY;
    draw((y - storyTop) / (SEG * vh));
    sparkles.draw(dt, now, portalOnScreen);
    requestAnimationFrame(frame);
  }

  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting && !running) {
      running = true;
      last = performance.now();
      requestAnimationFrame(frame);
    } else if (!entry.isIntersecting) {
      running = false;
    }
  }).observe(story);

  window.addEventListener('resize', layout);
  layout();
  draw(0);
})();
