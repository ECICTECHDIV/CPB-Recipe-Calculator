/* ============================================================
 * app.js — 浸染試染工具：邏輯（計算 / 畫面互動 / 存讀檔 / PWA 註冊）
 * 這個檔案依賴 data.js 先載入（用到 SG_TABLE、EVERZOL_TABLE、
 * MACHINE_TABLE、TRANSLATIONS、BUILTIN_TEMPLATES 等常數）。
 * ============================================================ */

/* ============ 工具函式 ============ */
function lookupEverzol(owf){
  for(const row of EVERZOL_TABLE){
    if(owf <= row.max) return row;
  }
  return EVERZOL_TABLE[EVERZOL_TABLE.length-1];
}

// 線性內插查表：由比重回推濃度 (g/L)
function interpConcentration(temp, sg){
  const table = SG_TABLE[temp];
  if(!table || sg === null || isNaN(sg)) return null;
  if(sg <= table[0][0]) return table[0][1];
  if(sg >= table[table.length-1][0]) return table[table.length-1][1];
  for(let i=0;i<table.length-1;i++){
    const [sg1,c1] = table[i];
    const [sg2,c2] = table[i+1];
    if(sg >= sg1 && sg <= sg2){
      const t = (sg - sg1) / (sg2 - sg1);
      return c1 + t*(c2-c1);
    }
  }
  return null;
}

// 反查：由濃度 (g/L) 回推比重（interpConcentration 的反函數）
function inverseSGFromConcentration(temp, targetConc){
  const table = SG_TABLE[temp];
  if(!table || targetConc === null || isNaN(targetConc)) return null;
  if(targetConc <= table[0][1]) return table[0][0];
  if(targetConc >= table[table.length-1][1]) return table[table.length-1][0];
  for(let i=0;i<table.length-1;i++){
    const [sg1,c1] = table[i];
    const [sg2,c2] = table[i+1];
    if(targetConc >= c1 && targetConc <= c2){
      const t = (targetConc - c1) / (c2 - c1);
      return sg1 + t*(sg2-sg1);
    }
  }
  return null;
}

function fmt(n, digits){
  if(n === null || n === undefined || isNaN(n)) return "–";
  return Number(n).toLocaleString("zh-Hant", {minimumFractionDigits:digits, maximumFractionDigits:digits});
}
function padUnitSpace(text){
  return text.replace(/(\d)([a-zA-Z%])/, "$1 $2");
}

// 所有數字輸入框：禁止負數。min 屬性只影響上下箭頭與外觀驗證，不會擋住手動輸入的負號，
// 所以用 capture 階段的 input 監聽，在其他計算邏輯讀值之前先把負數夾回該欄位的 min（預設 0）。
document.addEventListener("input", function(e){
  if(e.target && e.target.tagName === "INPUT" && e.target.type === "number"){
    const min = e.target.hasAttribute("min") ? parseFloat(e.target.min) : 0;
    if(e.target.value !== "" && Number(e.target.value) < min){
      e.target.value = min;
    }
  }
}, true);

/* ============ 狀態 ============ */
const state = {
  lang: "zh",
  fabricType: "unmerc",
  alkaliMode: "alone",
  temp: 40,
  sgManual: false,
  machineType: "jet",
  weightGrade: "light",
  ratioGrade: "mid",
  measureMode: "direct"
};


function T(key){ return (TRANSLATIONS[state.lang] && TRANSLATIONS[state.lang][key]) || TRANSLATIONS.zh[key] || key; }
function LL(obj){ return obj ? (obj[state.lang] || obj.zh) : ""; }

function applyLanguage(){
  document.documentElement.lang = state.lang === "en" ? "en" : "zh-Hant";
  document.querySelectorAll("[data-i18n]").forEach(el=>{
    el.textContent = T(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el=>{
    el.placeholder = T(el.getAttribute("data-i18n-placeholder"));
  });
  document.querySelectorAll("[data-i18n-title]").forEach(el=>{
    el.title = T(el.getAttribute("data-i18n-title"));
  });
  document.getElementById("langBtnZh").classList.toggle("active", state.lang === "zh");
  document.getElementById("langBtnEn").classList.toggle("active", state.lang === "en");
  ["pretreat","dye","wash"].forEach(populateTemplateSelect);
  // 重新跑一次計算，讓所有動態產生的文字（提示訊息、機型說明、工卡預覽等）也更新語言
  recalcAll();
  recomputeSpeed();
  if(document.getElementById("panel-print").classList.contains("active")) renderPrintCard();
  if(document.getElementById("panel-process").classList.contains("active")) renderProcessCurve();
  updateJumpNavOffset();
}
function setLanguage(lang){
  state.lang = lang;
  applyLanguage();
}

function jumpToSection(anchorId){
  const el = document.getElementById(anchorId);
  if(!el) return;
  const nav = document.querySelector("nav.tabs");
  const jumpNav = document.getElementById("jumpNav");
  const offset = (nav ? nav.offsetHeight : 0) + (jumpNav ? jumpNav.offsetHeight : 0) + 10;
  const top = el.getBoundingClientRect().top + window.pageYOffset - offset;
  window.scrollTo({ top, behavior:"smooth" });
}

// 置頂跳轉列的黏著位置用實際量出來的分頁籤高度設定，不用猜固定數字——
// 不同螢幕寬度、中英文文字長度都可能讓分頁籤實際高度略有差異，寫死的數字容易跟導覽列重疊
function updateJumpNavOffset(){
  const nav = document.querySelector("nav.tabs");
  const jumpNav = document.getElementById("jumpNav");
  if(!nav || !jumpNav) return;
  jumpNav.style.top = nav.getBoundingClientRect().height + "px";
}
window.addEventListener("resize", updateJumpNavOffset);
window.addEventListener("load", updateJumpNavOffset);
updateJumpNavOffset();

// 捲動時自動反白目前所在區塊對應的按鈕，讓使用者隨時知道自己捲到配方卡的哪一段
function initJumpNavScrollSpy(){
  const targets = ["jumpSection-order","jumpSection-dye","jumpSection-salt"];
  const buttons = {};
  targets.forEach(id=>{
    const btn = document.querySelector(`.jump-nav-inner button[onclick*="${id}"]`);
    if(btn) buttons[id] = btn;
  });
  if(!("IntersectionObserver" in window)) return;
  const observer = new IntersectionObserver((entries)=>{
    entries.forEach(entry=>{
      if(!entry.isIntersecting) return;
      const btn = buttons[entry.target.id];
      if(!btn) return;
      Object.values(buttons).forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
    });
  }, { rootMargin:"-15% 0px -70% 0px", threshold:0 });
  targets.forEach(id=>{
    const el = document.getElementById(id);
    if(el) observer.observe(el);
  });
}
initJumpNavScrollSpy();

async function shareToolUrl(){
  const url = window.location.href;
  const btn = document.getElementById("shareBtn");
  const original = btn.innerHTML;
  try{
    if(navigator.clipboard && navigator.clipboard.writeText){
      await navigator.clipboard.writeText(url);
    } else {
      const ta = document.createElement("textarea");
      ta.value = url; ta.style.position="fixed"; ta.style.opacity="0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    btn.textContent = state.lang === "en" ? "Copied!" : "已複製！";
    setTimeout(()=>{ btn.innerHTML = original; }, 2000);
  } catch(err){
    console.error("Copy failed:", err);
    alert(state.lang === "en" ? "Copy failed — please copy the URL from the address bar manually." : "複製失敗，請手動複製網址列的網址。");
  }
}

/* ============ Tab 切換 ============ */
document.querySelectorAll(".tab-btn").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p=>p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("panel-"+btn.dataset.tab).classList.add("active");
    // 置頂跳轉列只在配方分頁使用，切到其他分頁就隱藏，不佔用版面
    document.getElementById("jumpNav").classList.toggle("hidden-el", btn.dataset.tab !== "recipe");
    if(btn.dataset.tab === "print") renderPrintCard();
    if(btn.dataset.tab === "process") renderProcessCurve();
  });
});

/* ============ Segmented control 共用邏輯 ============ */
function bindSeg(id, onChange){
  const seg = document.getElementById(id);
  seg.querySelectorAll("button").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      seg.querySelectorAll("button").forEach(b=>b.classList.remove("on"));
      btn.classList.add("on");
      onChange(btn.dataset.val);
    });
  });
}

bindSeg("fabricTypeSeg", val=>{ state.fabricType = val; recalcAll(); });
bindSeg("alkaliModeSeg", val=>{
  state.alkaliMode = val;
  document.getElementById("alkaliAloneGroup").style.display = val==="alone" ? "block":"none";
  document.getElementById("alkaliCombinedGroup").style.display = val==="combined" ? "grid":"none";
  document.getElementById("alkaliTspGroup").style.display = val==="tsp" ? "block":"none";
  recalcAll();
});
bindSeg("tempSeg", val=>{ state.temp = Number(val); updateDefaultSG(); });
bindSeg("weightGradeSeg", val=>{ state.weightGrade = val; recomputeSpeed(); });
document.getElementById("machineTypeSel").addEventListener("change", (e)=>{
  state.machineType = e.target.value;
  recomputeSpeed();
});
bindSeg("ratioGradeSeg", val=>{ state.ratioGrade = val; state.ratioGradeManual = true; recomputeSpeed(); });
bindSeg("measureModeSeg", val=>{
  state.measureMode = val;
  document.getElementById("directSpeedField").style.display = val==="direct" ? "block":"none";
  document.getElementById("calcSpeedFields").style.display = val==="calc" ? "block":"none";
  recomputeSpeed();
});

/* ============ 參考表 render ============ */
function renderRefTable(owf){
  const tbody = document.getElementById("refTableBody");
  tbody.innerHTML = "";
  const hitRow = lookupEverzol(owf);
  EVERZOL_TABLE.forEach(row=>{
    const tr = document.createElement("tr");
    if(row === hitRow) tr.classList.add("hit");
    tr.innerHTML = `<td>${state.lang === "en" ? row.labelEn : row.label}</td><td>${row.unmerc}</td><td>${row.merc}</td><td>${row.sodaAlone}</td><td>${row.combinedSoda} + ${row.combinedLiquid}</td><td>${row.tsp}</td><td>${row.fixTime}</td>`;
    tbody.appendChild(tr);
  });
}
document.getElementById("toggleRefTable").addEventListener("click", (e)=>{
  const t = document.getElementById("refTable");
  const show = t.style.display === "none";
  t.style.display = show ? "table" : "none";
  e.target.setAttribute("data-i18n", show ? "hideRefTable" : "showRefTable");
  e.target.textContent = show ? T("hideRefTable") : T("showRefTable");
});

/* ============ 比重對照表（浴量校正參考） ============ */
let sgTableRendered = false;
function renderSgTable(){
  if(sgTableRendered) return;
  const tbody = document.getElementById("sgTableBody");
  const rows40 = SG_TABLE[40], rows60 = SG_TABLE[60], rows80 = SG_TABLE[80];
  const n = Math.max(rows40.length, rows60.length, rows80.length);
  let html = "";
  for(let i=0;i<n;i++){
    const a = rows40[i], b = rows60[i], c = rows80[i];
    html += `<tr><td>${a?a[0]:""}</td><td>${a?a[1]:""}</td><td>${b?b[0]:""}</td><td>${b?b[1]:""}</td><td>${c?c[0]:""}</td><td>${c?c[1]:""}</td></tr>`;
  }
  tbody.innerHTML = html;
  sgTableRendered = true;
}
document.getElementById("toggleSgTable").addEventListener("click", (e)=>{
  const wrap = document.getElementById("sgTableWrap");
  const show = wrap.style.display === "none";
  if(show) renderSgTable();
  wrap.style.display = show ? "block" : "none";
  e.target.setAttribute("data-i18n", show ? "hideSgTable" : "showSgTable");
  e.target.textContent = show ? T("hideSgTable") : T("showSgTable");
});

/* ============ Tab1: 配方卡 + 秤量 ============ */
let weighRowSeq = 0;

function fmtWeight(g){
  if(g === null || isNaN(g)) return "– g";
  if(Math.abs(g) >= 1000) return fmt(g/1000,2) + " kg";
  return fmt(g,1) + " g";
}
function fmtVolume(ml){
  if(ml === null || isNaN(ml)) return "– ml";
  if(Math.abs(ml) >= 1000) return fmt(ml/1000,2) + " L";
  return fmt(ml,1) + " ml";
}
function weightHtml(g){
  if(g === null || isNaN(g)) return `–<small>g</small>`;
  if(Math.abs(g) >= 1000) return `${fmt(g/1000,2)}<small>kg</small>`;
  return `${fmt(g,1)}<small>g</small>`;
}

function createWeighRow(container, presetName, presetMode, presetValue, isDye){
  const id = "wrow-" + (++weighRowSeq);
  const row = document.createElement("div");
  row.className = isDye ? "weigh-row" : "weigh-row has-mode";
  row.dataset.id = id;
  if(isDye){
    row.innerHTML = `
      <input type="text" class="w-name" data-i18n-placeholder="itemNamePh" placeholder="品名" value="${presetName || ''}">
      <input type="number" class="w-value" placeholder="%OWF" min="0" step="0.01" value="${presetValue != null ? presetValue : ''}">
      <div class="w-result">–</div>
      <button type="button" class="w-del" data-i18n-title="deleteTitle" title="刪除">×</button>
    `;
  } else {
    row.innerHTML = `
      <input type="text" class="w-name" data-i18n-placeholder="itemNamePh" placeholder="品名" value="${presetName || ''}">
      <select class="w-mode">
        <option value="owf">%OWF</option>
        <option value="gL">g/L</option>
        <option value="mlL">ml/L</option>
      </select>
      <input type="number" class="w-value" data-i18n-placeholder="doseCol" placeholder="用量" min="0" step="0.01" value="${presetValue != null ? presetValue : ''}">
      <div class="w-result">–</div>
      <button type="button" class="w-del" data-i18n-title="deleteTitle" title="刪除">×</button>
    `;
    row.querySelector(".w-mode").value = presetMode || "gL";
  }
  container.appendChild(row);

  // 染料列會改變染色濃度合計，需要重新查表；助劑列只影響秤重，不觸發重新查表（避免覆蓋手動調整的鹽鹼值）
  row.querySelector(".w-del").addEventListener("click", ()=>{
    row.remove();
    recalcAll(!isDye);
  });
  row.querySelectorAll(".w-name, .w-mode, .w-value").forEach(el=>{
    if(!el) return;
    el.addEventListener("input", ()=>recalcAll(!isDye));
    el.addEventListener("change", ()=>recalcAll(!isDye));
  });
  return row;
}

document.getElementById("addDyeRow").addEventListener("click", ()=>{
  createWeighRow(document.getElementById("dyeRows"), "", "owf", "", true);
  recalcAll();
});
document.getElementById("addAuxRow").addEventListener("click", ()=>{
  createWeighRow(document.getElementById("auxRows"), "", "gL", "", false);
  recalcAll(true);
});

// 助劑列用：單純依所選單位換算重量／液量
function computeRowResult(row, fabricWeightKg, totalLiquorL){
  const mode = row.querySelector(".w-mode").value;
  const value = Number(row.querySelector(".w-value").value);
  const resultEl = row.querySelector(".w-result");
  if(!value || isNaN(value)){
    resultEl.textContent = "–";
    return {grams:0, ml:0};
  }
  if(mode === "owf"){
    const grams = value/100 * fabricWeightKg * 1000;
    resultEl.textContent = fmtWeight(grams);
    return {grams, ml:0};
  } else if(mode === "gL"){
    const grams = value * totalLiquorL;
    resultEl.textContent = fmtWeight(grams);
    return {grams, ml:0};
  } else {
    const ml = value * totalLiquorL;
    resultEl.textContent = fmtVolume(ml);
    return {grams:0, ml};
  }
}

["saltDose","sodaAloneDose","sodaCombinedDose","liquidAlkaliDose","tspDose","fixTime"].forEach(id=>{
  document.getElementById(id).addEventListener("input", ()=>{ recalcAll(true); });
});
document.getElementById("fabricWeight").addEventListener("input", ()=>{ recalcAll(); recomputeSpeedFromRatio(); });
document.getElementById("liquorRatio").addEventListener("input", ()=>{ recalcAll(); recomputeSpeedFromRatio(); });
document.getElementById("liquorRatio").addEventListener("change", (e)=>{
  const v = Math.round(Number(e.target.value) || 0);
  e.target.value = v;
  recalcAll(); recomputeSpeedFromRatio();
});

// 核心：染料明細加總OWF% → 查表鹽鹼建議 → 各項總量 → 助劑 → 帶入浴量校正
function recalcAll(skipLookup){
  const fabricWeightKg = Number(document.getElementById("fabricWeight").value) || 0;
  const ratio = Number(document.getElementById("liquorRatio").value) || 0;
  const totalLiquor = fabricWeightKg * ratio; // L

  // --- 染料明細：加總 OWF% 與總重（染料一律以 %OWF 計） ---
  let dyeGrams = 0, owfTotal = 0;
  document.querySelectorAll("#dyeRows .weigh-row").forEach(row=>{
    const value = Number(row.querySelector(".w-value").value);
    const resultEl = row.querySelector(".w-result");
    if(!value || isNaN(value)){ resultEl.textContent = "–"; return; }
    const grams = value/100 * fabricWeightKg * 1000;
    resultEl.textContent = fmtWeight(grams);
    dyeGrams += grams;
    owfTotal += value;
  });
  document.getElementById("owfTotalOut").innerHTML = `${fmt(owfTotal,2)}<small>% OWF</small>`;
  document.getElementById("dyeTotalOut").innerHTML = weightHtml(dyeGrams);

  // --- 鹽鹼建議查表 ---
  const hitRow = lookupEverzol(owfTotal);
  if(!skipLookup){
    document.getElementById("saltDose").value = state.fabricType === "merc" ? hitRow.merc : hitRow.unmerc;
    document.getElementById("fixTime").value = hitRow.fixTime;
    document.getElementById("sodaAloneDose").value = hitRow.sodaAlone;
    document.getElementById("sodaCombinedDose").value = hitRow.combinedSoda;
    document.getElementById("liquidAlkaliDose").value = hitRow.combinedLiquid;
    document.getElementById("tspDose").value = hitRow.tsp;
  }
  document.getElementById("owfRangeLabel").textContent = state.lang === "en"
    ? `Total dye concentration ${fmt(owfTotal,2)}% falls in the "${hitRow.labelEn}" range, from the Everzol dosing table — editable.`
    : `染色濃度合計 ${fmt(owfTotal,2)}% 落在「${hitRow.label}」區間，依 Everzol 用量表帶出，可自行覆寫`;

  const saltDose = Number(document.getElementById("saltDose").value) || 0;
  const saltTotalKg = saltDose * totalLiquor / 1000;

  document.getElementById("totalLiquorOut").innerHTML = `${fmt(totalLiquor,0)}<small>L</small>`;
  document.getElementById("saltTotalOut").innerHTML = `${fmt(saltTotalKg,1)}<small>kg</small>`;

  let alkaliTotalsHtml = "";
  let alkaliTotalKg = 0, liquidAlkaliTotalL = 0;
  if(state.alkaliMode === "alone"){
    const dose = Number(document.getElementById("sodaAloneDose").value) || 0;
    alkaliTotalKg = dose * totalLiquor / 1000;
    alkaliTotalsHtml = `<div class="result-box"><div class="k">純鹼總需求量</div><div class="v">${fmt(alkaliTotalKg,1)}<small>kg</small></div></div>`;
  } else if(state.alkaliMode === "combined"){
    const sodaDose = Number(document.getElementById("sodaCombinedDose").value) || 0;
    const liquidDose = Number(document.getElementById("liquidAlkaliDose").value) || 0;
    alkaliTotalKg = sodaDose * totalLiquor / 1000;
    liquidAlkaliTotalL = liquidDose * totalLiquor / 1000; // ml/L × L = ml → /1000 = L
    alkaliTotalsHtml = `<div class="result-box"><div class="k">純鹼總量</div><div class="v">${fmt(alkaliTotalKg,1)}<small>kg</small></div></div>
      <div class="result-box"><div class="k">液鹼總量</div><div class="v">${fmt(liquidAlkaliTotalL,1)}<small>L</small></div></div>`;
  } else {
    const dose = Number(document.getElementById("tspDose").value) || 0;
    alkaliTotalKg = dose * totalLiquor / 1000;
    alkaliTotalsHtml = `<div class="result-box"><div class="k">磷酸三鈉總需求量</div><div class="v">${fmt(alkaliTotalKg,1)}<small>kg</small></div></div>`;
  }
  document.getElementById("alkaliTotalBoxes").innerHTML = alkaliTotalsHtml;

  renderRefTable(owfTotal);

  // --- 助劑明細 ---
  let auxGrams = 0, auxMl = 0;
  document.querySelectorAll("#auxRows .weigh-row").forEach(row=>{
    const r = computeRowResult(row, fabricWeightKg, totalLiquor);
    auxGrams += r.grams;
    auxMl += r.ml;
  });
  document.getElementById("auxTotalOut").innerHTML = state.lang === "en"
    ? `<span>Total weight: ${fmtWeight(auxGrams)}</span><span>Total liquid: ${fmtVolume(auxMl)}</span>`
    : `<span>助劑總重：${fmtWeight(auxGrams)}</span><span>助劑總液量：${fmtVolume(auxMl)}</span>`;

  // --- 帶入浴量校正頁 ---
  document.getElementById("bathTotalWater").value = totalLiquor.toFixed(0);
  document.getElementById("bathSaltTotal").value = saltTotalKg.toFixed(2);
  updateDefaultSG();
}

// 預設幾列空白範例（比照 CPB 工具的預設列數）
createWeighRow(document.getElementById("dyeRows"), "黃", "owf", "", true);
createWeighRow(document.getElementById("dyeRows"), "紅", "owf", "", true);
createWeighRow(document.getElementById("dyeRows"), "藍", "owf", "", true);
createWeighRow(document.getElementById("auxRows"), "滲透劑", "gL", "", false);
createWeighRow(document.getElementById("auxRows"), "", "gL", "", false);

/* ============ Tab2: 浴量校正 ============ */
["bathTotalWater","bathSaltTotal"].forEach(id=>{
  document.getElementById(id).addEventListener("input", recomputeBath);
});
document.getElementById("measuredSG").addEventListener("input", ()=>{
  state.sgManual = true;
  recomputeBath();
});

// 比重預設值＝假設補水完全達標時，配方電解質(芒硝/鹽)用量對應的理論比重；
// 使用者尚未手動輸入實測值前，換算溫度或配方改變都會更新這個預設值。
function updateDefaultSG(){
  const saltDose = Number(document.getElementById("saltDose").value); // g/L
  if(!state.sgManual && saltDose && !isNaN(saltDose)){
    const sg = inverseSGFromConcentration(state.temp, saltDose);
    if(sg !== null){
      document.getElementById("measuredSG").value = sg.toFixed(4);
    }
  }
  recomputeBath();
}

function recomputeBath(){
  const totalWater = Number(document.getElementById("bathTotalWater").value) || 0;
  const saltTotalKg = Number(document.getElementById("bathSaltTotal").value) || 0;
  const saltDose = Number(document.getElementById("saltDose").value) || 0; // g/L，配方卡設定的目標電解質濃度
  const sg = Number(document.getElementById("measuredSG").value);

  const conc = interpConcentration(state.temp, sg); // g/L，比重反查出來的目前實際濃度
  const saltTotalG = saltTotalKg * 1000;
  const actualWater = conc ? saltTotalG / conc : null; // L，回推缸內實際水量
  const diff = (actualWater !== null && totalWater) ? (totalWater - actualWater) : null; // >0：水太少（濃度太高）；<0：水太多（濃度太低）
  const startLevel = (actualWater !== null && totalWater) ? (actualWater/totalWater*100) : null;

  document.getElementById("sgConcOut").innerHTML = conc!==null ? `${fmt(conc,1)}<small>g/L</small>` : "–";
  document.getElementById("actualWaterOut").innerHTML = actualWater!==null ? `${fmt(actualWater,0)}<small>L</small>` : "–";
  document.getElementById("startLevelOut").innerHTML = startLevel!==null ? `${fmt(startLevel,0)}<small>%</small>` : "–";

  const labelEl = document.getElementById("makeupWaterLabelEl");
  const valueEl = document.getElementById("makeupWaterOut");
  const note = document.getElementById("bathNote");
  // 差距在目標水量 3% 以內用預設色（輕微、可自行斟酌），超過才變紅色提醒 —— 不是「3%內就不用管」，數字永遠照實際算出來顯示
  const TOLERANCE = 0.03;
  const isMinor = diff !== null && Math.abs(diff) < totalWater*TOLERANCE;

  if(diff === null){
    labelEl.textContent = T("makeupWaterLabel");
    valueEl.innerHTML = "–";
    valueEl.style.color = "";
    note.className = "note";
    note.textContent = state.lang === "en"
      ? "Please enter fabric weight and liquor ratio on the recipe tab first, then enter the measured specific gravity."
      : "請先於配方卡輸入布重、浴比，並輸入量測比重。";
  } else if(diff >= 0){
    // 芒硝濃度太高或剛好（缸內水量比目標少或持平）→ 補水稀釋
    labelEl.textContent = T("makeupWaterLabel");
    valueEl.innerHTML = `${fmt(diff,0)}<small>L</small>`;
    valueEl.style.color = isMinor ? "" : "var(--danger)";
    note.className = isMinor ? "note good" : "note danger";
    note.textContent = isMinor
      ? (state.lang === "en"
        ? `Concentration is close to target — a minor top-up of about ${fmt(diff,0)} L is enough; use your judgment.`
        : `濃度已接近目標，微調補水約 ${fmt(diff,0)} L 即可，可自行斟酌。`)
      : (state.lang === "en"
        ? `Concentration is higher than target (too little water) — add approximately ${fmt(diff,0)} L more water to dilute to the target ratio.`
        : `芒硝濃度比目標高（水量偏少），建議再補水約 ${fmt(diff,0)} L 以稀釋到目標浴比。`);
  } else {
    // 芒硝濃度太低（缸內水量比目標多，或芒硝溶解/下藥不足）→ 加芒硝補足濃度
    const extraSaltG = saltDose>0 ? (saltDose*actualWater - saltTotalG) : null;
    const extraSaltKg = extraSaltG!==null ? Math.max(0, extraSaltG/1000) : null;
    labelEl.textContent = T("addSaltLabel");
    valueEl.innerHTML = extraSaltKg!==null ? `${fmt(extraSaltKg,1)}<small>kg</small>` : "–";
    valueEl.style.color = (extraSaltKg!==null && !isMinor) ? "var(--danger)" : "";
    note.className = isMinor ? "note good" : "note danger";
    note.textContent = extraSaltKg!==null
      ? (isMinor
        ? (state.lang === "en"
          ? `Concentration is close to target — a minor addition of about ${fmt(extraSaltKg,1)} kg electrolyte is enough; use your judgment.`
          : `濃度已接近目標，微調加芒硝約 ${fmt(extraSaltKg,1)} kg 即可，可自行斟酌。`)
        : (state.lang === "en"
          ? `Concentration is lower than target (too much water, or electrolyte under-dosed) — add approximately ${fmt(extraSaltKg,1)} kg more electrolyte to reach the target concentration at the current water volume.`
          : `芒硝濃度比目標低（水量偏多，或芒硝下藥不足），建議再加芒硝約 ${fmt(extraSaltKg,1)} kg，以目前水量補到目標濃度。`))
      : (state.lang === "en"
        ? "Concentration is lower than target — please set the electrolyte dose on the recipe tab first."
        : "芒硝濃度比目標低，請先於配方卡設定電解質用量。");
  }
}

/* ============ Tab3: 布速 ============ */
function currentRatioGrade(){
  const ratio = Number(document.getElementById("liquorRatio").value) || 0;
  if(ratio < 6) return "low";
  if(ratio > 10) return "high";
  return "mid";
}
function recomputeSpeedFromRatio(){
  if(state.ratioGradeManual) return; // 使用者已手動覆寫，不再自動跟隨
  const grade = currentRatioGrade();
  state.ratioGrade = grade;
  const seg = document.getElementById("ratioGradeSeg");
  seg.querySelectorAll("button").forEach(b=>b.classList.toggle("on", b.dataset.val===grade));
  recomputeSpeed();
}

["actualSpeed","loopLength","loopSeconds","reelDiameter"].forEach(id=>{
  document.getElementById(id).addEventListener("input", recomputeSpeed);
});

function recomputeSpeed(){
  const machine = MACHINE_TABLE[state.machineType];
  document.getElementById("machineInfoNote").textContent = LL(machine.info);

  const factor = SPEED_FACTOR[state.weightGrade][state.ratioGrade];
  const [baseMin, baseMax] = machine.base;
  const rangeMin = Math.round(baseMin * factor.min);
  const rangeMax = Math.round(rangeMin + factor.max * (baseMax - baseMin));
  document.getElementById("speedRangeOut").innerHTML = `${rangeMin} - ${rangeMax}<small>m/min</small>`;

  // --- 噴嘴壓力（僅液流噴嘴機型適用）---
  const pressureBox = document.getElementById("pressureBox");
  const pressureOut = document.getElementById("pressureRangeOut");
  if(PRESSURE_MACHINE_FACTOR[state.machineType]){
    const [pMin, pMax] = PRESSURE_BY_WEIGHT[state.weightGrade];
    const mult = PRESSURE_MACHINE_FACTOR[state.machineType];
    const pLow = (pMin * mult).toFixed(2);
    const pHigh = (pMax * mult).toFixed(2);
    pressureBox.querySelector(".k").textContent = T("pressureRangeLabel");
    pressureOut.className = "v";
    pressureOut.innerHTML = `${pLow} - ${pHigh}<small>bar</small>`;
  } else {
    pressureBox.querySelector(".k").textContent = T("pressureNoValueLabel");
    pressureOut.className = "v small-text";
    pressureOut.textContent = LL(NO_NOZZLE_INFO[state.machineType]) || "–";
  }

  // --- 絞盤／滾筒轉速（選填直徑才顯示）---
  const diameterMm = Number(document.getElementById("reelDiameter").value);
  const rpmBox = document.getElementById("rpmBox");
  if(diameterMm && diameterMm > 0){
    rpmBox.style.display = "grid";
    const diameterM = diameterMm / 1000;
    const circumference = Math.PI * diameterM; // 每轉一圈的布長 (m)
    const rpmLow = rangeMin / circumference;
    const rpmHigh = rangeMax / circumference;
    document.getElementById("rpmRangeOut").innerHTML = `${fmt(rpmLow,1)} - ${fmt(rpmHigh,1)}<small>rpm</small>`;
  } else {
    rpmBox.style.display = "none";
  }

  let actual = null;
  if(state.measureMode === "direct"){
    actual = Number(document.getElementById("actualSpeed").value);
    if(isNaN(actual) || document.getElementById("actualSpeed").value==="") actual = null;
  } else {
    const len = Number(document.getElementById("loopLength").value);
    const sec = Number(document.getElementById("loopSeconds").value);
    if(len && sec){
      actual = len / sec * 60;
      document.getElementById("actualSpeed").value = actual.toFixed(1);
    } else {
      actual = null;
    }
  }

  const note = document.getElementById("speedNote");
  const ctx = `${LL(MACHINE_LABEL[state.machineType])} × ${LL(WEIGHT_GRADE_LABEL[state.weightGrade])} × ${LL(RATIO_GRADE_LABEL[state.ratioGrade])}`;
  if(actual === null){
    note.className = "note";
    note.textContent = state.lang === "en"
      ? `${ctx}: suggested speed range ${rangeMin}–${rangeMax} m/min (reference only, calibrate on-site).`
      : `${ctx}：建議布速區間 ${rangeMin}–${rangeMax} m/min（參考值，請依現場實際機台校正）。`;
  } else if(actual < rangeMin){
    note.className = "note warn";
    note.textContent = state.lang === "en"
      ? `Measured ${fmt(actual,1)} m/min — below the suggested range. Longer dwell time at high temperature raises the risk of pile-up creasing and uneven dyeing.`
      : `實測 ${fmt(actual,1)} m/min，低於建議區間下限，高溫段停留時間拉長，注意堆疊摺痕與不均染風險。`;
  } else if(actual > rangeMax){
    note.className = "note warn";
    note.textContent = state.lang === "en"
      ? `Measured ${fmt(actual,1)} m/min — above the suggested range. Rope tension increases; watch for rope marks and edge curling, and confirm nozzle pressure/flow is synced with reel speed.`
      : `實測 ${fmt(actual,1)} m/min，超過建議區間上限，繩狀張力增加，注意扭轉條紋(rope mark)、布邊捲曲，並確認噴嘴壓力／流量是否與絞盤轉速同步。`;
  } else {
    note.className = "note good";
    note.textContent = state.lang === "en"
      ? `Measured ${fmt(actual,1)} m/min — within the suggested range.`
      : `實測 ${fmt(actual,1)} m/min，落在建議區間內。`;
  }
}

/* ============ Tab5: 染程設定 ============ */
let stageRowSeq = 0;

function createStageRow(container, preset){
  preset = preset || {};
  const id = "srow-" + (++stageRowSeq);
  const row = document.createElement("div");
  row.className = "stage-row";
  row.dataset.id = id;
  row.innerHTML = `
    <div class="note-line">
      <input type="text" class="s-note" data-i18n-placeholder="stageNotePh" placeholder="備註（例如：加芒硝、加純鹼、皂洗）" value="${preset.note || ''}">
      <button type="button" class="w-del" data-i18n-title="deleteTitle" title="刪除">×</button>
    </div>
    <div class="num-line">
      <div><label data-i18n="targetTempLabel">目標溫度(°C)</label><input type="number" class="s-temp" min="0" step="1" value="${preset.targetTemp != null ? preset.targetTemp : ''}"></div>
      <div><label data-i18n="rampMinLabel">爬升(分)</label><input type="number" class="s-ramp" min="0" step="1" value="${preset.rampMin != null ? preset.rampMin : ''}"></div>
      <div><label data-i18n="holdMinLabel">保溫(分)</label><input type="number" class="s-hold" min="0" step="1" value="${preset.holdMin != null ? preset.holdMin : ''}"></div>
      <div></div>
    </div>
    <div class="drain-line">
      <label class="drain-check">
        <input type="checkbox" class="s-drain-on" ${preset.drain ? "checked" : ""}>
        <span data-i18n="drainLabel">排液</span>
        <span class="drain-hint" data-i18n="drainHint">（自動空白3分鐘）</span>
      </label>
    </div>
  `;
  container.appendChild(row);
  row.querySelector(".w-del").addEventListener("click", ()=>{
    row.remove();
    renderProcessCurve();
  });
  row.querySelectorAll(".s-note,.s-temp,.s-ramp,.s-hold").forEach(el=>{
    el.addEventListener("input", renderProcessCurve);
  });
  row.querySelector(".s-drain-on").addEventListener("change", renderProcessCurve);
  return row;
}

document.getElementById("addPretreatSeg").addEventListener("click", ()=>{
  createStageRow(document.getElementById("pretreatSegRows"));
  renderProcessCurve();
});
document.getElementById("addDyeSeg").addEventListener("click", ()=>{
  createStageRow(document.getElementById("dyeSegRows"));
  renderProcessCurve();
});
document.getElementById("addWashSeg").addEventListener("click", ()=>{
  createStageRow(document.getElementById("washSegRows"));
  renderProcessCurve();
});
["pretreatStartTemp","dyeStartTemp","washStartTemp"].forEach(id=>{
  document.getElementById(id).addEventListener("input", renderProcessCurve);
});

// 每個大階段先給一個空白起始列
createStageRow(document.getElementById("pretreatSegRows"));
createStageRow(document.getElementById("dyeSegRows"));
createStageRow(document.getElementById("washSegRows"));

// 清除單一染程階段：只清那一段自己的段落，不影響其他兩段或配方卡
function clearStage(startTempId, rowsId){
  const msg = state.lang === "en" ? "Clear this stage? This cannot be undone." : "確定要清除這個階段的內容嗎？此動作無法復原。";
  if(!confirm(msg)) return;
  document.getElementById(startTempId).value = "40";
  const container = document.getElementById(rowsId);
  container.innerHTML = "";
  createStageRow(container);
  renderProcessCurve();
}
document.getElementById("clearPretreatBtn").addEventListener("click", ()=> clearStage("pretreatStartTemp","pretreatSegRows"));
document.getElementById("clearDyeBtn").addEventListener("click", ()=> clearStage("dyeStartTemp","dyeSegRows"));
document.getElementById("clearWashBtn").addEventListener("click", ()=> clearStage("washStartTemp","washSegRows"));

// 清除整份配方：配方卡全部欄位 + 染程三段全部恢復空白，直接重新載入頁面回到最初預設狀態最單純可靠
document.getElementById("clearRecipeBtn").addEventListener("click", ()=>{
  const msg = state.lang === "en" ? "Clear everything and start a new recipe? This cannot be undone." : "確定要清空目前所有內容、重新開始嗎？此動作無法復原。";
  if(confirm(msg)){
    localStorage.removeItem("exhaust_autosave");
    location.reload();
  }
});

function collectStageSegments(containerId){
  const rows = document.querySelectorAll("#"+containerId+" .stage-row");
  const segs = [];
  rows.forEach(row=>{
    const targetTemp = row.querySelector(".s-temp").value;
    if(targetTemp === "" || isNaN(Number(targetTemp))) return; // 尚未填目標溫度，先不畫這段
    segs.push({
      note: row.querySelector(".s-note").value.trim(),
      targetTemp: Number(targetTemp),
      rampMin: Number(row.querySelector(".s-ramp").value) || 0,
      holdMin: Number(row.querySelector(".s-hold").value) || 0,
      drain: row.querySelector(".s-drain-on").checked
    });
  });
  return segs;
}

const DRAIN_GAP_MIN = 3; // 排液後固定空白時間（分鐘），不需使用者手動輸入



// 自訂範本：存在 localStorage，跟內建範本共用同一個下拉選單
const CUSTOM_TEMPLATES_KEY = "dyeProcessCustomTemplates_v1";
function loadCustomTemplates(){
  try{
    return JSON.parse(localStorage.getItem(CUSTOM_TEMPLATES_KEY)) || { pretreat:[], dye:[], wash:[] };
  }catch(e){
    return { pretreat:[], dye:[], wash:[] };
  }
}
function saveCustomTemplates(data){
  try{
    localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(data));
  }catch(e){
    alert(state.lang === "en" ? "Failed to save template (storage may be full or unavailable)." : "範本儲存失敗（可能是儲存空間已滿或無法使用）。");
  }
}

function populateTemplateSelect(stageKey){
  const sel = document.querySelector(`.template-select[data-stage="${stageKey}"]`);
  if(!sel) return;
  const custom = loadCustomTemplates()[stageKey] || [];
  const placeholder = state.lang === "en" ? "-- Select a template --" : "-- 選擇範本 --";
  const builtinLabel = state.lang === "en" ? "Built-in" : "內建範本";
  const customLabel = state.lang === "en" ? "My templates" : "我的範本";
  let html = `<option value="">${placeholder}</option>`;
  html += `<optgroup label="${builtinLabel}">`;
  BUILTIN_TEMPLATES[stageKey].forEach(t=>{
    html += `<option value="builtin:${t.id}">${escapeHtml(t.name)}</option>`;
  });
  html += `</optgroup>`;
  if(custom.length){
    html += `<optgroup label="${customLabel}">`;
    custom.forEach(t=>{
      html += `<option value="custom:${t.id}">${escapeHtml(t.name)}</option>`;
    });
    html += `</optgroup>`;
  }
  sel.innerHTML = html;
}

function applyTemplateToStage(stageKey, startTempId, rowsId, tmpl){
  document.getElementById(startTempId).value = tmpl.startTemp;
  const container = document.getElementById(rowsId);
  container.innerHTML = "";
  tmpl.segs.forEach(s=> createStageRow(container, s));
  if(!tmpl.segs.length) createStageRow(container);
  renderProcessCurve();
}

function findTemplate(stageKey, value){
  if(!value) return null;
  const [kind, id] = value.split(":");
  if(kind === "builtin"){
    return BUILTIN_TEMPLATES[stageKey].find(t=>t.id===id);
  }
  const custom = loadCustomTemplates()[stageKey] || [];
  return custom.find(t=>t.id===id);
}

function saveCurrentAsTemplate(stageKey, startTempId, rowsId){
  const name = prompt(state.lang === "en" ? "Name this template:" : "請輸入範本名稱：");
  if(!name) return;
  const segs = collectStageSegments(rowsId).map(s=>({
    targetTemp:s.targetTemp, rampMin:s.rampMin, holdMin:s.holdMin, note:s.note, drain:s.drain
  }));
  if(!segs.length){
    alert(state.lang === "en" ? "Fill in at least one stage before saving." : "至少要填一段才能存成範本。");
    return;
  }
  const startTemp = Number(document.getElementById(startTempId).value) || 40;
  const all = loadCustomTemplates();
  const id = "c" + Date.now();
  all[stageKey] = all[stageKey] || [];
  all[stageKey].push({ id, name, startTemp, segs });
  saveCustomTemplates(all);
  populateTemplateSelect(stageKey);
  document.querySelector(`.template-select[data-stage="${stageKey}"]`).value = "custom:"+id;
}

// 範本選單：初始化 + 選擇套用 + 另存新範本
const STAGE_CONFIG = {
  pretreat: { startTempId:"pretreatStartTemp", rowsId:"pretreatSegRows", saveBtnId:"savePretreatTemplate" },
  dye:      { startTempId:"dyeStartTemp",      rowsId:"dyeSegRows",      saveBtnId:"saveDyeTemplate" },
  wash:     { startTempId:"washStartTemp",     rowsId:"washSegRows",     saveBtnId:"saveWashTemplate" }
};
Object.keys(STAGE_CONFIG).forEach(stageKey=>{
  populateTemplateSelect(stageKey);
  const cfg = STAGE_CONFIG[stageKey];
  document.querySelector(`.template-select[data-stage="${stageKey}"]`).addEventListener("change", function(){
    if(!this.value) return;
    const tmpl = findTemplate(stageKey, this.value);
    if(tmpl) applyTemplateToStage(stageKey, cfg.startTempId, cfg.rowsId, tmpl);
  });
  document.getElementById(cfg.saveBtnId).addEventListener("click", ()=>{
    saveCurrentAsTemplate(stageKey, cfg.startTempId, cfg.rowsId);
  });
});

// 前處理／染色／水洗三個階段預設收合，點標題展開/收起，各自獨立、可以同時展開不只一個
document.querySelectorAll(".stage-toggle").forEach(toggleBtn=>{
  const stageKey = toggleBtn.dataset.stageToggle;
  const body = document.querySelector(`.stage-body[data-stage-body="${stageKey}"]`);
  toggleBtn.addEventListener("click", ()=>{
    const willOpen = body.style.display === "none";
    body.style.display = willOpen ? "block" : "none";
    toggleBtn.classList.toggle("open", willOpen);
    // 展開時該階段圖表可能是在容器寬度為0時畫的（收合期間），重新畫一次確保寬度正確
    if(willOpen) renderProcessCurve();
  });
});

// 更新染色段落上方的「目前配方參考」提示框
function updateDyeRecipeRefBox(){
  const box = document.getElementById("dyeRecipeRefBox");
  const saltDose = document.getElementById("saltDose").value || "–";
  const fixTime = document.getElementById("fixTime").value || "–";
  let alkaliText = "";
  if(state.alkaliMode === "alone"){
    alkaliText = `${T("alkaliAloneBtn")} ${document.getElementById("sodaAloneDose").value || "–"} g/L`;
  } else if(state.alkaliMode === "combined"){
    alkaliText = `${T("alkaliCombinedBtn")} ${document.getElementById("sodaCombinedDose").value || "–"} g/L + ${document.getElementById("liquidAlkaliDose").value || "–"} ml/L`;
  } else {
    alkaliText = `${T("alkaliTspBtn")} ${document.getElementById("tspDose").value || "–"} g/L`;
  }
  box.textContent = state.lang === "en"
    ? `Current recipe reference — electrolyte: ${saltDose} g/L · alkali: ${alkaliText} · fixation time: ${fixTime} min`
    : `目前配方參考 — 電解質：${saltDose} g/L．鹼劑：${alkaliText}．固著時間：${fixTime} 分`;
}

// 計算三段（前處理/染色/水洗）接續在同一條時間軸上的完整曲線座標
// 溫度不連續累加：每段各自從自己的起始溫度開始（換水/換缸），時間則連續往後排
// 計算單一大階段（前處理／染色／水洗）自己的時間軸，從0分鐘開始算，不跟其他階段接續
function computeStageTimeline(startTempId, rowsId){
  const startTemp = Number(document.getElementById(startTempId).value) || 0;
  const segs = collectStageSegments(rowsId);
  if(segs.length === 0) return null;

  let t = 0;
  const pointGroups = [];
  const annotations = []; // {t, temp, type:'note'|'drain', text}
  let groupPoints = [{ t, temp: startTemp }];
  segs.forEach(seg=>{
    const rampEndT = t + seg.rampMin;
    groupPoints.push({ t: rampEndT, temp: seg.targetTemp });
    const holdEndT = rampEndT + seg.holdMin;
    groupPoints.push({ t: holdEndT, temp: seg.targetTemp });
    if(seg.note){
      // 備註放在保溫段的正中間，不放在段落尾端
      annotations.push({ t: (rampEndT+holdEndT)/2, temp: seg.targetTemp, type:"note", text: seg.note });
    }
    t = holdEndT;
    if(seg.drain){
      // 排液＝重新入液：曲線斷開留白（固定3分鐘），下一段重新從起始溫度開始算
      annotations.push({ t, temp: seg.targetTemp, type:"drain", text: T("drainLabel") });
      pointGroups.push(groupPoints);
      t += DRAIN_GAP_MIN;
      groupPoints = [{ t, temp: startTemp }];
    }
  });
  // 排液後如果沒有接下一段，會留下一個懸空的起始點、沒有線可畫，直接捨棄不畫
  if(groupPoints.length > 1){
    pointGroups.push(groupPoints);
  }
  return { pointGroups, annotations, totalTime: t };
}

// 把單一階段的時間軸資料畫成一張 SVG 曲線圖（前處理／染色／水洗共用同一套畫法）
function renderStageSVG(timeline, availableWidth){
  const { pointGroups, annotations, totalTime } = timeline;
  // Y軸範圍依實際資料動態決定，避免像尼龍115°C這種高溫被固定上限切掉
  const allTemps = pointGroups.flat().map(p=>p.temp);
  const dataMaxTemp = allTemps.length ? Math.max(...allTemps) : 100;
  const dataMinTemp = allTemps.length ? Math.min(...allTemps) : 20;
  const minTemp = Math.min(20, Math.floor(dataMinTemp/10)*10);
  const maxTemp = Math.max(110, Math.ceil((dataMaxTemp+5)/10)*10);
  const MIN_PX_PER_MIN = 2.5; // 可讀性下限：每分鐘最少幾像素，容器夠寬時會撐大填滿、不會小於這個值
  const MIN_SEG_MIN = 8; // 每個轉折區間至少保留這麼多「分鐘」的視覺寬度，短的段落不會被壓扁
  const padL = 44, padR = 20, padT = 20, padB = 32;

  // 收集所有轉折時間點，建立「時間變形」對照：實際分鐘數 -> 視覺分鐘數（短區間拉開、長區間維持原比例）
  const breakpoints = Array.from(new Set(pointGroups.flat().map(p=>p.t))).sort((a,b)=>a-b);
  const warpedAt = [0];
  for(let i=1;i<breakpoints.length;i++){
    const real = breakpoints[i] - breakpoints[i-1];
    warpedAt.push(warpedAt[i-1] + Math.max(real, MIN_SEG_MIN));
  }
  function warp(t){
    if(breakpoints.length === 0) return 0;
    if(t <= breakpoints[0]) return warpedAt[0];
    if(t >= breakpoints[breakpoints.length-1]) return warpedAt[warpedAt.length-1];
    for(let i=1;i<breakpoints.length;i++){
      if(t <= breakpoints[i]){
        const real0=breakpoints[i-1], real1=breakpoints[i];
        const w0=warpedAt[i-1], w1=warpedAt[i];
        const frac = real1>real0 ? (t-real0)/(real1-real0) : 0;
        return w0 + frac*(w1-w0);
      }
    }
    return warpedAt[warpedAt.length-1];
  }
  const warpedTotal = warp(totalTime);

  // 實際量出容器可用寬度，優先撐滿單頁；只有連最低可讀密度都放不下時，才縮回最小寬度、交給外層捲動
  const usableForPlot = (availableWidth || 0) - padL - padR;
  const idealPxPerMin = warpedTotal > 0 && usableForPlot > 0 ? usableForPlot / warpedTotal : MIN_PX_PER_MIN;
  const pxPerMin = Math.max(MIN_PX_PER_MIN, idealPxPerMin);

  const plotW = Math.max(200, warpedTotal * pxPerMin);
  const plotH = 200;
  const svgW = plotW + padL + padR;
  const svgH = plotH + padT + padB;

  const xOf = tt => padL + (warpedTotal > 0 ? (warp(tt)/warpedTotal)*plotW : 0);
  const yOf = temp => padT + (1 - (temp-minTemp)/(maxTemp-minTemp)) * plotH;

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="${svgW}" height="${svgH}" style="max-width:none; display:block; font-family:inherit;">`;

  // Y 軸格線與刻度（依實際溫度範圍動態產生，每20°C一條）
  for(let tmp=minTemp; tmp<=maxTemp; tmp+=20){
    const y = yOf(tmp);
    svg += `<line x1="${padL}" y1="${y}" x2="${padL+plotW}" y2="${y}" stroke="#E1E4E8" stroke-width="1"/>`;
    svg += `<text x="${padL-8}" y="${y+4}" font-size="10" fill="#5B6B79" text-anchor="end">${tmp}°</text>`;
  }

  // 主曲線：每個連續段落各畫一條 path，排液處不連線、留空白
  pointGroups.forEach(group=>{
    const pathD = group.map((p,i)=> (i===0?"M":"L") + xOf(p.t).toFixed(1) + "," + yOf(p.temp).toFixed(1)).join(" ");
    svg += `<path d="${pathD}" fill="none" stroke="#1D5C6E" stroke-width="2.5"/>`;
  });

  // 保溫時間數字（寫在水平保溫線中間）
  pointGroups.forEach(group=>{
    for(let i=1;i<group.length;i++){
      const prev = group[i-1], cur = group[i];
      if(prev.temp === cur.temp && cur.t > prev.t){
        const midX = xOf((prev.t+cur.t)/2);
        const y = yOf(cur.temp);
        svg += `<text x="${midX}" y="${y-6}" font-size="10" fill="#5B6B79" text-anchor="middle">${cur.t-prev.t}</text>`;
      }
    }
  });

  // 頂點與溫度標籤：起始點（每段第一個點）不標溫度，只在真正爬升/下降到新溫度的地方標
  // 升溫的線從左下方上來，標籤放左上避開；降溫的線從左上方下來，標籤要放左下才不會擋到那條下降線
  pointGroups.forEach(group=>{
    group.forEach((p,i)=>{
      const x = xOf(p.t), y = yOf(p.temp);
      svg += `<circle cx="${x}" cy="${y}" r="3" fill="#1D5C6E"/>`;
      if(i > 0 && group[i-1].temp !== p.temp){
        const isRising = p.temp > group[i-1].temp;
        const ty = isRising ? y-20 : y+30;
        svg += `<text x="${x-5}" y="${ty}" font-size="10" font-weight="700" fill="#1B2734" text-anchor="end">${p.temp}°C</text>`;
      }
    });
  });

  // 動作標註：附註(加藥)先試貼近線的上方，會跟其他附註的文字寬度重疊才換位置（下方→更遠的上方→更遠的下方），
  // 真的依情況判斷，不是死板交錯；太長的備註自動拆兩行縮小寬度；排液只畫箭頭、不寫字，直接畫在線下方
  function estimateTextWidth(text){
    return text.length * 7.5; // 粗估：中文字約等於字級大小，字級10px時抓 7.5px/字
  }
  function fitsSlot(ranges, left, right){
    return !ranges.some(r => left < r.right && right > r.left);
  }
  function wrapText(text, maxChars){
    if(text.length <= maxChars) return [text];
    const mid = Math.ceil(text.length/2);
    return [text.slice(0,mid), text.slice(mid)];
  }

  const NOTE_SLOTS = [
    { side:"up",   dist:44 },
    { side:"down", dist:28 },
    { side:"up",   dist:66 },
    { side:"down", dist:50 },
    { side:"up",   dist:88 },
    { side:"down", dist:72 }
  ];
  const slotRanges = NOTE_SLOTS.map(()=>[]);

  annotations.forEach(a=>{
    // 備註的X座標刻意偏移一點，箭頭才不會直接穿過保溫時間數字（兩者原本在同一個時間點上）
    const x = xOf(a.t) + (a.type === "note" ? 11 : 0);
    const y = yOf(a.temp);
    if(a.type === "note"){
      const color = "#92600C";
      const lines = wrapText(a.text, 11);
      const maxLineLen = Math.max(...lines.map(l=>l.length));
      const halfW = (maxLineLen*7.5)/2 + 5;
      let chosen = NOTE_SLOTS.length - 1;
      for(let i=0;i<NOTE_SLOTS.length;i++){
        if(fitsSlot(slotRanges[i], x-halfW, x+halfW)){ chosen = i; break; }
      }
      slotRanges[chosen].push({ left:x-halfW, right:x+halfW });
      const slot = NOTE_SLOTS[chosen];
      const lineH = 12;
      if(slot.side === "up"){
        const shaftTop = y - slot.dist;
        // 兩行文字時，兩行都往上疊，最下面那行貼著箭頭
        lines.forEach((line, li)=>{
          const ly = shaftTop - 4 - (lines.length-1-li)*lineH;
          svg += `<text x="${x}" y="${ly}" font-size="10" font-weight="700" fill="${color}" text-anchor="middle">${escapeHtml(line)}</text>`;
        });
        svg += `<line x1="${x}" y1="${shaftTop}" x2="${x}" y2="${y-4}" stroke="${color}" stroke-width="1.5"/>`;
        svg += `<polygon points="${x-3.5},${y-8} ${x+3.5},${y-8} ${x},${y-2}" fill="${color}"/>`;
      } else {
        const shaftBottom = y + slot.dist;
        svg += `<line x1="${x}" y1="${y+4}" x2="${x}" y2="${shaftBottom-6}" stroke="${color}" stroke-width="1.5"/>`;
        svg += `<polygon points="${x-3.5},${shaftBottom-6} ${x+3.5},${shaftBottom-6} ${x},${shaftBottom}" fill="${color}"/>`;
        lines.forEach((line, li)=>{
          const ly = shaftBottom + 12 + li*lineH;
          svg += `<text x="${x}" y="${ly}" font-size="10" font-weight="700" fill="${color}" text-anchor="middle">${escapeHtml(line)}</text>`;
        });
      }
    } else {
      const color = "#2E6B8A";
      const armBottom = y + 26;
      svg += `<line x1="${x}" y1="${y+4}" x2="${x}" y2="${armBottom-6}" stroke="${color}" stroke-width="1.5"/>`;
      svg += `<polygon points="${x-3.5},${armBottom-6} ${x+3.5},${armBottom-6} ${x},${armBottom}" fill="${color}"/>`;
    }
  });

  // X 軸時間刻度
  const tickEvery = totalTime > 240 ? 60 : (totalTime > 90 ? 30 : 10);
  for(let tt=0; tt<=totalTime; tt+=tickEvery){
    const x = xOf(tt);
    svg += `<text x="${x}" y="${svgH-8}" font-size="10" fill="#5B6B79" text-anchor="middle">${tt}'</text>`;
  }

  svg += `</svg>`;
  return svg;
}

const PROCESS_STAGES = [
  { startTempId:"pretreatStartTemp", rowsId:"pretreatSegRows" },
  { startTempId:"dyeStartTemp",      rowsId:"dyeSegRows" },
  { startTempId:"washStartTemp",     rowsId:"washSegRows" }
];

// 畫單一階段的圖到指定容器，沒有資料就清空、不顯示
function renderStageChartInto(wrapEl, stage){
  const timeline = computeStageTimeline(stage.startTempId, stage.rowsId);
  if(!timeline){
    wrapEl.innerHTML = "";
    wrapEl.style.display = "none";
    return false;
  }
  wrapEl.style.display = "block";
  const availableWidth = wrapEl.clientWidth || wrapEl.parentElement.clientWidth || 600;
  wrapEl.innerHTML = renderStageSVG(timeline, availableWidth);
  return true;
}

function renderProcessCurve(){
  updateDyeRecipeRefBox();
  renderStageChartInto(document.getElementById("pretreatChartWrap"), PROCESS_STAGES[0]);
  renderStageChartInto(document.getElementById("dyeChartWrap"), PROCESS_STAGES[1]);
  renderStageChartInto(document.getElementById("washChartWrap"), PROCESS_STAGES[2]);
}

function escapeHtml(str){
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ============ Tab4: 工卡預覽 ============ */
function renderPrintCard(){
  const weight = document.getElementById("fabricWeight").value;
  const ratio = document.getElementById("liquorRatio").value;
  const fabricTypeText = state.lang === "en"
    ? (state.fabricType==="merc" ? "Mercerized / rayon" : "Unmercerized cotton")
    : (state.fabricType==="merc" ? "絲光棉／嫘縈" : "未絲光棉");
  const owf = document.getElementById("owfTotalOut").textContent;

  document.getElementById("printDate").textContent = (state.lang === "en" ? "Printed: " : "列印時間：")
    + new Date().toLocaleString(state.lang === "en" ? "en-US" : "zh-Hant-TW");

  document.getElementById("p-customer").textContent = document.getElementById("customerName").value || "–";
  document.getElementById("p-colorOrder").textContent = document.getElementById("colorOrder").value || "–";
  document.getElementById("p-fabricDesc").textContent = document.getElementById("fabricDesc").value || "–";

  document.getElementById("p-weight").textContent = weight + " kg";
  document.getElementById("p-ratio").textContent = "1 : " + ratio;
  document.getElementById("p-type").textContent = fabricTypeText;
  document.getElementById("p-owf").textContent = owf;

  document.getElementById("p-liquor").textContent = document.getElementById("totalLiquorOut").textContent.replace("L"," L");
  document.getElementById("p-salt").textContent = document.getElementById("saltDose").value + " g/L";
  document.getElementById("p-saltTotal").textContent = document.getElementById("saltTotalOut").textContent.replace("kg"," kg");
  document.getElementById("p-fixTime").textContent = document.getElementById("fixTime").value + (state.lang === "en" ? " min" : " 分");

  const alkaliBoxes = document.querySelectorAll("#alkaliTotalBoxes .result-box");
  const L = (zh,en)=> state.lang === "en" ? en : zh;
  let alkaliRowsHtml = "";
  if(state.alkaliMode === "alone"){
    alkaliRowsHtml = `<div class="k">${L("鹼劑方式","Alkali method")}</div><div class="v">${T("alkaliAloneBtn")}</div>
      <div class="k">${L("純鹼用量","Soda ash dose")}</div><div class="v">${document.getElementById("sodaAloneDose").value} g/L</div>
      <div class="k">${L("純鹼總量","Soda ash total")}</div><div class="v">${alkaliBoxes[0] ? padUnitSpace(alkaliBoxes[0].querySelector(".v").textContent) : "–"}</div>`;
  } else if(state.alkaliMode === "combined"){
    alkaliRowsHtml = `<div class="k">${L("鹼劑方式","Alkali method")}</div><div class="v">${T("alkaliCombinedBtn")}</div>
      <div class="k">${L("純鹼用量","Soda ash dose")}</div><div class="v">${document.getElementById("sodaCombinedDose").value} g/L</div>
      <div class="k">${L("液鹼用量","Caustic Soda dose")}</div><div class="v">${document.getElementById("liquidAlkaliDose").value} ml/L</div>
      <div class="k">${L("純鹼總量","Soda ash total")}</div><div class="v">${alkaliBoxes[0] ? padUnitSpace(alkaliBoxes[0].querySelector(".v").textContent) : "–"}</div>
      <div class="k">${L("液鹼總量","Caustic Soda total")}</div><div class="v">${alkaliBoxes[1] ? padUnitSpace(alkaliBoxes[1].querySelector(".v").textContent) : "–"}</div>`;
  } else {
    alkaliRowsHtml = `<div class="k">${L("鹼劑方式","Alkali method")}</div><div class="v">${T("alkaliTspBtn")}</div>
      <div class="k">${L("磷酸三鈉用量","TSP dose")}</div><div class="v">${document.getElementById("tspDose").value} g/L</div>
      <div class="k">${L("磷酸三鈉總量","TSP total")}</div><div class="v">${alkaliBoxes[0] ? padUnitSpace(alkaliBoxes[0].querySelector(".v").textContent) : "–"}</div>`;
  }
  document.getElementById("p-alkaliRows").innerHTML = alkaliRowsHtml;

  renderPrintWeighTable("dyeRows", "p-dyeTable");
  renderPrintWeighTable("auxRows", "p-auxTable");
  document.getElementById("p-dyeTotal").textContent = L("染料總重：","Total dye weight: ") + document.getElementById("dyeTotalOut").textContent;
  document.getElementById("p-auxTotal").innerHTML = document.getElementById("auxTotalOut").innerHTML.replace("</span><span>", "</span>　<span>");

  // 染程曲線：只有該階段有填資料才顯示，否則整段不整合進工卡
  renderPrintStageChart("p-pretreatChartSection", "p-pretreatChart", PROCESS_STAGES[0]);
  renderPrintStageChart("p-dyeChartSection", "p-dyeChart", PROCESS_STAGES[1]);
  renderPrintStageChart("p-washChartSection", "p-washChart", PROCESS_STAGES[2]);

  // 染色結果：有照片或總結文字才附在工卡最下方，完全沒填就整段不顯示（不管是下載圖片還是原生列印都吃得到）
  const resultSection = document.getElementById("p-resultSection");
  const notesVal = (document.getElementById("dyeResultNotes").value || "").trim();
  const hasResultData = resultPhotos.length > 0 || notesVal.length > 0;
  resultSection.style.display = hasResultData ? "block" : "none";
  if(hasResultData){
    document.getElementById("p-resultPhotos").innerHTML = resultPhotos.map(photo => `
      <div class="photo-card">
        <img src="${photo.src}" alt="">
        ${photo.caption ? `<div class="p-photo-caption">${escapeHtml(photo.caption)}</div>` : ""}
      </div>
    `).join("");
    document.getElementById("p-resultNotes").textContent = notesVal;
    document.getElementById("p-resultNotes").style.display = notesVal ? "block" : "none";
  }
}

// 把SVG字串轉成真正的PNG圖片(dataURL)，這樣顯示出來的是<img>標籤，
// 電腦右鍵「複製圖片」、手機長按「複製/儲存」才會是瀏覽器原生行為、穩定可用
function svgToPngDataUrl(svgMarkup, width, height){
  return new Promise((resolve, reject)=>{
    const svgBlob = new Blob([svgMarkup], { type:"image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = ()=>{
      const scale = 2; // 提高解析度，複製出來的圖貼到PPT/Word放大也還算清楚
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = (err)=>{
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

async function renderPrintStageChart(sectionId, chartId, stage){
  const section = document.getElementById(sectionId);
  const chartEl = document.getElementById(chartId);
  const timeline = computeStageTimeline(stage.startTempId, stage.rowsId);
  if(!timeline){
    section.style.display = "none";
    chartEl.innerHTML = "";
    return;
  }
  section.style.display = "block";
  // 工卡預覽／下載圖片用固定的寬版寬度，不管手機或電腦畫面多窄，匯出的圖永遠是完整寬版、不會被截斷
  const PRINT_CHART_MIN_WIDTH = 700;
  const availableWidth = Math.max(chartEl.clientWidth || 0, chartEl.parentElement.clientWidth || 0, PRINT_CHART_MIN_WIDTH);
  const svgString = renderStageSVG(timeline, availableWidth);
  const wMatch = svgString.match(/width="([\d.]+)"/);
  const hMatch = svgString.match(/height="([\d.]+)"/);
  const w = wMatch ? parseFloat(wMatch[1]) : availableWidth;
  const h = hMatch ? parseFloat(hMatch[1]) : 260;
  try{
    const dataUrl = await svgToPngDataUrl(svgString, w, h);
    chartEl.innerHTML = `<img src="${dataUrl}" alt="process chart" style="max-width:100%;display:block;">`;
  }catch(err){
    console.error("SVG轉PNG失敗，改用原本的SVG顯示:", err);
    chartEl.innerHTML = svgString;
  }
}

function renderPrintWeighTable(sourceContainerId, targetTableBodyId){
  const tbody = document.getElementById(targetTableBodyId);
  tbody.innerHTML = "";
  document.querySelectorAll("#"+sourceContainerId+" .weigh-row").forEach(row=>{
    const name = row.querySelector(".w-name").value.trim();
    const modeSel = row.querySelector(".w-mode");
    const unitLabel = modeSel ? (modeSel.value === "owf" ? "%" : modeSel.value === "mlL" ? "ml/L" : "g/L") : "%";
    const value = row.querySelector(".w-value").value;
    const result = row.querySelector(".w-result").textContent;
    if(!name && !value) return;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td style="text-align:left;">${name || T("unnamedItem")}</td><td>${value || "-"} ${unitLabel}</td><td style="text-align:right;font-weight:700;">${result}</td>`;
    tbody.appendChild(tr);
  });
  if(!tbody.children.length){
    tbody.innerHTML = `<tr><td colspan="3" style="color:var(--ink-soft);">${state.lang === "en" ? "(none entered)" : "（尚未輸入）"}</td></tr>`;
  }
}

/* ============ 配方儲存／載入（localStorage） ============ */
// localStorage 在部分情境（如 iOS 獨立模式的私密瀏覽限制、儲存空間已滿）可能會讀寫失敗但沒有任何畫面提示，
// 這兩個包裝函式統一處理例外，失敗時清楚告訴使用者原因，而不是靜默什麼都不做。
function getSavedRecipes(){
  try{
    return JSON.parse(localStorage.getItem("dyeWorkOrderRecipes") || "{}");
  } catch(err){
    console.error("Failed to read saved recipes:", err);
    alert(state.lang === "en"
      ? "Unable to read saved recipes. This browser/mode may be restricting local storage — try a regular browser tab."
      : "無法讀取已儲存的配方。此瀏覽器/模式可能限制了本機儲存功能，請改用一般瀏覽器分頁開啟試試。");
    return null;
  }
}
function setSavedRecipes(recipes){
  try{
    localStorage.setItem("dyeWorkOrderRecipes", JSON.stringify(recipes));
    return true;
  } catch(err){
    console.error("Failed to save recipes:", err);
    alert(state.lang === "en"
      ? "Save failed. This browser/mode may be restricting local storage, or storage is full."
      : "儲存失敗：此瀏覽器/模式可能限制了本機儲存功能，或儲存空間已滿。");
    return false;
  }
}

let loadedRecipeName = "";

// ========== 染色結果記錄：拍照/上傳照片(自動壓縮)+ 結果備註 ==========
const RESULT_PHOTO_MAX_DIM = 800; // 最長邊壓縮到 800px 內，兼顧清晰度與檔案大小
const RESULT_PHOTO_QUALITY = 0.6; // JPEG 壓縮品質
let resultPhotos = []; // {src, caption} 物件陣列，跟著配方一起存檔/載入

// iPhone 相機預設拍出來是 HEIC 格式，瀏覽器完全無法直接解碼（Android 的 JPEG 沒有這個問題）。
// 用 heic2any 這個函式庫做轉檔，但它體積不小，所以不寫死在 <script src>，只在真的遇到
// HEIC 檔案時才動態載入，Android 使用者完全不會載到這段東西。
let heic2anyLoadPromise = null;
function loadHeic2Any(){
  if(window.heic2any) return Promise.resolve();
  if(heic2anyLoadPromise) return heic2anyLoadPromise;
  heic2anyLoadPromise = new Promise((resolve, reject)=>{
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js";
    script.onload = ()=> resolve();
    script.onerror = ()=> reject(new Error("heic2any load failed"));
    document.head.appendChild(script);
  });
  return heic2anyLoadPromise;
}
// file.type 在部分 iOS Safari 版本上對 HEIC 檔案會回傳空字串，所以副檔名也要一併檢查
function isHeicFile(file){
  const type = (file.type || "").toLowerCase();
  if(type === "image/heic" || type === "image/heif") return true;
  return /\.(heic|heif)$/i.test(file.name || "");
}

async function handleResultPhotoInput(event){
  const files = Array.from(event.target.files || []);
  event.target.value = ""; // 清空，允許同一個檔案可以再選一次（例如重拍同一張）

  for(const file of files){
    const heic = isHeicFile(file);
    if(!heic && file.type && !file.type.startsWith("image/")) continue;

    let workingFile = file;
    if(heic){
      try{
        await loadHeic2Any();
      }catch(err){
        console.error("heic2any 函式庫載入失敗：", err);
        alert(state.lang === "en"
          ? "Couldn't load the HEIC photo converter — an internet connection is needed the first time it's used. Please try again once you're back online."
          : "無法載入 HEIC 照片轉檔工具——第一次使用時需要網路連線，請恢復連線後再試一次。");
        continue;
      }
      try{
        const converted = await window.heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
        workingFile = Array.isArray(converted) ? converted[0] : converted;
      }catch(err){
        console.error("HEIC 轉檔失敗：", err);
        alert(state.lang === "en"
          ? "This photo couldn't be converted from HEIC. Please try again, or switch your iPhone's Camera format to \"Most Compatible\" under Settings → Camera → Formats."
          : "這張照片轉檔失敗，可能是檔案本身有問題。請重試一次，或到 iPhone「設定 → 相機 → 格式」改成「最相容」。");
        continue;
      }
    }

    await new Promise((resolve)=>{
      const reader = new FileReader();
      reader.onload = (e)=>{
        const img = new Image();
        img.onload = ()=>{
          const canvas = document.createElement("canvas");
          let { width, height } = img;
          if(width > height && width > RESULT_PHOTO_MAX_DIM){
            height = Math.round(height * RESULT_PHOTO_MAX_DIM / width);
            width = RESULT_PHOTO_MAX_DIM;
          } else if(height > RESULT_PHOTO_MAX_DIM){
            width = Math.round(width * RESULT_PHOTO_MAX_DIM / height);
            height = RESULT_PHOTO_MAX_DIM;
          }
          canvas.width = width;
          canvas.height = height;
          canvas.getContext("2d").drawImage(img, 0, 0, width, height);
          resultPhotos.push({ src: canvas.toDataURL("image/jpeg", RESULT_PHOTO_QUALITY), caption: "" });
          renderResultPhotosGrid();
          resolve();
        };
        img.onerror = ()=>{
          console.error("圖片解碼失敗：", workingFile && workingFile.name);
          alert(state.lang === "en"
            ? "This photo couldn't be read. Please try a different photo or take a new one."
            : "這張照片無法讀取，請換一張照片或重新拍攝。");
          resolve();
        };
        img.src = e.target.result;
      };
      reader.onerror = ()=>{
        console.error("檔案讀取失敗：", workingFile && workingFile.name);
        resolve();
      };
      reader.readAsDataURL(workingFile);
    });
  }
}

function renderResultPhotosGrid(){
  const grid = document.getElementById("resultPhotosGrid");
  if(!grid) return;
  const captionPh = T("photoCaptionPlaceholder");
  grid.innerHTML = resultPhotos.map((photo, i)=>`
    <div class="photo-card">
      <img src="${photo.src}" onclick="openPhotoLightbox(${i})" alt="">
      <button type="button" class="photo-del-btn" onclick="deleteResultPhoto(${i})">×</button>
      <input type="text" class="photo-caption-input" value="${(photo.caption||"").replace(/"/g,"&quot;")}" placeholder="${captionPh}" oninput="updatePhotoCaption(${i}, this.value)">
    </div>
  `).join("");
}

function openPhotoLightbox(index){
  const photo = resultPhotos[index];
  if(!photo) return;
  document.getElementById("photoLightboxImg").src = photo.src;
  document.getElementById("photoLightbox").classList.remove("hidden-el");
}
function closePhotoLightbox(){
  document.getElementById("photoLightbox").classList.add("hidden-el");
}
function updatePhotoCaption(index, value){
  if(resultPhotos[index]) resultPhotos[index].caption = value;
}
function deleteResultPhoto(index){
  resultPhotos.splice(index, 1);
  renderResultPhotosGrid();
}

function collectRecipeData(){
  return {
    customerName: document.getElementById("customerName").value,
    colorOrder: document.getElementById("colorOrder").value,
    fabricDesc: document.getElementById("fabricDesc").value,
    fabricWeight: document.getElementById("fabricWeight").value,
    liquorRatio: document.getElementById("liquorRatio").value,
    fabricTreatment: state.fabricType,
    dyeRows: Array.from(document.querySelectorAll("#dyeRows .weigh-row")).map(row=>({
      name: row.querySelector(".w-name").value,
      value: row.querySelector(".w-value").value
    })),
    auxRows: Array.from(document.querySelectorAll("#auxRows .weigh-row")).map(row=>({
      name: row.querySelector(".w-name").value,
      mode: row.querySelector(".w-mode").value,
      value: row.querySelector(".w-value").value
    })),
    alkaliMode: state.alkaliMode,
    saltDose: document.getElementById("saltDose").value,
    fixTime: document.getElementById("fixTime").value,
    sodaAloneDose: document.getElementById("sodaAloneDose").value,
    sodaCombinedDose: document.getElementById("sodaCombinedDose").value,
    liquidAlkaliDose: document.getElementById("liquidAlkaliDose").value,
    tspDose: document.getElementById("tspDose").value,
    machineType: state.machineType,
    weightGrade: state.weightGrade,
    ratioGrade: state.ratioGrade,
    ratioGradeManual: !!state.ratioGradeManual,
    reelDiameter: document.getElementById("reelDiameter").value,
    temp: state.temp,
    measuredSG: document.getElementById("measuredSG").value,
    sgManual: !!state.sgManual,
    processStages: {
      pretreatStartTemp: document.getElementById("pretreatStartTemp").value,
      dyeStartTemp: document.getElementById("dyeStartTemp").value,
      washStartTemp: document.getElementById("washStartTemp").value,
      pretreatRows: collectStageRowsForSave("pretreatSegRows"),
      dyeRows: collectStageRowsForSave("dyeSegRows"),
      washRows: collectStageRowsForSave("washSegRows")
    },
    resultPhotos: resultPhotos.slice(),
    dyeResultNotes: document.getElementById("dyeResultNotes")?.value || ""
  };
}

function collectStageRowsForSave(containerId){
  return Array.from(document.querySelectorAll("#"+containerId+" .stage-row")).map(row=>({
    note: row.querySelector(".s-note").value,
    targetTemp: row.querySelector(".s-temp").value,
    rampMin: row.querySelector(".s-ramp").value,
    holdMin: row.querySelector(".s-hold").value,
    drain: row.querySelector(".s-drain-on").checked
  }));
}

function saveRecipe(){
  const typedName = document.getElementById("recipeNameInput").value.trim();
  const recipeName = typedName || loadedRecipeName;
  if(!recipeName){
    alert(state.lang === "en" ? "Please enter a recipe name." : "請輸入配方名稱。");
    return;
  }
  const existing = getSavedRecipes();
  if(existing === null) return;
  if(existing[recipeName]){
    const msg = state.lang === "en"
      ? `A recipe named "${recipeName}" already exists. Overwrite it?`
      : `已存在同名配方「${recipeName}」，是否要覆蓋？`;
    if(!confirm(msg)) return;
  }
  existing[recipeName] = collectRecipeData();
  if(!setSavedRecipes(existing)) return;

  updateRecipeList();
  document.getElementById("savedRecipesSel").value = recipeName;
  loadedRecipeName = recipeName;
  const input = document.getElementById("recipeNameInput");
  input.value = "";
  input.placeholder = state.lang === "en" ? `Loaded: ${recipeName} (blank = overwrite)` : `目前載入：${recipeName}（留空即覆蓋）`;
  alert(state.lang === "en" ? "Recipe saved!" : "配方儲存成功！");
}

function applyRecipeData(data){
  document.getElementById("customerName").value = data.customerName || "";
  document.getElementById("colorOrder").value = data.colorOrder || "";
  document.getElementById("fabricDesc").value = data.fabricDesc || "";
  document.getElementById("fabricWeight").value = data.fabricWeight || "";
  document.getElementById("liquorRatio").value = data.liquorRatio || "";

  state.fabricType = data.fabricTreatment || "unmerc";
  document.querySelectorAll("#fabricTypeSeg button").forEach(b=>b.classList.toggle("on", b.dataset.val === state.fabricType));

  document.getElementById("dyeRows").innerHTML = "";
  (data.dyeRows || []).forEach(r=> createWeighRow(document.getElementById("dyeRows"), r.name, "owf", r.value, true));
  if(!(data.dyeRows||[]).length){
    createWeighRow(document.getElementById("dyeRows"), "", "owf", "", true);
    createWeighRow(document.getElementById("dyeRows"), "", "owf", "", true);
    createWeighRow(document.getElementById("dyeRows"), "", "owf", "", true);
  }

  document.getElementById("auxRows").innerHTML = "";
  (data.auxRows || []).forEach(r=> createWeighRow(document.getElementById("auxRows"), r.name, r.mode, r.value, false));
  if(!(data.auxRows||[]).length){
    createWeighRow(document.getElementById("auxRows"), "", "gL", "", false);
    createWeighRow(document.getElementById("auxRows"), "", "gL", "", false);
  }

  state.alkaliMode = data.alkaliMode || "alone";
  document.querySelectorAll("#alkaliModeSeg button").forEach(b=>b.classList.toggle("on", b.dataset.val === state.alkaliMode));
  document.getElementById("alkaliAloneGroup").style.display = state.alkaliMode==="alone" ? "block":"none";
  document.getElementById("alkaliCombinedGroup").style.display = state.alkaliMode==="combined" ? "grid":"none";
  document.getElementById("alkaliTspGroup").style.display = state.alkaliMode==="tsp" ? "block":"none";

  if(data.saltDose !== undefined) document.getElementById("saltDose").value = data.saltDose;
  if(data.fixTime !== undefined) document.getElementById("fixTime").value = data.fixTime;
  if(data.sodaAloneDose !== undefined) document.getElementById("sodaAloneDose").value = data.sodaAloneDose;
  if(data.sodaCombinedDose !== undefined) document.getElementById("sodaCombinedDose").value = data.sodaCombinedDose;
  if(data.liquidAlkaliDose !== undefined) document.getElementById("liquidAlkaliDose").value = data.liquidAlkaliDose;
  if(data.tspDose !== undefined) document.getElementById("tspDose").value = data.tspDose;

  state.machineType = data.machineType || "jet";
  document.getElementById("machineTypeSel").value = state.machineType;
  state.weightGrade = data.weightGrade || "light";
  document.querySelectorAll("#weightGradeSeg button").forEach(b=>b.classList.toggle("on", b.dataset.val === state.weightGrade));
  state.ratioGrade = data.ratioGrade || "mid";
  state.ratioGradeManual = !!data.ratioGradeManual;
  document.querySelectorAll("#ratioGradeSeg button").forEach(b=>b.classList.toggle("on", b.dataset.val === state.ratioGrade));
  document.getElementById("reelDiameter").value = data.reelDiameter || "";

  state.temp = data.temp || 40;
  document.querySelectorAll("#tempSeg button").forEach(b=>b.classList.toggle("on", Number(b.dataset.val) === state.temp));
  state.sgManual = !!data.sgManual;
  if(data.measuredSG !== undefined) document.getElementById("measuredSG").value = data.measuredSG;

  const ps = data.processStages || {};
  document.getElementById("pretreatStartTemp").value = ps.pretreatStartTemp || "40";
  document.getElementById("dyeStartTemp").value = ps.dyeStartTemp || "40";
  document.getElementById("washStartTemp").value = ps.washStartTemp || "40";
  restoreStageRows("pretreatSegRows", ps.pretreatRows);
  restoreStageRows("dyeSegRows", ps.dyeRows);
  restoreStageRows("washSegRows", ps.washRows);

  // 染色結果記錄：舊格式相容（曾經可能是純字串陣列），一律轉成 {src, caption} 物件
  resultPhotos = (data.resultPhotos || []).map(p=>
    typeof p === "string" ? { src:p, caption:"" } : { src:p.src, caption:p.caption||"" }
  );
  renderResultPhotosGrid();
  document.getElementById("dyeResultNotes").value = data.dyeResultNotes || "";

  recalcAll(true);
  recomputeSpeed();
  renderProcessCurve();
}

function restoreStageRows(containerId, rows){
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  (rows || []).forEach(r=> createStageRow(container, {
    note: r.note, targetTemp: r.targetTemp, rampMin: r.rampMin, holdMin: r.holdMin, drain: !!r.drain
  }));
  if(!(rows||[]).length){
    createStageRow(container);
  }
}

function loadRecipe(){
  const sel = document.getElementById("savedRecipesSel");
  const name = sel.value;
  if(!name) return;
  const recipes = getSavedRecipes();
  if(recipes === null) return;
  const data = recipes[name];
  if(!data){
    alert(state.lang === "en" ? "Recipe not found." : "找不到配方。");
    return;
  }
  applyRecipeData(data);
  loadedRecipeName = name;
  const input = document.getElementById("recipeNameInput");
  input.value = "";
  input.placeholder = state.lang === "en" ? `Loaded: ${name} (blank = overwrite)` : `目前載入：${name}（留空即覆蓋）`;
  alert(state.lang === "en" ? "Recipe loaded!" : "配方載入成功！");
  autoSaveState(); // 載入配方後，自動存檔要跟著同步成這筆配方的內容，不然下次意外重開頁面又會被拉回舊的自動存檔
}

function deleteRecipe(){
  const sel = document.getElementById("savedRecipesSel");
  const name = sel.value;
  if(!name){
    alert(state.lang === "en" ? "Please select a recipe to delete." : "請選擇要刪除的配方。");
    return;
  }
  const msg = state.lang === "en" ? `Delete "${name}"?` : `確定要刪除「${name}」嗎？`;
  if(!confirm(msg)) return;
  const recipes = getSavedRecipes();
  if(recipes === null) return;
  delete recipes[name];
  if(!setSavedRecipes(recipes)) return;
  updateRecipeList();
  alert(state.lang === "en" ? "Recipe deleted." : "配方刪除成功！");
}

function updateRecipeList(){
  const recipes = getSavedRecipes();
  const sel = document.getElementById("savedRecipesSel");
  const current = sel.value;
  sel.innerHTML = `<option value="" data-i18n="selectRecipeOpt">${T("selectRecipeOpt")}</option>`;
  if(recipes){
    Object.keys(recipes).sort().forEach(name=>{
      const opt = document.createElement("option");
      opt.value = name; opt.textContent = name;
      sel.appendChild(opt);
    });
  }
  sel.value = current;
}

async function generateWorkOrderImage(){
  const btn = document.getElementById("downloadMenuBtn");
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = T("generatingImg");
  try{
    const target = document.getElementById("panel-print-content");
    // 用固定的桌面寬度虛擬視窗產生圖片，手機瀏覽器也會照桌面版面整個畫出來，
    // 不會因為手機畫面窄、內容需要左右滑動，導致滑出去的部分沒被抓進圖片裡
    const DESKTOP_WIDTH = 900;
    const canvas = await html2canvas(target, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      windowWidth: DESKTOP_WIDTH,
      windowHeight: target.scrollHeight
    });
    const dataUrl = canvas.toDataURL("image/png");
    // 檔名加上時分秒，同一天下載好幾次也不會撞名
    const now = new Date();
    const pad = n => String(n).padStart(2,"0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const filename = "浸染試染工具_" + stamp + ".png";

    // 一鍵完成：產生後直接觸發下載（電腦／Android 有效），同時把圖片顯示出來讓 iOS 可以長按存檔
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    const previewCard = document.getElementById("imgPreviewCard");
    const previewWrap = document.getElementById("imgPreviewWrap");
    previewWrap.innerHTML = `<img src="${dataUrl}" style="max-width:100%;border:1px solid var(--border);border-radius:8px;" alt="work order">`;
    previewCard.style.display = "block";
    previewCard.scrollIntoView({ behavior:"smooth", block:"start" });
  } catch(err){
    console.error("Failed to generate work order image:", err);
    alert(state.lang === "en" ? "Failed to generate image. Please try again." : "圖片產生失敗，請再試一次。");
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}
function toggleDownloadMenu(){
  document.getElementById("downloadMenu").classList.toggle("hidden-el");
}
function closeDownloadMenu(){
  document.getElementById("downloadMenu").classList.add("hidden-el");
}
document.addEventListener("click", (e)=>{
  const wrap = document.getElementById("downloadMenuWrap");
  if(wrap && !wrap.contains(e.target)) closeDownloadMenu();
});

// 依「染色結果」有沒有資料，決定要不要附在工卡最下方——這件事已經整合進 renderPrintCard()，
// 列印前只要確保工卡是最新內容即可，不用再另外處理 panel-reference 的顯示/隱藏
function printWorkOrder(){
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if(isIOS){
    const msg = state.lang === "en"
      ? 'On iPhone/iPad, the print preview has no direct "Save as PDF" button. To save as PDF: pinch to zoom in on the preview thumbnail, tap the share icon that appears, then choose "Save to Files".'
      : "iPhone/iPad 的列印預覽畫面沒有直接的「儲存為PDF」按鈕。要存成PDF，請在預覽縮圖上雙指放大，點出現的分享圖示，選擇「儲存至檔案」即可。";
    alert(msg);
  }
  renderPrintCard();
  window.print();
}

/* ============ 初始化 ============ */
updateRecipeList();
recalcAll();
recomputeSpeedFromRatio();
recomputeSpeed();

// ========== 自動存檔：任何欄位變動都存進 localStorage，重新打開頁面自動讀回來 ==========
// key 統一加 exhaust_ 前綴——這個網域下還有其他工具（例如CPB），localStorage是同網域共用，
// 不加前綴會有互相覆蓋的風險，之後要加新工具也建議比照這個命名方式
const AUTOSAVE_KEY = "exhaust_autosave";
let autoSaveTimer = null;
function autoSaveState(){
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(()=>{
    try{
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(collectRecipeData()));
    }catch(e){
      console.warn("自動存檔失敗：", e);
    }
  }, 500); // debounce，避免每個按鍵都寫一次localStorage
}
function restoreAutoSavedState(){
  try{
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if(!raw) return;
    applyRecipeData(JSON.parse(raw));
  }catch(e){
    console.warn("自動存檔讀取失敗：", e);
  }
}
// 用事件委派監聽整個頁面，任何輸入框/選單/勾選框變動都觸發自動存檔，不用每個欄位各自綁一次
document.addEventListener("input", autoSaveState);
document.addEventListener("change", autoSaveState);
restoreAutoSavedState();

// 註冊 Service Worker，讓工具可以離線使用、也能被瀏覽器判定為可安裝的 PWA
if("serviceWorker" in navigator){
  window.addEventListener("load", ()=>{
    navigator.serviceWorker.register("./sw.js").catch(err=>{
      console.error("Service worker registration failed:", err);
    });
  });
}
