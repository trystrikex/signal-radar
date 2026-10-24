const stored = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};

const state = {
  signals: [], history: [], status: null, selectedId: null, detailOpen: true,
  mode: "loading", updatedAt: null, scanning: false, view: "radar", search: "", toast: "",
  watched: new Set(stored("signal-radar-watched", [])), hidden: new Set(stored("signal-radar-hidden", [])),
  filters: { chain: "Alle", liquidity: 0, age: 720, risk: "Alle", fresh: false, checked: false },
  settings: { refreshMinutes: 5, minDesktopScore: 75, desktopNotifications: false, ...stored("signal-radar-settings", {}) },
  refreshTimer: null,
};

const icons = {
  radar: '<svg viewBox="0 0 24 24"><path d="M12 12 19 5M20 12a8 8 0 1 1-8-8M16 12a4 4 0 1 1-4-4"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/></svg>',
  history: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
  external: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 4.2A10.5 10.5 0 0 1 12 4c5.5 0 9 6 9 6a17 17 0 0 1-2.1 2.8M6.6 6.6C4.3 8.1 3 10 3 10s3.5 6 9 6a9 9 0 0 0 3-.5"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="1"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>',
};

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const safeUrl = (value) => { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? esc(url.href) : ""; } catch { return ""; } };
const persist = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const money = (value) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "USD", notation: value >= 1_000_000 ? "compact" : "standard", maximumFractionDigits: value >= 100_000 ? 1 : 0 }).format(value || 0);
const age = (hours) => hours == null ? "Unbekannt" : hours < 1 ? `${Math.max(1, Math.round(hours * 60))} Min.` : `${Math.round(hours)} Std.`;
const riskClass = (risk) => risk === "Hoch" ? "danger" : risk === "Erhöht" ? "warning" : "neutral";
const scoreClass = (score) => score >= 75 ? "good" : score >= 55 ? "warning" : "danger";
const dateTime = (value) => new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function showToast(message) {
  state.toast = message; render();
  window.setTimeout(() => { if (state.toast === message) { state.toast = ""; render(); } }, 2600);
}

function filteredSignals(base = state.signals) {
  const query = state.search.trim().toLowerCase();
  return base.filter((signal) => !state.hidden.has(signal.id))
    .filter((signal) => state.filters.chain === "Alle" || signal.chain === state.filters.chain)
    .filter((signal) => signal.liquidityUsd >= state.filters.liquidity)
    .filter((signal) => signal.ageHours == null || signal.ageHours <= state.filters.age)
    .filter((signal) => state.filters.risk === "Alle" || signal.risk === state.filters.risk)
    .filter((signal) => !state.filters.fresh || (signal.ageHours != null && signal.ageHours <= 24))
    .filter((signal) => !state.filters.checked || signal.security?.checked)
    .filter((signal) => !query || [signal.symbol, signal.name, signal.chain, signal.address].some((value) => String(value).toLowerCase().includes(query)));
}

function nav() {
  const item = (view, icon, label) => `<button class="nav-button ${state.view === view ? "active" : ""}" data-view="${view}" title="${label}">${icon}<span>${label}</span></button>`;
  return `<aside class="nav"><div class="brand-mark">${icons.radar}</div>${item("radar", icons.radar, "Radar")}<button class="nav-button" id="search-nav" title="Suche">${icons.search}<span>Suche</span></button>${item("watchlist", icons.star, "Merkliste")}${item("history", icons.history, "Verlauf")}<div class="nav-spacer"></div>${item("setup", icons.settings, "Setup")}</aside>`;
}

function header() {
  return `<header><div><h1>Signal Radar</h1><p>Frühe Signale. Klare Risiken. Keine automatischen Trades.</p></div><div class="header-actions"><span class="data-status ${state.mode}"><i></i>${state.mode === "live" ? "Live-Daten" : state.mode === "demo" ? "Demo-Modus" : "Lädt"}</span><span class="updated">${state.updatedAt ? `Aktualisiert ${new Date(state.updatedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}` : ""}</span><button class="primary scan" id="scan" ${state.scanning ? "disabled" : ""}>${icons.refresh}${state.scanning ? "Scan läuft" : "Scan starten"}</button></div></header>`;
}

function metrics(signals) {
  const avgLiquidity = signals.length ? signals.reduce((sum, signal) => sum + signal.liquidityUsd, 0) / signals.length : 0;
  const newCount = signals.filter((signal) => signal.ageHours != null && signal.ageHours <= 24).length;
  const checkedCount = signals.filter((signal) => signal.security?.checked).length;
  return `<section class="metrics"><div><span>Kandidaten</span><strong>${signals.length}</strong></div><div><span>Neue Tokens (24h)</span><strong>${newCount}</strong></div><div><span>Ø Liquidität</span><strong>${money(avgLiquidity)}</strong></div><div><span>Verträge geprüft</span><strong>${checkedCount}</strong></div><div><span>Beobachtet</span><strong>${state.watched.size}</strong></div><div><span>Marktlage</span><strong class="market-state"><i></i>${signals.some((signal) => signal.risk === "Hoch") ? "Erhöht" : "Ruhig"}</strong></div></section>`;
}

function filters() {
  const chains = ["Alle", ...new Set(state.signals.map((signal) => signal.chain))];
  return `<section class="filters" aria-label="Filter">
    <label>Netzwerk<select data-filter="chain">${chains.map((chain) => `<option ${chain === state.filters.chain ? "selected" : ""}>${esc(chain)}</option>`).join("")}</select></label>
    <label>Mindestliquidität<select data-filter="liquidity">${[[0,"Keine"],[25000,"25.000 $"],[50000,"50.000 $"],[100000,"100.000 $"]].map(([value,label]) => `<option value="${value}" ${state.filters.liquidity === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
    <label>Maximales Alter<select data-filter="age">${[[0.25,"15 Minuten"],[1,"1 Stunde"],[6,"6 Stunden"],[24,"24 Stunden"],[72,"72 Stunden"],[168,"168 Stunden"],[720,"720 Stunden"]].map(([value,label]) => `<option value="${value}" ${state.filters.age === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
    <label>Risiko<select data-filter="risk">${["Alle","Mittel","Erhöht","Hoch"].map((risk) => `<option ${state.filters.risk === risk ? "selected" : ""}>${risk}</option>`).join("")}</select></label>
    <label class="toggle-row"><input type="checkbox" data-filter="fresh" ${state.filters.fresh ? "checked" : ""}><span class="toggle"></span>Nur neue</label>
    <label class="toggle-row"><input type="checkbox" data-filter="checked" ${state.filters.checked ? "checked" : ""}><span class="toggle"></span>Nur geprüfte</label>
    <button class="text-button" id="reset-filters">Zurücksetzen</button>
  </section>`;
}

function signalTable(signals) {
  if (!signals.length) return `<div class="empty"><strong>Keine Treffer</strong><span>Passe Suche oder Filter an.</span></div>`;
  return `<div class="table-wrap"><table><thead><tr><th>Rang</th><th>Token</th><th>Netzwerk</th><th>Radar-Score</th><th>Trajectory</th><th>Momentum (24h)</th><th>Liquidität</th><th>Volumen (24h)</th><th>Alter</th><th>Risiko</th></tr></thead><tbody>${signals.map((signal, index) => `<tr data-id="${esc(signal.id)}" class="${signal.id === state.selectedId ? "selected" : ""} ${signal.ageHours != null && signal.ageHours <= 24 ? "fresh" : ""}"><td>${index + 1}</td><td><div class="token"><span class="token-icon">${safeUrl(signal.imageUrl) ? `<img src="${safeUrl(signal.imageUrl)}" alt="">` : esc(signal.symbol.slice(0, 2))}</span><span><strong>${esc(signal.symbol)}</strong><small>${esc(signal.name)}</small></span>${state.watched.has(signal.id) ? `<span class="watch-star">★</span>` : ""}</div></td><td>${esc(signal.chain)}</td><td><div class="score-cell"><strong>${signal.score}</strong><span class="bar"><i class="${scoreClass(signal.score)}" style="width:${signal.score}%"></i></span></div></td><td><span class="trajectory-tag ${esc(signal.trajectory?.band || "unknown")}">${esc(signal.trajectory?.label || "Keine Daten")}</span></td><td class="${signal.change24h >= 0 ? "positive" : "negative"}">${signal.change24h >= 0 ? "+" : ""}${signal.change24h.toFixed(1)}%</td><td>${money(signal.liquidityUsd)}</td><td>${money(signal.volume24h)}</td><td>${age(signal.ageHours)}</td><td><span class="risk ${riskClass(signal.risk)}">${esc(signal.risk)}</span></td></tr>`).join("")}</tbody></table></div>`;
}

function inspector(signal) {
  if (!signal) return `<aside class="inspector empty-inspector"><strong>Kein Signal ausgewählt</strong><span>Wähle einen Kandidaten aus der Tabelle.</span></aside>`;
  const parts = [{ label:"Marktaktivität",value:signal.scoreParts.activity,max:25 },{ label:"Liquidität",value:signal.scoreParts.liquidity,max:20 },{ label:"Kauf-/Verkaufsbalance",value:signal.scoreParts.balance,max:15 },{ label:"Neuheitsgrad",value:signal.scoreParts.freshness,max:15 },{ label:"Momentum-Proxy",value:signal.scoreParts.momentum,max:15 },{ label:"Quellenprofil",value:signal.scoreParts.completeness,max:10 }];
  const security = signal.security || { checked:false };
  const trajectory = signal.trajectory;
  const percent = (value) => value == null ? "Unbekannt" : `${(value * 100).toFixed(1)} %`;
  const dexUrl = safeUrl(signal.dexUrl);
  const socialLinks = signal.socials.map((social) => safeUrl(social.url) ? `<a href="${safeUrl(social.url)}" target="_blank" rel="noopener">${esc(social.type)}${icons.external}</a>` : "").filter(Boolean).join("");
  return `<aside class="inspector ${state.detailOpen ? "" : "mobile-hidden"}"><div class="inspector-head"><div><h2>${esc(signal.symbol)}</h2><p>${esc(signal.name)} · ${esc(signal.chain)}</p></div><button class="icon-button" id="close-detail" title="Details schließen">×</button></div>
    <div class="score-hero"><span>Radar-Score</span><strong>${signal.score}<small>/100</small></strong><div class="bar large"><i class="${scoreClass(signal.score)}" style="width:${signal.score}%"></i></div></div>
    <section class="inspect-section trajectory-section"><h3>Trajectory · Handelsstabilität</h3>${trajectory ? `<div class="trajectory-head"><span class="trajectory-tag ${esc(trajectory.band)}">${esc(trajectory.label)}</span><small>Datenlage: ${esc(trajectory.confidence)}</small></div><strong class="trajectory-horizon">${esc(trajectory.horizon)}</strong><div class="fact"><span>Marktdaten</span><b>${trajectory.inputWindowHours === 1 ? "Letzte 1 Stunde" : "Letzte 24 Stunden (Ersatz)"}</b></div><div class="fact"><span>Liquiditätstrend</span><b>${esc(trajectory.trend)}${trajectory.liquidityChangePercent == null ? "" : ` (${trajectory.liquidityChangePercent > 0 ? "+" : ""}${trajectory.liquidityChangePercent} %)`}</b></div><div class="fact"><span>Messpunkte</span><b>${trajectory.observations}</b></div>${trajectory.reasons.map((reason) => `<div class="trajectory-reason">${esc(reason)}</div>`).join("")}` : `<p class="trajectory-note">Noch keine Daten verfügbar.</p>`}<p class="trajectory-note">Heuristik, keine kalibrierte Überlebenswahrscheinlichkeit oder exakte Lebensdauer.</p></section>
    <section class="inspect-section"><h3>Score-Komponenten</h3>${parts.map((part) => `<div class="part"><span>${part.label}</span><b>${part.value}/${part.max}</b><span class="bar"><i class="${scoreClass((part.value / part.max) * 100)}" style="width:${(part.value / part.max) * 100}%"></i></span></div>`).join("")}${security.checked ? `<div class="security-deduction"><span>Sicherheitsabzug</span><b>−${security.penalty || 0}</b></div>` : ""}</section>
    <section class="inspect-section"><h3>Wichtige Hinweise</h3>${signal.warnings.map((warning) => `<div class="warning-line"><span class="warning-icon ${esc(warning.level)}">!</span><span>${esc(warning.text)}</span></div>`).join("")}</section>
    <section class="inspect-section"><h3>Vertragsprüfung</h3><div class="security-status ${security.checked ? "checked" : "unchecked"}"><i></i><span>${security.checked ? "Automatisch geprüft" : "Noch nicht verfügbar"}</span><b>${esc(security.provider || "")}</b></div><div class="fact"><span>Quelloffen</span><b>${security.checked ? (security.isOpenSource ? "Ja" : "Nein") : "–"}</b></div><div class="fact"><span>Holder</span><b>${security.holderCount ?? "–"}</b></div><div class="fact"><span>Top-10-Anteil</span><b>${security.top10Percent == null ? "–" : `${security.top10Percent.toFixed(1)} %`}</b></div><div class="fact"><span>Kauf- / Verkaufssteuer</span><b>${percent(security.buyTax)} / ${percent(security.sellTax)}</b></div><div class="fact"><span>Liquidität gesperrt</span><b>${security.lpLocked == null ? "–" : security.lpLocked ? "Ja" : "Nein"}</b></div></section>
    <section class="inspect-section"><h3>Quellen & Aktivität</h3><div class="fact"><span>DEX-Handelsdaten</span><b>${money(signal.volume24h)}</b></div><div class="fact"><span>Käufe / Verkäufe</span><b>${signal.buys24h} / ${signal.sells24h}</b></div><div class="fact"><span>X-Social-Scan</span><b>${signal.socialMetrics?.checked ? `${signal.socialMetrics.mentions} Posts` : "Nicht geprüft"}</b></div>${signal.socialMetrics?.checked ? `<div class="fact"><span>Accounts / Interaktionen</span><b>${signal.socialMetrics.uniqueAuthors} / ${signal.socialMetrics.engagement}</b></div>` : ""}${socialLinks ? `<div class="social-links">${socialLinks}</div>` : ""}<button class="contract-button" id="copy-address" data-address="${esc(signal.address)}">${icons.copy}<span>${esc(signal.address)}</span></button></section>
    <div class="actions"><button class="primary" id="toggle-watch">${icons.star}${state.watched.has(signal.id) ? "Nicht mehr beobachten" : "Beobachten"}</button>${dexUrl ? `<a class="secondary" href="${dexUrl}" target="_blank" rel="noopener">${icons.external} DEX öffnen</a>` : `<button class="secondary" disabled>${icons.external} DEX öffnen</button>`}<button class="quiet-action" id="hide-signal">${icons.eyeOff} Ausblenden</button></div>
    <p class="disclaimer">Recherchehilfe, keine Anlageberatung. Verkaufbarkeit und Risiken vor jedem Schritt selbst prüfen.</p></aside>`;
}

function radarView(watchlist = false) {
  const base = watchlist ? state.signals.filter((signal) => state.watched.has(signal.id)) : state.signals;
  const visible = filteredSignals(base);
  if (!visible.some((signal) => signal.id === state.selectedId)) state.selectedId = visible[0]?.id || null;
  const selected = state.signals.find((signal) => signal.id === state.selectedId);
  return `${metrics(base)}${filters()}<section class="content"><div class="results"><div class="results-head"><div><h2>${watchlist ? "Merkliste" : "Frühwarnsignale"}</h2><p>${watchlist ? "Deine lokal gespeicherten Kandidaten" : "Sortiert nach Radar-Score"}</p></div><label class="search-box">${icons.search}<input id="signal-search" type="search" placeholder="Token oder Adresse suchen" value="${esc(state.search)}"></label><span>${visible.length} Treffer</span></div>${state.mode === "demo" ? `<div class="mode-notice">Die Live-Quelle war nicht erreichbar. Angezeigt werden Beispieldaten.</div>` : ""}${signalTable(visible)}</div>${inspector(selected)}</section>`;
}

function historyView() {
  const rows = state.history.map((event) => `<button class="history-row ${event.type}" ${event.tokenId ? `data-token-id="${esc(event.tokenId)}"` : ""}><span class="history-dot"></span><span><strong>${esc(event.message)}</strong><small>${event.symbol ? `${esc(event.chain)} · Score ${event.score}` : "System"}</small></span><time>${dateTime(event.timestamp)}</time></button>`).join("");
  return `<section class="page-view"><div class="page-head"><div><h2>Scan-Verlauf</h2><p>Neue Kandidaten, größere Score-Änderungen und Systemmeldungen.</p></div><button class="secondary" id="refresh-history">${icons.refresh} Aktualisieren</button></div><div class="history-list">${rows || `<div class="empty"><strong>Noch kein Verlauf</strong><span>Nach dem ersten Scan erscheinen hier Ereignisse.</span></div>`}</div></section>`;
}

function sourceRow(label, active, detail) {
  return `<div class="source-row"><span class="source-light ${active ? "on" : "off"}"></span><div><strong>${label}</strong><small>${detail}</small></div><b>${active ? "Verbunden" : "Offen"}</b></div>`;
}

function setupView() {
  const status = state.status || { scanIntervalMinutes: 5, alertMinScore: 75, telegram: {}, sources: {} };
  return `<section class="page-view setup-view"><div class="page-head"><div><h2>Setup</h2><p>Alles, was für den laufenden Abendbetrieb wichtig ist.</p></div><span class="readiness ${state.mode === "live" ? "ready" : "pending"}"><i></i>${state.mode === "live" ? "Radar einsatzbereit" : "Live-Verbindung prüfen"}</span></div>
    <div class="setup-grid"><section class="setup-panel"><h3>Datenquellen</h3>${sourceRow("DEX Screener", status.sources?.dexScreener, "Markt, Volumen und neue Paare")}${sourceRow("GoPlus", status.sources?.goPlus, "EVM-Vertragsprüfung")}${sourceRow("X", status.sources?.x, status.sources?.x ? "Posts und Interaktionen fließen in den Score ein" : "Erfordert X_BEARER_TOKEN")}${sourceRow("Reddit", false, "Für die nächste Ausbaustufe vorgesehen")}</section>
    <section class="setup-panel"><h3>Automatik</h3><label class="setting-row"><span><strong>Browser-Aktualisierung</strong><small>Solange diese Seite geöffnet ist</small></span><select id="refresh-minutes">${[1,3,5,10,15].map((value) => `<option value="${value}" ${state.settings.refreshMinutes === value ? "selected" : ""}>${value} Min.</option>`).join("")}</select></label><label class="setting-row"><span><strong>Desktop-Hinweise</strong><small>Neue Signale ab Mindestscore</small></span><input id="desktop-notifications" type="checkbox" ${state.settings.desktopNotifications ? "checked" : ""}></label><label class="setting-row"><span><strong>Mindestscore</strong><small>Für lokale Desktop-Hinweise</small></span><input id="desktop-score" type="number" min="0" max="100" value="${state.settings.minDesktopScore}"></label><div class="server-note">Der Server scannt zusätzlich alle ${status.scanIntervalMinutes} Minuten.</div></section>
    <section class="setup-panel"><h3>Telegram</h3>${sourceRow("Telegram-Bot", status.telegram?.configured, status.telegram?.enabled ? `Aktiv ab Score ${status.alertMinScore}` : status.telegram?.configured ? "Konfiguriert, aber deaktiviert" : "Noch nicht eingerichtet")}<p class="setup-copy">Bot-Token und Chat-ID bleiben ausschließlich in der lokalen <code>.env</code>-Datei. Sie werden nicht an den Browser ausgeliefert.</p><button class="secondary full" id="telegram-test" ${status.telegram?.configured ? "" : "disabled"}>${icons.bell} Testnachricht senden</button></section>
    <section class="setup-panel"><h3>Lokale Daten</h3><div class="fact"><span>Beobachtete Tokens</span><b>${state.watched.size}</b></div><div class="fact"><span>Ausgeblendete Tokens</span><b>${state.hidden.size}</b></div><div class="fact"><span>Verlaufsereignisse</span><b>${state.history.length}</b></div><button class="secondary full" id="restore-hidden" ${state.hidden.size ? "" : "disabled"}>Ausgeblendete wiederherstellen</button></section></div>
    <div class="safety-band"><strong>Vor dem ersten Einsatz</strong><span>Nutze den Radar als Recherchehilfe. Prüfe Verkaufsfähigkeit, Vertragsadresse und Liquidität erneut direkt vor jeder eigenen Entscheidung.</span></div></section>`;
}

function render() {
  const content = state.view === "history" ? historyView() : state.view === "setup" ? setupView() : radarView(state.view === "watchlist");
  document.querySelector("#app").innerHTML = `<div class="app-shell">${nav()}<main>${header()}${content}</main>${state.toast ? `<div class="toast">${esc(state.toast)}</div>` : ""}</div>`;
  bindEvents();
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => { state.view = button.dataset.view; state.search = ""; render(); }));
  document.querySelector("#search-nav")?.addEventListener("click", () => { state.view = "radar"; render(); document.querySelector("#signal-search")?.focus(); });
  document.querySelectorAll("tbody tr").forEach((row) => row.addEventListener("click", () => { state.selectedId = row.dataset.id; state.detailOpen = true; render(); }));
  document.querySelectorAll("[data-filter]").forEach((input) => input.addEventListener("change", () => { const key = input.dataset.filter; state.filters[key] = input.type === "checkbox" ? input.checked : ["liquidity","age"].includes(key) ? Number(input.value) : input.value; render(); }));
  document.querySelector("#signal-search")?.addEventListener("input", (event) => { state.search = event.target.value; const position = event.target.selectionStart; render(); const input = document.querySelector("#signal-search"); input?.focus(); input?.setSelectionRange(position, position); });
  document.querySelector("#reset-filters")?.addEventListener("click", () => { state.filters = { chain:"Alle",liquidity:0,age:720,risk:"Alle",fresh:false,checked:false }; state.search = ""; render(); });
  document.querySelector("#scan")?.addEventListener("click", () => loadSignals(true));
  document.querySelector("#toggle-watch")?.addEventListener("click", () => { state.watched.has(state.selectedId) ? state.watched.delete(state.selectedId) : state.watched.add(state.selectedId); persist("signal-radar-watched", [...state.watched]); showToast(state.watched.has(state.selectedId) ? "Zur Merkliste hinzugefügt" : "Von der Merkliste entfernt"); });
  document.querySelector("#hide-signal")?.addEventListener("click", () => { state.hidden.add(state.selectedId); persist("signal-radar-hidden", [...state.hidden]); state.selectedId = null; showToast("Signal ausgeblendet"); });
  document.querySelector("#copy-address")?.addEventListener("click", async (event) => { const address = event.currentTarget.dataset.address; try { await navigator.clipboard.writeText(address); showToast("Vertragsadresse kopiert"); } catch { showToast("Kopieren nicht möglich"); } });
  document.querySelector("#close-detail")?.addEventListener("click", () => { state.detailOpen = false; render(); });
  document.querySelector("#refresh-history")?.addEventListener("click", loadHistory);
  document.querySelectorAll("[data-token-id]").forEach((row) => row.addEventListener("click", () => { if (state.signals.some((signal) => signal.id === row.dataset.tokenId)) { state.selectedId = row.dataset.tokenId; state.view = "radar"; render(); } else showToast("Token ist nicht mehr im aktuellen Scan"); }));
  document.querySelector("#refresh-minutes")?.addEventListener("change", (event) => { state.settings.refreshMinutes = Number(event.target.value); saveSettings(); scheduleRefresh(); showToast("Intervall gespeichert"); });
  document.querySelector("#desktop-score")?.addEventListener("change", (event) => { state.settings.minDesktopScore = Math.max(0, Math.min(100, Number(event.target.value))); saveSettings(); render(); });
  document.querySelector("#desktop-notifications")?.addEventListener("change", async (event) => { if (event.target.checked && "Notification" in window) { const permission = await Notification.requestPermission(); state.settings.desktopNotifications = permission === "granted"; } else state.settings.desktopNotifications = false; saveSettings(); render(); showToast(state.settings.desktopNotifications ? "Desktop-Hinweise aktiviert" : "Desktop-Hinweise deaktiviert"); });
  document.querySelector("#restore-hidden")?.addEventListener("click", () => { state.hidden.clear(); persist("signal-radar-hidden", []); showToast("Alle Signale wieder sichtbar"); });
  document.querySelector("#telegram-test")?.addEventListener("click", testTelegram);
}

function saveSettings() { persist("signal-radar-settings", state.settings); }
function scheduleRefresh() { clearTimeout(state.refreshTimer); state.refreshTimer = window.setTimeout(() => loadSignals(true), state.settings.refreshMinutes * 60_000); }

function notifyDesktop(previousIds, signals) {
  if (!state.settings.desktopNotifications || !("Notification" in window) || Notification.permission !== "granted" || !previousIds.size) return;
  const candidate = signals.find((signal) => !previousIds.has(signal.id) && signal.score >= state.settings.minDesktopScore && signal.risk !== "Hoch");
  if (candidate) new Notification(`Neues Signal: ${candidate.symbol}`, { body: `${candidate.chain} · Score ${candidate.score} · Risiko ${candidate.risk}` });
}

async function loadHistory() {
  try { const response = await fetch("/api/history"); const data = await response.json(); state.history = data.history || []; render(); } catch { showToast("Verlauf konnte nicht geladen werden"); }
}

async function loadStatus() {
  try { const response = await fetch("/api/status"); state.status = await response.json(); } catch { state.status = null; }
}

async function testTelegram() {
  try { const response = await fetch("/api/telegram/test", { method:"POST" }); const data = await response.json(); if (!response.ok) throw new Error(data.error); showToast("Telegram-Testnachricht gesendet"); await loadHistory(); }
  catch (error) { showToast(error.message || "Telegram-Test fehlgeschlagen"); }
}

async function loadSignals(force = false) {
  if (state.scanning) return;
  const previousIds = new Set(state.signals.map((signal) => signal.id));
  state.scanning = true; render();
  try {
    const response = await fetch(`/api/signals${force ? "?refresh=1" : ""}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Scan fehlgeschlagen");
    state.signals = data.signals; state.mode = data.mode; state.updatedAt = data.updatedAt;
    if (!state.selectedId || !data.signals.some((signal) => signal.id === state.selectedId)) state.selectedId = data.signals[0]?.id || null;
    notifyDesktop(previousIds, data.signals);
  } catch { state.mode = "demo"; showToast("Live-Scan fehlgeschlagen"); }
  finally { state.scanning = false; await Promise.all([loadStatus(), loadHistory()]); scheduleRefresh(); render(); }
}

render();
loadSignals();
