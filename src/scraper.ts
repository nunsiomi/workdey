import { JobPost } from './types.js';

const REQUEST_TIMEOUT_MS = 10_000;
// Source diversity: no single source can supply more than this many jobs per run.
const MAX_PER_SOURCE = 8;
const USER_AGENT =
    'WorkDey-Agent/1.0 (+https://apify.com/em07_adoz/workdey-career-agent)';

// ---------------------------------------------------------------------------
// Company boards. Only add names you have opened in a browser and confirmed.
// A board that does not exist is simply skipped, and the run log shows how
// many boards were actually reachable.
// ---------------------------------------------------------------------------

// https://<name>.bamboohr.com/careers
const BAMBOOHR_COMPANIES = [
    'africanclimatefoundation',
    'kuda',
    'moniepoint',
    'heliumhealth',
    'fairmoney',
    'seamlesshr',
    'flutterwave',
    'andela',
    'carbon',
    'interswitch',
    'piggyvest',
    'paystack'
];

// https://boards.greenhouse.io/<token>
const GREENHOUSE_BOARDS: string[] = [];

// https://jobs.lever.co/<name>
const LEVER_COMPANIES: string[] = [];

// ---------------------------------------------------------------------------
// Types for the external APIs
// ---------------------------------------------------------------------------

interface RemoteOkJob {
    id: string;
    position: string;
    company: string;
    location: string;
    url: string;
    date: string;
    description: string;
    tags: string[];
}

interface RemotiveJob {
    id: number;
    url: string;
    title: string;
    company_name: string;
    publication_date: string;
    candidate_required_location: string;
    description: string;
}

interface BambooJobItem {
    id: string;
    jobOpeningName: string;
    departmentLabel?: string;
    companyName?: string;
    location?: { city?: string; country?: string };
    employmentType?: string;
    datePosted?: string;
}

interface GreenhouseJob {
    id: number;
    title: string;
    updated_at?: string;
    absolute_url: string;
    location?: { name?: string };
    content?: string;
}

interface LeverPosting {
    id: string;
    text: string;
    hostedUrl: string;
    createdAt?: number;
    categories?: { location?: string; commitment?: string };
    descriptionPlain?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
}

function htmlToText(html: string): string {
    return html
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** RemoteOK sometimes returns UTF-8 text that was mis-decoded, e.g. "Â·" instead of "·". */
function fixEncoding(text: string): string {
    if (!/[ÂÃ]/.test(text)) return text;
    if ([...text].some((c) => c.charCodeAt(0) > 0xff)) return text;
    const fixed = Buffer.from(text, 'latin1').toString('utf8');
    return fixed.includes('\uFFFD') ? text : fixed;
}

/** Whole-word match, so "ml" does not match "html" and "ui" does not match "build". */
function hasWord(text: string, word: string): boolean {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(word)}([^a-z0-9]|$)`).test(text);
}

const GENERIC_WORDS = new Set([
    'senior', 'junior', 'lead', 'staff', 'principal', 'remote', 'the', 'and', 'for'
]);

/** Each target role plus common synonyms, e.g. "backend developer" and "backend engineer". */
function roleVariants(roles: string[]): string[] {
    const out = new Set<string>();
    for (const role of roles) {
        const base = role.toLowerCase().trim();
        if (!base) continue;
        out.add(base);
        if (base.includes('developer')) out.add(base.replace('developer', 'engineer'));
        if (base.includes('engineer')) out.add(base.replace('engineer', 'developer'));
        if (base.includes('analyst')) out.add(base.replace('analyst', 'analytics'));
        if (base.includes('machine learning')) out.add(base.replace('machine learning', 'ml'));
    }
    return [...out];
}

/** A title matches when it contains a whole role phrase, or every meaningful word of a role. */
function titleMatchesRoles(title: string, variants: string[]): boolean {
    const t = title.toLowerCase();
    return variants.some((variant) => {
        if (t.includes(variant)) return true;
        const words = variant
            .split(/[^a-z0-9+#.]+/)
            .filter((w) => w.length >= 2 && !GENERIC_WORDS.has(w));
        return words.length > 0 && words.every((w) => hasWord(t, w));
    });
}

/** Map roles to RemoteOK tags using whole-word matching. */
function extractTags(targetRoles: string[]): string[] {
    const text = targetRoles.join(' ').toLowerCase();
    const has = (...words: string[]) => words.some((w) => hasWord(text, w));
    const tags: string[] = [];

    if (has('data', 'analyst', 'analytics')) tags.push('data');
    if (has('python')) tags.push('python');
    if (has('design', 'designer', 'ui', 'ux')) tags.push('design');
    if (has('react', 'frontend', 'front-end')) tags.push('react');
    if (has('backend', 'back-end', 'node')) tags.push('backend');
    if (has('product', 'pm')) tags.push('product');
    if (has('machine learning', 'ai', 'ml')) tags.push('ai');
    if (has('software', 'engineer', 'developer')) tags.push('dev');

    return tags.length > 0 ? [...new Set(tags)].slice(0, 3) : ['dev'];
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/**
 * RemoteOK. Their API terms ask for a link back and a mention of RemoteOK as
 * the source. Every job keeps source "RemoteOK" and its original URL, and the
 * dashboard shows both. Keep it that way.
 */
async function fetchFromRemoteOK(
    targetRoles: string[],
    variants: string[]
): Promise<JobPost[]> {
    const strict: JobPost[] = [];
    const broad: JobPost[] = [];
    const seen = new Set<string>();

    for (const tag of extractTags(targetRoles)) {
        try {
            const data = await fetchJson<RemoteOkJob[]>(
                `https://remoteok.com/api?tag=${encodeURIComponent(tag)}`
            );

            // The first element of the response is a legal notice, not a job.
            for (const item of data.slice(1, 40)) {
                if (!item.position || seen.has(String(item.id))) continue;
                seen.add(String(item.id));

                const job: JobPost = {
                    id: `remoteok-${item.id}`,
                    title: fixEncoding(item.position),
                    company: fixEncoding(item.company || 'Remote Employer'),
                    location: fixEncoding(item.location || 'Remote'),
                    url: item.url || `https://remoteok.com/remote-jobs/${item.id}`,
                    postedAt: item.date || '',
                    source: 'RemoteOK',
                    rawText: fixEncoding(htmlToText(item.description || `Position: ${item.position}`)).slice(0, 1500)
                };

                (titleMatchesRoles(job.title, variants) ? strict : broad).push(job);
            }
        } catch (error) {
            console.warn(
                `[WorkDey Ingestion] RemoteOK tag "${tag}" failed: ${(error as Error).message}`
            );
        }
    }

    // If very few titles match strictly, top up with a few tag-matched jobs.
    const jobs = strict.length >= 3 ? strict : [...strict, ...broad.slice(0, 3 - strict.length)];
    console.log(
        `[WorkDey Ingestion] RemoteOK: ${strict.length} matching titles (${jobs.length} kept).`
    );
    return jobs.slice(0, MAX_PER_SOURCE);
}

/** Remotive public API. Light usage only (one request per role, at most two roles). */
async function fetchFromRemotive(
    targetRoles: string[],
    variants: string[]
): Promise<JobPost[]> {
    const jobs: JobPost[] = [];
    const seen = new Set<number>();

    await Promise.allSettled(
        targetRoles.slice(0, 2).map(async (role) => {
            try {
                const data = await fetchJson<{ jobs?: RemotiveJob[] }>(
                    `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(role)}&limit=30`
                );
                for (const item of data.jobs ?? []) {
                    if (seen.has(item.id) || !titleMatchesRoles(item.title, variants)) continue;
                    seen.add(item.id);
                    jobs.push({
                        id: `remotive-${item.id}`,
                        title: item.title,
                        company: item.company_name || 'Remote Employer',
                        location: item.candidate_required_location || 'Remote',
                        url: item.url,
                        postedAt: item.publication_date || '',
                        source: 'Remotive',
                        rawText: htmlToText(item.description || '').slice(0, 1500)
                    });
                }
            } catch (error) {
                console.warn(
                    `[WorkDey Ingestion] Remotive "${role}" failed: ${(error as Error).message}`
                );
            }
        })
    );

    console.log(`[WorkDey Ingestion] Remotive: ${jobs.length} matching titles.`);
    return jobs.slice(0, MAX_PER_SOURCE);
}

async function fetchFromBambooHR(variants: string[]): Promise<JobPost[]> {
    const jobs: JobPost[] = [];
    let reached = 0;

    await Promise.allSettled(
        BAMBOOHR_COMPANIES.map(async (company) => {
            try {
                const data = await fetchJson<{ result?: BambooJobItem[] }>(
                    `https://${company}.bamboohr.com/careers/list`
                );
                if (!Array.isArray(data?.result)) return;
                reached++;

                for (const item of data.result) {
                    if (!item.jobOpeningName || !titleMatchesRoles(item.jobOpeningName, variants)) continue;

                    const loc = item.location
                        ? `${item.location.city || ''}, ${item.location.country || ''}`.replace(/^,\s*|,\s*$/g, '')
                        : '';
                    const place = loc || 'Remote / Global';

                    jobs.push({
                        id: `bamboohr-${company}-${item.id}`,
                        title: item.jobOpeningName,
                        company: item.companyName || company.toUpperCase(),
                        location: place,
                        url: `https://${company}.bamboohr.com/careers/${item.id}`,
                        postedAt: item.datePosted || '',
                        source: 'BambooHR',
                        rawText:
                            `Position: ${item.jobOpeningName} at ${company.toUpperCase()}.\n` +
                            `Department: ${item.departmentLabel || 'General'}.\n` +
                            `Employment type: ${item.employmentType || 'Not stated'}.\n` +
                            `Location: ${place}.`
                    });
                }
            } catch {
                // Board does not exist or is not public: skipped, counted in the log below.
            }
        })
    );

    console.log(
        `[WorkDey Ingestion] BambooHR: reached ${reached}/${BAMBOOHR_COMPANIES.length} boards, ${jobs.length} matching titles.`
    );
    return jobs.slice(0, MAX_PER_SOURCE);
}

async function fetchFromGreenhouse(variants: string[]): Promise<JobPost[]> {
    if (GREENHOUSE_BOARDS.length === 0) return [];
    const jobs: JobPost[] = [];
    let reached = 0;

    await Promise.allSettled(
        GREENHOUSE_BOARDS.map(async (token) => {
            try {
                const data = await fetchJson<{ jobs?: GreenhouseJob[] }>(
                    `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`
                );
                reached++;
                for (const item of data.jobs ?? []) {
                    if (!titleMatchesRoles(item.title, variants)) continue;
                    jobs.push({
                        id: `greenhouse-${token}-${item.id}`,
                        title: item.title,
                        company: token,
                        location: item.location?.name || 'Not stated',
                        url: item.absolute_url,
                        postedAt: item.updated_at || '',
                        source: 'Greenhouse',
                        rawText: htmlToText(item.content || '').slice(0, 1500)
                    });
                }
            } catch {
                // skipped
            }
        })
    );

    console.log(
        `[WorkDey Ingestion] Greenhouse: reached ${reached}/${GREENHOUSE_BOARDS.length} boards, ${jobs.length} matching titles.`
    );
    return jobs.slice(0, MAX_PER_SOURCE);
}

async function fetchFromLever(variants: string[]): Promise<JobPost[]> {
    if (LEVER_COMPANIES.length === 0) return [];
    const jobs: JobPost[] = [];
    let reached = 0;

    await Promise.allSettled(
        LEVER_COMPANIES.map(async (name) => {
            try {
                const data = await fetchJson<LeverPosting[]>(
                    `https://api.lever.co/v0/postings/${name}?mode=json`
                );
                if (!Array.isArray(data)) return;
                reached++;
                for (const item of data) {
                    if (!titleMatchesRoles(item.text, variants)) continue;
                    jobs.push({
                        id: `lever-${name}-${item.id}`,
                        title: item.text,
                        company: name,
                        location: item.categories?.location || 'Not stated',
                        url: item.hostedUrl,
                        postedAt: item.createdAt ? new Date(item.createdAt).toISOString() : '',
                        source: 'Lever',
                        rawText: (item.descriptionPlain || '').slice(0, 1500)
                    });
                }
            } catch {
                // skipped
            }
        })
    );

    console.log(
        `[WorkDey Ingestion] Lever: reached ${reached}/${LEVER_COMPANIES.length} boards, ${jobs.length} matching titles.`
    );
    return jobs.slice(0, MAX_PER_SOURCE);
}

// ---------------------------------------------------------------------------
// Demo listings: SYNTHETIC scam examples, clearly labeled, opt-in only.
// They exist so the scam shield can be demonstrated. They are never real jobs.
// ---------------------------------------------------------------------------

function demoScamListings(targetRoles: string[]): JobPost[] {
    const role = targetRoles[0] || 'Software Engineer';
    const base = {
        location: 'Remote',
        url: 'https://apify.com/em07_adoz/workdey-career-agent',
        postedAt: new Date().toISOString(),
        source: 'Demo sample (synthetic)'
    };

    return [
        {
            ...base,
            id: 'demo-scam-fee',
            title: `${role} (Remote) - Start This Week`,
            company: 'Global Talent Hub (sample)',
            rawText:
                'We are hiring remote workers now. No experience needed. Earn $300 daily. ' +
                'Pay a refundable registration fee of $40 to secure your slot before you start. ' +
                'Contact us on WhatsApp to begin.'
        },
        {
            ...base,
            id: 'demo-scam-bvn',
            title: `${role} - Urgent Hiring in Lagos`,
            company: 'Prime Careers Ltd (sample)',
            rawText:
                'Urgent hiring in Lagos. To receive your signing bonus, send your BVN and bank account ' +
                'details to our HR on Telegram today. Limited slots available.'
        },
        {
            ...base,
            id: 'demo-scam-cheque',
            title: `Remote ${role} Assistant`,
            company: 'Northbridge Solutions (sample)',
            rawText:
                "Our client will send you a cashier's cheque to purchase your equipment and laptop " +
                'from our approved vendor. You will be reimbursed after the cheque clears. Apply now.'
        }
    ];
}

// ---------------------------------------------------------------------------
// Unified ingestion
// ---------------------------------------------------------------------------

export async function fetchLiveJobsForRoles(
    targetRoles: string[],
    includeDemoListings = false
): Promise<JobPost[]> {
    console.log(`[WorkDey Ingestion] Scanning boards for: "${targetRoles.join(', ')}"`);
    const variants = roleVariants(targetRoles);

    const [remoteOk, remotive, bamboo, greenhouse, lever] = await Promise.all([
        fetchFromRemoteOK(targetRoles, variants),
        fetchFromRemotive(targetRoles, variants),
        fetchFromBambooHR(variants),
        fetchFromGreenhouse(variants),
        fetchFromLever(variants)
    ]);

    const combined = [...remoteOk, ...remotive, ...bamboo, ...greenhouse, ...lever];

    // Remove the same role cross-posted on several boards.
    const seen = new Set<string>();
    const unique = combined.filter((job) => {
        const key = `${job.title.toLowerCase()}-${job.company.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    console.log(
        `[WorkDey Ingestion] Sources this run: RemoteOK ${remoteOk.length}, Remotive ${remotive.length}, ` +
            `BambooHR ${bamboo.length}, Greenhouse ${greenhouse.length}, Lever ${lever.length}. ` +
            `Unique jobs: ${unique.length}.`
    );

    if (includeDemoListings) {
        console.log('[WorkDey Ingestion] Adding 3 labeled synthetic demo listings.');
        unique.push(...demoScamListings(targetRoles));
    }

    return unique;
}