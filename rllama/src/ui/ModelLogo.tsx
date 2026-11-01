import React from 'react';

/**
 * Small vendor marks for model names.
 *
 * These are deliberately simple geometric glyphs in each vendor's colour
 * rather than copies of trademarked artwork: recognisable at 14px, no brand
 * assets shipped in the bundle, nothing to license.
 */

export type Vendor =
  | 'anthropic'
  | 'openai'
  | 'deepseek'
  | 'kimi'
  | 'google'
  | 'qwen'
  | 'meta'
  | 'mistral'
  | 'xai'
  | 'glm'
  | 'microsoft'
  | 'nvidia'
  | 'minimax'
  | 'community'
  | 'other';

const COLORS: Record<Vendor, string> = {
  anthropic: '#d97757',
  openai: '#7fb3a3',
  deepseek: '#5b7cfa',
  kimi: '#f08a4b',
  google: '#6aa1f7',
  qwen: '#a78bfa',
  meta: '#5b8def',
  mistral: '#f2a03d',
  xai: '#c9c6c0',
  glm: '#69a8f5',
  microsoft: '#6fb4ef',
  nvidia: '#8ec43f',
  minimax: '#e07ba0',
  community: '#9a948b',
  other: '#8f8b84',
};

const NAMES: Record<Vendor, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  kimi: 'Moonshot',
  google: 'Google',
  qwen: 'Alibaba',
  meta: 'Meta',
  mistral: 'Mistral',
  xai: 'xAI',
  glm: 'Z.ai',
  microsoft: 'Microsoft',
  nvidia: 'NVIDIA',
  minimax: 'MiniMax',
  community: 'Community',
  other: 'Model',
};

export function vendorOf(modelId: string): Vendor {
  const id = modelId.toLowerCase();
  if (/claude|anthropic|mythos|fable|haiku|sonnet|opus/.test(id)) return 'anthropic';
  if (/deepseek/.test(id)) return 'deepseek';
  if (/kimi|moonshot/.test(id)) return 'kimi';
  if (/gemma|gemini|palm|embeddinggemma|recurrentgemma/.test(id)) return 'google';
  if (/qwen/.test(id)) return 'qwen';
  if (/llama|meta|tinyllama|codellama/.test(id)) return 'meta';
  if (/mistral|mixtral|devstral|nemo|magistral/.test(id)) return 'mistral';
  if (/grok/.test(id)) return 'xai';
  if (/glm|chatglm|zhipu/.test(id)) return 'glm';
  if (/phi-?\d|phi4|phi3|microsoft/.test(id)) return 'microsoft';
  if (/nemotron|nvidia/.test(id)) return 'nvidia';
  if (/minimax/.test(id)) return 'minimax';
  if (/gpt|openai|o1|o3|o4|davinci|oss/.test(id)) return 'openai';
  if (/[a-z0-9_-]+\/[a-z0-9._-]+/.test(id)) return 'community';
  return 'other';
}

function glyph(vendor: Vendor): React.ReactNode {
  switch (vendor) {
    case 'anthropic':
      // six-point star
      return <path d="M8 2.4v11.2M3.2 5.2l9.6 5.6M12.8 5.2 3.2 10.8" />;
    case 'openai':
      // hexagon
      return <path d="M8 2.6l4.6 2.7v5.4L8 13.4 3.4 10.7V5.3z" />;
    case 'deepseek':
      // wave / whale tail
      return <path d="M2.6 10.4c2 .8 3.6-1.2 5.4-.4 1.8.8 3.4-1.2 5.4-.4M2.6 6.6c2 .8 3.6-1.2 5.4-.4 1.8.8 3.4-1.2 5.4-.4" />;
    case 'kimi':
      // crescent
      return <path d="M11.4 3.4a5.4 5.4 0 1 0 0 9.2 5.8 5.8 0 0 1 0-9.2z" />;
    case 'google':
      // diamond
      return <path d="M8 2.2 13.6 8 8 13.8 2.4 8z" />;
    case 'qwen':
      // cube
      return <path d="M8 2.4 13 5v6l-5 2.6L3 11V5z M8 2.4v11.2M13 5 8 8l-5-3" />;
    case 'meta':
      // llama head silhouette
      return <path d="M5.6 4.6 4 2.4v3.2M10.4 4.6 12 2.4v3.2M4.4 7.6c0-2 1.6-3.4 3.6-3.4s3.6 1.4 3.6 3.4v3.6L8 13.4l-3.6-2.2z" />;
    case 'mistral':
      // wind stripes
      return <path d="M2.6 5h10.8M2.6 8h7.4M2.6 11h10.8" />;
    case 'xai':
      return <path d="M3 3l10 10M13 3 3 13" />;
    case 'glm':
      return <path d="M8 2.6 13.4 8 8 13.4 2.6 8z M8 5.4 10.6 8 8 10.6 5.4 8z" />;
    case 'microsoft':
      return <path d="M3 3h4.4v4.4H3zM8.6 3H13v4.4H8.6zM3 8.6h4.4V13H3zM8.6 8.6H13V13H8.6z" />;
    case 'nvidia':
      return <path d="M4 8a4 4 0 0 1 4-4h3.4v8H8" />;
    case 'minimax':
      return <path d="M3 12V5.4L8 9l5-3.6V12" />;
    case 'community':
      return <path d="M4 12.4V6.2L8 3.6l4 2.6v6.2" />;
    default:
      return <circle cx="8" cy="8" r="4.2" />;
  }
}

export function ModelLogo({
  model,
  size = 14,
}: {
  model: string;
  size?: number;
}): React.ReactElement {
  const vendor = vendorOf(model);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke={COLORS[vendor]}
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ flex: '0 0 auto' }}
    >
      <title>{NAMES[vendor]}</title>
      {glyph(vendor)}
    </svg>
  );
}
