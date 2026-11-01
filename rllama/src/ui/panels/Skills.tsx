import React, { useState } from 'react';
import { PINNED_SKILLS } from '../../core/skills';
import type { Skill } from '../../core/types';
import { IconBolt, IconPlus, IconTrash } from '../Icons';

export interface SkillsPanelProps {
  skills: Skill[];
  enabledIds: string[];
  systemPrompt: string;
  onToggle: (skillId: string) => void;
  onAdd: (skill: Skill) => void;
  onRemove: (skillId: string) => void;
  onSystemPromptChange: (value: string) => void;
}

export function SkillsPanel(props: SkillsPanelProps): React.ReactElement {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');

  const pinned = PINNED_SKILLS.map((id) => props.skills.find((skill) => skill.id === id)).filter(
    (skill): skill is Skill => Boolean(skill),
  );
  const others = props.skills.filter((skill) => !PINNED_SKILLS.includes(skill.id));

  const card = (skill: Skill) => {
    const on = props.enabledIds.includes(skill.id);
    return (
      <div className={`skill-card ${on ? 'on' : ''}`} key={skill.id}>
        <div className="row">
          <div className="grow">
            <div className="card-title">{skill.name}</div>
            <div className="card-note">{skill.description}</div>
          </div>
          <button
            className={`switch ${on ? 'on' : ''}`}
            onClick={() => props.onToggle(skill.id)}
            aria-label={`${on ? 'Disable' : 'Enable'} ${skill.name}`}
          />
        </div>
        <div className="row wrap">
          {skill.builtin ? <span className="badge">built-in</span> : <span className="badge accent">custom</span>}
          {skill.tokenSaver ? <span className="badge ok">token saver</span> : null}
          <span className="spacer" />
          {skill.builtin ? null : (
            <button className="btn ghost tiny" onClick={() => props.onRemove(skill.id)} title="Delete skill">
              <IconTrash width={12} height={12} />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="hint">
        Skills are plain text appended to the system prompt — you can read exactly what is sent. Click a chip in the
        composer or use <code>/caveman</code>, <code>/rea</code>, <code>/openrouter</code> to toggle one mid-chat.
      </div>

      <div className="section-label" style={{ padding: '6px 0 0' }}>
        Pre-installed
      </div>
      {pinned.map(card)}

      <div className="section-label" style={{ padding: '10px 0 0' }}>
        More skills
      </div>
      {others.map(card)}

      <div className="section-label" style={{ padding: '10px 0 0' }}>
        Custom skill
      </div>
      {adding ? (
        <div className="card" style={{ display: 'grid', gap: 8 }}>
          <div>
            <label className="field-label" htmlFor="skill-name">
              Name
            </label>
            <input id="skill-name" type="text" value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="skill-desc">
              One-line description
            </label>
            <input
              id="skill-desc"
              type="text"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div>
            <label className="field-label" htmlFor="skill-prompt">
              Instructions (added verbatim to the system prompt)
            </label>
            <textarea
              id="skill-prompt"
              className="field"
              rows={6}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="SKILL: …&#10;Rules: …"
            />
          </div>
          <div className="row">
            <button className="btn ghost tiny" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <span className="spacer" />
            <button
              className="btn primary tiny"
              disabled={!name.trim() || !prompt.trim()}
              onClick={() => {
                props.onAdd({
                  id: `custom-${Date.now().toString(36)}`,
                  name: name.trim(),
                  description: description.trim() || 'Custom skill',
                  prompt: prompt.trim(),
                });
                setName('');
                setDescription('');
                setPrompt('');
                setAdding(false);
              }}
            >
              Add skill
            </button>
          </div>
        </div>
      ) : (
        <button className="btn tiny" onClick={() => setAdding(true)}>
          <IconPlus width={12} height={12} />
          Write a skill
        </button>
      )}

      <div className="section-label" style={{ padding: '10px 0 0' }}>
        Base system prompt
      </div>
      <textarea
        className="field"
        rows={4}
        value={props.systemPrompt}
        onChange={(event) => props.onSystemPromptChange(event.target.value)}
        placeholder="Sent before every skill, e.g. “You are working in the Rllama repo on Windows.”"
      />
      <div className="hint">
        <IconBolt width={11} height={11} /> Enabled skills: {props.enabledIds.length} — they apply to new messages,
        not retroactively.
      </div>
    </>
  );
}
