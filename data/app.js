/* ------------------------------------------------------------------ *
 *  PingCastle Trend - application logic (vanilla JS, zero dependency)
 * ------------------------------------------------------------------ */
"use strict";

/* ============================== helpers ============================== */

var TIP = document.getElementById("tip");

function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function num(n) {
  if (n === null || n === undefined || isNaN(n)) return "0";
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
function sum(arr) { var t = 0; for (var i = 0; i < arr.length; i++) t += (arr[i] || 0); return t; }
function uniq(arr) { return arr.filter(function (v, i, a) { return a.indexOf(v) === i; }); }
function byId(id) { return document.getElementById(id); }

var CATS = [
  { key: "Anomalies", label: "Anomalies", score: "anomaly", desc: "Points de contrôle de sécurité spécifiques" },
  { key: "PrivilegedAccounts", label: "Comptes à privilèges", score: "privileged", desc: "Administrateurs de l'Active Directory" },
  { key: "StaleObjects", label: "Objets obsolètes", score: "stale", desc: "Objets utilisateurs ou ordinateurs" },
  { key: "Trusts", label: "Approbations", score: "trust", desc: "Connexions entre deux Active Directory" }
];
var LV_COLORS = ["var(--l1)", "var(--l2)", "var(--l3)", "var(--l4)", "var(--l5)"];
var PALETTE = ["#7c6cff", "#4f8cff", "#22c55e", "#f97316", "#ef4444", "#38bdf8",
  "#eab308", "#ec4899", "#14b8a6", "#a855f7"];

function lvColor(l) { return (l >= 1 && l <= 5) ? LV_COLORS[l - 1] : "var(--muted)"; }
function scoreColor(v) {
  if (v >= 75) return "var(--l1)";
  if (v >= 50) return "var(--l2)";
  if (v >= 25) return "var(--l3)";
  if (v > 0) return "var(--l5)";
  return "var(--l4)";
}

/* ------------------------------- report maths ------------------------------ */

function totalPoints(r) { return r ? sum(r.rules.map(function (x) { return x.points; })) : 0; }
function catPoints(r, c) {
  if (!r) return 0;
  return sum(r.rules.filter(function (x) { return x.category === c; }).map(function (x) { return x.points; }));
}
function lvPoints(r, l) {
  if (!r) return 0;
  return sum(r.rules.filter(function (x) { return x.level === l; }).map(function (x) { return x.points; }));
}
function lvCount(r, l) {
  if (!r) return 0;
  return r.rules.filter(function (x) { return x.level === l; }).length;
}
function ruleIds(r) { return r ? r.rules.map(function (x) { return x.id; }) : []; }

/** rules present in b but not in a (regressions) */
function newRules(a, b) {
  var prev = ruleIds(a);
  return b.rules.filter(function (x) { return prev.indexOf(x.id) === -1; });
}
/** rules present in a but not in b (remediations) */
function solvedRules(a, b) {
  if (!a) return [];
  var cur = ruleIds(b);
  return a.rules.filter(function (x) { return cur.indexOf(x.id) === -1; });
}
/** every distinct rule ever seen for a set of reports */
function allRules(reports) {
  var seen = {}, out = [];
  reports.forEach(function (r) {
    r.rules.forEach(function (x) { if (!seen[x.id]) { seen[x.id] = 1; out.push(x); } });
  });
  return out.sort(function (a, b) { return (a.level || 9) - (b.level || 9) || a.id.localeCompare(b.id); });
}

/* ============================== components ============================== */

function delta(cur, prev, opts) {
  opts = opts || {};
  if (prev === null || prev === undefined) return '<span class="delta flat">—</span>';
  var d = cur - prev;
  var better = opts.higherIsBetter ? d > 0 : d < 0;
  var cls = d === 0 ? "flat" : (better ? "down" : "up");
  var ico = d === 0
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 12h14"/></svg>'
    : (d > 0
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>');
  return '<span class="delta ' + cls + '">' + ico + (d > 0 ? "+" : "") + num(d) + (opts.unit || "") + "</span>";
}

function kpi(label, value, unitOrFoot, foot) {
  var unit = foot !== undefined ? unitOrFoot : "";
  var f = foot !== undefined ? foot : (unitOrFoot || "");
  return '<div class="card kpi"><div class="label">' + esc(label) + "</div>" +
    '<div class="value">' + value + (unit ? "<small>" + esc(unit) + "</small>" : "") + "</div>" +
    '<div class="foot">' + (f || "&nbsp;") + "</div></div>";
}

function card(title, sub, bodyHtml, tight) {
  return '<div class="card"><header><h3>' + esc(title) + "</h3>" +
    (sub ? '<span class="sub">' + esc(sub) + "</span>" : "") +
    '</header><div class="body' + (tight ? " tight" : "") + '">' + bodyHtml + "</div></div>";
}

/* -------------------------------- tooltip -------------------------------- */

function showTip(evt, html) {
  TIP.innerHTML = html;
  TIP.classList.add("on");
  var w = TIP.offsetWidth, h = TIP.offsetHeight;
  var x = evt.clientX + 14, y = evt.clientY - h / 2;
  if (x + w > window.innerWidth - 8) x = evt.clientX - w - 14;
  if (y < 8) y = 8;
  if (y + h > window.innerHeight - 8) y = window.innerHeight - h - 8;
  TIP.style.left = x + "px";
  TIP.style.top = y + "px";
}
function hideTip() { TIP.classList.remove("on"); }

/* ------------------------------- line chart ------------------------------- */

var CHARTS = [];

/** Axe lisible : pas de 1/2/5 x 10^n, bornes arrondies sur ce pas. */
function niceScale(mn, mx, ticks) {
  if (mx <= mn) mx = mn + 1;
  var raw = (mx - mn) / ticks;
  var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
  var norm = raw / mag;
  var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  var lo = Math.floor(mn / step) * step;
  var hi = Math.ceil(mx / step) * step;
  return { lo: lo, hi: hi, step: step, n: Math.round((hi - lo) / step) };
}
function axisLabel(v, step) {
  if (Math.abs(v) >= 10000) return Math.round(v / 1000) + "k";
  if (step >= 1) return String(Math.round(v));
  return String(Math.round(v * 100) / 100);
}

function mountChart(host, drawFn) {
  var lastW = -1;
  var render = function () {
    var w = host.clientWidth;
    if (w < 40 || Math.abs(w - lastW) < 2) return;
    lastW = w;
    host.innerHTML = drawFn(w);
  };
  // redessin forcé (changement de thème)
  CHARTS.push(function () { lastW = -1; render(); });
  // le conteneur peut avoir une largeur nulle au premier passage (onglet masqué,
  // fenêtre étroite, impression) : on redessine dès qu'il obtient une largeur.
  if (window.ResizeObserver) { new ResizeObserver(render).observe(host); }
  render();
}

/**
 * cfg: { labels:[], series:[{name,color,values:[],step:bool}], height, min, max,
 *        area:bool, integer:bool, suffix:'' }
 */
function lineChart(host, cfg) {
  var H = cfg.height || 230;
  mountChart(host, function (W) {
    var m = { t: 14, r: 14, b: 30, l: 42 };
    var iw = Math.max(20, W - m.l - m.r), ih = H - m.t - m.b;
    var flat = [];
    cfg.series.forEach(function (s) {
      s.values.forEach(function (v) { if (v !== null && v !== undefined) flat.push(v); });
    });
    var sc;
    if (cfg.min !== undefined && cfg.max !== undefined) {
      var span = cfg.max - cfg.min;
      var k = span <= 6 ? span : 4;
      sc = { lo: cfg.min, hi: cfg.max, step: span / k, n: k };
    } else {
      var dmn = cfg.min !== undefined ? cfg.min : Math.min.apply(null, flat.concat([0]));
      var dmx = cfg.max !== undefined ? cfg.max : Math.max.apply(null, flat.concat([1]));
      sc = niceScale(dmn, dmx, 4);
    }

    var n = cfg.labels.length;
    var X = function (i) { return n === 1 ? m.l + iw / 2 : m.l + (i * iw) / (n - 1); };
    var Y = function (v) { return m.t + ih - ((v - sc.lo) / (sc.hi - sc.lo)) * ih; };

    var g = "";
    for (var t = 0; t <= sc.n; t++) {
      var val = sc.lo + sc.step * t;
      var y = Y(val);
      g += '<line x1="' + m.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - m.r) + '" y2="' + y.toFixed(1) +
        '" stroke="var(--grid)" stroke-width="1"/>';
      g += '<text x="' + (m.l - 8) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--muted)">' +
        axisLabel(val, sc.step) + "</text>";
    }

    var every = Math.ceil(n / Math.max(2, Math.floor(iw / 78)));
    var xl = "";
    for (var i = 0; i < n; i++) {
      if (i % every !== 0 && i !== n - 1) continue;
      xl += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" font-size="10" fill="var(--muted)">' +
        esc(cfg.labels[i]) + "</text>";
    }

    var paths = "", dots = "";
    cfg.series.forEach(function (s, si) {
      var d = "", started = false, prevPt = null;
      s.values.forEach(function (v, i) {
        if (v === null || v === undefined) { started = false; prevPt = null; return; }
        var x = X(i), y = Y(v);
        if (!started) { d += "M " + x.toFixed(1) + " " + y.toFixed(1); started = true; }
        else if (s.step && prevPt) { d += " L " + x.toFixed(1) + " " + prevPt[1].toFixed(1) + " L " + x.toFixed(1) + " " + y.toFixed(1); }
        else { d += " L " + x.toFixed(1) + " " + y.toFixed(1); }
        prevPt = [x, y];
        dots += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3" fill="var(--surface)" stroke="' +
          s.color + '" stroke-width="2" class="pt s' + si + '"/>';
      });
      if (cfg.area && cfg.series.length === 1 && d) {
        var first = null, last = null;
        s.values.forEach(function (v, i) { if (v !== null && v !== undefined) { if (first === null) first = i; last = i; } });
        paths += '<path d="' + d + " L " + X(last).toFixed(1) + " " + Y(sc.lo).toFixed(1) +
          " L " + X(first).toFixed(1) + " " + Y(sc.lo).toFixed(1) + ' Z" fill="' + s.color + '" opacity=".12"/>';
      }
      paths += '<path d="' + d + '" fill="none" stroke="' + s.color +
        '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    });

    var guide = '<line id="gd" x1="0" y1="' + m.t + '" x2="0" y2="' + (m.t + ih) +
      '" stroke="var(--accent)" stroke-width="1" opacity="0" stroke-dasharray="3 3"/>';
    var hit = '<rect x="' + m.l + '" y="' + m.t + '" width="' + iw + '" height="' + ih +
      '" fill="transparent" class="hit"/>';

    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" height="' + H + '">' + g + guide + paths + dots + xl + hit + "</svg>";
    setTimeout(function () { bindLine(host, cfg, X, m, iw, n); }, 0);
    return svg;
  });

  if (cfg.series.length > 1) {
    var lg = document.createElement("div");
    lg.className = "legend";
    lg.innerHTML = cfg.series.map(function (s, i) {
      return '<span data-i="' + i + '"><i style="background:' + s.color + '"></i>' + esc(s.name) + "</span>";
    }).join("");
    host.parentNode.insertBefore(lg, host.nextSibling);
    lg.addEventListener("click", function (e) {
      var sp = e.target.closest("span[data-i]");
      if (!sp) return;
      var i = +sp.dataset.i;
      var paths = host.querySelectorAll("svg > path");
      sp.classList.toggle("off");
      var off = sp.classList.contains("off");
      if (paths[i]) paths[i].style.display = off ? "none" : "";
      host.querySelectorAll(".pt.s" + i).forEach(function (c) { c.style.display = off ? "none" : ""; });
    });
  }
}

function bindLine(host, cfg, X, m, iw, n) {
  var svg = host.querySelector("svg");
  if (!svg) return;
  var hit = svg.querySelector(".hit"), gd = svg.querySelector("#gd");
  if (!hit) return;
  hit.addEventListener("mousemove", function (e) {
    var box = svg.getBoundingClientRect();
    var scale = box.width / svg.viewBox.baseVal.width;
    var px = (e.clientX - box.left) / scale;
    var best = 0, bd = Infinity;
    for (var i = 0; i < n; i++) { var d = Math.abs(X(i) - px); if (d < bd) { bd = d; best = i; } }
    gd.setAttribute("x1", X(best)); gd.setAttribute("x2", X(best)); gd.setAttribute("opacity", ".8");
    var rows = cfg.series.map(function (s) {
      var v = s.values[best];
      return '<div class="r"><i style="background:' + s.color + '"></i>' + esc(s.name) +
        "<b>" + (v === null || v === undefined ? "—" : num(v) + (cfg.suffix || "")) + "</b></div>";
    }).join("");
    showTip(e, '<div class="t">' + esc(cfg.labels[best]) + "</div>" + rows);
  });
  hit.addEventListener("mouseleave", function () { gd.setAttribute("opacity", "0"); hideTip(); });
}

/* -------------------------------- bar chart ------------------------------- */

function barChart(host, cfg) {
  var H = cfg.height || 190;
  mountChart(host, function (W) {
    var m = { t: 16, r: 10, b: 26, l: 38 };
    var iw = Math.max(20, W - m.l - m.r), ih = H - m.t - m.b;
    var sc = niceScale(0, Math.max.apply(null, cfg.items.map(function (d) { return d.value; }).concat([1])), 3);
    var n = cfg.items.length;
    var bw = Math.min(64, (iw / n) * 0.55);
    var s = "";
    for (var t = 0; t <= sc.n; t++) {
      var val = sc.lo + sc.step * t;
      var y = m.t + ih - ((val - sc.lo) / (sc.hi - sc.lo)) * ih;
      s += '<line x1="' + m.l + '" y1="' + y.toFixed(1) + '" x2="' + (W - m.r) + '" y2="' + y.toFixed(1) + '" stroke="var(--grid)"/>';
      s += '<text x="' + (m.l - 7) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--muted)">' +
        axisLabel(val, sc.step) + "</text>";
    }
    cfg.items.forEach(function (d, i) {
      var cx = m.l + (iw / n) * (i + 0.5);
      var h = Math.max(1, (d.value / sc.hi) * ih);
      s += '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + (m.t + ih - h).toFixed(1) + '" width="' + bw.toFixed(1) +
        '" height="' + h.toFixed(1) + '" rx="4" fill="' + (d.color || "var(--accent)") + '" opacity=".92"/>';
      s += '<text x="' + cx.toFixed(1) + '" y="' + (m.t + ih - h - 5).toFixed(1) +
        '" text-anchor="middle" font-size="11" font-weight="650" fill="var(--text)">' + num(d.value) + "</text>";
      s += '<text x="' + cx.toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle" font-size="10.5" fill="var(--muted)">' +
        esc(d.name) + "</text>";
    });
    return '<svg viewBox="0 0 ' + W + " " + H + '" height="' + H + '">' + s + "</svg>";
  });
}

/* --------------------------------- donut --------------------------------- */

function donut(host, segments, centerLabel) {
  var H = 210;
  var data = segments.filter(function (s) { return s.value > 0; });
  var tot = sum(data.map(function (s) { return s.value; }));
  mountChart(host, function (W) {
    var cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 26, sw = 22, C = 2 * Math.PI * r;
    var s = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="var(--surface-3)" stroke-width="' + sw + '"/>';
    var off = 0;
    data.forEach(function (d, i) {
      var frac = d.value / tot, len = frac * C;
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + d.color +
        '" stroke-width="' + sw + '" stroke-dasharray="' + len.toFixed(2) + " " + (C - len).toFixed(2) +
        '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 ' + cx + " " + cy +
        ')" data-i="' + i + '" class="seg" style="cursor:pointer"/>';
      off += len;
    });
    s += '<text x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle" font-size="24" font-weight="680" fill="var(--text)">' +
      num(tot) + "</text>";
    s += '<text x="' + cx + '" y="' + (cy + 16) + '" text-anchor="middle" font-size="11" fill="var(--muted)">' +
      esc(centerLabel || "") + "</text>";
    setTimeout(function () {
      host.querySelectorAll(".seg").forEach(function (c) {
        c.addEventListener("mousemove", function (e) {
          var d = data[+c.dataset.i];
          showTip(e, '<div class="t">' + esc(d.name) + '</div><div class="r"><i style="background:' + d.color +
            '"></i>' + num(d.value) + "<b>" + Math.round((d.value / tot) * 100) + "%</b></div>");
        });
        c.addEventListener("mouseleave", hideTip);
      });
    }, 0);
    return '<svg viewBox="0 0 ' + W + " " + H + '" height="' + H + '">' + s + "</svg>";
  });
  var lg = document.createElement("div");
  lg.className = "legend";
  lg.style.justifyContent = "center";
  lg.innerHTML = data.map(function (d) {
    return "<span><i style=\"background:" + d.color + '"></i>' + esc(d.name) + " · " + num(d.value) + "</span>";
  }).join("");
  host.parentNode.insertBefore(lg, host.nextSibling);
}

/* --------------------------------- gauge --------------------------------- */

function gauge(host, value, label, desc) {
  var H = 128;
  mountChart(host, function (W) {
    var cx = W / 2, cy = H - 16, r = Math.min(W / 2 - 14, 76), sw = 13;
    var col = scoreColor(value);
    var arc = function (a0, a1) {
      var p = function (a) { var t = (a * Math.PI) / 180; return [cx + r * Math.cos(t), cy + r * Math.sin(t)]; };
      var A = p(a0), B = p(a1);
      return "M " + A[0].toFixed(1) + " " + A[1].toFixed(1) + " A " + r + " " + r + " 0 " +
        (Math.abs(a1 - a0) > 180 ? 1 : 0) + " 1 " + B[0].toFixed(1) + " " + B[1].toFixed(1);
    };
    var end = 180 + (Math.max(0, Math.min(100, value)) / 100) * 180;
    var s = '<path d="' + arc(180, 360) + '" fill="none" stroke="var(--surface-3)" stroke-width="' + sw + '" stroke-linecap="round"/>';
    if (value > 0) s += '<path d="' + arc(180, end) + '" fill="none" stroke="' + col + '" stroke-width="' + sw + '" stroke-linecap="round"/>';
    s += '<text x="' + (cx - r + 2) + '" y="' + (cy + 15) + '" font-size="9.5" fill="var(--muted)">0</text>';
    s += '<text x="' + (cx + r - 2) + '" y="' + (cy + 15) + '" font-size="9.5" fill="var(--muted)" text-anchor="end">100</text>';
    return '<svg viewBox="0 0 ' + W + " " + H + '" height="' + H + '">' + s + "</svg>" +
      '<div class="gauge"><div class="g-val" style="color:' + col + '">' + num(value) + "</div>" +
      '<div class="g-lab">' + esc(label) + "</div>" +
      (desc ? '<div class="g-sub">' + esc(desc) + "</div>" : "") + "</div>";
  });
}

/* --------------------------------- table --------------------------------- */

var TBL_SEQ = 0;

/**
 * cfg: { columns:[{key,label,cls,render(row),sort(row),width}], rows:[],
 *        search:bool, pageSize:n, sort:[key,dir], rowClass(row), empty:'' }
 */
function tableView(cfg) {
  var id = "tb" + (++TBL_SEQ);
  var state = { q: "", sort: cfg.sort ? cfg.sort[0] : null, dir: cfg.sort ? cfg.sort[1] : 1, page: 0 };
  var ps = cfg.pageSize || 0;

  function val(row, c) {
    if (c.sort) return c.sort(row);
    var v = row[c.key];
    return v === null || v === undefined ? "" : v;
  }
  function txt(row, c) {
    if (c.render) return c.render(row);
    var v = row[c.key];
    return v === null || v === undefined ? '<span style="color:var(--muted)">—</span>' : esc(v);
  }
  function filtered() {
    var rows = cfg.rows.slice();
    if (state.q) {
      var q = state.q.toLowerCase();
      rows = rows.filter(function (r) {
        return cfg.columns.some(function (c) { return String(val(r, c)).toLowerCase().indexOf(q) !== -1; });
      });
    }
    if (state.sort) {
      var col = cfg.columns.filter(function (c) { return c.key === state.sort; })[0];
      if (col) rows.sort(function (a, b) {
        var x = val(a, col), y = val(b, col);
        if (typeof x === "number" && typeof y === "number") return (x - y) * state.dir;
        return String(x).localeCompare(String(y), "fr", { numeric: true }) * state.dir;
      });
    }
    return rows;
  }
  function draw() {
    var host = byId(id);
    if (!host) return;
    var rows = filtered();
    var total = rows.length;
    if (ps) rows = rows.slice(state.page * ps, state.page * ps + ps);
    var head = cfg.columns.map(function (c) {
      var srt = state.sort === c.key;
      return '<th class="' + (c.cls || "") + (srt ? " sorted" : "") + '" data-k="' + esc(c.key) + '"' +
        (c.width ? ' style="width:' + c.width + '"' : "") + ">" + esc(c.label) +
        '<span class="arw">' + (srt ? (state.dir === 1 ? "▲" : "▼") : "▼") + "</span></th>";
    }).join("");
    var body = rows.map(function (r) {
      return '<tr class="' + (cfg.rowClass ? cfg.rowClass(r) : "") + '">' + cfg.columns.map(function (c) {
        return '<td class="' + (c.cls || "") + '">' + txt(r, c) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    host.querySelector(".tbl-wrap").innerHTML = total === 0
      ? '<div class="empty">' + esc(cfg.empty || "Aucune donnée") + "</div>"
      : "<table><thead><tr>" + head + "</tr></thead><tbody>" + body + "</tbody></table>";
    var pg = host.querySelector(".pager");
    if (pg) {
      var pages = Math.max(1, Math.ceil(total / ps));
      pg.innerHTML = total > ps
        ? "<span>" + (state.page * ps + 1) + "–" + Math.min(total, (state.page + 1) * ps) + " sur " + total + "</span>" +
        '<button data-d="-1"' + (state.page === 0 ? " disabled" : "") + ">‹</button>" +
        '<button data-d="1"' + (state.page >= pages - 1 ? " disabled" : "") + ">›</button>"
        : total ? "<span>" + total + " ligne(s)</span>" : "";
    }
    host.querySelectorAll("thead th").forEach(function (th) {
      th.addEventListener("click", function () {
        var k = th.dataset.k;
        if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = 1; }
        state.page = 0; draw();
      });
    });
    if (pg) pg.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () { state.page += +b.dataset.d; draw(); });
    });
  }
  setTimeout(function () {
    var host = byId(id);
    if (!host) return;
    var inp = host.querySelector("input");
    if (inp) inp.addEventListener("input", function () { state.q = inp.value; state.page = 0; draw(); });
    draw();
  }, 0);

  return '<div id="' + id + '">' +
    (cfg.search !== false && cfg.rows.length > 8
      ? '<div class="tbl-tools"><label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input placeholder="Filtrer…"></label>' +
      (cfg.tools || "") + "</div>"
      : (cfg.tools ? '<div class="tbl-tools">' + cfg.tools + "</div>" : "")) +
    '<div class="tbl-wrap"></div>' + (ps ? '<div class="pager"></div>' : "") + "</div>";
}

/* ------------------------- shared column definitions ------------------------ */

var COL_LEVEL = {
  key: "level", label: "Crit.", width: "72px",
  sort: function (r) { return r.level || 9; },
  render: function (r) {
    return r.level ? '<span class="chip lv' + r.level + '">N' + r.level + "</span>"
      : '<span class="chip">?</span>';
  }
};
var COL_ID = { key: "id", label: "RiskId", cls: "rid" };
var COL_CAT = {
  key: "category", label: "Catégorie",
  render: function (r) { return esc(catLabel(r.category)); }
};
var COL_MODEL = { key: "model", label: "Modèle" };
var COL_PTS = { key: "points", label: "Pts", cls: "num", width: "62px" };
var COL_RAT = { key: "rationale", label: "Justification", cls: "rat" };

function catLabel(k) {
  var c = CATS.filter(function (x) { return x.key === k; })[0];
  return c ? c.label : k;
}

/* ============================== views ============================== */

function chartCard(title, sub, mount) {
  var id = "ch" + (++TBL_SEQ);
  setTimeout(function () { var h = byId(id); if (h) mount(h); }, 0);
  return card(title, sub, '<div class="chart" id="' + id + '"></div>');
}

/* --------------------------- domain overview ---------------------------- */

function viewDomain(d) {
  var reports = d.reports;
  var last = reports[reports.length - 1];
  var prev = reports.length > 1 ? reports[reports.length - 2] : null;
  var first = reports[0];
  var labels = reports.map(function (r) { return r.label; });
  var html = "";

  /* ---- KPI ---- */
  var tp = totalPoints(last), tpPrev = prev ? totalPoints(prev) : null;
  var solvedAll = solvedRules(first, last);
  var newSince = newRules(prev, last);
  html += '<div class="grid g6">' +
    kpi("Score global", '<span style="color:' + scoreColor(last.scores.global) + '">' + last.scores.global + "</span>", "/100",
      prev ? delta(last.scores.global, prev.scores.global) + " vs précédent" : "premier rapport") +
    kpi("Points cumulés", num(tp), "pts", prev ? delta(tp, tpPrev) + " vs précédent" : "premier rapport") +
    kpi("Maturité", '<span style="color:' + lvColor(last.maturity) + '">' + (last.maturity || "—") + "</span>", "/5",
      prev ? delta(last.maturity, prev.maturity, { higherIsBetter: true }) + " vs précédent" : "niveau ANSSI") +
    kpi("Règles déclenchées", num(last.rules.length),
      prev ? delta(last.rules.length, prev.rules.length) + " vs précédent" : "&nbsp;") +
    kpi("Résolues au total", '<span style="color:var(--good)">' + num(solvedAll.length) + "</span>",
      "depuis le " + first.label) +
    kpi("Nouvelles règles", '<span style="color:' + (newSince.length ? "var(--bad)" : "var(--muted)") + '">' + num(newSince.length) + "</span>",
      prev ? "depuis le " + prev.label : "premier rapport") +
    "</div>";

  /* ---- trend ---- */
  html += '<div class="section-title">Tendances</div>';
  html += chartCard("Total de points (non plafonné)", "Somme des 4 catégories · plus bas = mieux", function (h) {
    lineChart(h, {
      labels: labels, area: true, height: 250,
      series: [{ name: "Points", color: "var(--accent)", values: reports.map(totalPoints) }],
      suffix: " pts"
    });
  });

  html += '<div class="grid g2" style="margin-top:16px">';
  html += chartCard("Niveau de maturité ANSSI", "plus haut = mieux", function (h) {
    lineChart(h, {
      labels: labels, min: 0, max: 5, height: 230,
      series: [{ name: "Maturité", color: "var(--l4)", step: true, values: reports.map(function (r) { return r.maturity; }) }]
    });
  });
  html += chartCard("Règles déclenchées par criticité", "nombre de règles", function (h) {
    lineChart(h, {
      labels: labels, height: 230,
      series: [1, 2, 3, 4, 5].map(function (l) {
        return { name: "Niveau " + l, color: LV_COLORS[l - 1], values: reports.map(function (r) { return lvCount(r, l); }) };
      })
    });
  });
  html += "</div>";

  html += '<div class="section-title">Évolution par catégorie</div><div class="grid g2">';
  CATS.forEach(function (c) {
    html += chartCard(c.label, c.desc, function (h) {
      lineChart(h, {
        labels: labels, area: true, height: 200,
        series: [{ name: "Points", color: "var(--accent)", values: reports.map(function (r) { return catPoints(r, c.key); }) }],
        suffix: " pts"
      });
    });
  });
  html += "</div>";

  /* ---- score table ---- */
  html += '<div class="section-title">Historique</div>';
  var scoreRows = reports.map(function (r) {
    var row = { date: r.label, maturity: r.maturity, global: r.scores.global, total: totalPoints(r), rules: r.rules.length };
    CATS.forEach(function (c) { row[c.key] = catPoints(r, c.key); });
    return row;
  });
  var scoreCols = [
    { key: "date", label: "Date" },
    {
      key: "maturity", label: "Maturité", cls: "num", width: "84px",
      render: function (r) { return '<span class="chip lv' + (r.maturity || 5) + '">' + (r.maturity || "—") + "</span>"; }
    },
    {
      key: "global", label: "Score global", cls: "num",
      render: function (r) { return '<b style="color:' + scoreColor(r.global) + '">' + r.global + "</b>"; }
    },
    { key: "total", label: "Total pts", cls: "num", render: function (r) { return "<b>" + num(r.total) + "</b>"; } },
    { key: "rules", label: "Règles", cls: "num" }
  ].concat(CATS.map(function (c) {
    return {
      key: c.key, label: c.label, cls: "num",
      render: function (r) { return num(r[c.key]); }
    };
  }));
  html += card("Scores et maturité par rapport", reports.length + " rapport(s)",
    tableView({ columns: scoreCols, rows: scoreRows, sort: ["date", -1], search: false }));

  /* ---- evolution matrix ---- */
  var every = allRules(reports);
  var matRows = every.map(function (rule) {
    var row = { id: rule.id, level: rule.level, category: rule.category, model: rule.model, _last: 0 };
    reports.forEach(function (r, i) {
      var f = r.rules.filter(function (x) { return x.id === rule.id; })[0];
      row["d" + i] = f ? f.points : null;
      if (f) row._last = i;
    });
    row._open = row["d" + (reports.length - 1)] !== null;
    return row;
  });
  var matCols = [COL_LEVEL, COL_ID, COL_CAT].concat(reports.map(function (r, i) {
    return {
      key: "d" + i, label: r.label, cls: "num",
      sort: function (row) { return row["d" + i] === null ? -1 : row["d" + i]; },
      render: function (row) {
        var v = row["d" + i];
        if (v === null) return '<span class="hm" style="background:var(--surface-3);color:var(--muted)">·</span>';
        return '<span class="hm" style="background:' + heat(v) + ';color:#fff">' + v + "</span>";
      }
    };
  }));
  html += '<div style="margin-top:16px"></div>';
  html += card("Évolution des règles de risque", "points par rapport · les lignes grisées sont résolues",
    tableView({
      columns: matCols, rows: matRows, sort: ["level", 1], pageSize: 25,
      rowClass: function (r) { return r._open ? "" : "dim"; },
      empty: "Aucune règle"
    }));

  /* ---- remediation ---- */
  var solvedRows = solvedAll.map(function (r) {
    var lastSeen = "";
    for (var i = reports.length - 1; i >= 0; i--) {
      if (ruleIds(reports[i]).indexOf(r.id) !== -1) { lastSeen = reports[i].label; break; }
    }
    return { id: r.id, level: r.level, category: r.category, model: r.model, points: r.points, seen: lastSeen };
  });
  html += '<div style="margin-top:16px"></div>';
  html += card("Règles résolues depuis le premier rapport", first.label + " → " + last.label,
    tableView({
      columns: [COL_LEVEL, COL_ID, COL_CAT, COL_MODEL,
      { key: "points", label: "Pts évités", cls: "num" },
      { key: "seen", label: "Dernière apparition" }],
      rows: solvedRows, sort: ["level", 1], pageSize: 15,
      empty: "Aucune règle résolue sur la période"
    }));

  return html;
}

function heat(v) {
  if (v >= 30) return "var(--l1)";
  if (v >= 15) return "var(--l2)";
  if (v >= 5) return "var(--l3)";
  return "var(--l4)";
}

/* --------------------------- snapshot (one report) ---------------------- */

function viewReport(d, idx) {
  var reports = d.reports;
  var r = reports[idx];
  var prev = idx > 0 ? reports[idx - 1] : null;
  var first = reports[0];
  var html = "";

  /* timeline */
  html += '<div class="timeline">' + reports.map(function (x, i) {
    return '<div class="tl-item' + (i === idx ? " active" : "") + '" data-go="#/d/' + d.i + "/r/" + i + '">' +
      '<div class="d">' + esc(x.label) + "</div>" +
      '<div class="p"><span style="color:' + scoreColor(x.scores.global) + ';font-weight:700">' + x.scores.global +
      "</span> · " + num(totalPoints(x)) + " pts</div></div>";
  }).join("") + "</div>";

  /* header cards */
  var tp = totalPoints(r);
  html += '<div class="grid g3">';
  html += card("Informations du rapport", null,
    '<dl class="kv">' +
    "<dt>Version PingCastle</dt><dd>" + esc(r.version || "—") + "</dd>" +
    "<dt>Généré le</dt><dd>" + esc(r.dateLong || r.label) + "</dd>" +
    "<dt>Âge du rapport</dt><dd>" + num(r.age) + " jour(s)</dd>" +
    "<dt>Contrôleurs de domaine</dt><dd>" + (r.dcCount === null ? "—" : num(r.dcCount)) + "</dd>" +
    "<dt>Niveau fonctionnel domaine</dt><dd>" + esc(r.domainMode || "—") + "</dd>" +
    "<dt>Niveau fonctionnel forêt</dt><dd>" + esc(r.forestMode || "—") + "</dd>" +
    '<dt>Maturité ANSSI</dt><dd><span class="chip lv' + (r.maturity || 5) + '">Niveau ' + (r.maturity || "?") + "</span></dd>" +
    "</dl>");
  html += chartCard("Score global", "le pire des quatre indicateurs", function (h) {
    gauge(h, r.scores.global, "Score global", "0 = aucun risque détecté");
  });
  html += chartCard("Répartition par criticité", "nombre de règles déclenchées", function (h) {
    donut(h, [1, 2, 3, 4, 5].map(function (l) {
      return { name: "Niveau " + l, value: lvCount(r, l), color: LV_COLORS[l - 1] };
    }), "règles");
  });
  html += "</div>";

  /* points per criticity */
  html += '<div class="section-title">Points par niveau de criticité</div><div class="grid g6">';
  html += kpi("Total", num(tp), "pts", prev ? delta(tp, totalPoints(prev)) + " vs " + prev.label : "premier rapport");
  [1, 2, 3, 4, 5].forEach(function (l) {
    html += kpi("Niveau " + l, '<span style="color:' + LV_COLORS[l - 1] + '">' + num(lvPoints(r, l)) + "</span>", "pts",
      (prev ? delta(lvPoints(r, l), lvPoints(prev, l)) + " " : "") + lvCount(r, l) + " règle(s)");
  });
  html += "</div>";

  /* gauges */
  html += '<div class="section-title">Scores PingCastle</div><div class="grid g4">';
  CATS.forEach(function (c) {
    html += chartCard(c.label, c.desc, function (h) { gauge(h, r.scores[c.score], c.label, null); });
  });
  html += "</div>";

  /* comparison */
  html += '<div class="section-title">Comparaison avec les rapports précédents</div>';
  html += '<p class="note">Score non plafonné par catégorie. Il peut différer du score PingCastle (limité à 100) car certaines règles peuvent être exclues via <code>exceptions.csv</code>.</p>';
  html += '<div class="grid g4">';
  CATS.forEach(function (c) {
    html += chartCard(c.label, null, function (h) {
      var items = [];
      if (idx > 1) items.push({ name: "Initial", value: catPoints(first, c.key), color: "var(--surface-3)" });
      if (prev) items.push({ name: "Précédent", value: catPoints(prev, c.key), color: "var(--accent-2)" });
      items.push({ name: "Actuel", value: catPoints(r, c.key), color: "var(--accent)" });
      barChart(h, { items: items, height: 190 });
    });
  });
  html += "</div>";

  /* solved / new */
  var solved = solvedRules(prev, r), added = prev ? newRules(prev, r) : [];
  html += '<div class="section-title">Améliorations et régressions' +
    (prev ? " · depuis le " + prev.label : "") + "</div>";
  html += '<div class="split">';
  html += card("✓ Règles résolues", solved.length + " règle(s)",
    tableView({
      columns: [COL_LEVEL, COL_ID, COL_CAT, { key: "points", label: "Pts évités", cls: "num" }],
      rows: solved, sort: ["level", 1], search: false, pageSize: 10,
      empty: prev ? "Aucune règle résolue" : "Pas de rapport précédent"
    }));
  html += card("⚠ Nouvelles règles", added.length + " règle(s)",
    tableView({
      columns: [COL_LEVEL, COL_ID, COL_CAT, COL_PTS],
      rows: added, sort: ["level", 1], search: false, pageSize: 10,
      empty: prev ? "Aucune nouvelle règle" : "Pas de rapport précédent"
    }));
  html += "</div>";

  /* per model */
  var models = uniq(r.rules.map(function (x) { return x.model; })).map(function (m) {
    var set = r.rules.filter(function (x) { return x.model === m; });
    return { model: m, category: set[0].category, points: sum(set.map(function (x) { return x.points; })), count: set.length };
  }).filter(function (x) { return x.points > 0; }).sort(function (a, b) { return b.points - a.points; });

  html += '<div class="section-title">Répartition par modèle de règle</div><div class="split">';
  var mx = models.length ? models[0].points : 1;
  html += card("Points par modèle", models.length + " modèle(s)",
    models.length ? models.map(function (m, i) {
      return '<div class="bar-row"><span class="nm" title="' + esc(m.model) + '">' + esc(m.model) + "</span>" +
        '<span class="tr"><span class="fl" style="width:' + ((m.points / mx) * 100).toFixed(1) +
        "%;background:" + PALETTE[i % PALETTE.length] + '"></span></span>' +
        '<span class="vl">' + num(m.points) + "</span></div>";
    }).join("") : '<div class="empty">Aucune règle déclenchée</div>');
  html += chartCard("Distribution", "part des points par modèle", function (h) {
    donut(h, models.slice(0, 8).map(function (m, i) {
      return { name: m.model, value: m.points, color: PALETTE[i % PALETTE.length] };
    }), "pts");
  });
  html += "</div>";

  /* all rules */
  html += '<div class="section-title">Détail des règles</div>';
  html += card("Règles de risque déclenchées", r.rules.length + " règle(s) · " + num(tp) + " points",
    tableView({
      columns: [COL_LEVEL, COL_ID, COL_CAT, COL_MODEL, COL_PTS, COL_RAT],
      rows: r.rules, sort: ["points", -1], pageSize: 25, empty: "Aucune règle déclenchée"
    }));

  if (r.ignored && r.ignored.length) {
    html += '<div style="margin-top:16px"></div>';
    html += card("Règles ignorées", "exclues des scores via exceptions.csv",
      tableView({
        columns: [COL_LEVEL, COL_ID, COL_CAT, COL_MODEL, COL_PTS, COL_RAT],
        rows: r.ignored, sort: ["points", -1], search: false
      }));
  }
  return html;
}

/* ------------------------------ global view ----------------------------- */

function viewGlobal() {
  var ds = PCD.domains;
  var months = uniq([].concat.apply([], ds.map(function (d) {
    return d.reports.map(function (r) { return r.month; });
  }))).sort();

  /* one value per (domain, month): latest report of that month */
  function series(d, fn) {
    return months.map(function (m) {
      var inMonth = d.reports.filter(function (r) { return r.month === m; });
      return inMonth.length ? fn(inMonth[inMonth.length - 1]) : null;
    });
  }
  var lasts = ds.map(function (d) { return d.reports[d.reports.length - 1]; });
  var html = "";

  var allPts = sum(lasts.map(totalPoints));
  var worst = ds[0], wv = -1;
  ds.forEach(function (d, i) { var v = lasts[i].scores.global; if (v > wv) { wv = v; worst = d; } });
  var stale = lasts.filter(function (r) { return r.age > 90; }).length;

  html += '<div class="grid g4">' +
    kpi("Domaines suivis", num(ds.length), sum(ds.map(function (d) { return d.reports.length; })) + " rapport(s) analysé(s)") +
    kpi("Points cumulés", num(allPts), "pts", "sur le dernier rapport de chaque domaine") +
    kpi("Domaine le plus exposé", '<span style="font-size:19px;color:' + scoreColor(wv) + '">' + esc(worst.name) + "</span>",
      "score global " + wv + "/100") +
    kpi("Rapports périmés", '<span style="color:' + (stale ? "var(--l2)" : "var(--good)") + '">' + num(stale) + "</span>",
      "de plus de 90 jours") +
    "</div>";

  html += '<div class="section-title">Comparaison des domaines</div>';
  html += chartCard("Total de points par domaine", "dernier rapport de chaque mois · plus bas = mieux", function (h) {
    lineChart(h, {
      labels: months, height: 260, suffix: " pts",
      series: ds.map(function (d, i) {
        return { name: d.name, color: PALETTE[i % PALETTE.length], values: series(d, totalPoints) };
      })
    });
  });

  html += '<div class="grid g2" style="margin-top:16px">';
  html += chartCard("Niveau de maturité", "plus haut = mieux", function (h) {
    lineChart(h, {
      labels: months, min: 0, max: 5, height: 230,
      series: ds.map(function (d, i) {
        return { name: d.name, color: PALETTE[i % PALETTE.length], step: true, values: series(d, function (r) { return r.maturity; }) };
      })
    });
  });
  html += chartCard("Règles déclenchées", "nombre de règles", function (h) {
    lineChart(h, {
      labels: months, height: 230,
      series: ds.map(function (d, i) {
        return { name: d.name, color: PALETTE[i % PALETTE.length], values: series(d, function (r) { return r.rules.length; }) };
      })
    });
  });
  html += "</div>";

  html += '<div class="section-title">Évolution par catégorie</div><div class="grid g2">';
  CATS.forEach(function (c) {
    html += chartCard(c.label, c.desc, function (h) {
      lineChart(h, {
        labels: months, height: 210, suffix: " pts",
        series: ds.map(function (d, i) {
          return { name: d.name, color: PALETTE[i % PALETTE.length], values: series(d, function (r) { return catPoints(r, c.key); }) };
        })
      });
    });
  });
  html += "</div>";

  /* summary table */
  html += '<div class="section-title">Synthèse</div>';
  var rows = ds.map(function (d, i) {
    var r = lasts[i];
    var f = d.reports[0];
    var row = {
      domain: d.name, date: r.label, age: r.age, version: r.version, maturity: r.maturity,
      global: r.scores.global, total: totalPoints(r), rules: r.rules.length,
      trend: totalPoints(r) - totalPoints(f), i: d.i
    };
    CATS.forEach(function (c) { row[c.key] = catPoints(r, c.key); });
    return row;
  });
  html += card("Dernier rapport par domaine", null, tableView({
    columns: [
      { key: "domain", label: "Domaine", render: function (r) { return '<a href="#/d/' + r.i + '"><b>' + esc(r.domain) + "</b></a>"; } },
      { key: "date", label: "Date" },
      { key: "age", label: "Âge", cls: "num", render: function (r) { return num(r.age) + " j"; } },
      {
        key: "maturity", label: "Maturité", cls: "num",
        render: function (r) { return '<span class="chip lv' + (r.maturity || 5) + '">' + (r.maturity || "—") + "</span>"; }
      },
      {
        key: "global", label: "Score global", cls: "num",
        render: function (r) { return '<b style="color:' + scoreColor(r.global) + '">' + r.global + "</b>"; }
      },
      { key: "total", label: "Total pts", cls: "num" },
      { key: "rules", label: "Règles", cls: "num" }
    ].concat(CATS.map(function (c) { return { key: c.key, label: c.label, cls: "num" }; }))
      .concat([{
        key: "trend", label: "Depuis l'origine", cls: "num",
        render: function (r) { return delta(r.trend, 0); }
      }]),
    rows: rows, sort: ["global", -1], search: false
  }));

  /* rules matrix across domains */
  var everyRule = allRules(lasts);
  var matRows = everyRule.map(function (rule) {
    var row = { id: rule.id, level: rule.level, category: rule.category, total: 0, hits: 0 };
    ds.forEach(function (d, i) {
      var f = lasts[i].rules.filter(function (x) { return x.id === rule.id; })[0];
      row["x" + i] = f ? f.points : null;
      if (f) { row.total += f.points; row.hits++; }
    });
    return row;
  });
  html += '<div style="margin-top:16px"></div>';
  html += card("Règles de risque par domaine", "points sur le dernier rapport de chaque domaine", tableView({
    columns: [COL_LEVEL, COL_ID, COL_CAT].concat(ds.map(function (d, i) {
      return {
        key: "x" + i, label: d.name.split(".")[0], cls: "num",
        sort: function (row) { return row["x" + i] === null ? -1 : row["x" + i]; },
        render: function (row) {
          var v = row["x" + i];
          if (v === null) return '<span class="hm" style="background:var(--surface-3);color:var(--muted)">·</span>';
          return '<span class="hm" style="background:' + heat(v) + ';color:#fff">' + v + "</span>";
        }
      };
    })).concat([
      { key: "hits", label: "Domaines", cls: "num" },
      { key: "total", label: "Total", cls: "num", render: function (r) { return "<b>" + num(r.total) + "</b>"; } }
    ]),
    rows: matRows, sort: ["total", -1], pageSize: 25
  }));

  return html;
}

/* ============================== router ============================== */

function nav() {
  var multi = PCD.domains.length > 1;
  var h = "";
  if (multi) {
    h += '<div class="nav-label">Vue globale</div>' +
      '<a data-go="#/global" data-r="#/global"><span class="dot"></span>Tous les domaines' +
      '<span class="tail">' + PCD.domains.length + "</span></a>";
  }
  h += '<div class="nav-label">Domaines</div>';
  PCD.domains.forEach(function (d) {
    var last = d.reports[d.reports.length - 1];
    h += '<a data-go="#/d/' + d.i + '" data-r="#/d/' + d.i + '"><span class="dot" style="background:' +
      scoreColor(last.scores.global) + '"></span>' + esc(d.name) +
      '<span class="tail">' + last.scores.global + "</span></a>";
  });
  byId("nav").innerHTML = h;
}

function route() {
  var hash = location.hash || (PCD.domains.length > 1 ? "#/global" : "#/d/0");
  var view = byId("view");
  var crumb = byId("crumb"), title = byId("ptitle");
  var m;

  CHARTS = [];
  hideTip();

  if (hash === "#/global") {
    crumb.textContent = "Vue globale";
    title.textContent = PCD.domains.length + " domaines suivis";
    view.innerHTML = viewGlobal();
  } else if ((m = hash.match(/^#\/d\/(\d+)\/r\/(\d+)$/))) {
    var d = PCD.domains[+m[1]], i = +m[2];
    if (!d || !d.reports[i]) { location.hash = "#/d/0"; return; }
    crumb.textContent = d.name + " › Rapport";
    title.textContent = d.reports[i].label;
    view.innerHTML = viewReport(d, i);
  } else if ((m = hash.match(/^#\/d\/(\d+)$/))) {
    var dd = PCD.domains[+m[1]];
    if (!dd) { location.hash = "#/d/0"; return; }
    crumb.textContent = "Domaine";
    title.textContent = dd.name;
    view.innerHTML = viewDomain(dd) + tabsFooter(dd);
  } else {
    location.hash = PCD.domains.length > 1 ? "#/global" : "#/d/0";
    return;
  }

  document.querySelectorAll("#nav a").forEach(function (a) {
    var r = a.dataset.r;
    a.classList.toggle("active", hash === r || (hash.indexOf(r + "/") === 0));
  });
  window.scrollTo(0, 0);
}

function tabsFooter(d) {
  return '<div class="section-title">Rapports détaillés</div>' +
    '<div class="timeline">' + d.reports.map(function (x, i) {
      return '<div class="tl-item" data-go="#/d/' + d.i + "/r/" + i + '">' +
        '<div class="d">' + esc(x.label) + "</div>" +
        '<div class="p"><span style="color:' + scoreColor(x.scores.global) + ';font-weight:700">' + x.scores.global +
        "</span> · " + num(totalPoints(x)) + " pts</div></div>";
    }).join("") + "</div>";
}

/* ============================== bootstrap ============================== */

(function init() {
  PCD.domains.forEach(function (d, i) {
    d.i = i;
    d.reports.forEach(function (r) { if (!r.ignored) r.ignored = []; });
  });

  byId("sidefoot").innerHTML =
    "Généré le " + esc(PCD.generated) + "<br>" +
    esc(PCD.reportCount) + " rapport(s) · " + esc(PCD.domains.length) + " domaine(s)";

  nav();

  var saved = null;
  try { saved = localStorage.getItem("pcd-theme"); } catch (e) { }
  if (saved) document.documentElement.dataset.theme = saved;
  else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches)
    document.documentElement.dataset.theme = "light";

  byId("theme").addEventListener("click", function () {
    var t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("pcd-theme", t); } catch (e) { }
    CHARTS.forEach(function (f) { f(); });
  });
  byId("printbtn").addEventListener("click", function () { window.print(); });

  document.addEventListener("click", function (e) {
    var go = e.target.closest("[data-go]");
    if (go) { location.hash = go.dataset.go; }
  });

  var rt;
  window.addEventListener("resize", function () {
    clearTimeout(rt);
    rt = setTimeout(function () { CHARTS.forEach(function (f) { f(); }); }, 140);
  });

  window.addEventListener("hashchange", route);
  route();
})();
