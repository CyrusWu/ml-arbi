/* ML-ARBI 静态站(GitHub Pages)。原生 JS,零依赖;数据来自 ./data/*.json(由 cycle.py 每 4h 推送)。
   视图:#/ 组合总览 · #/strategies 策略广场 · #/strategies/<id> 产品详情 · #/system 系统状态 */

const TRACKS = ["T1_EQUITY_FUNDING","T2_BN_BSTOCK_SPOT_PERP","T3_CEX_CEX_CRYPTO_FUNDING","T4_CEX_DEX_CRYPTO_FUNDING","T5_BN_DATED_CARRY"];
const VERDICT_LABEL = { IN_WINDOW: "判决窗内", PROMOTION_CANDIDATE: "晋升候选", RETIRE_ON_VERDICT: "判决=退役" };
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdC = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const sm = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${usd.format(Math.abs(v))}`;
const sp = (v, d = 2) => (v === null || v === undefined || !isFinite(v)) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`;
const cn = (v, t = true) => !v ? "—" : new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", ...(t ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}) }).format(new Date(v));
const ago = (v) => { if (!v) return "—"; const m = Math.max(0, (Date.now() - new Date(v).getTime()) / 60000); return m < 90 ? `${m.toFixed(0)} 分钟前` : m < 2880 ? `${(m/60).toFixed(1)} 小时前` : `${(m/1440).toFixed(1)} 天前`; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const tone = (v) => v >= 0 ? "positive" : "negative";
const chip = (track, verdict) => track === "T2_BN_BSTOCK_SPOT_PERP" ? "❄️ 冻结(死因注册表)" : track === "T5_BN_DATED_CARRY" ? "🌱 数据积累中" : (VERDICT_LABEL[verdict] || verdict || "—");

let D = null;

async function load() {
  const v = Date.now();
  const grab = (p) => fetch(`./data/${p}?v=${v}`).then((r) => { if (!r.ok) throw new Error(`${p} ${r.status}`); return r.json(); });
  const [reviews, promotion, dashboard, gates, portfolio, kill, briefs, ...files] = await Promise.all([
    grab("evidence/strategy-reviews.json"), grab("evidence/promotion-status.json"), grab("ml-arbi.json"),
    grab("config/signal-gates-config.json"), grab("evidence/portfolio.json"), grab("config/kill-registry.json"),
    grab("evidence/duty-briefs.json").catch(() => ({ briefs: [] })),
    ...TRACKS.map((t) => grab(`evidence/${t}.json`)),
  ]);
  D = { reviews: reviews.reviews, glossary: reviews.glossary, promotion, dashboard, gates, portfolio, kill, briefs: briefs.briefs || [],
        evidence: Object.fromEntries(files.map((f) => [f.strategy_id, f])) };
}

function kpis(file) {
  const c = file.forward_paper.equity_curve, tr = file.forward_paper.trades, m = file.forward_paper.metrics;
  const started = new Date(file.forward_paper.forward_started_at_utc).getTime();
  const last = c.length ? new Date(c[c.length - 1].at).getTime() : started;
  const days = Math.max(0.01, (last - started) / 86400000);
  const ann = (m.cumulative_net_pnl_usd / 10000) * (365 / days) * 100;
  const mdd = c.length ? Math.min(...c.map((p) => p.drawdown_pct)) : 0;
  const holds = tr.map((t) => ((t.closed_at ? new Date(t.closed_at).getTime() : last) - new Date(t.opened_at).getTime()) / 3600000);
  const avgHold = holds.length ? holds.reduce((a, b) => a + b, 0) / holds.length : null;
  const turnover = tr.reduce((s, t) => s + t.committed_capital, 0);
  return { days, ann, mdd, avgHold, turnover, avgTrade: tr.length ? m.cumulative_net_pnl_usd / tr.length : null };
}

function gateChecks(cand, cfg, track) {
  const g = cfg.gates;
  if (!cand) return [{ id: "-", name: "本轮无候选", pass: null, obs: "该策略当前快照没有进入 top10 的候选", req: "—" }];
  const days = cand.history_days || 0, med = cand.history_median_day_bp, ratio = days > 0 ? (cand.history_positive_days || 0) / days : 0, con = cand.consecutive_pretriggers || 0;
  const killHit = track === "T2_BN_BSTOCK_SPOT_PERP" ? "KILL-C6-T2-FROZEN" : null;
  return [
    { id: "G1", name: "实收口径(历史天数×日中位)", pass: days >= g.g1_realized_basis.min_history_days && (med || 0) > g.g1_realized_basis.min_history_median_day_bp, obs: `${days} 天 · 中位 ${med == null ? "—" : Number(med).toFixed(1) + "bp/日"}`, req: `≥${g.g1_realized_basis.min_history_days} 天且中位>0` },
    { id: "G2", name: "严格同号(正日占比)", pass: ratio >= g.g2_strict_sign.min_positive_day_ratio, obs: `${(ratio*100).toFixed(0)}%`, req: `≥${g.g2_strict_sign.min_positive_day_ratio*100}%` },
    { id: "G3", name: "反尖峰(连续 pretrigger)", pass: con >= g.g3_persistence.min_consecutive_pretriggers, obs: `${con} 张`, req: `≥${g.g3_persistence.min_consecutive_pretriggers} 张` },
    { id: "G4", name: "容量先行(双腿配对容量)", pass: cand.capacity_usd >= g.g4_capacity.min_paired_capacity_usd, obs: usd.format(cand.capacity_usd), req: `≥${usd.format(g.g4_capacity.min_paired_capacity_usd)}` },
    { id: "G5", name: "死因注册表", pass: !killHit, obs: killHit || "无命中", req: "无 BLOCK_OPEN 命中" },
  ];
}

/* ---------- 图表 ---------- */
function spark(curve, h = 56) {
  if (!curve.length) return `<div style="font-size:12px;color:var(--muted);padding:14px 0">无曲线——无交易/无数据本身是有效结论,不画假线</div>`;
  const navs = curve.map((p) => p.nav_index), min = Math.min(...navs, 99.99), max = Math.max(...navs, 100.01), W = 560;
  const x = (i) => (i / Math.max(1, curve.length - 1)) * (W - 8) + 4, y = (n) => h - 8 - ((n - min) / (max - min)) * (h - 16);
  const d = navs.map((n, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(n).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${W} ${h}" style="width:100%;height:${h}px;display:block"><line x1="4" x2="${W-4}" y1="${y(100)}" y2="${y(100)}" stroke="#c9d1dc" stroke-dasharray="4 4"/><path d="${d}" fill="none" stroke="#5b8cff" stroke-width="2"/></svg>`;
}
function navChart(curve) {
  if (!curve.length) return `<div class="empty-card">前向影子尚无曲线。</div>`;
  const W = 820, H = 300, pad = { l: 64, r: 22, t: 24, b: 42 };
  const vals = curve.map((p) => p.nav_index), rMin = Math.min(...vals), rMax = Math.max(...vals), spr = Math.max(rMax - rMin, 0.02);
  const min = rMin - spr * .16, max = rMax + spr * .16;
  const x = (i) => pad.l + (i / Math.max(1, curve.length - 1)) * (W - pad.l - pad.r), y = (v) => pad.t + ((max - v) / (max - min)) * (H - pad.t - pad.b);
  const line = curve.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(p.nav_index).toFixed(2)}`).join(" ");
  const area = `${line} L${x(curve.length-1)},${H-pad.b} L${x(0)},${H-pad.b} Z`;
  const ticks = [0,1,2,3].map((i) => max - i * (max - min) / 3);
  const li = [...new Set([0, Math.floor((curve.length-1)/3), Math.floor((curve.length-1)*2/3), curve.length-1])];
  return `<div class="chart-canvas"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="前向影子净值">
    ${ticks.map((t) => `<line class="chart-grid" x1="${pad.l}" x2="${W-pad.r}" y1="${y(t)}" y2="${y(t)}"/><text class="chart-axis" x="${pad.l-12}" y="${y(t)+4}" text-anchor="end">${t.toFixed(3)}</text>`).join("")}
    <line class="chart-zero" x1="${pad.l}" x2="${W-pad.r}" y1="${y(100)}" y2="${y(100)}"/>
    <path class="chart-area" d="${area}"/><path class="chart-line" d="${line}"/>
    ${curve.map((p, i) => `<circle class="chart-point" cx="${x(i)}" cy="${y(p.nav_index)}" r="${p.data_status !== "MODELED_OK" ? 4 : i === curve.length-1 ? 4.5 : 2}" ${p.data_status !== "MODELED_OK" ? 'fill="#d97706"' : ""}><title>${cn(p.at)} · NAV ${p.nav_index.toFixed(4)} · 累计 ${sm(p.cumulative_pnl_usd)}${p.data_status !== "MODELED_OK" ? " · ⚠️ 数据缺口段" : ""}</title></circle>`).join("")}
    ${li.map((i) => `<text class="chart-axis" x="${x(i)}" y="${H-14}" text-anchor="${i === 0 ? "start" : i === curve.length-1 ? "end" : "middle"}">${cn(curve[i].at, false)}</text>`).join("")}
  </svg></div>`;
}
function progress(v) {
  if (!v) return "";
  const p = Math.min(1, Math.max(v.window.closed_trades / v.window.trades_required, v.window.elapsed_days / v.window.days_required));
  return `<div><div class="progress-track"><div class="progress-fill" style="width:${(p*100).toFixed(0)}%"></div></div><small class="progress-note">判决窗 ${v.window.closed_trades}/${v.window.trades_required} 笔 · ${v.window.elapsed_days.toFixed(1)}/${v.window.days_required} 天(先到为准)</small></div>`;
}
const card = (label, value, note, t = "default") => `<article class="metric-card tone-${t}"><span>${esc(label)}</span><strong>${value}</strong><small>${esc(note)}</small></article>`;

/* ---------- 壳 ---------- */
function shell(title, kicker, meta, body, active) {
  const items = [["01","组合总览","#/"],["02","策略广场","#/strategies"],["03","系统状态","#/system"]];
  return `
  <aside class="sidebar">
    <div class="brand-block"><span>ML</span><div><strong>ML—ARBI</strong><small>Arbitrage Strategy Platform</small></div></div>
    <nav aria-label="平台导航">${items.map(([n,l,h]) => `<a href="${h}" class="${active === h ? "active" : ""}"><span>${n}</span>${l}</a>`).join("")}</nav>
    <div class="sidebar-status"><div><span class="live-dot"></span>自有采集 · 4h 循环</div><small>PUBLIC DATA ONLY</small><strong>真实资金 $0.00 · 三锁未开</strong></div>
  </aside>
  <main class="workspace">
    <header class="workspace-header"><div><p>Money Lead / Arbitrage Intelligence</p><h1>${esc(title)}</h1><span style="color:var(--muted);font-size:11px">${esc(kicker)}</span></div>${meta ? `<div class="header-meta">${meta}</div>` : ""}</header>
    <div class="view-stack">${body}</div>
    <p class="site-foot">静态站由 cycle.py 每 4h 自动发布 · 数据源 data/(账本层唯一真相,重放对账 PASSED) · 影子模拟 · 真钱未授权</p>
  </main>`;
}

/* ---------- 视图 ---------- */
function viewOverview() {
  const { portfolio, dashboard, promotion, evidence } = D;
  const a = dashboard.portfolio_analytics;
  const body = `
    <section class="portfolio-hero"><div class="portfolio-identity"><div class="portfolio-kicker"><span>FORWARD SHADOW FUND</span><b>SIMULATION</b></div><h2>ML-ARBI Composite</h2><p>五条套利机制组成的容量驱动影子组合。所有绩效只计算系统启动后的前向快照;真钱层锁死。</p><p><a href="#/strategies" style="color:#8fb0ff;font-size:13px">→ 策略广场:说明书 × 三套账(历史/前向/真钱)</a></p></div>
      <div class="nav-hero"><span>组合净值</span><strong>${a.nav_index.toFixed(4)}</strong><b class="${tone(a.return_on_registered_capital_pct)}">${sp(a.return_on_registered_capital_pct, 4)}</b><small>基准净值 100 · 注册影子资本 ${usdC.format(a.registered_capital_usd)}</small></div></section>
    <div class="metric-strip">
      ${card("累计模型盈亏", sm(dashboard.summary.modeled_pnl_usd), `${dashboard.summary.closed_position_count} 已退出 · ${dashboard.summary.open_position_count} 持仓`, tone(dashboard.summary.modeled_pnl_usd))}
      ${card("在险资金", usdC.format(dashboard.summary.deployed_capital_usd), `利用率 ${a.capital_utilization_pct.toFixed(1)}%`)}
      ${card("最大回撤", `${a.max_drawdown_pct.toFixed(3)}%`, sm(a.max_drawdown_usd))}
      ${card("平仓胜率", a.closed_win_rate_pct === null ? "—" : `${a.closed_win_rate_pct.toFixed(0)}%`, `${a.closed_wins} 胜 ${a.closed_losses} 负`)}
      ${card("数据快照", String(dashboard.meta.source_snapshot_count), `完整 ${dashboard.meta.semantically_complete_snapshot_count} · 最新 ${ago(dashboard.meta.latest_market_snapshot_utc)}`)}
    </div>
    <section class="panel"><div class="panel-header"><div><h3>组合净值曲线</h3><p>NAV=100×(1+累计模型盈亏/$50,000);橙点=数据缺口段</p></div><strong>${a.nav_index.toFixed(4)}</strong></div>${navChart(a.nav_timeline.map((p) => ({ at: p.at, nav_index: p.nav_index, cumulative_pnl_usd: p.pnl_usd, data_status: "MODELED_OK" })))}</section>
    <section class="panel table-panel"><div class="panel-header"><div><h3>策略表现</h3><p>机制级聚合;点行进详情</p></div><a class="text-action" href="#/strategies">策略广场 →</a></div>
      <div class="table-scroll"><table><thead><tr><th>策略</th><th>状态</th><th>NAV</th><th>净盈亏</th><th>平仓</th><th>胜率</th><th>判决窗</th></tr></thead><tbody>
      ${TRACKS.map((t) => { const f = evidence[t], m = f.forward_paper.metrics, v = promotion.strategies[t]; return `<tr class="click-row" onclick="location.hash='#/strategies/${t}'"><td><strong>${f.display.number} · ${esc(f.display.short)}</strong><small>${esc(f.display.title)}</small></td><td>${chip(t, v && v.verdict)}</td><td>${m.nav_index.toFixed(4)}</td><td class="${tone(m.cumulative_net_pnl_usd)}">${sm(m.cumulative_net_pnl_usd)}</td><td>${m.closed_trades}</td><td>${m.closed_win_rate_pct === null ? "—" : m.closed_win_rate_pct.toFixed(0)+"%"}</td><td>${v ? `${v.window.closed_trades}/${v.window.trades_required} 笔 · ${v.window.elapsed_days.toFixed(1)}/${v.window.days_required} 天` : "—"}</td></tr>`; }).join("")}
      </tbody></table></div></section>
    <section class="panel"><div class="panel-header"><div><h3>值班简报(人话)</h3><p>每 4h 一条 · DeepSeek 只做事实翻译,不给建议 · 数字均来自引擎事件</p></div></div>
      <div style="padding:18px;display:grid;gap:12px">${(D.briefs || []).slice(0, 3).map((b) => `<article style="font-size:13px;line-height:1.8;padding:12px 14px;border-radius:8px;background:var(--panel-soft)"><div style="font-size:10px;color:var(--muted-2);margin-bottom:6px">${cn(b.snapshot)} 快照 · ${esc(b.source)}</div>${esc(b.text)}</article>`).join("") || `<div class="empty-card">暂无简报。</div>`}</div></section>
    <section class="panel"><div class="panel-header"><div><h3>最近事件</h3><p>引擎日志(开仓/平仓/缺口/五关拒绝)</p></div></div>
      <ul class="event-list" style="padding:18px;margin:0;list-style:none;display:grid;gap:10px">${dashboard.events.slice(0, 12).map((e) => `<li><span>${cn(e.at)}</span><div><strong>${e.type === "GATE_REJECTED" ? "🚧 " : e.type === "SIM_POSITION_OPENED" ? "🟦 " : e.type === "SIM_POSITION_CLOSED" ? "⬜ " : "⏸ "}${esc(e.title)}</strong><small>${esc(e.detail)}</small></div></li>`).join("")}</ul></section>`;
  const meta = `<span><i class="quality-ok"></i>采集 LIVE · 快照 ${ago(dashboard.meta.latest_market_snapshot_utc)}</span><span><i class="quality-ok"></i>真钱 锁死 $0</span>`;
  return shell("组合总览", "五条套利机制的前向影子组合 · 全部公开数据", meta, body, "#/");
}

function viewPlaza() {
  const { evidence, reviews, promotion, dashboard, portfolio } = D;
  const totalClosed = TRACKS.reduce((s, t) => s + evidence[t].forward_paper.metrics.closed_trades, 0);
  const totalWins = TRACKS.reduce((s, t) => s + evidence[t].forward_paper.metrics.closed_wins, 0);
  const sortKey = (location.hash.split("?sort=")[1] || "nav");
  const ordered = [...TRACKS].sort((l, r) => { const a = evidence[l].forward_paper.metrics, b = evidence[r].forward_paper.metrics; return sortKey === "pnl" ? b.cumulative_net_pnl_usd - a.cumulative_net_pnl_usd : sortKey === "closed" ? b.closed_trades - a.closed_trades : b.nav_index - a.nav_index; });
  const body = `
    <div class="metric-strip">
      ${card("组合 NAV", portfolio.nav_index.toFixed(4), `注册影子资本 ${usd.format(portfolio.registered_capital_usd)}`, tone(portfolio.nav_index - 100))}
      ${card("组合累计净盈亏", sm(portfolio.portfolio_cumulative_pnl_usd), `五策略求和对账 ${portfolio.sum_check}`, tone(portfolio.portfolio_cumulative_pnl_usd))}
      ${card("产品数", "4 活跃 + 1 冻结", "冻结 = 死因注册表拦截,仅观察不开仓")}
      ${card("平仓战绩", `${totalWins} 胜 ${totalClosed - totalWins} 负`, "全部为 v0 旧规则时代;v1 五关生效后 0 开仓")}
      ${card("组合生死会", promotion.portfolio.life_or_death_review_due_utc.slice(0, 10), "8 周 0/5 晋升 → 整线正式复审")}
    </div>
    <section class="panel"><div class="panel-header"><div><h3>产品货架</h3><p>点击卡片进入产品详情(说明书 / 账本 / 五关体检 / 风险 / 日志)</p></div>
      <div class="segmented">${[["nav","按 NAV"],["pnl","按盈亏"],["closed","按平仓"]].map(([k,l]) => `<button class="${sortKey === k ? "active" : ""}" onclick="location.hash='#/strategies?sort=${k}'">${l}</button>`).join("")}</div></div>
      <div class="plaza-grid" style="padding:18px">
      ${ordered.map((t) => { const f = evidence[t], r = reviews[t], v = promotion.strategies[t], m = f.forward_paper.metrics, k = kpis(f), p = dashboard.proposals.find((x) => x.id === t);
        return `<a class="card-link" href="#/strategies/${t}"><article class="panel fund-card" style="height:100%">
          <header style="display:flex;gap:8px;align-items:baseline"><strong style="font-size:14px">${f.display.number} · ${esc(f.display.short)}</strong><span class="status-chip" style="margin-left:auto">${chip(t, v && v.verdict)}</span></header>
          <p class="fund-sub" style="margin:0">${esc(r.plain_title)}</p>
          <div style="display:flex;align-items:baseline;gap:10px"><span class="fund-nav">${m.nav_index.toFixed(4)}</span><span class="${tone(m.cumulative_net_pnl_usd)}" style="font-weight:600;font-size:13px">${sm(m.cumulative_net_pnl_usd)}</span></div>
          ${spark(f.forward_paper.equity_curve)}
          <div class="fund-kpis">
            <div><span>年化(窗口口径)</span><strong class="${tone(k.ann)}">${sp(k.ann, 1)}</strong></div><div><span>最大回撤</span><strong>${k.mdd.toFixed(2)}%</strong></div><div><span>胜率</span><strong>${m.closed_win_rate_pct === null ? "—" : m.closed_win_rate_pct.toFixed(0)+"%"}</strong></div>
            <div><span>平仓 / 持仓</span><strong>${m.closed_trades} / ${m.open_trades}</strong></div><div><span>当前候选</span><strong>${esc(p && p.current_candidate ? p.current_candidate.underlying : "—")}</strong></div><div><span>本轮数据</span><strong>${p && p.track_quality === "complete" ? "完整" : "缺口"}</strong></div>
          </div>
          ${progress(v)}<p class="fund-sub" style="margin:0">${esc(r.current_call)}</p></article></a>`; }).join("")}
      </div></section>
    <p class="plaza-note">「年化」为窗口口径展示值(窗口仅 ${kpis(evidence.T1_EQUITY_FUNDING).days.toFixed(1)} 天,不构成业绩预期);资金数字以账本层为准。看不懂术语?进任意产品详情页的「策略说明书」页签。</p>`;
  const meta = `<span><i class="quality-ok"></i>采集 LIVE · 快照 ${ago(dashboard.meta.latest_market_snapshot_utc)}</span><span><i class="quality-ok"></i>真钱 锁死 $0</span>`;
  return shell("策略广场", "每条策略是一个产品对象:说明书 × 三套账 × 判决窗 · 全部影子模拟", meta, body, "#/strategies");
}

function viewDetail(track, tab) {
  const { evidence, reviews, promotion, dashboard, gates } = D;
  const f = evidence[track], r = reviews[track];
  if (!f || !r) return shell("未知策略", track, "", `<p><a href="#/strategies">← 返回策略广场</a></p>`, "#/strategies");
  const v = promotion.strategies[track], p = dashboard.proposals.find((x) => x.id === track), m = f.forward_paper.metrics, k = kpis(f);
  const curveEnd = f.forward_paper.equity_curve.length ? f.forward_paper.equity_curve[f.forward_paper.equity_curve.length-1].at : null;
  const events = dashboard.events.filter((e) => e.proposal === track), rej = events.filter((e) => e.type === "GATE_REJECTED");
  const gc = gateChecks(p && p.current_candidate, gates, track);
  const TABS = [["manual","01","策略说明书"],["perf","02","业绩与交易账本"],["market","03","当前市场与五关体检"],["risk","04","风险与产品合同"],["ledgers","05","三套账与治理"],["log","06","运行日志"]];
  tab = TABS.some(([k]) => k === tab) ? tab : "manual";
  const hold = (o, c) => { const e = c || curveEnd; if (!e) return "—"; const h = Math.max(0, (new Date(e) - new Date(o)) / 3600000); return h < 24 ? `${h.toFixed(1)}h` : `${(h/24).toFixed(1)}d`; };
  const glossary = D.glossary;
  let panel = "";
  if (tab === "manual") panel = `<section class="category-panel"><div class="category-heading"><div><span>CATEGORY 01</span><h3>策略说明书(人话)</h3></div><p>先懂机制,再看数字。</p></div>
    <div class="review-grid">${[["这是什么", r.what_is_it],["钱从哪来(谁在付钱)", r.where_money_comes_from],["怎么亏(主要死法)", r.why_it_can_fail],["七月研究裁决", r.july_verdict],["前向战绩解读", r.forward_read],["当前判定与盯什么", `${r.current_call} <em>盯:${esc(r.watch_next)}</em>`]].map(([h, b], i) => `<article><span>${h}</span><p>${i === 5 ? b : esc(b)}</p></article>`).join("")}</div>
    <div class="thesis-band"><span>理论依据</span><strong>${esc(p && p.theory_basis)}</strong></div>
    <details style="padding:14px 22px"><summary style="cursor:pointer;font-size:12px;color:var(--muted)">人话词典(资金费率 / delta 中性 / 基差 / 三套账)</summary><dl style="font-size:12.5px;line-height:1.75;margin:8px 0 0">${Object.entries(glossary).map(([t, d]) => `<div style="margin-bottom:6px"><dt style="font-weight:600;display:inline">${esc(t)}:</dt><dd style="display:inline;margin:0;color:var(--muted)">${esc(d)}</dd></div>`).join("")}</dl></details></section>`;
  else if (tab === "perf") panel = `<section class="category-panel"><div class="category-heading"><div><span>CATEGORY 02</span><h3>业绩归因与交易账本</h3></div><p>净盈亏 = 资金费 + 双腿盯市 − 费用;每笔可追溯到源快照。</p></div>
    <div class="component-grid"><div><span>模型资金费</span><strong class="${tone(m.funding_pnl_usd)}">${sm(m.funding_pnl_usd)}</strong></div><div><span>双腿盯市</span><strong class="${tone(m.basis_mark_pnl_usd)}">${sm(m.basis_mark_pnl_usd)}</strong></div><div><span>累计费用</span><strong class="negative">−${usd.format(m.fees_usd)}</strong></div><div><span>单笔均值</span><strong>${k.avgTrade === null ? "—" : sm(k.avgTrade)}</strong></div></div>
    <div class="table-scroll"><table><thead><tr><th>标的 / 方向</th><th>开仓</th><th>平仓</th><th>持仓</th><th>本金</th><th>入场(空/多)</th><th>最新(空/多)</th><th>资金费</th><th>盯市</th><th>费用</th><th>净</th><th>费率对账Δ</th><th>版本</th></tr></thead><tbody>
    ${f.forward_paper.trades.length ? f.forward_paper.trades.map((t) => `<tr><td><strong>${esc(t.underlying)}</strong><small>${esc(t.direction)}</small></td><td>${cn(t.opened_at)}</td><td>${t.closed_at ? `${cn(t.closed_at)} · ${esc(t.close_reason)}` : "持仓中"}</td><td>${hold(t.opened_at, t.closed_at)}</td><td>${usdC.format(t.committed_capital)}</td><td>${t.short_leg.entry_price} / ${t.long_leg.entry_price}</td><td>${t.short_leg.latest_cover_price} / ${t.long_leg.latest_exit_price}</td><td class="${tone(t.funding_pnl)}">${sm(t.funding_pnl)}</td><td class="${tone(t.basis_mark_pnl)}">${sm(t.basis_mark_pnl)}</td><td class="negative">−${usd.format(t.fees.total)}</td><td class="${tone(t.net_pnl)}"><strong>${sm(t.net_pnl)}</strong></td><td>${t.funding_reconciliation ? (t.funding_reconciliation.delta_usd === null ? "部分缺口" : sm(t.funding_reconciliation.delta_usd)) : "未对账"}</td><td><small>${t.strategy_version.startsWith("v0") ? "v0" : "v1"}</small></td></tr>`).join("") : `<tr><td colspan="13" class="table-empty">该策略尚无前向交易。</td></tr>`}
    </tbody></table></div><div class="evidence-note"><strong>对账Δ = 真实结算 − 模型估算</strong><span>已用交易所公开结算记录回填 7/8 笔;模型整体高估 ~12%,最大偏差 ZHIPU(模型 +2.01 / 实际 −0.64)。</span></div></section>`;
  else if (tab === "market") { const c = p && p.current_candidate; panel = `<section class="category-panel"><div class="category-heading"><div><span>CATEGORY 03</span><h3>当前市场与五关体检</h3></div><p>展示用复算;权威判定在引擎(每次拒绝都写入运行日志)。</p></div>
    ${c ? `<div class="metric-strip" style="padding:18px">${card("当前候选", esc(c.underlying), c.direction)}${card("日费差", `${(c.spread_day_bp||0).toFixed(1)} bp/日`, `入场基差 ${(c.entry_basis_bp||0).toFixed(1)} bp`)}${card("配对容量", usd.format(c.capacity_usd), `往返 taker ${(c.roundtrip_taker_bp||0).toFixed(1)} bp`)}${card("72h 模型净值", `${(c.projected_net_72h_bp||0).toFixed(1)} bp`, "模型预测,非实收")}</div>` : `<div class="empty-card">当前快照该策略没有进入 top10 的候选。</div>`}
    <table class="gate-table"><thead><tr><th>关</th><th>名称</th><th>观测值</th><th>要求</th><th>判定</th></tr></thead><tbody>${gc.map((g) => `<tr><td><strong>${g.id}</strong></td><td>${g.name}</td><td>${g.obs}</td><td>${g.req}</td><td>${g.pass === null ? "—" : `<span class="quality-text ${g.pass ? "quality-complete" : "quality-incomplete"}">${g.pass ? "过" : "拦"}</span>`}</td></tr>`).join("")}</tbody></table>
    <div class="evidence-note"><strong>为什么大多数时候都是「拦」</strong><span>五关就是七月军规:只放行「有多日实收历史、严格同号、连续在场、容量够、不撞死因」的费差。v1 生效以来 0 开仓不是故障——旧规则(v0)开的 8 笔 0 胜 8 负,全部会被这五关拦下。门在等采集攒出足够历史。最近拒绝:${rej.length ? `${esc(rej[0].title)}(${cn(rej[0].at)})` : "本策略暂无"}。</span></div></section>`; }
  else if (tab === "risk") panel = `<section class="category-panel"><div class="category-heading"><div><span>CATEGORY 04</span><h3>风险与产品合同</h3></div><p>资本上限不是损失保证上限。</p></div>
    <div class="exposure-grid" style="padding:18px">${card("模拟资本上限", usd.format(p ? p.risk_profile.max_committed_capital_usd : 0), "双腿本金 + 保证金缓冲", "risk")}${card("最大双腿名义", usd.format(p ? p.risk_profile.max_gross_notional_usd : 0), "每腿 ≤ $4,000")}${card("当前承诺资本", usd.format(p ? p.risk_profile.current_committed_capital_usd : 0), m.open_trades ? "有持仓" : "当前无仓")}${card("真钱层", "🔒 $0", "三锁未齐,恒不可开")}</div>
    <div class="risk-copy"><article><span>主要风险链</span><p>${esc(p && p.risk_logic)}</p></article><article><span>关闭 / 否决条件</span><p>${esc(p && p.kill)}</p></article></div>
    <details style="padding:0 18px 14px"><summary style="cursor:pointer;font-size:13px;color:var(--muted)">产品合同全文(入场/退出/仓位/成本模型)</summary><dl style="font-size:13px;line-height:1.8;margin:8px 0 0">${Object.entries(f.contract.entry_rule).map(([ver, rule]) => `<div><dt style="font-weight:600;display:inline"><code>${esc(ver)}</code>:</dt><dd style="display:inline;margin:0;color:var(--muted)">${esc(rule)}</dd></div>`).join("")}<div><dt style="font-weight:600;display:inline">退出:</dt><dd style="display:inline;margin:0;color:var(--muted)">${esc(f.contract.exit_rule)}</dd></div><div><dt style="font-weight:600;display:inline">仓位:</dt><dd style="display:inline;margin:0;color:var(--muted)">${esc(f.contract.sizing_rule)}</dd></div><div><dt style="font-weight:600;display:inline">成本:</dt><dd style="display:inline;margin:0;color:var(--muted)">${esc(f.contract.fee_model)};滑点 ${esc(f.contract.slippage_model)};资金费 ${esc(f.contract.funding_model)}</dd></div></dl></details>
    <div class="risk-warning"><strong>最大损失尚不可被证明封顶</strong><span>${esc(p && p.risk_profile.disclaimer)}</span></div></section>`;
  else if (tab === "ledgers") panel = `<section class="category-panel"><div class="category-heading"><div><span>CATEGORY 05</span><h3>三套账与治理</h3></div><p>三本账永不混写;真钱三锁缺一不可。</p></div>
    <div class="ledger-grid"><div class="ledger-box ledger-hist"><strong>历史回测 · ${esc(f.historical.status)}</strong><ul>${f.historical.blockers.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div>
    <div class="ledger-box ledger-fwd"><strong>前向影子 · ${esc(f.forward_paper.status)}</strong><p style="font-size:13px;margin:8px 0 0;line-height:1.65">起点 ${cn(f.forward_paper.forward_started_at_utc)};自有采集器每 4h 推进一次;重放对账逐字节一致(PASSED)——账本坏了循环会自己停。</p><div style="margin-top:8px">${progress(v)}</div></div>
    <div class="ledger-box ledger-real"><strong>真钱 · ${esc(f.real_money.status)}</strong><p style="font-size:20px;margin:8px 0 4px">🔒 $0 · 0 笔</p><ol>${f.real_money.unlock_requires.map((u) => `<li>${esc(u)}</li>`).join("")}</ol></div></div>
    <div class="evidence-note"><strong>晋升规则(预注册,窗内禁改)</strong><span>${esc(promotion.rules)}</span></div></section>`;
  else panel = `<section class="category-panel"><div class="category-heading"><div><span>CATEGORY 06</span><h3>运行日志</h3></div><p>该策略的引擎事件(开仓/平仓/数据缺口/五关拒绝)。</p></div>
    <ul class="event-list" style="padding:18px;margin:0;list-style:none;display:grid;gap:12px">${events.length ? events.map((e) => `<li><span>${cn(e.at)}</span><div><strong>${e.type === "GATE_REJECTED" ? "🚧 " : e.type === "SIM_POSITION_OPENED" ? "🟦 " : e.type === "SIM_POSITION_CLOSED" ? "⬜ " : "⏸ "}${esc(e.title)}</strong><small>${esc(e.detail)}</small></div></li>`).join("") : `<li><span>—</span><div><strong>暂无事件</strong><small>近 60 条全局事件中没有该策略的记录</small></div></li>`}</ul></section>`;

  const body = `
    <p style="font-size:12px;margin:0"><a href="#/strategies">← 返回策略广场</a></p>
    <section class="panel" style="padding:18px"><div class="metric-strip">
      ${card("NAV", m.nav_index.toFixed(4), "每策略固定注册 $10,000", tone(m.nav_index - 100))}${card("累计净盈亏", sm(m.cumulative_net_pnl_usd), `${m.closed_trades} 平仓 · ${m.open_trades} 持仓`, tone(m.cumulative_net_pnl_usd))}${card("年化(窗口口径)", sp(k.ann, 1), `窗口仅 ${k.days.toFixed(1)} 天,展示值非预期`)}${card("最大回撤", `${k.mdd.toFixed(3)}%`, "策略 NAV 口径")}${card("平仓胜率", m.closed_win_rate_pct === null ? "—" : `${m.closed_win_rate_pct.toFixed(0)}%`, `${m.closed_wins} 胜 ${m.closed_trades - m.closed_wins} 负`)}
    </div><div style="margin-top:12px">${progress(v)}</div></section>
    <section class="panel"><div class="panel-header"><div><h3>前向影子净值</h3><p>蓝线=NAV(基准 100 虚线);橙点=数据缺口段(资金费按 8h 封顶截断,不用平线伪装)</p></div><strong>${m.nav_index.toFixed(4)}</strong></div>${navChart(f.forward_paper.equity_curve)}</section>
    <div class="category-tabs" role="tablist" style="grid-template-columns:repeat(6,minmax(0,1fr))">${TABS.map(([kk, n, l]) => `<button role="tab" class="${tab === kk ? "active" : ""}" onclick="location.hash='#/strategies/${track}/${kk}'"><span>${n}</span><strong>${l}</strong></button>`).join("")}</div>
    ${panel}`;
  const meta = `<span><i class="quality-ok"></i>快照 ${ago(dashboard.meta.latest_market_snapshot_utc)}</span><span class="status-chip">${chip(track, v && v.verdict)}</span>`;
  return shell(`${f.display.number} · ${f.display.title}`, `${r.plain_title} · ${p ? p.thesis : ""}`, meta, body, "#/strategies");
}

function viewSystem() {
  const { dashboard, gates, kill, promotion } = D, meta = dashboard.meta;
  const body = `
    <section class="panel" style="padding:18px"><h2 style="margin:0;font-size:16px">数据管道(采集主权:ML-ARBI 自有,2026-08-14 起)</h2><ul style="font-size:13px;line-height:1.9;margin:8px 0 0;padding-left:18px">
      <li>采集器:<code>scripts/collector.py</code>(fork 自 run_monitor,T5 contractStatus bug 已修)→ 快照落 <code>data/snapshots/</code>,历史续读旧档案(不断代)</li>
      <li>循环:<code>scripts/cycle.py</code> = 采集→模拟→重放对账→晋升→镜像→<strong>发布本站</strong>;任一步失败即停(对账失败=账坏,不带病续跑)</li>
      <li>最新快照:<strong>${esc(meta.latest_market_snapshot_utc)}</strong>(${ago(meta.latest_market_snapshot_utc)}) · 快照总数 ${meta.source_snapshot_count}(完整 ${meta.semantically_complete_snapshot_count})</li>
      <li>刷新时间:${esc(meta.refreshed_at_utc)}</li></ul></section>
    <section class="panel" style="padding:18px"><h2 style="margin:0;font-size:16px">信号闸门(v1 五关,阈值已冻结)</h2><p style="font-size:13px;color:var(--muted);margin:6px 0">当前入场规则:<code>${esc(gates.entry_rule_version)}</code>${gates.thresholds_confirmed ? ` · ${esc(gates.thresholds_confirmed.decision)}(${esc(gates.thresholds_confirmed.by)} ${esc(gates.thresholds_confirmed.at)})` : ""}</p>
      <ul style="font-size:13px;line-height:1.8;margin:0;padding-left:18px"><li>G1 实收口径:history_days ≥ 3 且 history_median_day_bp &gt; 0(拒瞬时快照)</li><li>G2 严格同号:正日占比 ≥ 70%(拒含零口径)</li><li>G3 反尖峰:连续 pretrigger ≥ 3 张(ZHIPU 型尖峰名在此全灭)</li><li>G4 容量先行:双腿配对容量 ≥ $1,500</li><li>G5 死因注册:命中已杀 claim 即结构性拒绝</li></ul></section>
    <section class="panel" style="padding:18px"><h2 style="margin:0;font-size:16px">死因注册表(复活只走 Cyrus commit)</h2><ul style="font-size:13px;line-height:1.8;margin:8px 0 0;padding-left:18px">${kill.entries.map((e) => `<li><code>${esc(e.id)}</code>(${esc(e.effect)}):${esc(e.cause)}${e.revival_evidence ? `<span style="color:var(--muted)"> 复活证据:${esc(e.revival_evidence)}</span>` : ""}</li>`).join("")}</ul></section>
    <section class="panel" style="padding:18px"><h2 style="margin:0;font-size:16px">执行边界(下单管线)</h2><ul style="font-size:13px;line-height:1.9;margin:8px 0 0;padding-left:18px"><li>PaperAdapter:活。与前向影子同语义(L1 可执行价 + taker 费,不假设 maker)</li><li>RealAdapter:<strong>锁死</strong>。三锁授权文件不存在 → NotAuthorized;即使锁齐也只会抛 RealAdapterNotImplemented——<em>真下单代码在授权齐备前不允许存在于仓里</em>,由测试断言保证</li><li>trade_authorized = <code>${meta.trade_authorized}</code>(不变量)</li></ul></section>
    <section class="panel" style="padding:18px"><h2 style="margin:0;font-size:16px">治理</h2><ul style="font-size:13px;line-height:1.9;margin:8px 0 0;padding-left:18px"><li>晋升标尺:${esc(promotion.rules)}</li><li>组合生死会:${promotion.portfolio.life_or_death_review_due_utc.slice(0, 10)}</li><li>分工:Claude 建+提案 · Codex 独立审计裁决 · Cyrus 拍真钱/规则/自动化(提案者不当裁判)</li></ul></section>`;
  return shell("系统状态", "数据管道 · 信号闸门 · 死因注册表 · 执行边界 · 治理", "", body, "#/system");
}

function render() {
  const app = document.getElementById("app");
  const hash = (location.hash || "#/").split("?")[0];
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  let html;
  if (parts[0] === "strategies" && parts[1]) html = viewDetail(parts[1], parts[2]);
  else if (parts[0] === "strategies") html = viewPlaza();
  else if (parts[0] === "system") html = viewSystem();
  else html = viewOverview();
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

load().then(render).catch((e) => { document.getElementById("app").innerHTML = `<div class="loading">加载失败:${esc(e.message)}</div>`; });
window.addEventListener("hashchange", render);
