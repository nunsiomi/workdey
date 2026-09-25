import type { JobPost, SourceReport } from '../types.js';
import {
    fetchJson,
    fetchText,
    fixEncoding,
    hasWord,
    htmlToText,
    isEligibleLocation,
    makeId,
    parseDate,
    rotateVariants,
    titleMatchesRoles
} from './common.js';
import type { SourceOutput } from './nigerianBoards.js';

/**
 * Remote-first boards that publish open APIs or RSS feeds. Results are filtered
 * to jobs a candidate in Nigeria can plausibly take (Remote, Africa, Worldwide...).
 */

const CATEGORY = 'remote-board' as const;

const newReport = (source: string): SourceReport => ({ source, category: CATEGORY, reached: false, found: 0 });

/** Map roles to RemoteOK tags using whole-word matching. */
export function extractTags(targetRoles: string[]): string[] {
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
    if (has('assistant', 'admin', 'support', 'customer')) tags.push('support');
    if (has('marketing', 'content', 'social')) tags.push('marketing');
    if (has('software', 'engineer', 'developer')) tags.push('dev');

    return tags.length > 0 ? [...new Set(tags)].slice(0, 3) : ['dev'];
}

// ---------------------------------------------------------------------------
// RemoteOK. Their API terms ask for a link back and a mention of RemoteOK as the
// source. Every job keeps source "RemoteOK" and its original URL. Keep it that way.
// ---------------------------------------------------------------------------

async function fetchRemoteOK(roles: string[], variants: string[]): Promise<SourceOutput> {
    interface Item {
        id: string;
        position?: string;
        company?: string;
        location?: string;
        url?: string;
        date?: string;
        description?: string;
    }
    const report = newReport('RemoteOK');
    const seen = new Set<string>();
    const jobs: JobPost[] = [];

    for (const tag of extractTags(roles)) {
        try {
            const data = await fetchJson<Item[]>(`https://remoteok.com/api?tag=${encodeURIComponent(tag)}`);
            report.reached = true;
            // The first element of the response is a legal notice, not a job.
            for (const item of data.slice(1, 80)) {
                if (!item.position || seen.has(String(item.id))) continue;
                seen.add(String(item.id));
                const title = fixEncoding(item.position);
                const location = fixEncoding(item.location || 'Remote');
                if (!titleMatchesRoles(title, variants) || !isEligibleLocation(location)) continue;
                jobs.push({
                    id: makeId('remoteok', String(item.id)),
                    title,
                    company: fixEncoding(item.company || 'Remote Employer'),
                    location,
                    url: item.url || `https://remoteok.com/remote-jobs/${item.id}`,
                    postedAt: parseDate(item.date)?.toISOString() ?? '',
                    source: 'RemoteOK',
                    sourceCategory: CATEGORY,
                    postType: 'listing',
                    rawText: fixEncoding(htmlToText(item.description || `Position: ${item.position}`)).slice(0, 2500)
                });
            }
        } catch (error) {
            report.note = (error as Error).message;
        }
    }
    report.found = jobs.length;
    return { jobs, reports: [report] };
}

// ---------------------------------------------------------------------------
// Remotive public API (light use: one request per rotated role)
// ---------------------------------------------------------------------------

async function fetchRemotive(variants: string[]): Promise<SourceOutput> {
    interface Item {
        id: number;
        url: string;
        title: string;
        company_name?: string;
        publication_date?: string;
        candidate_required_location?: string;
        description?: string;
    }
    const report = newReport('Remotive');
    const jobs = new Map<number, JobPost>();

    for (const term of rotateVariants(variants, 1, 3)) {
        try {
            const data = await fetchJson<{ jobs?: Item[] }>(
                `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(term)}&limit=40`
            );
            report.reached = true;
            for (const item of data.jobs ?? []) {
                const location = item.candidate_required_location || 'Remote';
                if (jobs.has(item.id) || !titleMatchesRoles(item.title, variants) || !isEligibleLocation(location)) continue;
                jobs.set(item.id, {
                    id: makeId('remotive', String(item.id)),
                    title: item.title,
                    company: item.company_name || 'Remote Employer',
                    location,
                    url: item.url,
                    postedAt: parseDate(item.publication_date)?.toISOString() ?? '',
                    source: 'Remotive',
                    sourceCategory: CATEGORY,
                    postType: 'listing',
                    rawText: htmlToText(item.description || '').slice(0, 2500)
                });
            }
        } catch (error) {
            report.note = (error as Error).message;
        }
    }
    report.found = jobs.size;
    return { jobs: [...jobs.values()], reports: [report] };
}

// ---------------------------------------------------------------------------
// We Work Remotely: public RSS
// ---------------------------------------------------------------------------

export function parseWeWorkRemotelyFeed(xml: string): JobPost[] {
    const tag = (block: string, name: string) =>
        block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))?.[1]?.replace(/^<!\[CDATA\[|\]\]>$/g, '').trim() ?? '';

    const jobs: JobPost[] = [];
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
        const block = m[1];
        const link = tag(block, 'link') || tag(block, 'guid');
        const rawTitle = htmlToText(tag(block, 'title'));
        if (!link || !rawTitle) continue;

        // Titles look like "Company: Role".
        const colon = rawTitle.indexOf(': ');
        const company = colon > 0 ? rawTitle.slice(0, colon) : 'Remote Employer';
        const title = colon > 0 ? rawTitle.slice(colon + 2) : rawTitle;
        const region = htmlToText(tag(block, 'region')) || 'Remote';

        jobs.push({
            id: makeId('weworkremotely', link.split('/').pop() ?? link),
            title,
            company,
            location: region,
            url: link,
            postedAt: parseDate(tag(block, 'pubDate'))?.toISOString() ?? '',
            source: 'WeWorkRemotely',
            sourceCategory: CATEGORY,
            postType: 'listing',
            rawText: `${rawTitle}\n${htmlToText(tag(block, 'description'))}`.slice(0, 2500)
        });
    }
    return jobs;
}

async function fetchWeWorkRemotely(variants: string[]): Promise<SourceOutput> {
    const report = newReport('WeWorkRemotely');
    try {
        const xml = await fetchText('https://weworkremotely.com/remote-jobs.rss', 'application/rss+xml,text/xml');
        const all = parseWeWorkRemotelyFeed(xml);
        report.reached = all.length > 0;
        const jobs = all
            .filter((j) => titleMatchesRoles(j.title, variants))
            .filter((j) => isEligibleLocation(j.location));
        report.found = jobs.length;
        return { jobs, reports: [report] };
    } catch (error) {
        report.note = (error as Error).message;
        return { jobs: [], reports: [report] };
    }
}

// ---------------------------------------------------------------------------
// Himalayas: public search API with a country filter (NG = Nigeria)
// ---------------------------------------------------------------------------

async function fetchHimalayas(variants: string[]): Promise<SourceOutput> {
    interface Item {
        title: string;
        excerpt?: string;
        description?: string;
        companyName?: string;
        employmentType?: string;
        locationRestrictions?: string[];
        pubDate?: number | string;
        applicationLink?: string;
        guid?: string;
    }
    const report = newReport('Himalayas');
    const jobs = new Map<string, JobPost>();

    for (const term of rotateVariants(variants, 2, 3)) {
        try {
            const data = await fetchJson<{ jobs?: Item[] }>(
                `https://himalayas.app/jobs/api/search?q=${encodeURIComponent(term)}&country=NG&limit=20`
            );
            report.reached = true;
            for (const item of data.jobs ?? []) {
                const link = item.guid || item.applicationLink;
                if (!link || jobs.has(link) || !titleMatchesRoles(item.title, variants)) continue;
                const restrictions = item.locationRestrictions ?? [];
                // Empty list means open worldwide; otherwise Nigeria or Africa must be allowed.
                const open = restrictions.length === 0 || restrictions.some((r) => /nigeria|africa/i.test(r));
                if (!open) continue;
                jobs.set(link, {
                    id: makeId('himalayas', link.split('/').slice(-3).join('-')),
                    title: item.title,
                    company: item.companyName || 'Remote Employer',
                    location: restrictions.length === 0 ? 'Worldwide (remote)' : 'Remote (open to Nigeria)',
                    url: link,
                    postedAt: parseDate(item.pubDate)?.toISOString() ?? '',
                    source: 'Himalayas',
                    sourceCategory: CATEGORY,
                    postType: 'listing',
                    rawText: htmlToText(item.description || item.excerpt || '').slice(0, 2500)
                });
            }
        } catch (error) {
            report.note = (error as Error).message;
        }
    }
    report.found = jobs.size;
    return { jobs: [...jobs.values()], reports: [report] };
}

// ---------------------------------------------------------------------------
// Jobicy: public remote jobs API
// ---------------------------------------------------------------------------

async function fetchJobicy(variants: string[]): Promise<SourceOutput> {
    interface Item {
        id: number;
        url: string;
        jobTitle: string;
        companyName?: string;
        jobGeo?: string;
        jobExcerpt?: string;
        jobDescription?: string;
        pubDate?: string;
    }
    const report = newReport('Jobicy');
    const jobs = new Map<number, JobPost>();
    // Jobicy's tag search is free text but needs 3+ characters ("ai" is rejected).
    const tags = rotateVariants(variants, 3, 3).filter((t) => t.length >= 3);

    for (const tag of tags) {
        try {
            const data = await fetchJson<{ jobs?: Item[] }>(
                `https://jobicy.com/api/v2/remote-jobs?count=50&tag=${encodeURIComponent(tag)}`
            );
            report.reached = true;
            for (const item of data.jobs ?? []) {
                const location = item.jobGeo || 'Remote';
                if (jobs.has(item.id) || !titleMatchesRoles(item.jobTitle, variants) || !isEligibleLocation(location)) continue;
                jobs.set(item.id, {
                    id: makeId('jobicy', String(item.id)),
                    title: htmlToText(item.jobTitle),
                    company: item.companyName || 'Remote Employer',
                    location,
                    url: item.url,
                    postedAt: parseDate(item.pubDate)?.toISOString() ?? '',
                    source: 'Jobicy',
                    sourceCategory: CATEGORY,
                    postType: 'listing',
                    rawText: htmlToText(item.jobDescription || item.jobExcerpt || '').slice(0, 2500)
                });
            }
        } catch (error) {
            report.note = (error as Error).message;
        }
    }
    report.found = jobs.size;
    return { jobs: [...jobs.values()], reports: [report] };
}

// ---------------------------------------------------------------------------
// Working Nomads: one public JSON list of current remote jobs
// ---------------------------------------------------------------------------

async function fetchWorkingNomads(variants: string[]): Promise<SourceOutput> {
    interface Item {
        url: string;
        title: string;
        description?: string;
        company_name?: string;
        location?: string;
        pub_date?: string;
    }
    const report = newReport('Working Nomads');
    try {
        const data = await fetchJson<Item[]>('https://www.workingnomads.com/api/exposed_jobs/');
        report.reached = Array.isArray(data);
        const jobs = (Array.isArray(data) ? data : [])
            .filter((j) => j.title && j.url && titleMatchesRoles(j.title, variants))
            .filter((j) => isEligibleLocation(j.location || 'Remote'))
            .map(
                (j): JobPost => ({
                    id: makeId('workingnomads', j.url.replace(/\D+/g, ' ').trim().split(' ').pop() ?? j.url),
                    title: htmlToText(j.title),
                    company: j.company_name || 'Remote Employer',
                    location: j.location || 'Remote',
                    url: j.url,
                    postedAt: parseDate(j.pub_date)?.toISOString() ?? '',
                    source: 'Working Nomads',
                    sourceCategory: CATEGORY,
                    postType: 'listing',
                    rawText: htmlToText(j.description || j.title).slice(0, 2500)
                })
            );
        report.found = jobs.length;
        return { jobs, reports: [report] };
    } catch (error) {
        report.note = (error as Error).message;
        return { jobs: [], reports: [report] };
    }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function fetchRemoteBoards(roles: string[], variants: string[]): Promise<SourceOutput> {
    const results = await Promise.all([
        fetchRemoteOK(roles, variants),
        fetchRemotive(variants),
        fetchWeWorkRemotely(variants),
        fetchHimalayas(variants),
        fetchJobicy(variants),
        fetchWorkingNomads(variants)
    ]);
    return {
        jobs: results.flatMap((r) => r.jobs),
        reports: results.flatMap((r) => r.reports)
    };
}
