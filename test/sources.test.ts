import { describe, expect, it } from 'vitest';

import { dedupeJobs } from '../src/scraper.js';
import { relevance, roleKeywords, selectDiverse } from '../src/selection.js';
import {
    canonicalUrl,
    isEligibleLocation,
    isOffTopicTitle,
    parseDayMonth,
    qualityGate,
    roleVariants,
    rotateVariants,
    titleMatchesRoles
} from '../src/sources/common.js';
import {
    parseHotNigerianJobsFeed,
    parseJobbermanListing,
    parseMyJobMagListing,
    splitTitleAndCompany
} from '../src/sources/nigerianBoards.js';
import { parseWeWorkRemotelyFeed } from '../src/sources/remoteBoards.js';
import { buildXQuery, tweetToLead } from '../src/sources/social.js';
import { JobPost } from '../src/types.js';

const job = (over: Partial<JobPost>): JobPost => ({
    id: 'x',
    title: 'Data Analyst',
    company: 'Acme',
    location: 'Lagos',
    url: 'https://example.com/a',
    postedAt: '',
    source: 'Test',
    rawText: 'Analyse data.',
    ...over
});

describe('role expansion', () => {
    it('adds synonyms and Nigerian variants', () => {
        const v = roleVariants(['Data Analyst', 'Virtual Assistant']);
        expect(v).toContain('bi analyst');
        expect(v).toContain('reporting analyst');
        expect(v).toContain('executive assistant');
        expect(v).toContain('admin assistant');
    });

    it('matches whole words only for very short variants', () => {
        const v = roleVariants(['Virtual Assistant']);
        expect(titleMatchesRoles('VA - Day Shift', v)).toBe(true);
        expect(titleMatchesRoles('Chief Executive Officer of Nevada Holdings', v)).toBe(false);
    });

    it('rotates different variants per site', () => {
        const v = ['a', 'b', 'c', 'd'];
        expect(rotateVariants(v, 0, 2)).toEqual(['a', 'b']);
        expect(rotateVariants(v, 3, 2)).toEqual(['d', 'a']);
    });
});

describe('location gate', () => {
    it.each([
        ['Remote', true],
        ['Worldwide (remote)', true],
        ['Anywhere in the World', true],
        ['Remote - Africa', true],
        ['EMEA', true],
        ['Lagos', true],
        ['Remote, Nigeria', true],
        ['', true],
        ['Remote (US)', false],
        ['Remote, Poland', false],
        ['USA only', false],
        ['Europe', false],
        ['Hybrid', false],
        ['Hybrid, Lagos', true],
        ['New York, NY', false],
        ['Philippines, Guatemala, South Africa', false]
    ])('"%s" -> %s', (location, expected) => {
        expect(isEligibleLocation(location)).toBe(expected);
    });
});

describe('quality gates', () => {
    const now = new Date('2026-09-25T00:00:00Z');

    it('drops teaching posts for non-teaching seekers only', () => {
        expect(isOffTopicTitle('Data Science Lecturer', ['Data Scientist'])).toBe(true);
        expect(isOffTopicTitle('Senior Data Scientist', ['Data Scientist'])).toBe(false);
        expect(isOffTopicTitle('Data Science Instructor', ['Data Science Instructor'])).toBe(false);
    });

    it('drops closed listings', () => {
        const reason = qualityGate(job({ rawText: 'This position has been filled.' }), { maxAgeDays: 30, now });
        expect(reason).toMatch(/closed/);
    });

    it('drops old listings but keeps unknown dates', () => {
        expect(qualityGate(job({ postedAt: '2026-06-01T00:00:00Z' }), { maxAgeDays: 30, now })).toMatch(/older/);
        expect(qualityGate(job({ postedAt: '' }), { maxAgeDays: 30, now })).toBeNull();
        expect(qualityGate(job({ postedAt: '2026-09-20T00:00:00Z' }), { maxAgeDays: 30, now })).toBeNull();
    });

    it('drops non-http links', () => {
        expect(qualityGate(job({ url: 'javascript:alert(1)' }), { maxAgeDays: 30, now })).not.toBeNull();
    });

    it('reads a day-and-month date without a year', () => {
        const d = parseDayMonth('23 September', new Date('2026-09-25T00:00:00Z'));
        expect(d?.toISOString().slice(0, 10)).toBe('2026-09-23');
        // "28 December" seen on 5 January is last year, not the future.
        const past = parseDayMonth('28 December', new Date('2026-01-05T00:00:00Z'));
        expect(past?.toISOString().slice(0, 10)).toBe('2025-12-28');
    });
});

describe('dedupe', () => {
    it('collapses tracking-param links', () => {
        expect(canonicalUrl('https://www.Site.com/job/1/?utm_source=x')).toBe(canonicalUrl('https://site.com/job/1'));
    });

    it('keeps the employer (ATS) copy of a cross-posted role', () => {
        const board = job({ id: 'b', url: 'https://board.example/1', sourceCategory: 'remote-board', source: 'Board' });
        const ats = job({ id: 'a', url: 'https://ats.example/1', sourceCategory: 'ats', source: 'Greenhouse' });
        const out = dedupeJobs([board, ats]);
        expect(out).toHaveLength(1);
        expect(out[0].source).toBe('Greenhouse');
    });

    it('does not merge different social leads by title', () => {
        const a = job({ id: '1', title: 'we are hiring', url: 'https://x.com/a/status/1', postType: 'social-signal' });
        const b = job({ id: '2', title: 'we are hiring', url: 'https://x.com/b/status/2', postType: 'social-signal' });
        expect(dedupeJobs([a, b])).toHaveLength(2);
    });
});

describe('source diversity', () => {
    it('never lets one source exceed its share while others can fill the list', () => {
        const many = Array.from({ length: 20 }, (_, i) =>
            job({ id: `h${i}`, title: `Data Scientist ${i}`, url: `https://h.example/${i}`, source: 'Himalayas', sourceCategory: 'remote-board' })
        );
        const others = [
            job({ id: 'm1', title: 'Data Scientist', url: 'https://m.example/1', source: 'MyJobMag', sourceCategory: 'nigerian-board' }),
            job({ id: 'm2', title: 'Data Analyst', url: 'https://m.example/2', source: 'MyJobMag', sourceCategory: 'nigerian-board' }),
            job({ id: 'g1', title: 'Data Scientist', url: 'https://g.example/1', source: 'Greenhouse', sourceCategory: 'ats' }),
            job({ id: 'g2', title: 'Data Engineer', url: 'https://g.example/2', source: 'Ashby', sourceCategory: 'ats' })
        ];
        const keywords = roleKeywords(['Data Scientist']);
        const picked = selectDiverse([...many, ...others], 10, (j) => relevance(j, keywords), { maxShare: 0.3 });

        expect(picked).toHaveLength(10);
        const himalayas = picked.filter((j) => j.source === 'Himalayas').length;
        // cap is 3 of 10; a top-up only happens because the other sources ran out.
        expect(himalayas).toBeGreaterThanOrEqual(3);
        expect(picked.some((j) => j.source === 'MyJobMag')).toBe(true);
        expect(picked.some((j) => j.sourceCategory === 'ats')).toBe(true);
    });

    it('stays under the cap when enough other sources exist', () => {
        const mk = (source: string, category: JobPost['sourceCategory'], n: number) =>
            Array.from({ length: n }, (_, i) =>
                job({ id: `${source}${i}`, title: 'Data Scientist', url: `https://${source}.example/${i}`, source, sourceCategory: category })
            );
        const all = [...mk('A', 'remote-board', 10), ...mk('B', 'nigerian-board', 10), ...mk('C', 'ats', 10), ...mk('D', 'ats', 10)];
        const picked = selectDiverse(all, 10, () => 1, { maxShare: 0.3 });
        for (const s of ['A', 'B', 'C', 'D']) {
            expect(picked.filter((j) => j.source === s).length).toBeLessThanOrEqual(3);
        }
    });

    it('boosts Nigerian jobs when the seeker prefers Nigeria', () => {
        const k = ['data'];
        const local = job({ location: 'Lagos', sourceCategory: 'nigerian-board' });
        const foreign = job({ location: 'Remote', sourceCategory: 'remote-board' });
        expect(relevance(local, k, ['Nigeria'])).toBeGreaterThan(relevance(foreign, k, ['Nigeria']));
        expect(relevance(local, k, [])).toBe(relevance(foreign, k, []));
    });
});

describe('Nigerian board parsers', () => {
    it('splits "Role at Company"', () => {
        expect(splitTitleAndCompany('Data Analyst at Acme Ltd')).toEqual({ role: 'Data Analyst', company: 'Acme Ltd' });
        expect(splitTitleAndCompany('Data Analyst - Alaba at Iknorbert Ltd')).toEqual({
            role: 'Data Analyst - Alaba',
            company: 'Iknorbert Ltd'
        });
    });

    it('parses the HotNigerianJobs RSS feed', () => {
        const xml = `<rss><channel><item>
            <title>IT Specialist at Spring of Hope Nigeria</title>
            <link>https://www.hotnigerianjobs.com/hotjobs/964125/it-specialist.html</link>
            <description>Spring of Hope is recruiting. The position is located in Lagos State. Salary: N200,000.</description>
            <pubDate>Wed, 23 Sep 2026 18:23:43 +0100</pubDate>
        </item></channel></rss>`;
        const [j] = parseHotNigerianJobsFeed(xml);
        expect(j.title).toBe('IT Specialist');
        expect(j.company).toBe('Spring of Hope Nigeria');
        expect(j.location).toBe('Lagos State');
        expect(j.sourceCategory).toBe('nigerian-board');
        expect(j.postedAt.startsWith('2026-09-23')).toBe(true);
    });

    it('parses a MyJobMag listing page', () => {
        const html = `<ul><li class="job-list-li">
            <ul><li class="job-logo"><a href="/jobs-at/x"><img src="a.jpg"></a></li>
            <li class="job-info"><ul>
              <li class="mag-b"><h2><a href="/job/data-scientist-ipsos">Data Scientist at Ipsos</a></h2></li>
              <li class="job-desc">Ipsos is hiring a data scientist to build models.</li>
              <li class="job-item"><ul><li id="job-date">22 September <span><a href="/jobs-location/lagos">Lagos</a></span></li></ul></li>
            </ul></li></ul></li></ul>`;
        const [j] = parseMyJobMagListing(html, new Date('2026-09-25T00:00:00Z'));
        expect(j.title).toBe('Data Scientist');
        expect(j.company).toBe('Ipsos');
        expect(j.location).toBe('Lagos');
        expect(j.url).toBe('https://www.myjobmag.com/job/data-scientist-ipsos');
        expect(j.postedAt.slice(0, 10)).toBe('2026-09-22');
    });

    it('parses a Jobberman listing card', () => {
        const html = `<div data-cy="listing-cards-components">
            <a href="https://www.jobberman.com/listings/sales-rep-abc" data-cy="listing-title-link" title="Sales Representative">
              <p>Sales Representative</p></a>
            <p class="text-sm text-blue-700 text-loading-animate inline-block mt-3"> Shake Shack Lekki </p>
            <div><span class="mb-3 px-3 py-1 rounded"> Lagos </span><span class="mb-3 px-3 py-1 rounded">Full Time</span></div>
            </div>`;
        const [j] = parseJobbermanListing(html);
        expect(j.title).toBe('Sales Representative');
        expect(j.company).toBe('Shake Shack Lekki');
        expect(j.location).toBe('Lagos');
    });
});

describe('remote board parsers', () => {
    it('parses We Work Remotely items and splits company from role', () => {
        const xml = `<rss><channel><item>
            <title>Acme: DevOps Engineer (Remote)</title>
            <region>Anywhere in the World</region>
            <description>&lt;p&gt;Great job&lt;/p&gt;</description>
            <pubDate>Thu, 24 Sep 2026 10:00:00 +0000</pubDate>
            <link>https://weworkremotely.com/remote-jobs/acme-devops</link>
        </item></channel></rss>`;
        const [j] = parseWeWorkRemotelyFeed(xml);
        expect(j.company).toBe('Acme');
        expect(j.title).toBe('DevOps Engineer (Remote)');
        expect(j.location).toBe('Anywhere in the World');
        expect(isEligibleLocation(j.location)).toBe(true);
    });
});

describe('social signals', () => {
    it('builds a query under the X limit and only for verified accounts', () => {
        const terms = Array.from({ length: 12 }, (_, i) => `very long role title number ${i} for testing`);
        const q = buildXQuery(['we\'re hiring', 'now hiring', 'DM your CV'], terms);
        expect(q.length).toBeLessThanOrEqual(512);
        expect(q).toContain('is:verified');
        expect(q).toContain('-is:retweet');
    });

    it('marks every social lead as verified, social-signal and verify-manually', () => {
        const lead = tweetToLead(
            { id: '123', text: "We're hiring a data analyst! DM your CV.", created_at: '2026-09-24T10:00:00Z' },
            { id: '9', username: 'acme', name: 'Acme', verified: true },
            'hiring'
        );
        expect(lead.postType).toBe('social-signal');
        expect(lead.verified).toBe(true);
        expect(lead.verifyManually).toBe(true);
        expect(lead.url).toBe('https://x.com/acme/status/123');
        expect(lead.rawText).toMatch(/verify manually/i);
    });
});
