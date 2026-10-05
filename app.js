const storageKey = "zfl17-film-strip-desk";

// 每本盘的固定容量（秒）。容量调整后装盘方案全部作废重算。
const REEL_CAPACITY = 60;

const fallbackThumbs = ["#d49b35", "#347d89", "#b54d48", "#4d7656", "#6d6378"];

const defaultState = {
  reelTitle: "春日试映A卷",
  // actualText：放映机导出的实际记录原文，随存档保存，刷新后可继续对账。
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
      // 旧数据没有盘号：迁移时没有该字段也不补死值，
      // 这里仅作占位，真正的盘号由装盘算法统一计算。
      reel: null
    },
    {
      id: crypto.randomUUID(),
      code: "A-006",
      duration: 9,
      shift: "偏红",
      damage: "轻微划痕",
      note: "人物近景左侧有划痕，试映时留意是否明显。",
      thumb: "",
      reel: null
    },
    {
      id: crypto.randomUUID(),
      code: "A-012",
      duration: 14,
      shift: "褪色",
      damage: "接片松动",
      note: "接片位置靠近段尾，放映前建议重新压平。",
      thumb: "",
      reel: null
    }
  ]
};

let state = loadState();
let draggedId = null;
// 最近一次装盘结果（盘号、超装告警），时长或顺序一变就重算。
let pack = { reels: [], overflow: new Set(), unavoidable: new Set() };

const els = {
  reelTitle: document.querySelector("#reelTitle"),
  colorFilter: document.querySelector("#colorFilter"),
  searchInput: document.querySelector("#searchInput"),
  actualInput: document.querySelector("#actualInput"),
  reconcileResult: document.querySelector("#reconcileResult"),
  segmentForm: document.querySelector("#segmentForm"),
  codeInput: document.querySelector("#codeInput"),
  durationInput: document.querySelector("#durationInput"),
  shiftInput: document.querySelector("#shiftInput"),
  damageInput: document.querySelector("#damageInput"),
  thumbInput: document.querySelector("#thumbInput"),
  noteInput: document.querySelector("#noteInput"),
  segmentList: document.querySelector("#segmentList"),
  reelList: document.querySelector("#reelList"),
  reelCapacityLabel: document.querySelector("#reelCapacityLabel"),
  warningList: document.querySelector("#warningList"),
  totalDuration: document.querySelector("#totalDuration"),
  damageCount: document.querySelector("#damageCount"),
  segmentCount: document.querySelector("#segmentCount"),
  exportBtn: document.querySelector("#exportBtn")
};

function loadState() {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return structuredClone(defaultState);
  let parsed;
  try {
    parsed = JSON.parse(saved);
  } catch {
    return structuredClone(defaultState);
  }
  // 迁移：旧数据可能缺 actualText，也可能缺每条的 reel / note / thumb 字段。
  // 备注和缩略图一律保留；盘号只补默认值 null，真正盘号交给装盘算法。
  const merged = { ...structuredClone(defaultState), ...parsed };
  merged.segments = (parsed.segments || []).map((item) => ({
    id: item.id || crypto.randomUUID(),
    code: String(item.code ?? ""),
    duration: Number(item.duration) || 0,
    shift: item.shift || "正常",
    damage: item.damage || "完好",
    note: item.note ?? "",
    thumb: item.thumb ?? "",
    reel: item.reel ?? null
  }));
  merged.actualText = merged.actualText ?? "";
  return merged;
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

/* ---------------- 编号归一化 ---------------- */

function normalizeCode(raw) {
  // 全角转半角、大写、去空白和所有分隔符（- _ / 等）。
  // 不做数字转换：编号里的前导零（A-001 与 A001）必须保留。
  return String(raw ?? "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

function isSpliceDamage(damage) {
  // 接片松动、接片破损等一律不得排在盘尾
  return String(damage || "").includes("接片");
}

/* ---------------- 实际记录解析与对账 ---------------- */

function parseActualLines(text) {
  return text
    .split(/\r?\n/)
    .map((raw) => {
      const line = raw.trim();
      if (!line) return null;
      const wide = line
        .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
        .toUpperCase();
      const match = wide.match(/[A-Z0-9]*[A-Z](?:[\s\-_/／]*\d+)+?/);
      if (!match) return { raw: line, code: "", norm: "", duration: null };
      const code = match[0].replace(/[\s\-_/／]+/g, "-");
      const rest = wide.slice(match.index + match[0].length);
      const durationMatch = rest.match(/\d+(?:\.\d+)?/);
      return {
        raw: line,
        code,
        norm: normalizeCode(code),
        duration: durationMatch ? Number(durationMatch[0]) : null
      };
    })
    .filter(Boolean);
}

function reconcile() {
  const records = parseActualLines(state.actualText);
  if (!state.actualText.trim()) return null;

  const planByNorm = new Map();
  state.segments.forEach((item) => {
    const norm = normalizeCode(item.code);
    if (!planByNorm.has(norm)) planByNorm.set(norm, []);
    planByNorm.get(norm).push(item);
  });

  const usedPlanIds = new Set();
  const matched = [];
  const extras = [];

  records.forEach((rec, order) => {
    if (!rec.norm) {
      extras.push({ ...rec, order, unparsed: true });
      return;
    }
    const candidates = planByNorm.get(rec.norm) || [];
    const plan = candidates.find((item) => !usedPlanIds.has(item.id)) || null;
    if (plan) {
      usedPlanIds.add(plan.id);
      matched.push({
        ...rec,
        order,
        plan,
        durationDiff: rec.duration != null && Number(rec.duration) !== Number(plan.duration)
      });
    } else {
      extras.push({ ...rec, order, unparsed: false });
    }
  });

  // 计划有、实际没放：保持计划顺序
  const missing = state.segments.filter((item) => !usedPlanIds.has(item.id));

  return { records, matched, extras, missing };
}

/* ---------------- 装盘 ---------------- */

function buildReels() {
  // 约束：① 保持放映顺序；② 每本 ≤ REEL_CAPACITY（装不下往后顺延）；
  // ③ 接片破损片段不得落在盘尾。
  //
  // 单次顺序贪心：逐片段装入"当前本"。某片段 X 装不进当前本时——
  //   - 当前本末尾没有接片段：直接换本；
  //   - 末尾是连续接片段 R：先尝试把 R 整体顺延到新本开头，再装 X。
  //     dur(R)+dur(X) ≤ C 时可行；否则在顺序不可变的前提下无解
  //     （R 留旧本仍压盘尾、放新本又超容），记为不可避免并交试映提醒。
  // 最后一本末尾若为接片段，后面无片段可补位，同样不可避免。
  const unavoidable = new Set();
  const reels = [];
  let cur = [];
  let curSum = 0;

  const dur = (item) => Number(item.duration);
  const closeReel = () => {
    if (cur.length) reels.push(cur);
    cur = [];
    curSum = 0;
  };

  state.segments.forEach((item) => {
    if (curSum + dur(item) <= REEL_CAPACITY) {
      cur.push(item);
      curSum += dur(item);
      return;
    }

    // 装不下：找出当前本末尾的连续接片段
    let runStart = cur.length;
    while (runStart > 0 && isSpliceDamage(cur[runStart - 1].damage)) runStart--;
    const run = cur.slice(runStart);
    const runDur = run.reduce((sum, seg) => sum + dur(seg), 0);

    if (run.length) {
      if (runDur + dur(item) <= REEL_CAPACITY) {
        // 接片段顺延到新本开头，X 跟在后面补位
        cur = cur.slice(0, runStart);
        curSum -= runDur;
        closeReel();
        cur = [...run, item];
        curSum = runDur + dur(item);
        return;
      }
      // 无解：接片段只能留在旧本盘尾；X 正常换本
      run.forEach((seg) => unavoidable.add(seg.id));
    }

    closeReel();
    cur = [item];
    curSum = dur(item);
  });

  // 最后一本末尾的连续接片段没有后续片段可补位
  let tailStart = cur.length;
  while (tailStart > 0 && isSpliceDamage(cur[tailStart - 1].damage)) tailStart--;
  cur.slice(tailStart).forEach((seg) => unavoidable.add(seg.id));
  closeReel();

  const overflow = new Set();
  state.segments.forEach((item) => {
    if (dur(item) > REEL_CAPACITY) overflow.add(item.id);
  });
  if (!reels.length) reels.push([]);
  return { reels, overflow, unavoidable };
}

function recomputePack() {
  pack = buildReels();
  pack.reels.forEach((reel, reelIndex) => {
    reel.forEach((item) => {
      // 盘号写回数据，旧数据升级时由此补默认盘号
      item.reel = reelIndex + 1;
    });
  });
}

/* ---------------- 渲染 ---------------- */

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

function renderList() {
  const segments = getFilteredSegments();
  els.segmentList.innerHTML =
    segments
      .map((item) => {
        const realIndex = state.segments.findIndex((segment) => segment.id === item.id);
        const hasDamage = item.damage !== "完好";
        const splice = isSpliceDamage(item.damage);
        const overflow = pack.overflow.has(item.id);
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
                <span class="reel-badge" title="所在盘号">第 ${item.reel ?? "?"} 本</span>
                <label class="inline-duration">
                  时长(秒)
                  <input type="number" min="1" value="${Number(item.duration)}" data-duration="${item.id}" />
                </label>
                ${overflow ? `<span class="tag damage" title="单片时长超过每本容量">超装</span>` : ""}
              </div>
              <div class="tag-row">
                <span class="tag">${escapeHtml(item.shift)}</span>
                <span class="tag ${hasDamage ? "damage" : "ok"}">${escapeHtml(item.damage)}${splice ? "·禁排盘尾" : ""}</span>
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
      .join("") || `<p class="empty">没有符合筛选的片段。</p>`;
}

function renderReels() {
  els.reelCapacityLabel.textContent = `${REEL_CAPACITY} 秒`;
  if (!pack.reels.length || !state.segments.length) {
    els.reelList.innerHTML = `<p class="empty">还没有片段，暂无装盘方案。</p>`;
    return;
  }
  els.reelList.innerHTML = pack.reels
    .map((reel, index) => {
      const used = reel.reduce((sum, item) => sum + Number(item.duration), 0);
      const pct = Math.min(100, Math.round((used / REEL_CAPACITY) * 100));
      const over = used > REEL_CAPACITY;
      const lastItem = reel[reel.length - 1];
      const tailRisk = lastItem && (isSpliceDamage(lastItem.damage) || pack.unavoidable.has(lastItem.id));
      return `
        <div class="reel-card ${over ? "over" : ""}">
          <div class="reel-head">
            <strong>第 ${index + 1} 本</strong>
            <span>${reel.length} 段 · ${formatDuration(used)} / ${formatDuration(REEL_CAPACITY)}</span>
          </div>
          <div class="reel-bar"><i style="width:${pct}%"></i></div>
          <ol class="reel-items">
            ${reel
              .map((item) => {
                const risk =
                  isSpliceDamage(item.damage) && pack.unavoidable.has(item.id)
                    ? `<em class="risk">接片段落在盘尾，试映前重点检查</em>`
                    : "";
                return `<li>${escapeHtml(item.code)}<span>${formatDuration(item.duration)}</span>${risk}</li>`;
              })
              .join("")}
          </ol>
          ${tailRisk ? `<p class="reel-note risk">本盘末尾是接片破损段，无法顺延，请试映前人工确认。</p>` : ""}
        </div>
      `;
    })
    .join("");
}

function renderReconcile() {
  const result = reconcile();
  if (!result) {
    els.reconcileResult.innerHTML = `<p class="empty">还没有粘贴实际记录。粘贴后会自动逐条对账。</p>`;
    return;
  }
  const { matched, extras, missing } = result;
  const diffCount = matched.filter((item) => item.durationDiff).length;
  const parts = [];

  parts.push(`
    <div class="reconcile-summary">
      <span class="chip ok">对上 ${matched.length}</span>
      <span class="chip ${diffCount ? "warn" : "ok"}">时长不一致 ${diffCount}</span>
      <span class="chip danger">计划有 / 实际没放 ${missing.length}</span>
      <span class="chip warn">实际有 / 待确认 ${extras.length}</span>
    </div>
  `);

  if (missing.length) {
    parts.push(`
      <div class="reconcile-group">
        <h3>计划有、实际没放</h3>
        ${missing
          .map(
            (item) => `
              <div class="reconcile-row missing">
                <strong>${escapeHtml(item.code)}</strong>
                <span>${formatDuration(item.duration)} · ${escapeHtml(item.damage)}</span>
                <button type="button" data-mark-unshown="${item.id}">标记为未放</button>
              </div>`
          )
          .join("")}
      </div>
    `);
  }

  if (extras.length) {
    parts.push(`
      <div class="reconcile-group">
        <h3>实际有、计划没有（待确认）</h3>
        ${extras
          .map((extra) =>
            extra.unparsed
              ? `
                <div class="reconcile-row extra">
                  <strong>无法识别</strong>
                  <span>${escapeHtml(extra.raw)}</span>
                </div>`
              : `
                <div class="reconcile-row extra">
                  <strong>${escapeHtml(extra.code)}</strong>
                  <span>${extra.duration != null ? formatDuration(extra.duration) : "无时长"}</span>
                  <button type="button" data-adopt-code="${escapeHtml(extra.code)}" data-adopt-duration="${extra.duration ?? ""}">补入计划</button>
                </div>`
          )
          .join("")}
      </div>
    `);
  }

  if (matched.length) {
    parts.push(`
      <details class="reconcile-group" ${diffCount ? "open" : ""}>
        <summary>已对上（${matched.length} 条${diffCount ? `，${diffCount} 条时长不一致` : ""}）</summary>
        ${matched
          .map(
            (m) => `
              <div class="reconcile-row ${m.durationDiff ? "diff" : "hit"}">
                <strong>${escapeHtml(m.plan.code)}</strong>
                <span>实际 ${escapeHtml(m.code)} · 计划 ${formatDuration(m.plan.duration)}${
                  m.duration != null ? ` / 实际 ${formatDuration(m.duration)}` : ""
                }</span>
                ${
                  m.durationDiff
                    ? `<button type="button" data-apply-duration="${m.plan.id}" data-new-duration="${m.duration}">用实际时长 ${m.duration} 秒</button>`
                    : ""
                }
              </div>`
          )
          .join("")}
      </details>
    `);
  }

  els.reconcileResult.innerHTML = parts.join("");
}

function renderWarnings() {
  const warnings = [];

  state.segments.forEach((item, index) => {
    const reasons = [item.shift !== "正常" ? item.shift : "", item.damage !== "完好" ? item.damage : ""].filter(Boolean);
    if (reasons.length) {
      warnings.push({
        tone: "damage",
        title: `${index + 1}. ${item.code}（第 ${item.reel ?? "?"} 本）`,
        text: `${reasons.join(" · ")}${item.note ? `：${item.note}` : ""}`
      });
    }
  });

  pack.unavoidable.forEach((id) => {
    const item = state.segments.find((segment) => segment.id === id);
    if (!item) return;
    warnings.push({
      tone: "damage",
      title: `${item.code} 接片破损段无法避开盘尾`,
      text: "顺延和补位都排不下，放映前必须人工检查接片位置。"
    });
  });

  pack.overflow.forEach((id) => {
    const item = state.segments.find((segment) => segment.id === id);
    if (!item) return;
    warnings.push({
      tone: "damage",
      title: `${item.code} 单片超装`,
      text: `时长 ${formatDuration(item.duration)} 超过每本 ${formatDuration(REEL_CAPACITY)}，一本盘装不下，需拆段或换大盘。`
    });
  });

  const result = reconcile();
  if (result) {
    result.missing.forEach((item) => {
      warnings.push({
        tone: "missing",
        title: `${item.code} 实际未放映`,
        text: `计划 ${formatDuration(item.duration)}，实际记录里没找到（编号已按归一化匹配）。`
      });
    });
    result.extras.forEach((extra) => {
      if (extra.unparsed) return;
      warnings.push({
        tone: "pending",
        title: `${extra.code} 待确认`,
        text: `实际放了但计划清单没有${extra.duration != null ? `，时长 ${formatDuration(extra.duration)}` : ""}，确认后再补入计划。`
      });
    });
    result.matched
      .filter((m) => m.durationDiff)
      .forEach((m) => {
        warnings.push({
          tone: "pending",
          title: `${m.plan.code} 实际时长对不上`,
          text: `计划 ${formatDuration(m.plan.duration)}，实际 ${formatDuration(m.duration)}；采用实际值后装盘会重算。`
        });
      });
  }

  els.warningList.innerHTML = warnings.length
    ? warnings
        .map(
          (w) => `
          <div class="warning-item ${w.tone}">
            <strong>${escapeHtml(w.title)}</strong>
            <span>${escapeHtml(w.text)}</span>
          </div>`
        )
        .join("")
    : `<p class="empty">当前清单没有颜色偏移、破损或对账提醒。</p>`;
}

function renderAll() {
  recomputePack();
  saveState();
  els.reelTitle.value = state.reelTitle;
  if (document.activeElement !== els.actualInput) {
    els.actualInput.value = state.actualText;
  }
  renderStats();
  renderList();
  renderReels();
  renderReconcile();
  renderWarnings();
}

/* ---------------- 工具 ---------------- */

function formatDuration(seconds) {
  const value = Number(seconds) || 0;
  const minutes = Math.floor(value / 60);
  const rest = String(Math.round((value - minutes * 60) * 100) / 100);
  const [whole, decimal] = rest.split(".");
  const sec = whole.padStart(2, "0");
  return decimal ? `${minutes}:${sec}.${decimal}` : `${minutes}:${sec}`;
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
    reel: null
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

function exportList() {
  const result = reconcile();
  const lines = [
    `胶片卷：${state.reelTitle || "未命名胶片卷"}`,
    `总时长：${formatDuration(state.segments.reduce((sum, item) => sum + Number(item.duration), 0))}`,
    `每本容量：${formatDuration(REEL_CAPACITY)}｜共 ${pack.reels.length} 本`,
    "",
    ...state.segments.map((item, index) => {
      const splice = isSpliceDamage(item.damage) ? "｜接片段禁排盘尾" : "";
      return `${index + 1}. 第${item.reel ?? "?"}本｜${item.code}｜${formatDuration(item.duration)}｜${item.shift}｜${item.damage}${splice}｜${item.note || "无备注"}`;
    })
  ];
  if (result) {
    lines.push(
      "",
      "—— 对账结果 ——",
      ...result.missing.map((item) => `未放：${item.code}｜${formatDuration(item.duration)}`),
      ...result.extras.filter((e) => !e.unparsed).map((e) => `待确认：${e.code}｜${e.duration != null ? formatDuration(e.duration) : "无时长"}`),
      ...result.matched.filter((m) => m.durationDiff).map((m) => `时长不一致：${m.plan.code}｜计划 ${formatDuration(m.plan.duration)} / 实际 ${formatDuration(m.duration)}`)
    );
  }
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

/* ---------------- 事件 ---------------- */

els.reelTitle.addEventListener("input", () => {
  state.reelTitle = els.reelTitle.value;
  saveState();
});
els.colorFilter.addEventListener("change", renderList);
els.searchInput.addEventListener("input", renderList);
els.segmentForm.addEventListener("submit", addSegment);
els.exportBtn.addEventListener("click", exportList);

els.actualInput.addEventListener("input", () => {
  state.actualText = els.actualInput.value;
  saveState();
  renderReconcile();
  renderWarnings();
});

els.segmentList.addEventListener("input", (event) => {
  const input = event.target.closest("[data-duration]");
  if (!input) return;
  const item = state.segments.find((segment) => segment.id === input.dataset.duration);
  if (!item) return;
  const value = Number(input.value);
  if (!(value > 0)) return;
  if (value === Number(item.duration)) return;
  // 时长一变：装盘方案和试映提醒作废重算
  item.duration = value;
  saveState();
  recomputePack();
  renderStats();
  renderReels();
  renderWarnings();
  renderReconcile();
});

els.reconcileResult.addEventListener("click", (event) => {
  const adopt = event.target.closest("[data-adopt-code]");
  const apply = event.target.closest("[data-apply-duration]");
  if (adopt) {
    // 实际有、计划没有：确认后补入计划（默认完好/正常，可再编辑）
    state.segments.push({
      id: crypto.randomUUID(),
      code: adopt.dataset.adoptCode,
      duration: Number(adopt.dataset.adoptDuration) || 1,
      shift: "正常",
      damage: "完好",
      note: "由实际放映记录补入，待确认画面情况。",
      thumb: "",
      reel: null
    });
    renderAll();
  }
  if (apply) {
    const item = state.segments.find((segment) => segment.id === apply.dataset.applyDuration);
    if (item) {
      item.duration = Number(apply.dataset.newDuration) || item.duration;
      renderAll();
    }
  }
});

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

els.segmentList.addEventListener("dragstart", (event) => {
  const card = event.target.closest("[data-id]");
  if (!card) return;
  // 输入框上不启动拖拽，保证时长可以正常点击修改
  if (event.target.closest("input, button, select, textarea")) {
    event.preventDefault();
    return;
  }
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
  // 顺序一变，装盘同样作废重算
  renderAll();
});

renderAll();
