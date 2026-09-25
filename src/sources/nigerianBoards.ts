import * as cheerio from 'cheerio';

import type { JobPost, SourceReport } from '../types.js';
import {
    fetchText,
    htmlToText,
    makeId,
    mapLimit,
    parseDate,
    parseDayMonth,
    rotateVariants,
    sleep,
    slugify,
    titleMatchesRoles
} from './common.js';

/**
 * Nigerian job boards, read the way their robots.txt allows: public RSS feeds and
 * plain category / title listing pages. Search-query URLs (?q=, ?page=) are
 * disallowed by these sites, so they are never requested.
 */

export interface SourceOutput {
    jobs: JobPost[];
    reports: SourceReport[];
}

const CATEGORY = 'nigerian-board' as const;

/** "Data Analyst at Acme Ltd" -> { role: "Data Analyst", company: "Acme Ltd" } */
export function splitTitleAndCompany(full: string): { role: string; company: string } {
    const text = htmlToText(full);
    const i = text.lastIndexOf(' at ');
    if (i > 0) return { role: text.slice(0, i).trim(), company: text.slice(i + 4).trim() };
    return { role: text, company: 'Not stated' };
}

// ---------------------------------------------------------------------------
// HotNigerianJobs: RSS
// ---------------------------------------------------------------------------

function xmlTag(block: string, tag: string): string {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    if (!m) return '';
    return m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').trim();
}

export function parseHotNigerianJobsFeed(xml: string): JobPost[] {
    const jobs: JobPost[] = [];
    for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
        const block = match[1];
        const link = xmlTag(block, 'link');
        const rawTitle = xmlTag(block, 'title');
        if (!link || !rawTitle) continue;

        const { role, company } = splitTitleAndCompany(rawTitle);
        const description = htmlToText(xmlTag(block, 'description'));
        const loc = description.match(/located in ([^.]+?)(?:\.|$)/i)?.[1]?.trim();
        const id = link.match(/\/hotjobs\/(\d+)\//)?.[1] ?? slugify(link).slice(-40);

        jobs.push({
            id: makeId('hotnigerianjobs', id),
            title: role,
            company,
            location: loc || 'Nigeria',
            url: link,
            postedAt: parseDate(xmlTag(block, 'pubDate'))?.toISOString() ?? '',
            source: 'HotNigerianJobs',
            sourceCategory: CATEGORY,
            postType: 'listing',
            rawText: `${rawTitle}\n${description}`.slice(0, 1500)
        });
    }
    return jobs;
}

async function fetchHotNigerianJobs(variants: string[]): Promise<SourceOutput> {
    const report: SourceReport = { source: 'HotNigerianJobs', category: CATEGORY, reached: false, found: 0 };
    try {
        const xml = await fetchText('https://www.hotnigerianjobs.com/feed/', 'application/rss+xml,text/xml');
        const all = parseHotNigerianJobsFeed(xml);
        report.reached = all.length > 0;
        const jobs = all.filter((j) => titleMatchesRoles(j.title, variants));
        report.found = jobs.length;
        report.note = `${all.length} recent postings scanned`;
        return { jobs, reports: [report] };
    } catch (error) {
        report.note = (error as Error).message;
        return { jobs: [], reports: [report] };
    }
}

// ---------------------------------------------------------------------------
// MyJobMag: /jobs-by-title/<slug> and /jobs-by-field/<slug> listing pages
// ---------------------------------------------------------------------------

const MYJOBMAG_FIELDS: { when: RegExp; field: string }[] = [
    { when: /data|software|developer|engineer|devops|machine learning|\bai\b|\bml\b|cyber|cloud|it\b|web|frontend|backend|full[- ]?stack|ux|ui/, field: 'information-technology' },
    { when: /engineer|technician|mechanical|electrical|civil/, field: 'engineering' },
    { when: /assistant|admin|secretary|office|coordinator|hr\b|human resources/, field: 'administration' },
    { when: /account|audit|finance|tax/, field: 'accounting-audit' },
    { when: /sales|marketing|growth|brand|social media|content|copywriter|business development/, field: 'sales-marketing' },
    { when: /customer|support|care|success/, field: 'customer-care' }
];

export function parseMyJobMagListing(html: string, now = new Date()): JobPost[] {
    const $ = cheerio.load(html);
    const jobs: JobPost[] = [];

    $('li.job-list-li').each((_, el) => {
        const link = $(el).find('li.mag-b h2 a').first();
        const href = link.attr('href');
        const rawTitle = link.text().trim();
        if (!href || !rawTitle) return;

        const { role, company } = splitTitleAndCompany(rawTitle);
        const desc = $(el).find('li.job-desc').text().replace(/\s+/g, ' ').trim();
        const dateText = $(el).find('#job-date').first().clone().children().remove().end().text().trim();
        const location = $(el).find('#job-date a').first().text().trim() || 'Nigeria';
        const url = new URL(href, 'https://www.myjobmag.com').toString();

        jobs.push({
            id: makeId('myjobmag', href.replace(/^\/job\//, '')),
            title: role,
            company,
            location,
            url,
            postedAt: parseDayMonth(dateText, now)?.toISOString() ?? '',
            source: 'MyJobMag',
            sourceCategory: CATEGORY,
            postType: 'listing',
            rawText: `${rawTitle}\n${desc}`.slice(0, 1500)
        });
    });
    return jobs;
}

async function fetchMyJobMag(roles: string[], variants: string[]): Promise<SourceOutput> {
    const report: SourceReport = { source: 'MyJobMag', category: CATEGORY, reached: false, found: 0, attempted: 0, reachedCount: 0 };

    const urls = new Set<string>();
    // Title pages for a rotated slice of the role variants (roles first, then synonyms).
    for (const v of rotateVariants(variants, 0, 5)) {
        urls.add(`https://www.myjobmag.com/jobs-by-title/${slugify(v)}`);
    }
    // Broad field pages, page 1 and 2, for the fields the roles map to.
    const text = roles.join(' ').toLowerCase();
    const fields = MYJOBMAG_FIELDS.filter((f) => f.when.test(text)).map((f) => f.field);
    for (const field of fields.slice(0, 2)) {
        urls.add(`https://www.myjobmag.com/jobs-by-field/${field}`);
        urls.add(`https://www.myjobmag.com/jobs-by-field/${field}/2`);
    }

    const pages = [...urls];
    report.attempted = pages.length;
    const found: JobPost[] = [];

    await mapLimit(pages, 2, async (url) => {
        try {
            const html = await fetchText(url, 'text/html');
            const listing = parseMyJobMagListing(html);
            if (listing.length > 0) report.reachedCount!++;
            found.push(...listing.filter((j) => titleMatchesRoles(j.title, variants)));
        } catch {
            // Page missing (e.g. no such title slug) or blocked: counted in the report below.
        }
        await sleep(250); // be polite
    });

    report.reached = report.reachedCount! > 0;
    const unique = new Map(found.map((j) => [j.id, j]));
    report.found = unique.size;
    return { jobs: [...unique.values()], reports: [report] };
}

// ---------------------------------------------------------------------------
// Jobberman: the default listing only (its search URLs are disallowed by robots.txt)
// ---------------------------------------------------------------------------

export function parseJobbermanListing(html: string): JobPost[] {
    const $ = cheerio.load(html);
    const jobs: JobPost[] = [];

    $('[data-cy="listing-cards-components"]').each((_, el) => {
        const link = $(el).find('[data-cy="listing-title-link"]').first();
        const href = link.attr('href');
        const title = (link.attr('title') || link.text()).trim();
        if (!href || !title) return;

        const company = $(el).find('p.text-blue-700').first().text().replace(/\s+/g, ' ').trim();
        const chips = $(el)
            .find('span.rounded')
            .map((__, chip) => $(chip).text().replace(/\s+/g, ' ').trim())
            .get()
            .filter(Boolean);
        const text = $(el).text().replace(/\s+/g, ' ').trim();

        jobs.push({
            id: makeId('jobberman', href.split('/').pop() ?? slugify(href)),
            title,
            company: company || 'Not stated',
            location: chips[0] || 'Nigeria',
            url: href,
            postedAt: '',
            source: 'Jobberman',
            sourceCategory: CATEGORY,
            postType: 'listing',
            rawText: text.slice(0, 1500)
        });
    });
    return jobs;
}

async function fetchJobberman(variants: string[]): Promise<SourceOutput> {
    const report: SourceReport = { source: 'Jobberman', category: CATEGORY, reached: false, found: 0 };
    try {
        const html = await fetchText('https://www.jobberman.com/jobs', 'text/html');
        const all = parseJobbermanListing(html);
        report.reached = all.length > 0;
        const jobs = all.filter((j) => titleMatchesRoles(j.title, variants));
        report.found = jobs.length;
        report.note = 'default listing only (search pages are disallowed by robots.txt)';
        return { jobs, reports: [report] };
    } catch (error) {
        report.note = (error as Error).message;
        return { jobs: [], reports: [report] };
    }
}

// ---------------------------------------------------------------------------
// Public entry point + detail enrichment
// ---------------------------------------------------------------------------

export async function fetchNigerianBoards(roles: string[], variants: string[]): Promise<SourceOutput> {
    const results = await Promise.all([
        fetchHotNigerianJobs(variants),
        fetchMyJobMag(roles, variants),
        fetchJobberman(variants)
    ]);
    return {
        jobs: results.flatMap((r) => r.jobs),
        reports: results.flatMap((r) => r.reports)
    };
}

/** Selectors that hold the description on the boards we read. First non-empty wins. */
const DETAIL_SELECTORS = ['.job-details', '#printable', '.job-description', 'article'];

/**
 * Short listing snippets are not enough for the LLM to judge fit or spot a scam.
 * Fetch the full posting page for the few jobs that reach the shortlist.
 *
 * Only MyJobMag is enriched: its page has a clean description block. The
 * HotNigerianJobs RSS text already holds role, place, pay and requirements, and
 * its page is mostly navigation, so it is left as is.
 */
export async function enrichNigerianJob(job: JobPost): Promise<JobPost> {
    if (job.source !== 'MyJobMag' || job.rawText.length >= 900) return job;
    try {
        const $ = cheerio.load(await fetchText(job.url, 'text/html'));
        $('script, style, nav, header, footer, aside, form, select, option, noscript').remove();
        for (const selector of DETAIL_SELECTORS) {
            const el = $(selector).first();
            if (el.length === 0) continue;
            const text = el.text().replace(/\s+/g, ' ').trim();
            if (text.length > 200) return { ...job, rawText: `${job.title}\n${text}`.slice(0, 2500) };
        }
    } catch {
        // keep the snippet
    }
    return job;
}
