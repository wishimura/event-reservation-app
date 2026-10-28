/**
 * docs/シナリオテスト仕様書.md と E2E テストの対応を検査する。
 *
 * 仕様書は「何を保証しているか」の目次です。目次である以上、テストと対応が
 * 取れていないと存在価値がなくなります。人の運用ルールだけでは半年で必ず
 * 腐るので、ここで機械的に縛ります。
 *
 *   1. 仕様書の `## S-NN` と `test.describe("S-NN …")` が両側に揃っているか
 *   2. `test.describe` がシナリオ番号から始まっているか
 *   3. 仕様書が名指ししているテストファイルが実在し、その番号を含んでいるか
 *   4. tests/e2e の中に、Playwright に拾われない名前のファイルが紛れていないか
 *      （`.e2e.ts` でないと testMatch から外れ、**黙って実行されない**）
 *
 *   npm run check:scenarios
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SPEC_PATH = "docs/シナリオテスト仕様書.md";
const E2E_DIR = "tests/e2e";
/** playwright.config.ts の testMatch と必ず揃えること。 */
const E2E_SUFFIX = ".e2e.ts";

interface SpecScenario {
  id: string;
  title: string;
  files: string[];
}

/** 仕様書から `## S-NN タイトル` と、その節が名指ししているファイルを拾う。 */
function readSpec(): SpecScenario[] {
  const text = readFileSync(join(ROOT, SPEC_PATH), "utf8");
  const sections: SpecScenario[] = [];
  let current: SpecScenario | null = null;

  for (const line of text.split("\n")) {
    const heading = /^##\s+(S-\d{2})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = { id: heading[1] ?? "", title: heading[2] ?? "", files: [] };
      sections.push(current);
      continue;
    }
    // シナリオ以外の見出しに入ったら節を閉じる
    if (/^##\s/.test(line)) {
      current = null;
      continue;
    }
    if (!current) continue;
    for (const m of line.matchAll(/`([\w./-]+\.e2e\.ts)`/g)) {
      const file = m[1];
      if (file && !current.files.includes(file)) current.files.push(file);
    }
  }
  return sections;
}

/**
 * `.ts` を全部集める。ヘルパーも含むのは、テストを書いているのに testMatch から
 * 外れているファイル（黙って実行されない）を見つけるため。
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

interface Describe {
  file: string;
  line: number;
  title: string;
  id: string | null;
}

/** Playwright が拾わない名前で置かれているテストファイル。 */
const orphanFiles: string[] = [];

function readDescribes(): Describe[] {
  const dir = join(ROOT, E2E_DIR);
  if (!existsSync(dir)) return [];
  const out: Describe[] = [];

  for (const file of walk(dir)) {
    const rel = relative(ROOT, file);
    const source = readFileSync(file, "utf8");

    if (!rel.endsWith(E2E_SUFFIX)) {
      // testMatch から外れているので、置いてあっても実行されない。
      // 「書いたのに走っていない」は赤いテストより危ないので、ここで落とす。
      if (/\btest\.describe\s*\(/.test(source)) orphanFiles.push(rel);
      continue;
    }

    source.split("\n").forEach((line, i) => {
      const m = /test\.describe(?:\.\w+)*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/.exec(line);
      if (!m) return;
      const title = m[2] ?? "";
      out.push({
        file: rel,
        line: i + 1,
        title,
        id: /^(S-\d{2})\b/.exec(title)?.[1] ?? null,
      });
    });
  }
  return out;
}

const problems: string[] = [];
const scenarios = readSpec();
const describes = readDescribes();

for (const f of orphanFiles) {
  problems.push(
    `${f} は Playwright に拾われません（testMatch は \`*${E2E_SUFFIX}\`）。` +
      `\n    → \`${E2E_SUFFIX}\` に改名してください。` +
      `\n      名前に spec / test を入れないのは、node:test や Vitest の収集が` +
      `\n      Playwright のファイルまで拾って npm test が落ちるためです`
  );
}

if (scenarios.length === 0) {
  problems.push(`${SPEC_PATH} にシナリオ（## S-NN）が1つもありません`);
}
if (describes.length === 0) {
  problems.push(`${E2E_DIR} に test.describe が1つも見つかりません`);
}

// 1. 番号で始まっていない describe
for (const d of describes) {
  if (!d.id) {
    problems.push(
      `${d.file}:${d.line} の describe「${d.title}」がシナリオ番号で始まっていません。` +
        `\n    → "S-NN " を頭に付けてください（落ちたときに仕様書のどこか分かるようにするため）`
    );
  }
}

// 2. 両側の突き合わせ
const specIds = new Set(scenarios.map((s) => s.id));
const testIds = new Set(
  describes.map((d) => d.id).filter((id): id is string => id !== null)
);

for (const s of scenarios) {
  if (!testIds.has(s.id)) {
    problems.push(
      `${s.id}「${s.title}」が ${SPEC_PATH} にありますが、E2E に対応する describe がありません。` +
        `\n    → テストを書くか、保証しないと決めたなら仕様書から節を消してください`
    );
  }
}
for (const id of [...testIds].sort()) {
  if (!specIds.has(id)) {
    const where = describes
      .filter((d) => d.id === id)
      .map((d) => `${d.file}:${d.line}`);
    problems.push(
      `${id} の describe があります（${where.join(", ")}）が、${SPEC_PATH} に節がありません。` +
        `\n    → 「## ${id} …」と「保証すること」を仕様書に足してください`
    );
  }
}

// 3. 仕様書が名指ししているファイルの実在と中身
for (const s of scenarios) {
  if (s.files.length === 0) {
    problems.push(`${s.id} の節に **テスト**: のファイル名がありません`);
    continue;
  }
  for (const f of s.files) {
    if (!existsSync(join(ROOT, f))) {
      problems.push(
        `${s.id} が指している ${f} が存在しません（移動・改名しましたか）`
      );
      continue;
    }
    if (!describes.some((d) => d.file === f && d.id === s.id)) {
      problems.push(
        `${s.id} は ${f} を指していますが、そのファイルに ${s.id} の describe がありません`
      );
    }
  }
}

if (problems.length > 0) {
  console.error("シナリオ仕様書と E2E の対応がずれています:\n");
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(
    `\n${problems.length} 件。仕様書とテストは片方だけ直さないでください。`
  );
  process.exit(1);
}

console.log(
  `✓ シナリオ ${scenarios.length} 件 / describe ${describes.length} 件が対応しています ` +
    `(${SPEC_PATH})`
);
