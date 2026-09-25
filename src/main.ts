import { createHash } from 'node:crypto';
import { Actor } from 'apify';
import { CandidateInput, JobPost, ProcessedJob } from './types.js';
import { countReached, fetchLiveJobsForRoles } from './scraper.js';
import { evaluateJob, generateApplicationPack } from './ai.js';
import { renderDashboard } from './dashboard.js';
import { sendApplicationEmail } from './email.js';
import { relevance, roleKeywords, selectDiverse } from './selection.js';
import { canonicalUrl, mapLimit } from './sources/common.js';
import { enrichNigerianJob } from './sources/nigerianBoards.js';

// IMPORTANT: these must match the event names in
// Apify Console > your Actor > Publication > Monetization, exactly.
const EVENT_MATCH = 'match-found';
const EVENT_PACK = 'application-pack-drafted';

// Keep runs fast: only the most relevant new jobs go to the LLM.
const MAX_JOBS_TO_EVALUATE = 15;
// How many LLM evaluations run at the same time.
const CONCURRENCY = 10;
// Cap the memory list so it cannot grow forever (each job stores its id and its link).
const MAX_SEEN_IDS = 4000;
// A run that reaches fewer sources than this is treated as a failed sweep.
const MIN_SOURCES_REACHED = 6;

type EvalResult = Awaited<ReturnType<typeof evaluateJob>>;
type Evaluated = { job: JobPost; result: EvalResult };

/** A job counts as already sent if either its id or its original link was seen before. */
const seenKeys = (job: JobPost): string[] => [job.id, `url:${canonicalUrl(job.url)}`];

/** Stable per-candidate key so each person's seen-jobs list is separate. */
function memoryKey(input: CandidateInput): string {
    const email = (input as { email?: string }).email ?? '';
    const who = `${email}|${input.fullName}|${[...input.targetRoles].sort().join(',')}`;
    return `seen-${createHash('sha1').update(who.toLowerCase()).digest('hex').slice(0, 16)}`;
}

function buildApplicationEmail(
    fullName: string,
    results: ProcessedJob[],
    dashboardUrl: string
): string {
    const matches = results.filter(
        (job) => job.status === 'MATCHED' && job.applicationPack
    );

    const jobSections = matches
        .map((job) => {
            const pack = job.applicationPack!;

            const cvTips = pack.cvTips.length
                ? `<ul>${pack.cvTips.map((tip) => `<li>${tip}</li>`).join('')}</ul>`
                : '<p>No CV tips provided.</p>';

            const factsUsed = pack.factsUsed?.length
                ? `<ul>${pack.factsUsed.map((fact) => `<li>${fact}</li>`).join('')}</ul>`
                : '<p>No facts-used list provided.</p>';

            return `
                <hr>
                <h2>${job.title} at ${job.company}</h2>

                <p>
                    <strong>Match score:</strong> ${job.score}/100<br>
                    <strong>Location:</strong> ${job.location}<br>
                    <strong>Source:</strong> ${job.source}
                </p>

                <p>
                    <a href="${job.url}">View job posting</a>
                </p>

                <h3>Recruiter Reply</h3>
                <p>${pack.reply.replace(/\n/g, '<br>')}</p>

                <h3>Cover Letter</h3>
                <p>${pack.coverLetter.replace(/\n/g, '<br>')}</p>

                <h3>CV Tips</h3>
                ${cvTips}

                <h3>Facts Used</h3>
                ${factsUsed}
            `;
        })
        .join('');

    return `
        <html>
        <body>
            <h1>Your WorkDey Application Pack</h1>

            <p>Hi ${fullName},</p>

            <p>
                WorkDey found ${matches.length} matched
                ${matches.length === 1 ? 'role' : 'roles'}
                and prepared your application materials.
            </p>

            ${jobSections}

            <hr>

            <p>
                <a href="${dashboardUrl}">
                    View your full WorkDey dashboard
                </a>
            </p>

            <p>
                Good luck with your applications.
            </p>

            <p>
                <strong>WorkDey</strong>
            </p>
        </body>
        </html>
    `;
}

await Actor.main(async () => {
    const input = await Actor.getInput<CandidateInput>();

    if (!input || !input.cvText || !input.targetRoles?.length || !input.fullName) {
        throw new Error(
            'Missing required input fields: cvText, targetRoles, and fullName are required.'
        );
    }

    const {
        fullName,
        targetRoles,
        minScore = 60,
        maxPacks = 2,
        resetMemory = false
    } = input;

    console.log(`[WorkDey] Starting match run for: ${fullName}`);
    console.log(`[WorkDey] Target Roles: ${targetRoles.join(', ')}`);
    await Actor.setStatusMessage('Loading memory and scanning job feeds...');

    // NAMED store: persists across runs (the default store is new for every run,
    // so it cannot remember anything between runs).
    const store = await Actor.openKeyValueStore('workdey-memory');
    const key = memoryKey(input);

    const previouslySeen: string[] = resetMemory
        ? []
        : ((await store.getValue<string[]>(key)) ?? []);
    const seen = new Set<string>(previouslySeen);

    console.log(
        resetMemory
            ? '[WorkDey Memory] Memory reset requested. Ignoring previously seen jobs.'
            : `[WorkDey Memory] Loaded ${seen.size} previously seen job IDs.`
    );

    // 1. Sweep every source category
    let ingestion: Awaited<ReturnType<typeof fetchLiveJobsForRoles>>;
    try {
        ingestion = await fetchLiveJobsForRoles(targetRoles, {
            includeDemoListings: Boolean(input.includeDemoListings),
            maxJobAgeDays: input.maxJobAgeDays,
            skills: input.skills,
            includeSocialSignals: input.includeSocialSignals,
            xBearerToken: input.xBearerToken
        });
    } catch (error) {
        throw new Error(
            `Could not fetch job feeds right now: ${(error as Error).message}`
        );
    }
    const rawJobs = ingestion.jobs;
    const sourcesReached = countReached(ingestion.reports);
    console.log(`[WorkDey Ingestion] Discovered ${rawJobs.length} live job postings from ${sourcesReached} sources.`);
    if (sourcesReached < MIN_SOURCES_REACHED) {
        console.warn(
            `[WorkDey Ingestion] Only ${sourcesReached} sources answered (expected at least ${MIN_SOURCES_REACHED}). ` +
                'This sweep is incomplete: check the network or the run report.'
        );
    }

    // The run report makes a single-site collapse visible at a glance.
    const runStore = await Actor.openKeyValueStore();
    await runStore.setValue('RUN_REPORT', {
        generatedAt: new Date().toISOString(),
        sourcesReached,
        totalJobs: rawJobs.length,
        dropped: ingestion.dropped,
        sources: ingestion.reports
    });

    // 2. Keep only new jobs, then shortlist the most relevant ones for the LLM,
    //    with no single source allowed to fill more than ~30% of the list.
    const fresh = rawJobs.filter((job) => !seenKeys(job).some((k) => seen.has(k)));
    const keywords = roleKeywords(targetRoles);
    const preferred = input.preferredLocations ?? input.locations ?? [];

    const picked = selectDiverse(fresh, MAX_JOBS_TO_EVALUATE, (job) =>
        relevance(job, keywords, preferred)
    );
    // Listing snippets are short; pull the full posting text for the few we will evaluate.
    const shortlist = await mapLimit(picked, 4, (job) => enrichNigerianJob(job));

    const bySource = shortlist.reduce<Record<string, number>>((acc, j) => {
        acc[j.source] = (acc[j.source] ?? 0) + 1;
        return acc;
    }, {});
    console.log(
        `[WorkDey Ingestion] ${fresh.length} new postings; evaluating the top ${shortlist.length}. ` +
            `Shortlist by source: ${JSON.stringify(bySource)}`
    );

    if (shortlist.length === 0) {
        await Actor.setStatusMessage(
            'No new jobs found for these roles. Try different roles, or enable Reset Memory.'
        );
        return;
    }

    // 3. Evaluate in small parallel batches
    const evaluated: Evaluated[] = [];

    for (let i = 0; i < shortlist.length; i += CONCURRENCY) {
        const batch = shortlist.slice(i, i + CONCURRENCY);
        const settled = await Promise.allSettled(
            batch.map((job) => evaluateJob(job, input))
        );

        settled.forEach((outcome, idx) => {
            const job = batch[idx];
            if (outcome.status === 'fulfilled') {
                evaluated.push({ job, result: outcome.value });
                console.log(
                    `[WorkDey Triage] "${job.title}" at "${job.company}" -> ${outcome.value.score}/100${
                        outcome.value.isScam ? ' (SCAM)' : ''
                    }`
                );
            } else {
                // Not marked as seen, so it gets retried on the next run.
                console.error(
                    `[WorkDey Error] Failed to evaluate "${job.title}":`,
                    outcome.reason
                );
            }
        });

        await Actor.setStatusMessage(
            `Evaluated ${Math.min(i + CONCURRENCY, shortlist.length)}/${shortlist.length} jobs`
        );
    }

    // 4. Split results
    const scams = evaluated.filter((e) => e.result.isScam);
    const rejected = evaluated.filter(
        (e) => !e.result.isScam && e.result.score < minScore
    );
    const matched = evaluated
        .filter((e) => !e.result.isScam && e.result.score >= minScore)
        .sort((a, b) => b.result.score - a.result.score); // best first

    for (const e of scams) {
        console.warn(
            `[WorkDey Scam Alert] "${e.job.title}": ${e.result.scamReason ?? 'suspicious pattern'}`
        );
    }

    const toProcessed = (
        e: Evaluated,
        status: ProcessedJob['status'],
        applicationPack?: ProcessedJob['applicationPack']
    ): ProcessedJob => ({
        ...e.job,
        score: e.result.score,
        isScam: e.result.isScam,
        scamReason: e.result.scamReason ?? null,
        fitReasons: e.result.fitReasons,
        applicationPack,
        status,
        processedAt: new Date().toISOString()
    });

    // Everything we save also goes into the dashboard.
    const results: ProcessedJob[] = [];
    const save = async (item: ProcessedJob) => {
        results.push(item);
        await Actor.pushData(item);
    };

    // 6. Save free results first: scams and rejected roles are never charged
    for (const e of scams) {
        await save(toProcessed(e, 'SCAM'));
        seenKeys(e.job).forEach((k) => seen.add(k));
    }
    for (const e of rejected) {
        await save(toProcessed(e, 'REJECTED'));
        seenKeys(e.job).forEach((k) => seen.add(k));
    }

    // 7. Save matches, charging only after successful delivery
let matchesDelivered = 0;
let packsDelivered = 0;
let limitReached = false;

for (const e of matched) {
    if (limitReached) break;

    // 1. Charge for the verified match first.
    const matchCharge = await Actor.charge({
        eventName: EVENT_MATCH
    });

    // "eventChargeLimitReached" is also true right AFTER a successful charge that
    // used up the budget, so success is judged by chargedCount, not by that flag.
    if (matchCharge.chargedCount < 1) {
        console.warn(
            `[WorkDey Billing] Match charge limit reached. Stopping delivery.`
        );
        limitReached = true;
        break;
    }
    // This match is paid for and will be delivered, but nothing more can be charged.
    if (matchCharge.eventChargeLimitReached) limitReached = true;

    let applicationPack: ProcessedJob['applicationPack'] | undefined;

    // 2. Only generate an application pack after the match has
    // successfully been charged.
    if (packsDelivered < maxPacks && !limitReached) {
        await Actor.setStatusMessage(
            `Drafting application pack ${packsDelivered + 1}/${maxPacks}...`
        );

        try {
            const generatedPack = await generateApplicationPack(
                e.job,
                input
            );

            // 3. Charge for the application pack only after
            // generation succeeds.
            const packCharge = await Actor.charge({
                eventName: EVENT_PACK
            });

            if (packCharge.chargedCount < 1) {
                console.warn(
                    `[WorkDey Billing] Application pack charge limit reached.`
                );
                limitReached = true;
            } else {
                // Charged successfully, so the customer always receives the pack.
                applicationPack = generatedPack;
                packsDelivered++;
                if (packCharge.eventChargeLimitReached) limitReached = true;
            }
        } catch (error) {
            console.error(
                `[WorkDey Error] Pack generation failed for "${e.job.title}":`,
                error
            );
        }
    }

    // 4. Deliver the match. If the pack charge was rejected,
    // the match is still delivered without an application pack.
    await save(
        toProcessed(
            e,
            'MATCHED',
            applicationPack
        )
    );

    seenKeys(e.job).forEach((k) => seen.add(k));
    matchesDelivered++;
}
    // 8. Save memory (only jobs we actually processed are marked as seen)
    await store.setValue(key, [...seen].slice(-MAX_SEEN_IDS));

    // 9. Build the dashboard (saved in this run's own default store, separate from the named memory store)
    await runStore.setValue(
        'OUTPUT_DASHBOARD.html',
        renderDashboard(results, { fullName, targetRoles }),
        { contentType: 'text/html; charset=utf-8' }
    );
   const dashboardUrl = runStore.getPublicUrl('OUTPUT_DASHBOARD.html');
    console.log(`[WorkDey] Dashboard: ${dashboardUrl}`);

    if (input.email && packsDelivered > 0) {
    try {
        await Actor.setStatusMessage('Sending your application pack by email...');

        const emailHtml = buildApplicationEmail(
            fullName,
            results,
            dashboardUrl
        );

        await sendApplicationEmail(
            input.email,
            `WorkDey Application Pack: ${packsDelivered} ${packsDelivered === 1 ? 'match' : 'matches'}`,
            emailHtml
        );

        console.log(`[WorkDey Email] Application pack sent to ${input.email}`);
    } catch (error) {
        console.error('[WorkDey Email] Failed to send application email:', error);
    }
}

    const summary =
        `Done: ${matchesDelivered} matches, ${scams.length} scams flagged, ` +
        `${packsDelivered} application packs, from ${sourcesReached} sources.` +
        (limitReached ? ' Stopped early: spending limit reached.' : '');

    console.log(`[WorkDey] ${summary}`);
    await Actor.setStatusMessage(`${summary} Dashboard: ${dashboardUrl}`);
});