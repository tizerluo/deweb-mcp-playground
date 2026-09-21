/**
 * The four language tables, checked mechanically.
 *
 * The review found three classes of defect here: tables that drifted apart
 * (a key added to one language only, or a placeholder renamed on one side), a
 * stray English sentence glued into a localized line, and keys nobody renders
 * any more. The first two are hard failures; the third is checked against the
 * source tree, so a key that only exists in the tables is reported as dead
 * rather than left to rot.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LOCALES, MESSAGES, htmlLang, matchAcceptLanguage, parseLocale, t } from "./i18n.ts";

const LOCALE_IDS = ["zh", "en", "ja", "ko"] as const;
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = `${REPO}src`;
const I18N_SOURCE = readFileSync(new URL("./i18n.ts", import.meta.url), "utf8");

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}

/** Every .ts/.tsx under src/, minus the tables themselves and their tests. */
function appSources(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = `${dir}/${entry}`;
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      if (entry === "i18n.ts" || entry.endsWith(".test.ts") || entry.endsWith(".test.tsx"))
        continue;
      out.push({ path: full.slice(REPO.length), text: readFileSync(full, "utf8") });
    }
  };
  walk(SRC);
  return out;
}

/** Key prefixes built at runtime, e.g. `t(`svc.${slug}.name`)`. */
function dynamicPrefixes(sources: { text: string }[]): string[] {
  const prefixes = new Set<string>();
  for (const { text } of sources) {
    // A prefix that ends in `.` or `_` is a family of keys: `svc.${slug}.headline`
    // and `jev.car.state.timeout_${mode}` both name a whole branch of the tables.
    for (const match of text.matchAll(/`([A-Za-z][\w.-]*[._])\$\{/g)) prefixes.add(match[1]!);
  }
  return [...prefixes];
}

describe("language tables", () => {
  it("defines exactly the same keys in all four languages", () => {
    const base = new Set(Object.keys(MESSAGES.en));
    assert.ok(base.size > 200, "the table should be the whole UI's vocabulary");
    for (const locale of LOCALE_IDS) {
      const keys = new Set(Object.keys(MESSAGES[locale]));
      const missing = [...base].filter((key) => !keys.has(key));
      const extra = [...keys].filter((key) => !base.has(key));
      assert.deepEqual(missing, [], `${locale} is missing keys`);
      assert.deepEqual(extra, [], `${locale} has keys English does not`);
    }
  });

  it("never defines the same key twice in one language block", () => {
    for (const locale of LOCALE_IDS) {
      const block = I18N_SOURCE.split(new RegExp(`\\n  ${locale}: \\{`))[1];
      assert.ok(block, `${locale} block found`);
      const body = block.split("\n  },\n")[0]!;
      const defined = [
        ...body.matchAll(/^ {4}(?:"([A-Za-z][\w.-]*)"|([A-Za-z][\w-]*)):\s*"/gm),
      ].map((m) => m[1] ?? m[2]!);
      assert.equal(new Set(defined).size, defined.length, `${locale} defines a key twice`);
    }
  });

  it("keeps the placeholder set identical across languages", () => {
    for (const [key, value] of Object.entries(MESSAGES.en)) {
      const expected = placeholders(value);
      for (const locale of LOCALE_IDS) {
        assert.deepEqual(
          placeholders(MESSAGES[locale][key] ?? ""),
          expected,
          `${locale} · ${key} has different placeholders`,
        );
      }
    }
  });

  it("substitutes what it is given and leaves no placeholder behind", () => {
    for (const [key, value] of Object.entries(MESSAGES.en)) {
      if (placeholders(value).length > 0) continue;
      for (const locale of LOCALE_IDS) {
        assert.ok(
          !t(key, undefined, locale).includes("{"),
          `${locale} · ${key} renders a placeholder it has no value for`,
        );
      }
    }
    assert.equal(t("err.lowBem", { n: "0.05" }, "en").includes("0.05"), true);
    for (const locale of LOCALE_IDS) {
      assert.ok(t("err.lowBem", { n: "0.05" }, locale).includes("0.05"), locale);
    }
  });

  it("resolves every key the app asks for, literal or built", () => {
    const sources = appSources();
    assert.ok(sources.length > 20, "the scan should see the app's modules");
    const known = new Set(Object.keys(MESSAGES.en));
    for (const { path, text } of sources) {
      for (const match of text.matchAll(/\bt(?:r)?\(\s*"([^"{]+)"/g)) {
        const key = match[1]!;
        assert.ok(known.has(key), `${path} asks for an unknown key: ${key}`);
      }
    }
  });

  it("reports keys nothing renders any more", () => {
    const sources = appSources();
    const haystack = sources.map((s) => s.text).join("\n");
    const prefixes = dynamicPrefixes(sources);
    const dead = Object.keys(MESSAGES.en).filter(
      (key) =>
        !haystack.includes(`"${key}"`) &&
        !haystack.includes(`'${key}'`) &&
        !prefixes.some((prefix) => key.startsWith(prefix)),
    );
    assert.deepEqual(dead, [], "keys with no reader in the app");
  });

  it("names one fallback term per language, never two", () => {
    // The same "degraded / fell back to the local policy" idea is rendered by
    // the home note, the JEV state badges, the statistics breakdown and the
    // low-BEM notice. Two spellings of it in one language reads as two
    // different things; each language picks one and keeps it.
    const TERMS: Record<(typeof LOCALE_IDS)[number], { chosen: string; rejected: string[] }> = {
      zh: { chosen: "降级", rejected: ["降級", "降格"] },
      en: { chosen: "degrad", rejected: ["降級", "降格"] },
      ja: { chosen: "降格", rejected: ["降級"] },
      ko: { chosen: "대체", rejected: ["강등"] },
    };
    for (const locale of LOCALE_IDS) {
      const { chosen, rejected } = TERMS[locale];
      const values = Object.entries(MESSAGES[locale]);
      const offenders = values
        .filter(([, value]) => rejected.some((term) => value.includes(term)))
        .map(([key]) => key);
      assert.deepEqual(offenders, [], `${locale} mixes a second fallback term`);
      const used = values.filter(([, value]) => value.includes(chosen));
      assert.ok(used.length >= 4, `${locale} should spell its fallback term ${chosen}`);
    }
    // The spots the review named, one per language that had drifted.
    assert.ok(MESSAGES.ja["home.note"]!.includes("降格"));
    assert.ok(MESSAGES.ja["jev.lowBem"]!.includes("降格"));
    assert.ok(MESSAGES.ko["jev.car.note"]!.includes("대체"));
  });

  it("maps locales to html tags and detects them from a request", () => {
    assert.equal(LOCALES.length, 4);
    assert.equal(htmlLang("zh"), "zh-CN");
    assert.equal(htmlLang("en"), "en");
    for (const locale of LOCALE_IDS) assert.equal(parseLocale(locale), locale);
    assert.equal(parseLocale("fr"), null);
    assert.equal(parseLocale(null), null);
    assert.equal(matchAcceptLanguage("zh-CN,zh;q=0.9,en;q=0.8"), "zh");
    assert.equal(matchAcceptLanguage("fr-FR, ja;q=0.7"), "ja");
    assert.equal(matchAcceptLanguage("ko-KR;q=0.9,en;q=0.1"), "ko");
    assert.equal(matchAcceptLanguage("de,fr;q=0.5"), null);
    assert.equal(matchAcceptLanguage(null), null);
    assert.equal(matchAcceptLanguage("en;q=0"), null, "an unacceptable language is not a match");
  });
});
