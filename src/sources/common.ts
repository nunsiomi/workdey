import type { JobPost } from '../types.js';

export const REQUEST_TIMEOUT_MS = 20_000;
export const USER_AGENT =
    'WorkDey-Agent/1.0 (+https://apify.com/em07_adoz/workdey-career-agent)';

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

export const sleep = async (ms: number): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, ms);
    });

/** GET with a timeout. Retries once on HTTP 429 / 5xx or a network error / timeout. */
export async function fetchText(
    url: string,
    accept = '*/*',
    headers: Record<string, string> = {}
): Promise<string> {
    for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
            res = await fetch(url, {
                headers: { 'User-Agent': USER_AGENT, Accept: accept, ...headers },
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                redirect: 'follow'
            });
        } catch (error) {
            if (attempt === 0) {
                await sleep(1000);
                continue;
            }
            throw error;
        }
        if (res.ok) return res.text();
        if (attempt === 0 && (res.status === 429 || res.status >= 500)) {
            await sleep(1500);
            continue;
        }
        throw new Error(`HTTP ${res.status}`);
    }
}

export async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
    return JSON.parse(await fetchText(url, 'application/json', headers)) as T;
}

/** Run async work over a list with a bounded number in flight (polite to small sites). */
export async function mapLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i], i);
        }
    });
    await Promise.all(workers);
    return results;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

export function htmlToText(html: string): string {
    return html
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;|&apos;/g, "'")
        .replace(/&#8211;|&ndash;/g, '-')
        .replace(/&#8217;|&rsquo;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/[ \t\r\f]+/g, ' ')
        .replace(/\s*\n\s*/g, '\n')
        .trim();
}

export function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word match, so "ml" does not match "html" and "ui" does not match "build". */
export function hasWord(text: string, word: string): boolean {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(word)}([^a-z0-9]|$)`).test(text);
}

/** RemoteOK sometimes returns UTF-8 text that was mis-decoded, e.g. "Â·" instead of "·". */
export function fixEncoding(text: string): string {
    if (!/[ÂÃ]/.test(text)) return text;
    if ([...text].some((c) => c.charCodeAt(0) > 0xff)) return text;
    const fixed = Buffer.from(text, 'latin1').toString('utf8');
    return fixed.includes('�') ? text : fixed;
}

export function slugify(s: string): string {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Role expansion. Used both to match titles and to rotate search terms per site.
// ---------------------------------------------------------------------------

/** Synonyms and Nigerian variants, keyed by a word that appears in a target role. */
const ROLE_SYNONYMS: { when: RegExp; add: string[] }[] = [
    { when: /data analyst|data analytics/, add: ['bi analyst', 'business intelligence analyst', 'reporting analyst', 'data analytics', 'mis analyst', 'insights analyst'] },
    { when: /data scientist/, add: ['machine learning engineer', 'ml engineer', 'applied scientist', 'data science'] },
    { when: /machine learning|\bml\b/, add: ['ml engineer', 'ai engineer', 'data scientist', 'mlops engineer'] },
    { when: /data engineer/, add: ['analytics engineer', 'etl developer', 'big data engineer'] },
    { when: /virtual assistant|\bva\b/, add: ['va', 'admin assistant', 'administrative assistant', 'executive assistant', 'personal assistant', 'office assistant'] },
    { when: /customer (support|service|success)/, add: ['customer care', 'customer experience', 'support specialist', 'client support'] },
    { when: /software (engineer|developer)|backend|back-end|full[- ]?stack/, add: ['software developer', 'software engineer', 'web developer', 'programmer'] },
    { when: /front[- ]?end/, add: ['frontend developer', 'frontend engineer', 'react developer', 'ui developer'] },
    { when: /product design|ui\/?ux|ux design|ui design/, add: ['ux designer', 'ui designer', 'product designer', 'ui/ux designer'] },
    { when: /product manager/, add: ['product owner', 'associate product manager'] },
    { when: /project manager/, add: ['project coordinator', 'program manager'] },
    { when: /social media/, add: ['community manager', 'content creator', 'digital marketer'] },
    { when: /content (writer|creator)|copywriter/, add: ['content writer', 'copywriter', 'content creator', 'content strategist'] },
    { when: /devops|sre|cloud engineer/, add: ['devops engineer', 'site reliability engineer', 'cloud engineer', 'platform engineer'] },
    { when: /accountant|accounting/, add: ['finance officer', 'accounts officer', 'financial analyst'] },
    { when: /marketing/, add: ['digital marketer', 'marketing executive', 'growth marketer'] },
    { when: /sales/, add: ['business development', 'sales executive', 'sales representative'] }
];

/** Each target role plus synonyms and swaps such as "developer" <-> "engineer". */
export function roleVariants(roles: string[]): string[] {
    const out = new Set<string>();
    for (const role of roles) {
        const base = role.toLowerCase().trim();
        if (!base) continue;
        out.add(base);
        if (base.includes('developer')) out.add(base.replace('developer', 'engineer'));
        if (base.includes('engineer')) out.add(base.replace('engineer', 'developer'));
        if (base.includes('analyst')) out.add(base.replace('analyst', 'analytics'));
        if (base.includes('machine learning')) out.add(base.replace('machine learning', 'ml'));
        for (const { when, add } of ROLE_SYNONYMS) {
            if (when.test(base)) add.forEach((a) => out.add(a));
        }
    }
    return [...out];
}

const GENERIC_WORDS = new Set([
    'senior', 'junior', 'lead', 'staff', 'principal', 'remote', 'the', 'and', 'for'
]);

/** A title matches when it contains a whole role phrase, or every meaningful word of a role. */
export function titleMatchesRoles(title: string, variants: string[]): boolean {
    const t = title.toLowerCase();
    return variants.some((variant) => {
        if (variant.length <= 2) return hasWord(t, variant); // "va", "ml": whole word only
        if (t.includes(variant)) return true;
        const words = variant
            .split(/[^a-z0-9+#.]+/)
            .filter((w) => w.length >= 2 && !GENERIC_WORDS.has(w));
        return words.length > 0 && words.every((w) => hasWord(t, w));
    });
}

/**
 * Pick which variants to send to a searchable site. Each site starts at a
 * different offset, so identical queries are not fired everywhere.
 */
export function rotateVariants(variants: string[], offset: number, count: number): string[] {
    if (variants.length === 0) return [];
    const out: string[] = [];
    for (let i = 0; i < Math.min(count, variants.length); i++) {
        out.push(variants[(offset + i) % variants.length]);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Location: is a listing plausibly open to someone based in Nigeria / Africa?
// ---------------------------------------------------------------------------

const NIGERIA_HINT =
    /\b(nigeria|lagos|abuja|port harcourt|ibadan|kano|enugu|benin city|kaduna|ogun|oyo|rivers|fct|lekki|ikeja|victoria island)\b/i;
const AFRICA_OR_OPEN =
    /\b(africa|emea|worldwide|world[- ]?wide|anywhere|global|international|any ?where|all countries)\b/i;
/** Words that describe the work arrangement, not a place. */
const ARRANGEMENT_WORDS =
    /\b(remote|remotely|hybrid|fully|100%|work from home|wfh|home[- ]?based|full[- ]?time|part[- ]?time|contract|permanent|flexible|position|role|based)\b/gi;

export function isNigeriaLocation(location: string): boolean {
    return NIGERIA_HINT.test(location);
}

/**
 * True when the location text does not rule out a candidate in Nigeria.
 *  - "Remote", "Worldwide", "Anywhere", "Remote - Africa", "EMEA", "Lagos" -> in
 *  - "Remote (US)", "Remote, Poland", "Europe", "New York" -> out
 * A remote job that names any other place is treated as restricted to that place.
 */
export function isEligibleLocation(location: string): boolean {
    const loc = location.trim();
    if (!loc) return true; // unknown: let the LLM judge from the full text
    // "South Africa" alone is one country, not the whole continent.
    const continentCheck = loc.replace(/south africa/gi, ' ');
    if (NIGERIA_HINT.test(loc) || AFRICA_OR_OPEN.test(continentCheck)) return true;
    // Only remote work can be open to someone abroad. A bare "Hybrid" means an office somewhere else.
    if (/\bremote|work from home|wfh\b/i.test(loc)) {
        const leftover = loc.replace(ARRANGEMENT_WORDS, ' ').replace(/[^a-z0-9]+/gi, ' ').trim();
        return leftover.length === 0; // "Remote" alone is open; "Remote Poland" is not
    }
    return false;
}

const TEACHING_TITLE = /\b(instructor|lecturer|professor|tutor|teacher|facilitator|trainer|teaching|academic)\b/i;

/**
 * Synonyms such as "data science" also match university posts ("Data Science
 * Lecturer"). Those are not what a data scientist is looking for, so drop
 * teaching posts unless the seeker's own roles ask for them.
 */
export function isOffTopicTitle(title: string, targetRoles: string[]): boolean {
    return TEACHING_TITLE.test(title) && !targetRoles.some((r) => TEACHING_TITLE.test(r));
}

// ---------------------------------------------------------------------------
// Dates and quality gates
// ---------------------------------------------------------------------------

/** Parse RFC822 / ISO / epoch dates. Returns undefined when it cannot tell. */
export function parseDate(value: string | number | undefined | null): Date | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const n = typeof value === 'number' ? value : Number(value);
    let d: Date;
    if (!Number.isNaN(n) && n > 1e9) d = new Date(n < 1e12 ? n * 1000 : n);
    else d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? undefined : d;
}

/** "23 September" (no year) -> the most recent such date that is not in the future. */
export function parseDayMonth(text: string, now = new Date()): Date | undefined {
    const m = text.match(/(\d{1,2})\s+([A-Za-z]{3,9})/);
    if (!m) return undefined;
    const d = new Date(`${m[1]} ${m[2]} ${now.getFullYear()} 12:00:00 UTC`);
    if (Number.isNaN(d.getTime())) return undefined;
    if (d.getTime() > now.getTime() + 86_400_000) d.setUTCFullYear(now.getFullYear() - 1);
    return d;
}

const CLOSED_PATTERN =
    /\b(no longer accepting applications|applications? (?:are |is )?(?:now )?closed|position (?:has been |is )?filled|this (?:job|position|role|vacancy) (?:has )?(?:expired|closed)|vacancy (?:has )?(?:expired|closed)|deadline has passed|job (?:has )?expired)\b/i;

export interface GateOptions {
    /** Drop listings older than this many days (only when the date is known). */
    maxAgeDays: number;
    now?: Date;
}

/** Real, current and eligible? Returns a reason string when the job should be dropped. */
export function qualityGate(job: JobPost, opts: GateOptions): string | null {
    if (!job.title?.trim() || !job.url?.trim()) return 'missing title or link';
    if (!/^https?:\/\//i.test(job.url)) return 'link is not http(s)';

    const text = `${job.title}\n${job.rawText ?? ''}`;
    if (CLOSED_PATTERN.test(text)) return 'listing says it is closed or filled';

    const posted = parseDate(job.postedAt);
    if (posted) {
        const ageDays = ((opts.now ?? new Date()).getTime() - posted.getTime()) / 86_400_000;
        if (ageDays > opts.maxAgeDays) return `older than ${opts.maxAgeDays} days`;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Dedupe keys
// ---------------------------------------------------------------------------

/** Lower-cased URL without tracking params or trailing slash, so links compare reliably. */
export function canonicalUrl(url: string): string {
    try {
        const u = new URL(url);
        for (const key of [...u.searchParams.keys()]) {
            if (/^(utm_|ref$|source$|gh_src$|lever-source)/i.test(key)) u.searchParams.delete(key);
        }
        u.hash = '';
        return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`.toLowerCase();
    } catch {
        return url.toLowerCase();
    }
}

/** Company + normalised title, so the same role cross-posted on several sites collapses. */
export function roleKey(job: JobPost): string {
    const norm = (s: string) =>
        s
            .toLowerCase()
            .replace(/\(.*?\)|\[.*?\]/g, ' ')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    return `${norm(job.title)}|${norm(job.company)}`;
}

export function hostOf(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return '';
    }
}

/** Convenience for building a stable id from a source name and a native id or url. */
export function makeId(source: string, native: string): string {
    return `${slugify(source)}-${native}`;
}
