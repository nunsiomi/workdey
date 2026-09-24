// Builds the short alert email (PRD section 7.3). It only returns the content; sending is notify.ts's job.
// Email clients ignore most modern CSS, so this uses tables and inline styles.

export interface EmailMatch {
    title: string;
    company: string;
    fitScore: number;
    fitReasons: string[];
}

export interface EmailOptions {
    /** Link to the saved results page. */
    resultsUrl: string;
    /** How many application packs were drafted this run. */
    packsDrafted: number;
    /** What this run cost, for example "$0.25". */
    costLabel?: string;
    /** For example "16:05". */
    nextRunLabel?: string;
    settingsUrl?: string;
    unsubscribeUrl?: string;
}

export interface Email {
    subject: string;
    html: string;
    text: string;
}

const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const safeHref = (u: string | undefined): string => (u && /^https?:\/\//i.test(u) ? esc(u) : '');

const PINK = '#ff80b5';
const INK = '#0d0f12';
const SOFT = '#565c66';
const FONT = "'Segoe UI', Helvetica, Arial, sans-serif";

/** Matches must already be sorted best first. Returns null when there is nothing to send. */
export function buildEmail(matches: EmailMatch[], opts: EmailOptions): Email | null {
    const n = matches.length;
    if (n === 0) return null;
    const top = matches[0]!;
    const subject = `${n} new job ${n === 1 ? 'match' : 'matches'} for you`;
    const why = top.fitReasons[0] ?? 'It fits your profile.';
    const packs = Math.min(opts.packsDrafted, n);
    const packsLine =
        packs > 0 ? `Packs drafted for ${packs === n ? (n === 1 ? 'it' : `all ${n}`) : `${packs} of ${n}`}.` : '';

    const footerBits: string[] = [];
    if (opts.costLabel) footerBits.push(esc(opts.costLabel));
    if (opts.nextRunLabel) footerBits.push(`Next run ${esc(opts.nextRunLabel)}`);
    const settings = safeHref(opts.settingsUrl);
    const unsub = safeHref(opts.unsubscribeUrl);
    if (settings) footerBits.push(`<a href="${settings}" style="color:${SOFT};">Settings</a>`);
    if (unsub) footerBits.push(`<a href="${unsub}" style="color:${SOFT};">Unsubscribe</a>`);

    const button = safeHref(opts.resultsUrl);
    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#eceef1;">
<div style="display:none;max-height:0;overflow:hidden;">${esc(top.title)} at ${esc(top.company)}. ${esc(why)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eceef1;"><tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:100%;max-width:520px;background:#ffffff;border:1px solid ${INK};border-radius:18px;">
    <tr><td style="height:10px;background:${PINK};border-radius:17px 17px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td style="height:4px;background:${INK};font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td style="height:10px;background:${PINK};font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td style="height:4px;background:${INK};font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td style="padding:28px 28px 8px;font-family:${FONT};color:${INK};">
      <div style="font-size:18px;font-weight:800;">WorkDey</div>
      <div style="font-size:34px;line-height:1.05;font-weight:800;letter-spacing:-1px;margin:18px 0 16px;">${n} new ${n === 1 ? 'match' : 'matches'}</div>
      <p style="margin:0 0 12px;font-size:16px;line-height:1.5;">Top: <strong>${esc(top.title)}</strong>, ${esc(top.company)}. Score ${Math.round(top.fitScore)}.</p>
      <p style="margin:0 0 12px;font-size:16px;line-height:1.5;">${esc(why)}</p>${
          packsLine ? `\n      <p style="margin:0 0 20px;font-size:16px;line-height:1.5;">${esc(packsLine)}</p>` : ''
      }
    </td></tr>${
        button
            ? `
    <tr><td style="padding:0 28px 28px;font-family:${FONT};">
      <a href="${button}" style="display:inline-block;background:${INK};color:${PINK};font-size:16px;font-weight:700;text-decoration:none;padding:14px 26px;border-radius:999px;">View matches</a>
    </td></tr>`
            : ''
    }${
        footerBits.length
            ? `
    <tr><td style="padding:14px 28px;border-top:1px dashed #b9bec7;font-family:${FONT};font-size:12px;color:${SOFT};">${footerBits.join(' &middot; ')}</td></tr>`
            : ''
    }
  </table>
</td></tr></table>
</body></html>`;

    const textLines = [
        `${n} new ${n === 1 ? 'match' : 'matches'}`,
        '',
        `Top: ${top.title}, ${top.company}. Score ${Math.round(top.fitScore)}.`,
        why,
        ...(packsLine ? [packsLine] : []),
        '',
        ...(opts.resultsUrl ? [`View matches: ${opts.resultsUrl}`] : []),
    ];
    return { subject, html, text: textLines.join('\n') };
}
