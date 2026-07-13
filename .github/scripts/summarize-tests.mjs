// Renders jest-junit's XML as a Markdown table on the Job Summary — no
// external XML dependency (the format is flat/regular enough for a direct
// regex parse) and no elevated GitHub permissions (unlike a Checks-API
// reporter, $GITHUB_STEP_SUMMARY is writable by any step by default).
import { readFileSync, appendFileSync } from 'node:fs';

const xmlPath = process.argv[2];
const summaryPath = process.env.GITHUB_STEP_SUMMARY;
if (!xmlPath || !summaryPath) {
  console.error('usage: summarize-tests.mjs <junit.xml>  (needs GITHUB_STEP_SUMMARY set)');
  process.exit(1);
}

const xml = readFileSync(xmlPath, 'utf8');
const unescape = (s) =>
  s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const totals = xml.match(/<testsuites[^>]*tests="(\d+)"[^>]*failures="(\d+)"[^>]*errors="(\d+)"[^>]*time="([\d.]+)"/);
const [, tests, failures, errors, time] = totals ?? ['', '0', '0', '0', '0'];

let out = `## Test results\n\n`;
out += `${failures === '0' && errors === '0' ? '✅' : '❌'} **${tests} tests**, ${failures} failures, ${errors} errors — ${time}s\n\n`;

const suiteRe = /<testsuite name="([^"]*)"[^>]*tests="(\d+)"[^>]*>([\s\S]*?)<\/testsuite>/g;
const caseRe = /<testcase classname="[^"]*" name="([^"]*)" time="([\d.]+)">([\s\S]*?)<\/testcase>/g;

let suiteMatch;
while ((suiteMatch = suiteRe.exec(xml))) {
  const [, suiteName, , suiteBody] = suiteMatch;
  out += `<details><summary>${unescape(suiteName)}</summary>\n\n`;
  out += `| Status | Test | Time (s) |\n|---|---|---|\n`;
  let caseMatch;
  caseRe.lastIndex = 0;
  while ((caseMatch = caseRe.exec(suiteBody))) {
    const [, name, t, body] = caseMatch;
    const failed = /<failure/.test(body);
    out += `| ${failed ? '❌' : '✅'} | ${unescape(name)} | ${t} |\n`;
  }
  out += `\n</details>\n\n`;
}

appendFileSync(summaryPath, out);
