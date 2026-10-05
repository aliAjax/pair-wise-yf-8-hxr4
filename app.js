const storageKey = "zfl17-film-strip-desk";

const fallbackThumbs = ["#d49b35", "#347d89", "#b54d48", "#4d7656", "#6d6378"];

const defaultState = {
  reelTitle: "春日试映A卷",
  diskCapacity: 90,
  actualText: "",
  segments: [
    {
      id: crypto.randomUUID(),
      code: "A-001",
      duration: 18,
      shift: "正常",
      damage: "完好",
      note: "开场街景，节奏平稳，适合保留原顺序。",
      thumb: "",
      disk: 1
    },
    {
      id: crypto.randomUUID(),
      code: "A-006",
      duration: 9,
      shift: "偏红",
      damage: "轻微划痕",
      note: "人物近景左侧有划痕，试映时留意是否明显。",
      thumb: "",
      disk: 1
    },
    {
      id: crypto.randomUUID(),
      code: "A-012",
      duration: 14,
      shift: "褪色",
      damage: "接片松动",
      note: "接片位置靠近段尾，放映前建议重新压平。",
      thumb: "",
      disk: 1
    },
    {
      id: crypto.randomUUID(),
      code: "A-018",
      duration: 16,
      shift: "正常",
      damage: "完好",
      note: "结尾字幕与出品方信息，接片完整，适合收尾。",
      thumb: "",
      disk: 1
    }
  ]
};

let state = loadState();
let draggedId = null;
let packing = null;
let recon = null;

const els = {
  reelTitle: document.querySelector("#reelTitle"),
  colorFilter: document.querySelector("#colorFilter"),
  searchInput: document.querySelector("#searchInput"),
  capacityInput: document.querySelector("#capacityInput"),
  segmentForm: document.querySelector("#segmentForm"),
  codeInput: document.querySelector("#codeInput"),
  durationInput: document.querySelector("#durationInput"),
  shiftInput: document.querySelector("#shiftInput"),
  damageInput: document.querySelector("#damageInput"),
  thumbInput: document.querySelector("#thumbInput"),
  noteInput: document.querySelector("#noteInput"),
  segmentList: document.querySelector("#segmentList"),
  warningList: document.querySelector("#warningList"),
  totalDuration: document.querySelector("#totalDuration"),
  damageCount: document.querySelector("#damageCount"),
  segmentCount: document.querySelector("#segmentCount"),
  exportBtn: document.querySelector("#exportBtn"),
  actualInput: document.querySelector("#actualInput"),
  clearActualBtn: document.querySelector("#clearActualBtn"),
  reconCounts: document.querySelector("#reconCounts"),
  reconMissing: document.querySelector("#reconMissing"),
  reconPending: document.querySelector("#reconPending"),
  missingCount: document.querySelector("#missingCount"),
  pendingCount: document.querySelector("#pendingCount"),
  diskPlan: document.querySelector("#diskPlan")
};

function loadState() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return structuredClone(defaultState);
  try {
    const parsed = JSON.parse(saved);
    const merged = { ...structuredClone(defaultState), ...parsed };
    // 迁移：旧数据没有盘号，补默认值 1，备注和缩略图原样保留
    if (Array.isArray(merged.segments)) {
      merged.segments = merged.segments.map((seg) => ({
        ...seg,
        disk: Number.isFinite(Number(seg.disk)) ? Number(seg.disk) : 1
      }));
    }
    if (!Number.isFinite(Number(merged.diskCapacity)) || Number(merged.diskCapacity) <= 0) {
      merged.diskCapacity = defaultState.diskCapacity;
    }
    if (typeof merged.actualText !== "string") merged.actualText = "";
    return merged;
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

/* ---------------- 编号归一化（写法不同认成同一条） ---------------- */

function normalizeCode(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .replace(/\d+/g, (digits) => String(Number(digits)));
}

/* ---------------- 实际记录解析与对账 ---------------- */

function parseActualRecords(text) {
  const records = [];
  const seen = new Set();
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/[\s,，;；|｜]+/).filter(Boolean);
    const code = parts[0];
    if (!code) continue;
    const key = normalizeCode(code);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    records.push({ raw: trimmed, code, key });
  }
  return records;
}

function reconcile() {
  const records = parseActualRecords(state.actualText);
  const plannedByKey = new Map();
  for (const seg of state.segments) {
    const key = normalizeCode(seg.code);
    if (key && !plannedByKey.has(key)) plannedByKey.set(key, seg);
  }
  const matched = [];
  const pending = [];
  const matchedIds = new Set();
  for (const rec of records) {
    const seg = plannedByKey.get(rec.key);
    if (seg) {
      matched.push({ record: rec, segment: seg });
      matchedIds.add(seg.id);
    } else {
      pending.push(rec);
    }
  }
  const missing = state.segments.filter((seg) => !matchedIds.has(seg.id));
  return { records, matched, pending, missing };
}

/* ---------------- 装盘算法 ---------------- */

function isSpliceDamaged(item) {
  return item?.damage === "接片松动";
}

// 按顺序装盘：每盘容量固定，装不下顺延下一盘；
// 接片破损的片段不排在盘尾（抽到下一盘盘头），无法避免时给出警告。
function packDisks(segments, capacity) {
  const cap = Math.max(1, Number(capacity) || 1);
  const disks = [];
  const moved = new Set();
  let pendingHead = null;

  let i = 0;
  while (i < segments.length || pendingHead) {
    const disk = { items: [], duration: 0 };
    if (pendingHead) {
      disk.items.push(pendingHead);
      disk.duration += Number(pendingHead.duration) || 0;
      pendingHead = null;
    }
    while (i < segments.length) {
      const seg = segments[i];
      const segDur = Number(seg.duration) || 0;
      if (disk.items.length === 0) {
        disk.items.push(seg);
        disk.duration += segDur;
        i += 1;
      } else if (disk.duration + segDur <= cap) {
        disk.items.push(seg);
        disk.duration += segDur;
        i += 1;
      } else {
        const tail = disk.items[disk.items.length - 1];
        if (isSpliceDamaged(tail) && !moved.has(tail.id)) {
          moved.add(tail.id);
          disk.items.pop();
          disk.duration -= Number(tail.duration) || 0;
          pendingHead = tail;
        }
        break;
      }
    }
    if (disk.items.length > 0) disks.push(disk);
  }

  // 最后一盘盘尾检查
  if (disks.length > 0) {
    const last = disks[disks.length - 1];
    if (last.items.length > 0) {
      const tail = last.items[last.items.length - 1];
      if (isSpliceDamaged(tail) && !moved.has(tail.id)) {
        moved.add(tail.id);
        last.items.pop();
        last.duration -= Number(tail.duration) || 0;
        if (last.items.length === 0) disks.pop();
        disks.push({ items: [tail], duration: Number(tail.duration) || 0 });
      }
    }
  }

  const assignments = new Map();
  disks.forEach((disk, idx) => {
    disk.number = idx + 1;
    disk.items.forEach((seg) => assignments.set(seg.id, idx + 1));
  });

  const warnings = [];
  disks.forEach((disk) => {
    if (disk.duration > cap) {
      warnings.push({ kind: "overflow", disk: disk.number, duration: disk.duration });
    }
    const tail = disk.items[disk.items.length - 1];
    if (tail && isSpliceDamaged(tail)) {
      warnings.push({ kind: "splice-tail", disk: disk.number, code: tail.code });
    }
  });

  return { disks, assignments, warnings };
}

function getPacking() {
  return packDisks(state.segments, state.diskCapacity);
}

/* ---------------- 筛选与渲染 ---------------- */

function getFilteredSegments() {
  const color = els.colorFilter.value;
  const keyword = els.searchInput.value.trim();
  return state.segments.filter((item) => {
    const matchesColor = color === "all" || item.shift === color;
    const matchesKeyword = !keyword || `${item.code}${item.note}${item.damage}`.includes(keyword);
    return matchesColor && matchesKeyword;
  });
}

function renderStats() {
  const total = state.segments.reduce((sum, item) => sum + Number(item.duration), 0);
  const damaged = state.segments.filter((item) => item.damage !== "完好").length;
  els.totalDuration.textContent = formatDuration(total);
  els.damageCount.textContent = damaged;
  els.segmentCount.textContent = state.segments.length;
}

function renderDiskPlan() {
  if (!els.diskPlan) return;
  const cap = Math.max(1, Number(state.diskCapacity) || 1);
  els.diskPlan.innerHTML =
    packing.disks
      .map((disk) => {
        const over = disk.duration > cap;
        const tail = disk.items[disk.items.length - 1];
        const spliceWarn = tail && isSpliceDamaged(tail);
        return `
          <div class="disk-chip ${over || spliceWarn ? "warn" : ""}">
            <strong>盘 ${disk.number}</strong>
            <span>${formatDuration(disk.duration)} / ${formatDuration(cap)}</span>
            <em>${disk.items.length} 段${over ? " · 超容量" : spliceWarn ? " · 盘尾接片" : ""}</em>
          </div>
        `;
      })
      .join("") || `<p class="empty">还没有装盘。</p>`;
}

function renderList() {
  const segments = getFilteredSegments();
  const visibleIds = new Set(segments.map((item) => item.id));
  const missingIds = new Set(recon ? recon.missing.map((item) => item.id) : []);
  const matchedIds = new Set(recon ? recon.matched.map((entry) => entry.segment.id) : []);

  const html = packing.disks
    .map((disk) => {
      const items = disk.items.filter((item) => visibleIds.has(item.id));
      if (!items.length) return "";
      const over = disk.duration > Math.max(1, Number(state.diskCapacity) || 1);
      const tail = disk.items[disk.items.length - 1];
      const spliceWarn = tail && isSpliceDamaged(tail);
      return `
        <div class="disk-group">
          <div class="disk-group-head">
            <strong>盘 ${disk.number}</strong>
            <span>${formatDuration(disk.duration)} / ${formatDuration(state.diskCapacity)}</span>
            ${over ? `<span class="disk-warn">超容量</span>` : ""}
            ${spliceWarn ? `<span class="disk-warn">盘尾接片破损</span>` : ""}
          </div>
          <div class="segment-list">
            ${items
              .map((item) => {
                const realIndex = state.segments.findIndex((segment) => segment.id === item.id);
                const hasDamage = item.damage !== "完好";
                const isMissing = missingIds.has(item.id);
                const isMatched = matchedIds.has(item.id);
                return `
                  <article class="segment-card" draggable="true" data-id="${item.id}">
                    <div class="thumb">
                      ${
                        item.thumb
                          ? `<img src="${item.thumb}" alt="${escapeHtml(item.code)}缩略图" />`
                          : `<div class="film-placeholder" style="background:${fallbackThumbs[realIndex % fallbackThumbs.length]}">${escapeHtml(item.code)}</div>`
                      }
                    </div>
                    <div class="segment-main">
                      <div class="segment-title">
                        <strong>${realIndex + 1}. ${escapeHtml(item.code)}</strong>
                        <span class="disk-badge">盘 ${disk.number}</span>
                        ${isMatched ? `<span class="status-badge matched">已匹配</span>` : ""}
                        ${isMissing ? `<span class="status-badge missing">缺失</span>` : ""}
                        <span>${formatDuration(item.duration)}</span>
                      </div>
                      <div class="tag-row">
                        <span class="tag">${escapeHtml(item.shift)}</span>
                        <span class="tag ${hasDamage ? "damage" : "ok"}">${escapeHtml(item.damage)}</span>
                      </div>
                      <p class="segment-note">${escapeHtml(item.note || "没有备注。")}</p>
                    </div>
                    <div class="segment-actions">
                      <button type="button" title="上移" data-move-up="${item.id}">↑</button>
                      <button type="button" title="下移" data-move-down="${item.id}">↓</button>
                      <button type="button" title="删除" data-delete="${item.id}">×</button>
                    </div>
                  </article>
                `;
              })
              .join("")}
          </div>
        </div>
      `;
    })
    .join("");

  els.segmentList.innerHTML = html || `<p class="empty">没有符合筛选的片段。</p>`;
}

function renderReconcile() {
  if (!recon) return;
  const { matched, pending, missing } = recon;
  els.reconCounts.textContent = `匹配 ${matched.length} · 缺失 ${missing.length} · 待确认 ${pending.length}`;
  els.missingCount.textContent = missing.length;
  els.pendingCount.textContent = pending.length;
  els.reconMissing.innerHTML = missing.length
    ? missing.map((item) => `<li><span>${escapeHtml(item.code)}</span></li>`).join("")
    : `<li class="empty">计划片段都已放映。</li>`;
  els.reconPending.innerHTML = pending.length
    ? pending
        .map(
          (rec, index) => `
          <li>
            <span>${escapeHtml(rec.raw)}</span>
            <button type="button" data-add-pending="${index}">加入计划</button>
          </li>`
        )
        .join("")
    : `<li class="empty">没有待确认的实际记录。</li>`;
}

function renderWarnings() {
  const cap = Math.max(1, Number(state.diskCapacity) || 1);
  const items = [];
  for (const item of state.segments) {
    if (item.damage !== "完好" || item.shift !== "正常") {
      const index = state.segments.findIndex((segment) => segment.id === item.id) + 1;
      const reasons = [item.shift !== "正常" ? item.shift : "", item.damage !== "完好" ? item.damage : ""].filter(Boolean).join(" · ");
      items.push({
        title: `${index}. ${escapeHtml(item.code)}`,
        body: `${escapeHtml(reasons)}${item.note ? `：${escapeHtml(item.note)}` : ""}`
      });
    }
  }
  for (const w of packing.warnings) {
    if (w.kind === "overflow") {
      items.push({
        title: `盘 ${w.disk} 时长超容量`,
        body: `装盘 ${formatDuration(w.duration)} 超过每盘容量 ${formatDuration(cap)}，装不下的片段已顺延到下一盘。`
      });
    } else if (w.kind === "splice-tail") {
      items.push({
        title: `盘 ${w.disk} 盘尾为 ${escapeHtml(w.code)}`,
        body: "接片破损片段排在盘尾，换盘时容易断片，建议调整顺序避开。"
      });
    }
  }
  els.warningList.innerHTML = items.length
    ? items
        .map(
          (item) => `
          <div class="warning-item">
            <strong>${item.title}</strong>
            <span>${item.body}</span>
          </div>
        `
        )
        .join("")
    : `<p class="empty">当前清单没有颜色偏移、破损或装盘提醒。</p>`;
}

function renderAll() {
  saveState();
  els.reelTitle.value = state.reelTitle;
  if (els.capacityInput) els.capacityInput.value = state.diskCapacity;
  if (els.actualInput) els.actualInput.value = state.actualText || "";
  packing = getPacking();
  // 时长一变，旧装盘方案作废，按当前顺序与容量重算并回填盘号
  state.segments.forEach((seg) => {
    seg.disk = packing.assignments.get(seg.id) ?? seg.disk ?? 1;
  });
  recon = reconcile();
  renderStats();
  renderDiskPlan();
  renderList();
  renderReconcile();
  renderWarnings();
}

function formatDuration(seconds) {
  const value = Number(seconds) || 0;
  const minutes = Math.floor(value / 60);
  const rest = String(value % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

async function addSegment(event) {
  event.preventDefault();
  const thumb = await readFileAsDataUrl(els.thumbInput.files[0]);
  state.segments.push({
    id: crypto.randomUUID(),
    code: els.codeInput.value.trim(),
    duration: Number(els.durationInput.value),
    shift: els.shiftInput.value,
    damage: els.damageInput.value,
    note: els.noteInput.value.trim(),
    thumb,
    disk: 1
  });
  els.segmentForm.reset();
  els.durationInput.value = 12;
  renderAll();
}

function moveSegment(id, direction) {
  const index = state.segments.findIndex((item) => item.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= state.segments.length) return;
  const [item] = state.segments.splice(index, 1);
  state.segments.splice(target, 0, item);
  renderAll();
}

function addPendingToPlan(index) {
  if (!recon || !recon.pending[index]) return;
  const rec = recon.pending[index];
  state.segments.push({
    id: crypto.randomUUID(),
    code: rec.code,
    duration: 12,
    shift: "正常",
    damage: "完好",
    note: "实际记录待确认后补入计划，时长待核。",
    thumb: "",
    disk: 1
  });
  renderAll();
}

function exportList() {
  const lines = [
    `胶片卷：${state.reelTitle || "未命名胶片卷"}`,
    `总时长：${formatDuration(state.segments.reduce((sum, item) => sum + Number(item.duration), 0))}`,
    `每盘容量：${formatDuration(state.diskCapacity)}`,
    "",
    ...state.segments.map((item, index) => `${index + 1}. [盘${item.disk}] ${item.code}｜${formatDuration(item.duration)}｜${item.shift}｜${item.damage}｜${item.note || "无备注"}`)
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${state.reelTitle || "film-reel"}-checklist.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.reelTitle.addEventListener("input", () => {
  state.reelTitle = els.reelTitle.value;
  saveState();
});
els.colorFilter.addEventListener("change", renderList);
els.searchInput.addEventListener("input", renderList);
els.capacityInput.addEventListener("change", () => {
  const value = Number(els.capacityInput.value);
  if (Number.isFinite(value) && value > 0) {
    state.diskCapacity = Math.round(value);
    renderAll();
  }
});
els.actualInput.addEventListener("input", () => {
  state.actualText = els.actualInput.value;
  saveState();
  recon = reconcile();
  renderList();
  renderReconcile();
});
els.clearActualBtn.addEventListener("click", () => {
  state.actualText = "";
  els.actualInput.value = "";
  saveState();
  recon = reconcile();
  renderList();
  renderReconcile();
});
els.segmentForm.addEventListener("submit", addSegment);
els.exportBtn.addEventListener("click", exportList);

els.segmentList.addEventListener("click", (event) => {
  const up = event.target.closest("[data-move-up]");
  const down = event.target.closest("[data-move-down]");
  const remove = event.target.closest("[data-delete]");
  if (up) moveSegment(up.dataset.moveUp, -1);
  if (down) moveSegment(down.dataset.moveDown, 1);
  if (remove) {
    state.segments = state.segments.filter((item) => item.id !== remove.dataset.delete);
    renderAll();
  }
});

els.reconPending.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-add-pending]");
  if (!btn) return;
  addPendingToPlan(Number(btn.dataset.addPending));
});

els.segmentList.addEventListener("dragstart", (event) => {
  const card = event.target.closest("[data-id]");
  if (!card) return;
  draggedId = card.dataset.id;
  card.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
});

els.segmentList.addEventListener("dragend", (event) => {
  event.target.closest("[data-id]")?.classList.remove("dragging");
  draggedId = null;
});

els.segmentList.addEventListener("dragover", (event) => {
  const card = event.target.closest("[data-id]");
  if (!card || !draggedId || card.dataset.id === draggedId) return;
  event.preventDefault();
  const fromIndex = state.segments.findIndex((item) => item.id === draggedId);
  const toIndex = state.segments.findIndex((item) => item.id === card.dataset.id);
  if (fromIndex < 0 || toIndex < 0) return;
  const [item] = state.segments.splice(fromIndex, 1);
  state.segments.splice(toIndex, 0, item);
  renderAll();
});

renderAll();
