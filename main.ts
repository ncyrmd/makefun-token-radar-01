// Token Radar's entry program (Node 22, standard library only).
//
// It reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// scores every rankable pre-token protocol with the calibrated model in
// lib/model.ts — farm plans live in lib/plans.ts — writes the ranked board to
// /output/board.json, and copies this repository's dashboard/ and screenshots/
// to /output. Last, it writes /output/dossier.json, the summary the judge
// reads, with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network:
// dashboard/index.html, dashboard/app.css and dashboard/app.js read
// /output/data.js, which this program writes from the same board. The page
// and the board are one model: the page recomputes every row from the
// snapshot figures, so what it shows and what board.json carries are visibly
// the same arithmetic. The model section's age curve panel draws the same
// calibration the board was scored with, so the curve and the ranks agree.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadarData, dataModule, readSnapshot, validateBoard } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps: the text cap shapes the bytes, the rest refuse. */
const TEXT_CAP_BYTES = 65_536;
const SHOT_LIMITS = { max: 4, max_bytes: 524_288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/**
 * Read `--name <value>` (or `--name=<value>`) from the arguments, else the
 * fallback. A bare `--name` with no value is a mistake, not a silent
 * fallback: fail loudly so a typo never runs against the default input by
 * accident.
 */
function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0) {
    if (at + 1 >= process.argv.length) die(`--${name} needs a value: pass --${name} <value>`, 2);
    return process.argv[at + 1]!;
  }
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

/** Copy one directory's regular files into `to`, skipping dot-names; returns the names copied. */
function copyPlainFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

function die(message: string, code = 1): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

const inputArg = option('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  die(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
}
const out = option('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

/** The screenshots the gate takes: three or four, each a plain image name. */
function checkShots(shots: string[]): void {
  if (shots.length < 3 || shots.length > 4) {
    die(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3 or 4, the board, a detail view, a filtered view and the model`);
  }
  for (const name of shots) {
    if (!SHOT_NAME.test(name)) die(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  }
}

/** Write the board, the dashboard data, the dashboard files and the screenshots to `out`; returns the screenshot names copied. */
function writeOutputs(out: string, board: ReturnType<typeof buildRadarData>['board'], radar: ReturnType<typeof buildRadarData>['radar']): string[] {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
  writeFileSync(join(out, 'data.js'), dataModule(radar));
  copyPlainFiles(join(here, 'dashboard'), join(out, 'dashboard'));
  const shots = copyPlainFiles(join(here, 'screenshots'), join(out, 'screenshots'));
  checkShots(shots);
  return shots;
}

const snapshot = readSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadarData(snapshot);
const issue = validateBoard(board, snapshot);
if (issue !== null) die(`the model wrote a board the gate refuses: ${issue}`);

const shots = writeOutputs(out, board, radar);

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_CAP_BYTES, screenshots: SHOT_LIMITS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const youngest = radar.calibration.age_buckets[0]!;
const oldest = radar.calibration.age_buckets[radar.calibration.age_buckets.length - 1]!;
// The summary names the age curve's ends twice — the raw rates the bars
// show and the shrunk rates the factors are built from — so a run's log
// carries the same evidence the dashboard's age curve panel draws.
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} off-list, ${radar.live_size} live set aside)\n` +
    `token radar: top row is ${board[0]!.name} at $${board[0]!.implied_value_usd.toLocaleString('en-US')} expected value, calibrated on ${radar.calibration.global_live_count} live-token protocols (global multiple ${radar.calibration.global_multiple.toFixed(3)}x, global launch rate ${(radar.calibration.global_token_rate * 100).toFixed(1)}%, age factors ${youngest.factor.toFixed(2)}x to ${oldest.factor.toFixed(2)}x)\n` +
    `token radar: age curve runs ${(youngest.rate * 100).toFixed(0)}% (${youngest.label}, shrunk ${(youngest.shrunk_rate * 100).toFixed(1)}%) to ${(oldest.rate * 100).toFixed(0)}% (${oldest.label}, shrunk ${(oldest.shrunk_rate * 100).toFixed(1)}%) across ${radar.calibration.age_buckets.length} buckets, shrunk toward the global rate with ten pseudo-counts\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
