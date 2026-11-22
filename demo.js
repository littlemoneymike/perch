// The two replays and the action list. No libraries.
(() => {
  // "?still" shows the page the way someone who has asked for reduced motion sees it.
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches || new URLSearchParams(location.search).has("still");
  const ABORT = Symbol("abort");
  const EASE = "cubic-bezier(.3,0,.2,1)";

  // ---------- Shared pieces of the drawn desktop ----------
  const bars = '<i style="height:38%"></i><i style="height:55%"></i><i style="height:47%"></i><i style="height:72%"></i><i style="height:64%"></i><i style="height:88%"></i>';
  const menubar = (app) => `
    <div class="menubar">
      <span class="mb-left"><b>${app}</b><span>File</span><span>Edit</span><span>View</span><span>Window</span></span>
      <span class="mb-right"><i class="full"></i><i></i><img src="images/icon.png" alt=""><span>Tue 9:41 AM</span></span>
    </div>`;
  const dock = `<div class="dock">${["", "sq", "bar", "donut", "", "sq", "bar", "donut"].map((shape, i) =>
    `${i === 6 ? "<s></s>" : ""}<i class="${i % 2 ? "" : "on"}"><u class="${shape}"></u></i>`).join("")}</div>`;
  const browser = (style, compact, tab, url, page) => `
    <div class="win${compact ? " compact" : ""}" style="${style}">
      <div class="tabs"><i></i><i></i><i></i><div class="tab"><em></em>${tab}<s>×</s></div><span class="plus">+</span></div>
      <div class="toolbar"><span class="navb">‹</span><span class="navb">›</span><div class="omni">${url}</div>
        <span class="dlicon" data-el="dlicon"><svg width="15" height="15" viewBox="0 0 24 24"><path fill="currentColor" d="M12 3a1 1 0 0 1 1 1v9.6l3.3-3.3a1 1 0 0 1 1.4 1.4l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 0 1 1.4-1.4l3.3 3.3V4a1 1 0 0 1 1-1ZM5 19h14a1 1 0 1 1 0 2H5a1 1 0 1 1 0-2Z"/></svg></span>
        <span class="avatar"></span></div>
      <div class="page">${page}</div>
    </div>`;
  const cursor = `
    <div class="ripple" data-el="ripple"></div>
    <div class="cursor" data-el="cursor">
      <svg class="arrow" width="22" height="26" viewBox="0 0 22 26"><path d="M2 2v19l5-4.5 3.2 7.3 3-1.3-3.2-7.2H17L2 2Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>
      <svg class="cross" width="26" height="26" viewBox="0 0 26 26"><path d="M13 2v22M2 13h22" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/><path d="M13 2v22M2 13h22" stroke="#111" stroke-width="1.4" stroke-linecap="round"/></svg>
    </div>`;

  // ---------- The engine: one per replay ----------
  // Each replay is drawn in its own units and scaled to fit. On a narrow screen it switches to a
  // tighter arrangement of the same desktop, so the trays stay large enough to see.
  function Demo(root, { template, script, poster, wide, narrow }) {
    const wrap = root.querySelector(".stage-wrap");
    const stage = root.querySelector(".stage");
    const steps = [...root.querySelectorAll(".steps li")];
    const button = root.querySelector(".demo-pause");
    const live = new Set();
    const pos = new WeakMap();
    let run = 0, scale = 1, isNarrow = null, started = false, userPaused = reduceMotion, offscreen = true;
    const paused = () => userPaused || offscreen;

    const api = {
      get narrow() { return isNarrow; },
      q: (name) => stage.querySelector(`[data-el="${name}"]`),
      // Where an element is, in stage units.
      rect(node) {
        const s = stage.getBoundingClientRect(), r = node.getBoundingClientRect();
        const x = (r.left - s.left) / scale, y = (r.top - s.top) / scale, w = r.width / scale, h = r.height / scale;
        return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
      },
      async anim(node, frames, ms, easing = EASE) {
        const mine = run;
        const a = node.animate(frames, { duration: ms, easing });
        live.add(a);
        if (paused()) a.pause();
        try { await a.finished; } catch (_) { /* cancelled */ }
        live.delete(a);
        if (mine !== run) throw ABORT;
      },
      async wait(ms) {
        const mine = run;
        // Counts real time, so a busy or throttled page can't stretch the pacing.
        let left = ms, last = performance.now();
        while (left > 0) {
          await new Promise((r) => setTimeout(r, Math.min(30, left)));
          if (mine !== run) throw ABORT;
          const now = performance.now();
          if (!paused()) left -= now - last;
          last = now;
        }
      },
      place(node, x, y) { pos.set(node, [x, y]); node.style.transform = `translate(${x}px,${y}px)`; },
      move(node, x, y, ms, easing) {
        const [x0, y0] = pos.get(node) || [x, y];
        api.place(node, x, y);
        return api.anim(node, [{ transform: `translate(${x0}px,${y0}px)` }, { transform: `translate(${x}px,${y}px)` }], ms, easing);
      },
      fade(node, to, ms = 160) {
        const from = getComputedStyle(node).opacity;
        node.style.opacity = to;
        return api.anim(node, [{ opacity: from }, { opacity: to }], ms, "ease");
      },
      pop(node, ms = 260) {
        node.style.opacity = 1;
        return api.anim(node, [{ opacity: 0, transform: "scale(.6)" }, { opacity: 1, transform: "scale(1)" }], ms, "cubic-bezier(.2,1.3,.4,1)");
      },
      appear(node, ms = 200) {
        node.style.opacity = 1;
        return api.anim(node, [{ opacity: 0, transform: "scale(.94)" }, { opacity: 1, transform: "scale(1)" }], ms, "ease-out");
      },
      together(...promises) {
        return Promise.all(promises.map((p) => p.catch((e) => e))).then((results) => {
          const failed = results.find((r) => r === ABORT || r instanceof Error);
          if (failed) throw failed;
        });
      },
      async click(x, y) {
        const ripple = api.q("ripple");
        api.place(ripple, x, y);
        await api.anim(ripple, [{ opacity: 0.9, transform: `translate(${x}px,${y}px) scale(.3)` }, { opacity: 0, transform: `translate(${x}px,${y}px) scale(1.5)` }], 260, "ease-out");
      },
      step(index) { steps.forEach((li, i) => li.classList.toggle("on", i === index)); },
    };

    function draw() {
      live.forEach((a) => a.cancel());
      live.clear();
      stage.innerHTML = template(isNarrow);
    }
    // A still picture for anyone who has asked for less motion. Play is still there if they want it.
    function still() {
      run++;
      draw();
      poster(api);
      root.classList.add("still");
    }
    async function loop(fromTheTop = false) {
      const mine = ++run;
      started = true;
      root.classList.remove("still");
      try {
        while (mine === run) {
          draw();
          await script(api, fromTheTop);
          fromTheTop = false;
        }
      } catch (error) {
        if (error !== ABORT) throw error;
      }
    }
    const sync = () => live.forEach((a) => (paused() ? a.pause() : a.play()));
    function setPaused(value) {
      userPaused = value;
      button.textContent = value ? "Play" : "Pause";
      button.setAttribute("aria-label", value ? "Play the replay" : "Pause the replay");
      if (!value && !started) loop();
      sync();
    }
    function fit() {
      const width = wrap.clientWidth;
      if (!width) return;
      const nowNarrow = width < 560;
      const size = nowNarrow ? narrow : wide;
      scale = width / size.w;
      stage.style.width = `${size.w}px`;
      stage.style.height = `${size.h}px`;
      stage.style.transform = `scale(${scale})`;
      wrap.style.height = `${size.h * scale}px`;
      if (nowNarrow === isNarrow) return;
      // The arrangement changed (or this is the first look), so draw it afresh.
      isNarrow = nowNarrow;
      if (reduceMotion && !started) still(); else loop();
    }

    button.addEventListener("click", () => setPaused(!userPaused));
    if (reduceMotion) setPaused(true);
    new IntersectionObserver(([entry]) => {
      offscreen = !entry.isIntersecting;
      sync();
    }, { threshold: 0.08 }).observe(wrap);
    new ResizeObserver(fit).observe(wrap);
    fit();

    return {
      // Plays from the very first scene. Left alone when motion is reduced and nothing is playing.
      restart() {
        if (reduceMotion && userPaused) return;
        if (userPaused) setPaused(false);
        loop(true);
      },
    };
  }

  // ---------- Replay 1: one gesture. Pick up a file, shake, open the ring, choose, see the result ----------
  const filesLayout = (narrow) => (narrow
    ? { win: "left:14px;top:40px;width:368px;height:318px", bubble: "left:112px;top:118px", tray: "left:396px;top:40px", rx: 262, ry: 322 }
    : { win: "left:40px;top:46px;width:600px;height:384px", bubble: "left:398px;top:124px", tray: "left:794px;top:40px", rx: 590, ry: 252 });

  // As drawn, this is the moment after a download: the file is in the tray, named, with the pointer on it.
  const filesTemplate = (narrow) => {
    const L = filesLayout(narrow);
    return `
    ${menubar("Chrome")}
    ${browser(L.win, narrow, "Sunset – Photos", "photos.example.com/sunset", `
      <div class="photo-page"><img src="images/sunset.jpg" alt="">
        <div class="photo-meta"><b>Sunset.jpg</b><span>1600 × 1100, 240 KB</span><span class="dlbtn" data-el="dlbtn">Download</span></div></div>`)}
    <div class="bubble" data-el="bubble" style="${L.bubble}"><img data-el="bubbleThumb" src="images/thumb-sunset.jpg" alt=""><div><b>Sunset.jpg</b><span data-el="dlLabel">240 KB · Done</span><em data-el="dlTrack" style="visibility:hidden"><u data-el="dlBar"></u></em></div></div>
    <div class="tray" data-el="tray" style="${L.tray}">
      <div class="tray-head"><span></span></div>
      <div class="tiles">
        <div class="tile named" data-el="slot1"><img src="images/thumb-sunset.jpg" alt=""><span class="cap">Sunset.jpg</span></div>
        <div class="tile" data-el="slot2" style="opacity:0"><div class="pdf"><i></i><i></i><i></i><b>PDF</b></div><span class="cap">Sunset.pdf</span></div>
      </div>
      <div class="toast" data-el="toast">Converted · saved in Downloads</div>
      <div class="callout below">File Tray</div>
    </div>
    ${dock}
    <img class="ringimg" data-el="ringIdle" src="images/ring-idle.png" alt="" style="left:${L.rx - 140}px;top:${L.ry - 140}px;width:280px;height:280px">
    <img class="ringimg" data-el="ringOpen" src="images/ring-open.png" alt="" style="left:${L.rx - 148}px;top:${L.ry - 148}px;width:296px;height:296px">
    <img class="ringimg" data-el="ringPdf" src="images/ring-pdf.png" alt="" style="left:${L.rx - 148}px;top:${L.ry - 148}px;width:296px;height:296px">
    <div class="flyer" data-el="flyer"><img src="images/thumb-sunset.jpg" alt=""></div>
    <div class="ghost" data-el="ghost"><img src="images/thumb-sunset.jpg" alt=""></div>
    ${cursor}`;
  };

  async function filesScript(d, fromTheTop) {
    const { q, rect, wait, move, place, fade, pop, appear, anim, together } = d;
    const { rx, ry } = filesLayout(d.narrow);
    const cur = q("cursor"), ghost = q("ghost"), flyer = q("flyer");
    const slot1 = q("slot1"), slot2 = q("slot2");
    const tile = rect(slot1);
    const home = [tile.cx + 13, tile.cy - 13]; // on the picture, clear of its name
    // The pointer and the file it's holding always travel as one.
    const carry = (x, y, ms, easing) => together(move(cur, x, y, ms, easing), move(ghost, x, y, ms, easing));

    function emptyTray() {
      for (const node of [slot1, slot2, q("toast"), q("tray"), q("bubble")]) node.style.opacity = 0;
      slot1.classList.remove("named");
      slot2.classList.remove("named");
      q("dlicon").classList.remove("active");
    }

    // Scene 1: a download lands in the File Tray.
    async function download() {
      d.step(0);
      const btn = rect(q("dlbtn"));
      await move(cur, btn.cx, btn.cy, 480);
      await d.click(btn.cx, btn.cy);
      q("dlicon").classList.add("active");
      q("dlLabel").textContent = "Downloading…";
      q("dlTrack").style.visibility = "visible";
      await appear(q("bubble"), 160);
      await anim(q("dlBar"), [{ width: "0%" }, { width: "100%" }], 560, "ease-in-out");
      q("dlLabel").textContent = "240 KB · Done";
      q("dlTrack").style.visibility = "hidden";
      await appear(q("tray"), 200);
      const from = rect(q("bubbleThumb"));
      place(flyer, from.cx, from.cy);
      flyer.style.opacity = 1;
      await move(flyer, tile.cx, tile.cy, 460);
      flyer.style.opacity = 0;
      await pop(slot1, 220);
      await move(cur, home[0], home[1], 520);
      slot1.classList.add("named");
      await wait(600);
    }

    // Scene 2: the gesture.
    async function gesture() {
      d.step(0);
      await wait(1500);

      d.step(1);
      await d.click(home[0], home[1]);
      slot1.classList.remove("named");
      slot1.style.opacity = 0.35;
      q("dlicon").classList.remove("active");
      fade(q("bubble"), 0, 200).catch(() => {});
      place(ghost, home[0], home[1]);
      ghost.style.opacity = 1;
      await carry(rx, ry, 700);
      await wait(160);
      for (const dx of [28, -28, 28, -28, 28, 0]) await carry(rx + dx, ry, 90, "ease-in-out");
      await wait(140);
      await appear(q("ringIdle"), 170);
      await wait(520);

      d.step(2);
      await carry(rx + 18, ry - 52, 300);
      await wait(430);
      await fade(q("ringOpen"), 1, 110);
      q("ringIdle").style.opacity = 0;
      await wait(380);
      await carry(rx + 44, ry - 76, 340);
      q("ringPdf").style.opacity = 1;
      q("ringOpen").style.opacity = 0;
      await wait(900);

      // Letting go: the ring closes and the new file is in the tray, named, long enough to read.
      await together(fade(q("ringPdf"), 0, 170), fade(ghost, 0, 170));
      slot1.style.opacity = 1;
      await pop(slot2, 260);
      await fade(q("toast"), 1, 180);
      const made = rect(slot2);
      await move(cur, made.cx + 13, made.cy - 13, 620);
      slot2.classList.add("named");
      await wait(2800);
    }

    if (fromTheTop) {
      emptyTray();
      place(cur, rx - 120, ry + 130);
      await wait(450);
      await download();
    } else {
      place(cur, home[0], home[1]);
    }
    await gesture();
    await together(fade(q("tray"), 0, 240), fade(q("bubble"), 0, 240));
    emptyTray();
    await wait(300);
    await download();
  }
  function filesPoster(d) {
    const tile = d.rect(d.q("slot1"));
    d.place(d.q("cursor"), tile.cx + 13, tile.cy - 13);
  }

  // ---------- Replay 2: three screenshots, then all three dragged out together ----------
  const chartArt = `<div class="minichart">${bars}</div>`;
  const statArt = '<div class="ministat"><b></b><i></i><i></i></div>';
  const pageArt = `<div class="minipage">${chartArt}${statArt}</div>`;
  const captureLayout = (narrow) => (narrow
    ? { win: "left:14px;top:40px;width:532px;height:318px", chat: "left:14px;top:372px;width:340px;height:280px", tray: "left:396px;top:438px", keys: "left:368px;right:14px;top:378px", callout: "below" }
    : { win: "left:36px;top:46px;width:520px;height:346px", chat: "left:584px;top:46px;width:350px;height:280px", tray: "left:794px;top:338px", keys: "top:408px", callout: "left" });

  const captureTemplate = (narrow) => {
    const L = captureLayout(narrow);
    return `
    ${menubar("Chrome")}
    ${browser(L.win, narrow, "Q3 report", "docs.example.com/q3-report", `
      <div class="line w60"></div><div class="line w40"></div>
      <div class="panels" data-el="panels"><div class="panel a" data-el="panelA">${chartArt}</div><div class="panel b" data-el="panelB">${statArt}</div></div>`)}
    <div class="win" style="${L.chat}">
      <div class="chat-bar"><i></i><i></i><i></i>Maya</div>
      <div class="chat-body">
        <div class="msg">Can you send me the Q3 numbers?</div>
        <div class="msg out">Sure, three screenshots coming</div>
        <div class="pics" data-el="pics"><div data-el="pic1">${chartArt}</div><div data-el="pic2">${statArt}</div><div data-el="pic3">${pageArt}</div></div>
        <div class="delivered" data-el="delivered">Delivered</div>
      </div>
      <div class="chat-input">Message</div>
    </div>
    <div class="tray" data-el="tray" style="${L.tray};opacity:0">
      <div class="tray-head"><span></span><em data-el="dragall">Drag all 3</em></div>
      <div class="tiles">
        <div class="tile" data-el="slot1" style="opacity:0"><div class="thumb">${chartArt}</div></div>
        <div class="tile" data-el="slot2" style="opacity:0"><div class="thumb">${statArt}</div></div>
        <div class="tile" data-el="slot3" style="opacity:0"><div class="thumb">${pageArt}</div></div>
      </div>
      <div class="callout ${L.callout}">Screenshot Tray</div>
    </div>
    ${dock}
    <div class="keys" data-el="keys" style="${L.keys}"><kbd>⇧</kbd><kbd>⌘</kbd><kbd>7</kbd></div>
    <div class="sel" data-el="sel"></div>
    <div class="shot" data-el="shot"></div>
    <div class="ghost stack" data-el="ghost"><div>${statArt}</div><div>${pageArt}</div><div>${chartArt}</div><b>3</b></div>
    <div class="flash" data-el="flash"></div>
    ${cursor}`;
  };

  async function captureScript(d) {
    const { q, rect, wait, move, place, fade, pop, appear, anim, together } = d;
    const cur = q("cursor"), sel = q("sel"), shot = q("shot"), ghost = q("ghost"), keys = q("keys");
    const slots = ["slot1", "slot2", "slot3"];
    const pressKeys = () => anim(keys, [{ transform: "scale(1)" }, { transform: "scale(.92)" }, { transform: "scale(1)" }], 200, "ease-out");

    // One screenshot: press the keys, drag out an area, and it flies to its place in the tray.
    async function capture(area, art, index) {
      const x0 = area.x - 6, y0 = area.y - 6, w = area.w + 12, h = area.h + 12;
      pressKeys().catch(() => {});
      cur.classList.add("crosshair");
      await move(cur, x0, y0, 240);
      Object.assign(sel.style, { left: `${x0}px`, top: `${y0}px`, width: `${w}px`, height: `${h}px`, opacity: 1 });
      await together(
        move(cur, x0 + w, y0 + h, 420, "ease-in-out"),
        anim(sel, [{ width: "0px", height: "0px" }, { width: `${w}px`, height: `${h}px` }], 420, "ease-in-out"),
      );
      sel.style.opacity = 0;
      cur.classList.remove("crosshair");
      shot.innerHTML = art;
      Object.assign(shot.style, { width: `${w}px`, height: `${h}px`, opacity: 1 });
      const start = `translate(${x0}px,${y0}px) scale(1)`;
      shot.style.transform = start;
      anim(q("flash"), [{ opacity: 0.6 }, { opacity: 0 }], 240, "ease-out").catch(() => {});
      if (getComputedStyle(q("tray")).opacity === "0") await appear(q("tray"), 160);
      const slot = rect(q(slots[index]));
      const end = `translate(${slot.cx - w / 2}px,${slot.cy - h / 2}px) scale(${56 / w}, ${40 / h})`;
      shot.style.transform = end;
      await anim(shot, [{ transform: start }, { transform: end }], 360);
      shot.style.opacity = 0;
      await pop(q(slots[index]), 190);
      // The tray counts them as they arrive.
      if (index > 0) {
        q("dragall").textContent = `Drag all ${index + 1}`;
        q("dragall").style.opacity = 1;
      }
      await wait(160);
    }

    d.step(0);
    place(cur, 300, 300);
    await wait(250);
    await appear(keys, 150);
    await capture(rect(q("panelA")), chartArt, 0);
    await capture(rect(q("panelB")), statArt, 1);
    await capture(rect(q("panels")), pageArt, 2);
    fade(keys, 0, 180).catch(() => {});

    d.step(1);
    await wait(1000);

    d.step(2);
    const handle = rect(q("dragall"));
    await move(cur, handle.cx, handle.cy, 420);
    await d.click(handle.cx, handle.cy);
    for (const name of slots) q(name).style.opacity = 0.35;
    place(ghost, handle.cx, handle.cy);
    ghost.style.opacity = 1;
    const drop = rect(q("pics"));
    await together(move(cur, drop.cx - 20, drop.cy - 14, 900), move(ghost, drop.cx - 20, drop.cy - 14, 900));
    await wait(200);
    // Dropped: the three leave the tray, which closes, and arrive as three images.
    fade(ghost, 0, 160).catch(() => {});
    fade(q("tray"), 0, 260).catch(() => {});
    for (const name of ["pic1", "pic2", "pic3"]) await pop(q(name), 190);
    await fade(q("delivered"), 1, 180);
    await move(cur, drop.cx + 40, drop.cy + 86, 420);
    await wait(2600);
  }
  // The still shows the middle of the drag: three captures in the tray, travelling as a stack of three.
  function capturePoster(d) {
    const { q, rect, place } = d;
    q("tray").style.opacity = 1;
    q("dragall").style.opacity = 1;
    for (const name of ["slot1", "slot2", "slot3"]) q(name).style.opacity = 0.35;
    const handle = rect(q("dragall")), drop = rect(q("pics"));
    const x = handle.cx + (drop.cx - handle.cx) * 0.62, y = handle.cy + (drop.cy - handle.cy) * 0.62;
    place(q("ghost"), x, y);
    q("ghost").style.opacity = 1;
    place(q("cursor"), x, y);
  }

  const hero = Demo(document.getElementById("demo"), {
    template: filesTemplate, script: filesScript, poster: filesPoster,
    wide: { w: 960, h: 540 }, narrow: { w: 560, h: 520 },
  });
  Demo(document.getElementById("demoCapture"), {
    template: captureTemplate, script: captureScript, poster: capturePoster,
    wide: { w: 960, h: 540 }, narrow: { w: 560, h: 728 },
  });
  // "See how it works" goes to the replay and starts it from the download.
  document.getElementById("seeHow").addEventListener("click", () => hero.restart());

  // ---------- The action ring: one selection drives the row, the ring and the example ----------
  const overlay = document.querySelector(".ring-overlay");
  const rows = [...document.querySelectorAll(".action")];
  const examples = [...document.querySelectorAll(".ex")];
  const names = ["convert", "rename", "copy", "send"]; // clockwise from the top, as on the ring
  const NS = "http://www.w3.org/2000/svg";
  // A point on the ring, in the capture's own points: 0° is straight up, turning clockwise.
  const at = (r, deg) => {
    const t = (deg * Math.PI) / 180;
    return `${(140 + r * Math.sin(t)).toFixed(2)} ${(140 - r * Math.cos(t)).toFixed(2)}`;
  };
  const marks = names.map((name, i) => {
    const a = i * 90;
    const wedge = document.createElementNS(NS, "path");
    wedge.setAttribute("class", "wedge");
    wedge.setAttribute("d", `M${at(26, a - 45)}L${at(76, a - 45)}A76 76 0 0 1 ${at(76, a + 45)}L${at(26, a + 45)}A26 26 0 0 0 ${at(26, a - 45)}Z`);
    wedge.addEventListener("click", () => select(name));
    const arc = document.createElementNS(NS, "path");
    arc.setAttribute("class", "arc");
    arc.setAttribute("d", `M${at(82, a - 39)}A82 82 0 0 1 ${at(82, a + 39)}`);
    overlay.append(wedge, arc);
    return [wedge, arc];
  });
  function select(name) {
    rows.forEach((row) => {
      const input = row.querySelector("input"), on = input.value === name;
      input.checked = on;
      row.classList.toggle("selected", on);
    });
    names.forEach((n, i) => marks[i].forEach((node) => node.classList.toggle("on", n === name)));
    examples.forEach((ex) => ex.classList.toggle("on", ex.dataset.example === name));
  }
  rows.forEach((row) => row.querySelector("input").addEventListener("change", (event) => {
    if (event.target.checked) select(event.target.value);
  }));
  // A reloaded page can come back with another row already chosen, so start from whatever is checked.
  select((rows.map((row) => row.querySelector("input")).find((input) => input.checked) || { value: "convert" }).value);

  // The Rename example uses today's date, the same way Perch does.
  const today = new Date();
  document.getElementById("exDate").textContent =
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
})();
