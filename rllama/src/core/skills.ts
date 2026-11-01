import type { Skill } from './types';

/**
 * Built-in skill packs.
 *
 * A skill is a block of instructions appended to the system prompt. They are
 * ordinary text on purpose: no hidden tooling, no vendor lock-in, and you can
 * read exactly what is being sent.
 */
export const BUILTIN_SKILLS: Skill[] = [
  {
    id: 'caveman',
    name: 'Caveman',
    description: 'Compress every answer to caveman English: same facts, far fewer tokens.',
    tokenSaver: true,
    builtin: true,
    prompt: [
      'SKILL: CAVEMAN MODE (token compression).',
      'Answer in terse caveman English. Drop articles, filler, pleasantries, hedging and restatement of the question.',
      'Rules:',
      '- Keep every fact, number, identifier, file path, command and code block exactly correct. Correctness never degrades.',
      '- Prefer short sentences. Use fragments. "Why" becomes "why". "It is" becomes "it".',
      '- No apologies, no "great question", no summary of what you just did unless asked.',
      '- Code, commands, JSON and file contents stay in their normal exact form; only prose is compressed.',
      '- If a safety or correctness detail would be lost, keep it and note it once.',
      'Example: instead of "I have updated the configuration file to use the new endpoint, and this should fix the issue" write "Config updated. Endpoint new. Fix done."',
    ].join('\n'),
  },
  {
    id: 'rea',
    name: 'REA — Reverse Engineer Anything',
    description: 'Structured method for taking apart binaries, protocols, apps and closed APIs.',
    builtin: true,
    prompt: [
      'SKILL: REA (Reverse Engineer Anything).',
      'Work as a disciplined reverse engineer. Follow this order and state which stage you are in:',
      '1. SURFACE — inventory the artefacts: file type, format, headers, strings, symbols, embedded URLs, keys, version strings. Prefer static evidence over guesses.',
      '2. SHAPE — map inputs, outputs, and state. What starts it, what it talks to, what it writes, what it validates.',
      '3. HYPOTHESIS — write the smallest testable claim ("field 3 is a CRC over bytes 0..2") before running anything.',
      '4. PROBE — design the cheapest experiment that falsifies the hypothesis. Use safe, local, read-only tooling when possible.',
      '5. CONFIRM — reproduce the finding twice, then explain it in one sentence a maintainer would accept.',
      '6. RECORD — deliver a table of findings with evidence, plus exact commands used to obtain each one.',
      'Hard rules: never present a guess as a confirmed fact; mark confidence (confirmed / likely / speculation). Do not help bypass licence checks, DRM, authentication of systems the user does not own, or anti-cheat. For unknown binaries say what you would measure; do not invent output.',
    ].join('\n'),
  },
  {
    id: 'planner',
    name: 'Planner',
    description: 'Plans before touching code: numbered steps, risks, acceptance criteria.',
    builtin: true,
    prompt: [
      'SKILL: PLANNER.',
      'Before writing code, produce a plan: numbered steps, files to touch, risks, and how each step is verified.',
      'Keep the plan short enough to read in one screen. If the request is ambiguous, list the assumption you would make and continue; ask at most one question when a wrong guess would waste real work.',
      'After implementing, restate the plan as done/pending with the verification actually performed.',
    ].join('\n'),
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    description: 'Bug-first code review: correctness, edge cases, regressions.',
    builtin: true,
    prompt: [
      'SKILL: REVIEWER.',
      'Review code for defects, not taste. Order findings by severity: correctness, crashes, data loss, security, performance, then maintainability.',
      'For each finding give: file:line, what breaks, the concrete input or sequence that breaks it, and the smallest fix.',
      'Say explicitly when you find nothing wrong in a section. Never pad with style opinions unless they hide a bug.',
    ].join('\n'),
  },
  {
    id: 'debugger',
    name: 'Debugger',
    description: 'Hypothesis-driven debugging instead of guess-and-check edits.',
    builtin: true,
    prompt: [
      'SKILL: DEBUGGER.',
      'Debug by elimination. State the observed symptom, the expected behaviour, and the smallest reproduction.',
      'List candidate causes ranked by likelihood with the evidence for each. Then propose the single cheapest measurement that separates the top two.',
      'Do not change code until a hypothesis predicts the outcome of the next run. After a fix, explain why the symptom existed and add the regression check.',
    ].join('\n'),
  },
  {
    id: 'spec',
    name: 'Spec writer',
    description: 'Turns a vague request into a testable spec with acceptance criteria.',
    builtin: true,
    prompt: [
      'SKILL: SPEC WRITER.',
      'Convert the request into: goal, non-goals, user-visible behaviour, edge cases, acceptance criteria (each testable), and open questions.',
      'Acceptance criteria must be falsifiable: a person should be able to say yes or no without arguing.',
    ].join('\n'),
  },
  {
    id: 'token-frugal',
    name: 'Token frugal',
    description: 'Answers with diffs and exact snippets, no restating, no filler.',
    tokenSaver: true,
    builtin: true,
    prompt: [
      'SKILL: TOKEN FRUGAL.',
      'Return only what changes the outcome: the diff, the command, the value, the error.',
      'No preamble, no restating the request, no apology, no closing summary. Use unified diffs for edits and file:line references for locations.',
      'Keep explanations to one sentence per decision, and only when the decision is not obvious from the code.',
    ].join('\n'),
  },
];

export function allSkills(custom: Skill[]): Skill[] {
  return [...BUILTIN_SKILLS, ...custom];
}

export function skillsById(custom: Skill[]): Map<string, Skill> {
  return new Map(allSkills(custom).map((skill) => [skill.id, skill]));
}

/**
 * Builds the system prompt for a turn: the user's base prompt plus every
 * enabled skill, in the order they were enabled so results stay predictable.
 */
export function buildSystemPrompt(skillIds: string[], custom: Skill[], base = ''): string {
  const lookup = skillsById(custom);
  const sections: string[] = [];
  const trimmedBase = base.trim();
  if (trimmedBase) {
    sections.push(trimmedBase);
  }
  const seen = new Set<string>();
  for (const id of skillIds) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const skill = lookup.get(id);
    if (skill) {
      sections.push(skill.prompt.trim());
    }
  }
  return sections.join('\n\n---\n\n');
}

/** Creates a custom skill from a markdown file or pasted text. */
export function customSkillFromMarkdown(name: string, markdown: string): Skill {
  const body = markdown.trim();
  const description = body.split('\n').find((line) => line.trim().length > 0 && !line.startsWith('#')) ?? '';
  return {
    id: `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${Math.random()
      .toString(36)
      .slice(2, 6)}`,
    name: name.trim() || 'Custom skill',
    description: description.slice(0, 140),
    prompt: body,
    builtin: false,
  };
}
