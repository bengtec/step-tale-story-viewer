const COL = 280;
const ROW = 96;
const NW = 210;
const NH = 68;

const state = {
  catalog: [],
  story: null,
  graph: null,
  pos: {},
  size: { w: 0, h: 0 },
  view: { x: 24, y: 24, k: 1 },
  mode: "map",
  selected: null,
  walk: [],
  picks: {},
  ending: null,
  query: "",
};

const $ = (id) => document.getElementById(id);

function main() {
  bind();
  bindLoader();
}

function bindLoader() {
  const openPicker = () => $("file").click();
  $("upload").addEventListener("click", openPicker);
  $("upload-gate").addEventListener("click", openPicker);
  $("file").addEventListener("change", () => {
    const file = $("file").files && $("file").files[0];
    $("file").value = "";
    if (file) readStoryFile(file);
  });
  const drop = $("drop");
  ["dragenter", "dragover"].forEach((name) => {
    document.addEventListener(name, (event) => {
      event.preventDefault();
      drop.classList.add("hot");
    });
  });
  ["dragleave", "drop"].forEach((name) => {
    document.addEventListener(name, (event) => {
      event.preventDefault();
      drop.classList.remove("hot");
    });
  });
  document.addEventListener("drop", (event) => {
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) readStoryFile(file);
  });
}

function readStoryFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      showStory(JSON.parse(String(reader.result)), file.name);
    } catch (err) {
      showGateError(err instanceof SyntaxError ? "That file is not JSON." : err.message);
    }
  };
  reader.onerror = () => showGateError("The file could not be read.");
  reader.readAsText(file);
}

function showStory(data, source) {
  const story = parseStory(data);
  state.story = story;
  state.graph = buildGraph(story);
  layout(state.graph);
  state.selected = story.start;
  state.walk = [story.start];
  state.picks = {};
  state.ending = null;
  state.query = "";
  $("search").value = "";
  $("title").textContent = story.title || story.id || "Story";
  $("logline").textContent = story.logline || source;
  document.title = $("title").textContent + " — paths";
  setReady(true);
  renderFilters();
  renderAll();
  requestAnimationFrame(() => {
    state.view.k = 0.9;
    centerOn(story.start);
  });
}

function parseStory(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("The file must be a JSON object.");
  }
  if (!data.beats || typeof data.beats !== "object" || Array.isArray(data.beats)) {
    throw new Error("Missing a beats object.");
  }
  if (typeof data.start !== "string" || !data.beats[data.start]) {
    throw new Error("start must name a beat that exists.");
  }
  const problems = [];
  Object.entries(data.beats).forEach(([id, beat]) => {
    if (!beat || typeof beat !== "object") {
      problems.push(id + " is not an object.");
      return;
    }
    if (!["travel", "choice", "ending"].includes(beat.kind)) problems.push(id + " has an unknown kind.");
    if (!Array.isArray(beat.messages)) problems.push(id + " needs a messages array.");
    if (beat.kind === "travel") {
      if (typeof beat.next !== "string") problems.push(id + " needs next.");
      if (typeof beat.steps !== "number") problems.push(id + " needs a numeric steps cost.");
    }
    if (beat.kind === "choice") {
      if (!Array.isArray(beat.choices) || beat.choices.length < 2) {
        problems.push(id + " needs at least two choices.");
      } else {
        beat.choices.forEach((choice, index) => {
          if (!choice || typeof choice.label !== "string" || typeof choice.next !== "string") {
            problems.push(id + " choice " + (index + 1) + " needs label and next.");
          }
        });
      }
    }
    if (beat.kind === "ending" && (typeof beat.ending_id !== "string" || typeof beat.title !== "string")) {
      problems.push(id + " needs ending_id and title.");
    }
  });
  if (problems.length) throw new Error(problems.slice(0, 5).join(" "));
  return data;
}

function showGateError(message) {
  $("gate-error").textContent = message;
  if (!message) return;
  $("logline").textContent = message;
  if (!state.story) setReady(false);
}

function setReady(ready) {
  $("gate").hidden = ready;
  $("stage").classList.toggle("empty", !ready);
  ["search", "fit", "mode-map", "mode-walk"].forEach((id) => {
    $(id).disabled = !ready;
  });
}

function buildGraph(story) {
  const beats = story.beats;
  const ids = Object.keys(beats);
  const parents = {};
  const outs = {};
  ids.forEach((id) => {
    parents[id] = [];
    outs[id] = [];
  });
  ids.forEach((id) => {
    const beat = beats[id];
    const links = beat.kind === "travel"
      ? [{ to: beat.next, label: beat.activity }]
      : beat.kind === "choice"
        ? beat.choices.map((c) => ({ to: c.next, label: c.label }))
        : [];
    links.forEach((link) => {
      if (!beats[link.to]) return;
      outs[id].push(link);
      parents[link.to].push({ from: id, label: link.label });
    });
  });
  const depth = {};
  const visiting = new Set();
  function depthOf(id) {
    if (depth[id] != null) return depth[id];
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const ps = parents[id];
    depth[id] = ps.length ? 1 + Math.max(...ps.map((p) => depthOf(p.from))) : 0;
    visiting.delete(id);
    return depth[id];
  }
  ids.forEach(depthOf);

  const endingsFrom = {};
  function endingsOf(id) {
    if (endingsFrom[id]) return endingsFrom[id];
    const beat = beats[id];
    if (beat.kind === "ending") {
      endingsFrom[id] = [{ endingId: beat.ending_id, title: beat.title, beat: id }];
      return endingsFrom[id];
    }
    const map = new Map();
    outs[id].forEach((link) => {
      endingsOf(link.to).forEach((e) => map.set(e.endingId + "@" + e.beat, e));
    });
    endingsFrom[id] = [...map.values()];
    return endingsFrom[id];
  }
  ids.forEach(endingsOf);

  const pathCount = {};
  function count(id) {
    if (pathCount[id] != null) return pathCount[id];
    if (id === story.start) {
      pathCount[id] = 1;
      return 1;
    }
    pathCount[id] = parents[id].reduce((sum, p) => sum + count(p.from), 0);
    return pathCount[id];
  }
  ids.forEach(count);

  return { beats, ids, parents, outs, depth, endingsFrom, pathCount };
}

function layout(graph) {
  const layers = [];
  graph.ids.forEach((id) => {
    const d = graph.depth[id];
    if (!layers[d]) layers[d] = [];
    layers[d].push(id);
  });
  const index = new Map();
  const reindex = () => {
    index.clear();
    layers.forEach((layer) => layer.forEach((id, i) => index.set(id, i)));
  };
  const bary = (id, links) => {
    const xs = links.map((n) => index.get(n)).filter((n) => n != null);
    if (!xs.length) return index.get(id) ?? 0;
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  reindex();
  for (let pass = 0; pass < 8; pass++) {
    for (let i = 1; i < layers.length; i++) {
      layers[i].sort((a, b) => {
        const pa = graph.parents[a].map((p) => p.from);
        const pb = graph.parents[b].map((p) => p.from);
        return bary(a, pa) - bary(b, pb) || a.localeCompare(b);
      });
    }
    reindex();
    for (let i = layers.length - 2; i >= 0; i--) {
      layers[i].sort((a, b) => {
        const ca = graph.outs[a].map((p) => p.to);
        const cb = graph.outs[b].map((p) => p.to);
        return bary(a, ca) - bary(b, cb) || a.localeCompare(b);
      });
    }
    reindex();
  }
  state.pos = {};
  let tallest = 1;
  layers.forEach((layer, d) => {
    tallest = Math.max(tallest, layer.length);
    layer.forEach((id, i) => {
      state.pos[id] = { x: 28 + d * COL, y: 28 + i * ROW };
    });
  });
  state.size.w = 28 + layers.length * COL + NW;
  state.size.h = 28 + tallest * ROW + 20;
}

function bind() {
  $("mode-map").addEventListener("click", () => setMode("map", { keepPlace: true }));
  $("mode-walk").addEventListener("click", () => setMode("walk"));
  $("fit").addEventListener("click", fit);
  $("search").addEventListener("input", (e) => {
    state.query = e.target.value.trim().toLowerCase();
    renderAll();
  });
  const map = $("map");
  let drag = null;
  map.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".node")) return;
    drag = { x: e.clientX, y: e.clientY, vx: state.view.x, vy: state.view.y };
    map.classList.add("dragging");
    map.setPointerCapture(e.pointerId);
  });
  map.addEventListener("pointermove", (e) => {
    if (!drag) return;
    state.view.x = drag.vx + (e.clientX - drag.x);
    state.view.y = drag.vy + (e.clientY - drag.y);
    applyView();
  });
  const endDrag = () => {
    drag = null;
    map.classList.remove("dragging");
  };
  map.addEventListener("pointerup", endDrag);
  map.addEventListener("pointercancel", endDrag);
  map.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = map.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const next = Math.min(1.8, Math.max(0.18, state.view.k * (e.deltaY < 0 ? 1.08 : 0.92)));
    const scale = next / state.view.k;
    state.view.x = mx - (mx - state.view.x) * scale;
    state.view.y = my - (my - state.view.y) * scale;
    state.view.k = next;
    applyView();
  }, { passive: false });
  window.addEventListener("resize", fit);
}

function setMode(mode, opts = {}) {
  state.mode = mode;
  $("mode-map").setAttribute("aria-pressed", mode === "map" ? "true" : "false");
  $("mode-walk").setAttribute("aria-pressed", mode === "walk" ? "true" : "false");
  $("stage").classList.toggle("walking", mode === "walk");
  if (opts.keepPlace && state.walk.length) {
    state.selected = state.walk[state.walk.length - 1];
  }
  renderAll();
  if (mode === "map" && state.selected) centerOn(state.selected);
}

function renderFilters() {
  const bar = $("filters");
  [...bar.querySelectorAll("button")].forEach((n) => n.remove());
  const byId = new Map();
  state.graph.ids.forEach((id) => {
    const beat = state.graph.beats[id];
    if (beat.kind === "ending" && !byId.has(beat.ending_id)) {
      byId.set(beat.ending_id, beat.title);
    }
  });
  [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1])).forEach(([endingId, title]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = title;
    btn.setAttribute("aria-pressed", state.ending === endingId ? "true" : "false");
    btn.addEventListener("click", () => {
      state.ending = state.ending === endingId ? null : endingId;
      const beat = state.graph.ids.find((id) => {
        const b = state.graph.beats[id];
        return b.kind === "ending" && b.ending_id === endingId;
      });
      if (state.ending && beat) {
        state.selected = beat;
        state.mode = "map";
        setMode("map");
        centerOn(beat);
      }
      renderFilters();
      renderAll();
    });
    bar.appendChild(btn);
  });
}

function focusSet() {
  if (!state.ending) return null;
  const targets = state.graph.ids.filter((id) => {
    const beat = state.graph.beats[id];
    return beat.kind === "ending" && beat.ending_id === state.ending;
  });
  const seen = new Set();
  const stack = [...targets];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    state.graph.parents[id].forEach((p) => stack.push(p.from));
  }
  return seen;
}

function matchSet() {
  const q = state.query;
  if (!q) return null;
  const hits = new Set();
  state.graph.ids.forEach((id) => {
    const beat = state.graph.beats[id];
    const hay = [
      id,
      beat.kind,
      beat.title || "",
      beat.activity || "",
      ...(beat.messages || []),
      ...((beat.choices || []).map((c) => c.label + " " + c.send)),
    ].join("\n").toLowerCase();
    if (hay.includes(q)) hits.add(id);
  });
  return hits;
}

function renderAll() {
  renderMap();
  renderPanel();
  renderWalk();
  applyView();
}

function renderMap() {
  const focus = focusSet();
  const matches = matchSet();
  const onPath = new Set(state.walk);
  const hotEdges = new Set();
  for (let i = 0; i < state.walk.length - 1; i++) {
    hotEdges.add(state.walk[i] + "->" + state.walk[i + 1]);
  }

  const svg = $("edges");
  svg.setAttribute("width", state.size.w);
  svg.setAttribute("height", state.size.h);
  svg.replaceChildren();
  state.graph.ids.forEach((id) => {
    state.graph.outs[id].forEach((link) => {
      const a = state.pos[id];
      const b = state.pos[link.to];
      if (!a || !b) return;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const x1 = a.x + NW;
      const y1 = a.y + NH / 2;
      const x2 = b.x;
      const y2 = b.y + NH / 2;
      const mx = (x1 + x2) / 2;
      path.setAttribute("d", `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`);
      const key = id + "->" + link.to;
      const dim = focus && (!focus.has(id) || !focus.has(link.to));
      path.classList.toggle("hot", hotEdges.has(key));
      path.classList.toggle("dim", Boolean(dim));
      svg.appendChild(path);
      if (hotEdges.has(key)) {
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", mx);
        text.setAttribute("y", (y1 + y2) / 2 - 6);
        text.setAttribute("text-anchor", "middle");
        text.textContent = link.label;
        svg.appendChild(text);
      }
    });
  });

  const nodes = $("nodes");
  nodes.replaceChildren();
  state.graph.ids.forEach((id) => {
    const beat = state.graph.beats[id];
    const pos = state.pos[id];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "node " + beat.kind;
    if (state.graph.parents[id].length > 1) btn.classList.add("join");
    if (id === state.selected || onPath.has(id)) btn.classList.add("on");
    if (focus && !focus.has(id)) btn.classList.add("dim");
    if (matches && matches.has(id)) btn.classList.add("match");
    btn.style.left = pos.x + "px";
    btn.style.top = pos.y + "px";
    const name = document.createElement("strong");
    name.textContent = beat.kind === "ending" ? beat.title : id;
    const sub = document.createElement("em");
    sub.textContent = beat.kind === "travel"
      ? beat.activity + " · " + beat.steps
      : beat.kind === "choice"
        ? beat.choices.length + " choices"
        : "ending";
    btn.append(name, sub);
    btn.addEventListener("click", () => {
      state.selected = id;
      renderPanel();
      renderMap();
    });
    nodes.appendChild(btn);
  });

  const world = $("world");
  world.style.width = state.size.w + "px";
  world.style.height = state.size.h + "px";
}

function renderPanel() {
  const panel = $("panel");
  panel.replaceChildren();
  const id = state.selected;
  if (!id) return;
  const beat = state.graph.beats[id];
  const g = state.graph;
  const kicker = document.createElement("p");
  kicker.className = "kicker";
  const join = g.parents[id].length > 1 ? " · " + g.parents[id].length + " ways in" : "";
  kicker.textContent = beat.kind + " · " + id + join + " · " + g.pathCount[id] + " path" + (g.pathCount[id] === 1 ? "" : "s");
  const h = document.createElement("h2");
  h.textContent = beat.kind === "ending" ? beat.title : beat.kind === "travel" ? (beat.activity || id) : "Choose";
  panel.append(kicker, h);

  (beat.messages || []).forEach((line) => {
    const p = document.createElement("p");
    p.className = "bubble";
    p.textContent = line;
    panel.appendChild(p);
  });

  if (beat.kind === "travel") {
    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = beat.steps + " steps · " + beat.activity;
    panel.appendChild(meta);
    panel.appendChild(jump("Arrive at " + beat.next, () => select(beat.next)));
  }

  if (beat.kind === "choice") {
    const box = document.createElement("div");
    box.className = "choices";
    beat.choices.forEach((choice) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = choice.label;
      btn.addEventListener("click", () => select(choice.next));
      box.appendChild(btn);
    });
    panel.appendChild(box);
  }

  if (g.parents[id].length) {
    panel.appendChild(heading("Reached from"));
    const links = document.createElement("div");
    links.className = "links";
    g.parents[id].forEach((p) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = p.label + " ← " + p.from;
      btn.addEventListener("click", () => select(p.from));
      links.appendChild(btn);
    });
    panel.appendChild(links);
  }

  const endings = g.endingsFrom[id];
  panel.appendChild(heading("Endings still open · " + new Set(endings.map((e) => e.endingId)).size));
  const list = document.createElement("div");
  list.className = "links";
  const seen = new Set();
  endings.forEach((e) => {
    if (seen.has(e.endingId)) return;
    seen.add(e.endingId);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = e.title;
    btn.addEventListener("click", () => {
      state.ending = e.endingId;
      state.selected = e.beat;
      renderFilters();
      renderAll();
      centerOn(e.beat);
    });
    list.appendChild(btn);
  });
  panel.appendChild(list);

  const toWalk = document.createElement("button");
  toWalk.type = "button";
  toWalk.className = "arrive";
  toWalk.textContent = "Walk to here from the start";
  toWalk.addEventListener("click", () => {
    const route = oneRoute(id);
    state.walk = route.map((step) => step.id);
    state.picks = {};
    route.forEach((step) => {
      if (step.choice != null) state.picks[step.id] = step.choice;
    });
    setMode("walk");
  });
  panel.appendChild(toWalk);
}

function renderWalk() {
  const root = $("walk");
  root.replaceChildren();
  const phone = document.createElement("div");
  phone.className = "phone";
  const who = document.createElement("div");
  who.className = "who";
  const h = document.createElement("h2");
  h.textContent = state.story.contact;
  h.style.color = state.story.accent || "inherit";
  const role = document.createElement("span");
  role.textContent = state.story.contact_role || "";
  who.append(h, role);
  phone.appendChild(who);

  const back = document.createElement("button");
  back.type = "button";
  back.className = "arrive";
  back.textContent = "Back";
  back.disabled = state.walk.length < 2;
  back.addEventListener("click", () => {
    if (state.walk.length < 2) return;
    state.walk.pop();
    const prev = state.walk[state.walk.length - 1];
    delete state.picks[prev];
    state.selected = prev;
    renderWalk();
    renderMap();
  });
  phone.appendChild(back);

  state.walk.forEach((id, index) => {
    const beat = state.graph.beats[id];
    const last = index === state.walk.length - 1;
    (beat.messages || []).forEach((line) => {
      const p = document.createElement("p");
      p.className = "bubble";
      p.textContent = line;
      phone.appendChild(p);
    });
    if (beat.kind === "choice" && state.picks[id] != null && !last) {
      const sent = document.createElement("p");
      sent.className = "bubble player";
      sent.textContent = beat.choices[state.picks[id]].send;
      phone.appendChild(sent);
    }
    if (!last) return;
    if (beat.kind === "travel") {
      const meta = document.createElement("p");
      meta.className = "meta";
      meta.textContent = beat.activity + " · " + beat.steps + " steps, no wait in this viewer";
      const go = document.createElement("button");
      go.type = "button";
      go.className = "arrive";
      go.textContent = "Arrive";
      go.addEventListener("click", () => {
        state.walk.push(beat.next);
        state.selected = beat.next;
        renderWalk();
        renderMap();
      });
      phone.append(meta, go);
    } else if (beat.kind === "choice") {
      const box = document.createElement("div");
      box.className = "choices";
      beat.choices.forEach((choice, i) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = choice.label;
        btn.addEventListener("click", () => {
          state.picks[id] = i;
          state.walk.push(choice.next);
          state.selected = choice.next;
          renderWalk();
          renderMap();
        });
        box.appendChild(btn);
      });
      phone.appendChild(box);
    } else {
      const card = document.createElement("div");
      card.className = "ending-card";
      const title = document.createElement("h3");
      title.textContent = beat.title;
      const idLine = document.createElement("p");
      idLine.className = "meta";
      idLine.textContent = beat.ending_id;
      card.append(title, idLine);
      phone.appendChild(card);
    }
  });

  const again = document.createElement("button");
  again.type = "button";
  again.className = "arrive";
  again.textContent = "Return to the start";
  again.addEventListener("click", () => {
    state.walk = [state.story.start];
    state.picks = {};
    state.selected = state.story.start;
    renderWalk();
    renderMap();
  });
  phone.appendChild(again);
  root.appendChild(phone);
  root.scrollTop = root.scrollHeight;
}

function oneRoute(target) {
  const prev = {};
  const queue = [state.story.start];
  prev[state.story.start] = null;
  while (queue.length) {
    const id = queue.shift();
    if (id === target) break;
    state.graph.outs[id].forEach((link) => {
      if (prev[link.to] !== undefined) return;
      prev[link.to] = { from: id, label: link.label };
      queue.push(link.to);
    });
  }
  const ids = [];
  let cursor = target;
  while (cursor) {
    ids.push(cursor);
    cursor = prev[cursor] ? prev[cursor].from : null;
  }
  ids.reverse();
  return ids.map((id, index) => {
    const beat = state.graph.beats[id];
    let choice = null;
    if (beat.kind === "choice" && index < ids.length - 1) {
      choice = beat.choices.findIndex((c) => c.next === ids[index + 1]);
    }
    return { id, choice };
  });
}

function select(id) {
  state.selected = id;
  renderAll();
  centerOn(id);
}

function heading(text) {
  const h = document.createElement("h3");
  h.className = "subhead";
  h.textContent = text;
  return h;
}

function jump(text, fn) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "arrive";
  btn.textContent = text;
  btn.addEventListener("click", fn);
  return btn;
}

function applyView() {
  const v = state.view;
  $("world").style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
}

function fit() {
  const rect = $("map").getBoundingClientRect();
  if (!rect.width || !state.size.w) return;
  const k = Math.min(rect.width / state.size.w, rect.height / state.size.h, 1);
  state.view.k = Math.max(0.18, k);
  state.view.x = Math.max(12, (rect.width - state.size.w * state.view.k) / 2);
  state.view.y = 16;
  applyView();
}

function centerOn(id) {
  const pos = state.pos[id];
  const rect = $("map").getBoundingClientRect();
  if (!pos || !rect.width) return;
  state.view.x = rect.width / 2 - (pos.x + NW / 2) * state.view.k;
  state.view.y = rect.height / 2 - (pos.y + NH / 2) * state.view.k;
  applyView();
}

main();
