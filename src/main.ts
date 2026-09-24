import { createHash } from 'node:crypto';
import { Actor } from 'apify';
import { CandidateInput, JobPost, ProcessedJob } from './types.js';
import { fetchLiveJobsForRoles } from './scraper.js';
import { evaluateJob, generateApplicationPack } from './ai.js';
import { renderDashboard } from './dashboard.js';
import { sendApplicationEmail } from './email.js';

// IMPORTANT: these must match the event names in
// Apify Console > your Actor > Publication > Monetization, exactly.
const EVENT_MATCH = 'match-found';
const EVENT_PACK = 'application-pack-drafted';

// Keep runs fast: only the most relevant new jobs go to the LLM.
const MAX_JOBS_TO_EVALUATE = 15;
// How many LLM evaluations run at the same time.
const CONCURRENCY = 10;
// Cap the memory list so it cannot grow forever.
const MAX_SEEN_IDS = 2000;

type EvalResult = Awaited<ReturnType<typeof evaluateJob>>;
type Evaluated = { job: JobPost; result: EvalResult };

/** All string fields of a job joined into one lowercase blob for keyword checks. */
function jobText(job: JobPost): string {
    return Object.values(job as unknown as Record<string, unknown>)
        .filter((v): v is string => typeof v === 'string')
        .join(' ')
        .toLowerCase();
}

/** Split target roles into unique lowercase keywords, e.g. "Machine Learning Engineer" -> machine, learning, engineer. */
function roleKeywords(roles: string[]): string[] {
    const words = roles
        .join(' ')
        .toLowerCase()
        .split(/[^a-z0-9+#]+/)
        .filter((w) => w.length > 2);
    return [...new Set(words)];
}

function relevance(job: JobPost, keywords: string[]): number {
    const text = jobText(job);
    return keywords.reduce((n, k) => (text.includes(k) ? n + 1 : n), 0);
}

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

    // 1. Fetch live jobs
    let rawJobs: JobPost[];
    try {
        rawJobs = await fetchLiveJobsForRoles(targetRoles, Boolean(input.includeDemoListings));
    } catch (error) {
        throw new Error(
            `Could not fetch job feeds right now: ${(error as Error).message}`
        );
    }
    console.log(`[WorkDey Ingestion] Discovered ${rawJobs.length} live job postings.`);

    // 2. Keep only new jobs, then shortlist the most relevant ones for the LLM
    const fresh = rawJobs.filter((job) => !seen.has(job.id));
    const keywords = roleKeywords(targetRoles);

    const shortlist = fresh
        .map((job) => ({ job, score: relevance(job, keywords) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_JOBS_TO_EVALUATE)
        .map((x) => x.job);

    console.log(
        `[WorkDey Ingestion] ${fresh.length} new postings; evaluating the top ${shortlist.length}.`
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
        seen.add(e.job.id);
    }
    for (const e of rejected) {
        await save(toProcessed(e, 'REJECTED'));
        seen.add(e.job.id);
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

    if (matchCharge.eventChargeLimitReached) {
        console.warn(
            `[WorkDey Billing] Match charge limit reached. Stopping delivery.`
        );
        limitReached = true;
        break;
    }

    let applicationPack: ProcessedJob['applicationPack'] | undefined;

    // 2. Only generate an application pack after the match has
    // successfully been charged.
    if (packsDelivered < maxPacks) {
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

            if (packCharge.eventChargeLimitReached) {
                console.warn(
                    `[WorkDey Billing] Application pack charge limit reached.`
                );
                limitReached = true;
            } else {
                applicationPack = generatedPack;
                packsDelivered++;
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

    seen.add(e.job.id);
    matchesDelivered++;
}
    // 8. Save memory (only jobs we actually processed are marked as seen)
    await store.setValue(key, [...seen].slice(-MAX_SEEN_IDS));

    // 9. Build the dashboard (saved in this run's own default store, separate from the named memory store)
    const runStore = await Actor.openKeyValueStore();
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
        `${packsDelivered} application packs.` +
        (limitReached ? ' Stopped early: spending limit reached.' : '');

    console.log(`[WorkDey] ${summary}`);
    await Actor.setStatusMessage(`${summary} Dashboard: ${dashboardUrl}`);
});