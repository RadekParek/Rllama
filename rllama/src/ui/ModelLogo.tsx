import React from 'react';
import { LOGO_PATHS, LOGO_VIEWBOX } from './logos.generated';

/**
 * Vendor marks next to model names.
 *
 * The artwork is the official brand SVG, inlined from
 * @lobehub/icons-static-svg (MIT) by scripts/make-logos.mjs — the same marks
 * the vendors publish, not hand-drawn approximations.
 */

export type VendorKey =
  | 'anthropic'
  | 'openai'
  | 'deepseek'
  | 'kimi'
  | 'gemini'
  | 'gemma'
  | 'qwen'
  | 'meta'
  | 'mistral'
  | 'groq'
  | 'glm'
  | 'microsoft'
  | 'nvidia'
  | 'minimax'
  | 'xai'
  | 'ollama'
  | 'generic';

export function vendorOf(modelId: string): VendorKey {
  const id = modelId.toLowerCase();
  if (/claude|anthropic|mythos|fable|haiku|sonnet|opus/.test(id)) return 'anthropic';
  if (/deepseek/.test(id)) return 'deepseek';
  if (/kimi|moonshot/.test(id)) return 'kimi';
  if (/gemma/.test(id)) return 'gemma';
  if (/gemini|palm/.test(id)) return 'gemini';
  if (/qwen/.test(id)) return 'qwen';
  if (/grok/.test(id)) return 'xai';
  if (/glm|zhipu|chatglm/.test(id)) return 'glm';
  if (/groq/.test(id)) return 'groq';
  if (/phi-?\d|phi3|phi4|microsoft/.test(id)) return 'microsoft';
  if (/nemotron|nvidia/.test(id)) return 'nvidia';
  if (/minimax/.test(id)) return 'minimax';
  if (/mistral|mixtral|devstral|magistral|nemo/.test(id)) return 'mistral';
  if (/llama|meta|codellama|tinyllama/.test(id)) return 'meta';
  if (/gpt|openai|davinci|o1|o3|o4|oss/.test(id)) return 'openai';
  if (/ollama/.test(id)) return 'ollama';
  return 'generic';
}

const LABELS: Record<VendorKey, string> = {
  anthropic: 'Claude',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  gemini: 'Gemini',
  gemma: 'Gemma',
  qwen: 'Qwen',
  meta: 'Llama',
  mistral: 'Mistral',
  groq: 'Groq',
  glm: 'GLM',
  microsoft: 'Microsoft',
  nvidia: 'NVIDIA',
  minimax: 'MiniMax',
  xai: 'Grok',
  ollama: 'Ollama',
  generic: 'Model',
};

export interface ModelLogoProps {
  model: string;
  size?: number;
}

export function ModelLogo({ model, size = 14 }: ModelLogoProps): React.ReactElement {
  const vendor = vendorOf(model);
  const body = LOGO_PATHS[vendor];

  if (!body) {
    // Unknown vendor: a neutral letter chip is clearer than a wrong logo.
    return (
      <span
        className="model-logo-fallback"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.62) }}
        aria-hidden
        title={LABELS[vendor]}
      >
        {model.trim().charAt(0).toUpperCase() || '?'}
      </span>
    );
  }

  return (
    <svg
      className="model-logo"
      width={size}
      height={size}
      viewBox={LOGO_VIEWBOX[vendor] ?? '0 0 24 24'}
      role="img"
      aria-label={LABELS[vendor]}
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}
