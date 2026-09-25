import { ProcessedJob } from './types.js';

interface DashboardMeta {
    fullName: string;
    targetRoles: string[];
}

/** Escape untrusted text (job posts come from the internet) before putting it in HTML. */
function esc(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Only allow http(s) links. Anything else becomes "#". */
function safeUrl(value: string | undefined): string {
    try {
        const u = new URL(String(value));
        return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : '#';
    } catch {
        return '#';
    }
}

/** Days since posting. Handles ISO strings, epoch seconds and epoch milliseconds. */
function daysOld(postedAt: unknown): number | null {
    if (postedAt === undefined || postedAt === null || String(postedAt).trim() === '') {
        return null;
    }
    const raw = String(postedAt).trim();
    const n = Number(raw);
    const ms = Number.isNaN(n) ? Date.parse(raw) : n < 1e12 ? n * 1000 : n;
    if (Number.isNaN(ms)) return null;
    return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000));
}

/**
 * Freshness is based ONLY on the posting date. Applicant counts are not
 * public for these sources, so we do not claim to measure crowding.
 */
function freshness(postedAt: unknown): { label: string; cls: string } {
    const d = daysOld(postedAt);
    if (d === null) return { label: 'Date unknown', cls: 'muted' };
    if (d <= 3) return { label: d === 0 ? 'Fresh: today' : `Fresh: ${d}d ago`, cls: 'hot' };
    if (d <= 10) return { label: `Recent: ${d}d ago`, cls: 'warm' };
    return { label: `Older: ${d}d ago`, cls: 'muted' };
}

function packHtml(job: ProcessedJob, i: number): string {
    const pack = job.applicationPack;
    if (!pack) return '';

    const facts = pack.factsUsed?.length
        ? `<h4>CV facts used</h4><ul>${pack.factsUsed.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`
        : '';
    const tips = pack.cvTips?.length
        ? `<h4>CV tips for this role</h4><ul>${pack.cvTips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`
        : '';

    return `
    <details class="pack">
      <summary>Application pack</summary>
      <h4>Short reply <button class="copy" data-copy="reply-${i}" type="button">Copy</button></h4>
      <textarea id="reply-${i}" readonly rows="4">${esc(pack.reply)}</textarea>
      <h4>Cover letter <button class="copy" data-copy="cover-${i}" type="button">Copy</button></h4>
      <textarea id="cover-${i}" readonly rows="10">${esc(pack.coverLetter)}</textarea>
      ${tips}
      ${facts}
      <p class="note">Draft only. Check every date, title and company before you send.</p>
    </details>`;
}

function matchCard(job: ProcessedJob, i: number): string {
    const fresh = freshness(job.postedAt);
    const reasons = job.fitReasons?.length
        ? `<ul>${job.fitReasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
        : '';

    return `
    <article class="card">
      <div class="row">
        <h3>${esc(job.title)}</h3>
        <span class="badge score">${esc(job.score)}/100</span>
      </div>
      <p class="meta">${esc(job.company)} &middot; ${esc(job.location)} &middot; ${esc(job.source)}</p>
      <p><span class="badge ${fresh.cls}">${esc(fresh.label)}</span>${
          job.verifyManually
              ? ' <span class="badge warm">Social lead: verify manually</span>'
              : ''
      }</p>
      ${reasons}
      <p><a class="btn" href="${esc(safeUrl(job.url))}" target="_blank" rel="noopener noreferrer">View listing</a></p>
      ${packHtml(job, i)}
    </article>`;
}

function scamCard(job: ProcessedJob): string {
    return `
    <article class="card scam">
      <div class="row">
        <h3>${esc(job.title)}</h3>
        <span class="badge danger">Blocked</span>
      </div>
      <p class="meta">${esc(job.company)} &middot; ${esc(job.source)}</p>
      <p><strong>Why:</strong> ${esc(job.scamReason ?? 'Looks like a predatory listing.')}</p>
    </article>`;
}

function rejectedRow(job: ProcessedJob): string {
    return `<li>${esc(job.title)} at ${esc(job.company)} <span class="muted">(${esc(job.score)}/100)</span></li>`;
}

export function renderDashboard(jobs: ProcessedJob[], meta: DashboardMeta): string {
    const matches = jobs
        .filter((j) => j.status === 'MATCHED')
        .sort((a, b) => b.score - a.score);
    const scams = jobs.filter((j) => j.status === 'SCAM');
    const rejected = jobs.filter((j) => j.status === 'REJECTED');
    const generated = new Date().toUTCString();

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WorkDey results for ${esc(meta.fullName)}</title>
<style>
  :root { --bg:#f6f7f9; --card:#fff; --text:#15181d; --muted:#667085; --line:#e3e6eb;
          --accent:#0b7a4b; --danger:#b42318; --warm:#b54708; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0e1116; --card:#171b22; --text:#e8eaee; --muted:#98a2b3; --line:#2a303a;
            --accent:#3ddc97; --danger:#ff7b72; --warm:#f5a524; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text);
         font:16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width:860px; margin:0 auto; padding:24px 16px 48px; }
  h1 { margin:0 0 4px; font-size:28px; }
  h2 { margin:32px 0 12px; font-size:20px; }
  h3 { margin:0; font-size:17px; }
  h4 { margin:16px 0 6px; font-size:14px; display:flex; align-items:center; gap:8px; }
  .sub { color:var(--muted); margin:0 0 16px; }
  .stats { display:flex; gap:12px; flex-wrap:wrap; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:12px 16px; min-width:120px; }
  .stat b { display:block; font-size:24px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; margin-bottom:12px; }
  .card.scam { border-left:4px solid var(--danger); }
  .row { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; }
  .meta { color:var(--muted); margin:4px 0 8px; font-size:14px; }
  .badge { display:inline-block; border-radius:999px; padding:2px 10px; font-size:13px; border:1px solid var(--line); white-space:nowrap; }
  .badge.score { color:var(--accent); border-color:var(--accent); font-weight:600; }
  .badge.hot { color:var(--accent); border-color:var(--accent); }
  .badge.warm { color:var(--warm); border-color:var(--warm); }
  .badge.danger { color:var(--danger); border-color:var(--danger); }
  .muted { color:var(--muted); }
  ul { margin:6px 0; padding-left:20px; }
  .btn { display:inline-block; padding:8px 14px; border-radius:8px; background:var(--accent); color:#fff;
         text-decoration:none; font-weight:600; font-size:14px; }
  @media (prefers-color-scheme: dark) { .btn { color:#06210f; } }
  details.pack { margin-top:8px; border-top:1px solid var(--line); padding-top:8px; }
  summary { cursor:pointer; font-weight:600; }
  textarea { width:100%; background:var(--bg); color:var(--text); border:1px solid var(--line);
             border-radius:8px; padding:10px; font:inherit; font-size:14px; resize:vertical; }
  .copy { font-size:12px; padding:2px 8px; border-radius:6px; border:1px solid var(--line);
          background:var(--card); color:var(--text); cursor:pointer; }
  .note, footer { color:var(--muted); font-size:13px; }
  footer { margin-top:32px; }
</style>
</head>
<body>
<main>
  <h1>WorkDey</h1>
  <p class="sub">Results for ${esc(meta.fullName)} &middot; roles: ${esc(meta.targetRoles.join(', '))} &middot; ${esc(generated)}</p>

  <div class="stats">
    <div class="stat"><b>${matches.length}</b>verified matches</div>
    <div class="stat"><b>${scams.length}</b>scams blocked</div>
    <div class="stat"><b>${rejected.length}</b>not a fit</div>
  </div>

  <h2>Top matches</h2>
  ${
      matches.length
          ? matches.map((j, i) => matchCard(j, i)).join('')
          : '<p class="muted">No matches this run. Try more roles or a lower minimum score.</p>'
  }

  <h2>Scams blocked</h2>
  ${
      scams.length
          ? scams.map((j) => scamCard(j)).join('')
          : '<p class="muted">No scam listings were found in this run.</p>'
  }

  <h2>Not a fit</h2>
  ${
      rejected.length
          ? `<details><summary>${rejected.length} listings scored below your threshold</summary><ul>${rejected
                .map((j) => rejectedRow(j))
                .join('')}</ul></details>`
          : '<p class="muted">Nothing here.</p>'
  }

  <footer>
    Freshness is based on the posting date only; applicant counts are not public for these sources.
    Drafts are suggestions: review everything before you send it.
  </footer>
</main>
<script>
document.addEventListener('click', function (e) {
  var btn = e.target.closest('[data-copy]');
  if (!btn) return;
  var el = document.getElementById(btn.getAttribute('data-copy'));
  if (!el) return;
  var done = function () {
    var t = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(function () { btn.textContent = t; }, 1500);
  };
  if (navigator.clipboard) { navigator.clipboard.writeText(el.value).then(done); }
  else { el.select(); document.execCommand('copy'); done(); }
});
</script>
</body>
</html>`;
}