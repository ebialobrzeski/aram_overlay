// Worker thread: runs the template matching off the main process so the overlay stays responsive.
import { parentPort, workerData } from 'node:worker_threads';
import { matchTemplates, type Gray, type Match, type Region, type Template } from '../shared/match';

interface Job { img: { width: number; height: number; data: Float32Array }; templates: Template[]; regions: { bench: Region; team: Region }; benchKeys: string[]; teamKeys: string[] }

const job = workerData as Job;
const img: Gray = { width: job.img.width, height: job.img.height, data: job.img.data };
const benchSet = new Set(job.benchKeys), teamSet = new Set(job.teamKeys);
const started = Date.now();
const matches: Match[] = [
  ...matchTemplates(img, job.templates.filter(t => benchSet.has(t.key)), job.regions.bench),
  ...matchTemplates(img, job.templates.filter(t => teamSet.has(t.key)), job.regions.team),
];
parentPort?.postMessage({ matches, ms: Date.now() - started });
