import { describe, expect, it } from 'vitest';
import { allSkills, BUILTIN_SKILLS, buildSystemPrompt, customSkillFromMarkdown, skillsById } from '../skills';
import { initialState, loadState, saveState, STORAGE_KEY } from '../store';

describe('built-in skills', () => {
  it('ships caveman and rea', () => {
    const ids = BUILTIN_SKILLS.map((skill) => skill.id);
    expect(ids).toContain('caveman');
    expect(ids).toContain('rea');
  });

  it('marks the token-saving skills', () => {
    const caveman = BUILTIN_SKILLS.find((skill) => skill.id === 'caveman');
    expect(caveman?.tokenSaver).toBe(true);
    expect(caveman?.prompt).toMatch(/caveman/i);
  });

  it('has unique ids and non-empty prompts', () => {
    const ids = BUILTIN_SKILLS.map((skill) => skill.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const skill of BUILTIN_SKILLS) {
      expect(skill.prompt.trim().length).toBeGreaterThan(40);
    }
  });
});

describe('buildSystemPrompt', () => {
  it('combines the base prompt with enabled skills in order', () => {
    const prompt = buildSystemPrompt(['caveman', 'planner'], [], 'Be precise.');
    expect(prompt.startsWith('Be precise.')).toBe(true);
    expect(prompt.indexOf('CAVEMAN')).toBeLessThan(prompt.indexOf('PLANNER'));
  });

  it('ignores unknown and duplicate ids', () => {
    const prompt = buildSystemPrompt(['caveman', 'caveman', 'nope'], []);
    expect(prompt.match(/CAVEMAN MODE/g)?.length).toBe(1);
  });

  it('returns an empty string when nothing is enabled', () => {
    expect(buildSystemPrompt([], [], '   ')).toBe('');
  });

  it('includes custom skills', () => {
    const custom = customSkillFromMarkdown('SQL', 'Always use explicit JOINs.');
    expect(buildSystemPrompt([custom.id], [custom])).toContain('explicit JOINs');
  });
});

describe('custom skills', () => {
  it('derives an id from the name and keeps the body', () => {
    const skill = customSkillFromMarkdown('My Great Skill', '# Title\n\nDo the thing.');
    expect(skill.id.startsWith('custom-my-great-skill-')).toBe(true);
    expect(skill.prompt).toBe('# Title\n\nDo the thing.');
    expect(skill.builtin).toBe(false);
    expect(skill.description).toBe('Do the thing.');
  });

  it('appears in the skill index', () => {
    const custom = customSkillFromMarkdown('extra', 'some instructions');
    const index = skillsById([custom]);
    expect(index.get(custom.id)?.name).toBe('extra');
    expect(allSkills([custom]).length).toBe(BUILTIN_SKILLS.length + 1);
  });
});

describe('persistence', () => {
  function memoryStorage(): Storage {
    const data = new Map<string, string>();
    return {
      get length() {
        return data.size;
      },
      clear() {
        data.clear();
      },
      getItem(key: string) {
        return data.get(key) ?? null;
      },
      key(index: number) {
        return Array.from(data.keys())[index] ?? null;
      },
      removeItem(key: string) {
        data.delete(key);
      },
      setItem(key: string, value: string) {
        data.set(key, value);
      },
    };
  }

  it('round-trips state', () => {
    const storage = memoryStorage();
    const state = initialState();
    state.skillIds = ['caveman'];
    state.systemPrompt = 'hi';
    saveState(state, storage);
    const loaded = loadState(storage);
    expect(loaded.skillIds).toEqual(['caveman']);
    expect(loaded.systemPrompt).toBe('hi');
    expect(loaded.providers.length).toBeGreaterThan(0);
  });

  it('starts fresh on corrupt or foreign data', () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEY, 'not json');
    expect(loadState(storage).threads.length).toBe(1);
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 99 }));
    expect(loadState(storage).threads.length).toBe(1);
  });

  it('survives a storage that throws', () => {
    const failing = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(loadState(failing).threads.length).toBe(1);
    expect(() => saveState(initialState(), failing)).not.toThrow();
  });
});
