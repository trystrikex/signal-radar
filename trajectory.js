const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function evaluateTrajectory(signal, observations = []) {
  const liquidity = Math.max(0, Number(signal.liquidityUsd) || 0);
  const hasHourly = [signal.volume1h, signal.buys1h, signal.sells1h, signal.change1h].every((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
  const volume = Math.max(0, Number(hasHourly ? signal.volume1h : signal.volume24h) || 0);
  const buys = Math.max(0, Number(hasHourly ? signal.buys1h : signal.buys24h) || 0);
  const sells = Math.max(0, Number(hasHourly ? signal.sells1h : signal.sells24h) || 0);
  const age = Number.isFinite(signal.ageHours) ? signal.ageHours : null;
  const change = Number(hasHourly ? signal.change1h : signal.change24h) || 0;
  const security = signal.security || {};
  const reasons = [];
  let score = 50;

  if (liquidity < 10_000) { score -= 35; reasons.push("Liquidität unter 10.000 $"); }
  else if (liquidity < 25_000) { score -= 23; reasons.push("Sehr dünne Liquidität"); }
  else if (liquidity < 100_000) { score -= 10; reasons.push("Begrenzte Liquidität"); }
  else if (liquidity >= 250_000) { score += 13; reasons.push("Hohe Liquidität"); }
  else score += 6;

  if (volume < (hasHourly ? 100 : 2_000)) { score -= 19; reasons.push(`Kaum Handel in ${hasHourly ? "1 Stunde" : "24 Stunden"}`); }
  else if (volume < (hasHourly ? 1_000 : 20_000)) { score -= 8; reasons.push(`Schwacher Handel in ${hasHourly ? "1 Stunde" : "24 Stunden"}`); }
  else if (volume >= (hasHourly ? 5_000 : 100_000)) score += 9;
  else score += 3;

  if (buys + sells < (hasHourly ? 5 : 20)) { score -= 8; reasons.push("Wenige Transaktionen"); }
  else if (sells > buys * 2) { score -= 12; reasons.push("Deutlich mehr Verkäufe als Käufe"); }
  else if (buys >= sells * 0.8) score += 5;

  if (change <= (hasHourly ? -40 : -80)) { score -= 18; reasons.push(`Starker Preiseinbruch in ${hasHourly ? "1 Stunde" : "24 Stunden"}`); }
  else if (change <= (hasHourly ? -20 : -40)) { score -= 9; reasons.push("Preis stark gefallen"); }
  if (age !== null && age < 6) { score -= 8; reasons.push("Paar jünger als 6 Stunden"); }
  else if (age !== null && age >= 24) score += 7;

  const highFindings = (signal.warnings || []).filter((warning) => warning.level === "high" && !warning.text.includes("Liquidität")).length;
  if (security.isHoneypot || (security.sellTax !== null && security.sellTax !== undefined && security.sellTax > 0.25)) {
    score = Math.min(score, 5);
    reasons.unshift("Verkaufbarkeit laut Vertragsprüfung kritisch");
  } else if (security.checked) {
    score -= Math.min(32, highFindings * 16 + Math.max(0, Number(security.penalty) || 0) * 0.3);
    if (highFindings) reasons.push("Kritische Vertragsindikatoren");
    else score += 5;
  } else reasons.push("Vertragsrisiken nicht vollständig geprüft");

  const ordered = observations.filter((item) => Number.isFinite(Date.parse(item.at))).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const latest = ordered.at(-1);
  const baseline = ordered.findLast((item) => {
    const elapsed = latest && Date.parse(latest.at) - Date.parse(item.at);
    return elapsed >= 30 * 60_000 && elapsed <= 6 * 3_600_000;
  });
  let trend = "Noch kein Verlauf";
  let liquidityChangePercent = null;
  if (baseline && Number(baseline.liquidityUsd) > 0) {
    liquidityChangePercent = Math.round((liquidity / Number(baseline.liquidityUsd) - 1) * 100);
    if (liquidityChangePercent <= -50) { score -= 25; trend = "Liquidität bricht ein"; reasons.unshift("Liquidität seit früherem Scan stark gesunken"); }
    else if (liquidityChangePercent <= -20) { score -= 12; trend = "Liquidität sinkt"; reasons.unshift("Liquidität seit früherem Scan gesunken"); }
    else if (liquidityChangePercent >= 20) { score += 5; trend = "Liquidität steigt"; }
    else trend = "Liquidität stabil";
  }

  score = Math.round(clamp(score, 0, 100));
  const band = score < 30 ? "critical" : score < 60 ? "fragile" : "more-stable";
  const label = band === "critical" ? "Kritisch" : band === "fragile" ? "Fragil" : "Relativ stabil";
  const spanHours = ordered.length > 1 ? (Date.parse(latest.at) - Date.parse(ordered[0].at)) / 3_600_000 : 0;
  const confidence = !hasHourly || !security.checked || ordered.length < 3 || spanHours < 1 ? "Niedrig" : spanHours < 6 ? "Mittel" : "Erhöht";
  return {
    score, band, label, confidence, trend, liquidityChangePercent,
    inputWindowHours: hasHourly ? 1 : 24,
    observations: ordered.length,
    reasons: reasons.slice(0, 4),
    horizon: band === "critical" ? "Nächste 6 Stunden: akutes Ausfallrisiko" : band === "fragile" ? "Nächste 6 Stunden: eng beobachten" : "Nächste 6 Stunden: kein akutes Ausfallsignal",
  };
}

module.exports = { evaluateTrajectory };
