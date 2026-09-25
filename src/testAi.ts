import { evaluateJob, generateApplicationPack } from './ai.js';
import { MOCK_JOBS } from './fixtures/mockJobs.js';

const mockCandidate = {
    fullName: 'Amina Bello',
    targetRoles: ['Data Analyst', 'Python Developer'],
    skills: ['Python', 'SQL', 'Tableau', 'Pandas'],
    locations: ['Lagos', 'Remote'],
    cvText: `
Amina Bello | Lagos, Nigeria | aminabello@example.com
EDUCATION: B.Sc. Computer Science, UNILAG (2024). NYSC Completed.
EXPERIENCE: Data Analyst Intern at Sterling Tech (2023-2024). Built Tableau dashboards, cleaned datasets with Python/Pandas, wrote SQL queries for monthly reporting.
PROJECTS: Churn Classifier with Scikit-learn (86% accuracy).
    `,
    minScore: 65,
    maxPacks: 2,
};

async function runTest() {
    console.log('--- TESTING WORKDEY AI AGENT WITH GROQ ---');

    for (const job of MOCK_JOBS) {
        console.log(`\nEvaluating: ${job.title} at ${job.company}`);
        const result = await evaluateJob(job, mockCandidate);
        console.log('Result:', JSON.stringify(result, null, 2));

        if (result.score >= 65 && !result.isScam) {
            console.log('\n--- High fit! Generating Application Pack ---');
            const pack = await generateApplicationPack(job, mockCandidate);
            console.log('Pack:', JSON.stringify(pack, null, 2));
        }
    }
}

runTest();