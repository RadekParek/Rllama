/**
 * Ollama model catalog.
 *
 * This is a snapshot of https://ollama.com/search taken on 2026-11-01, kept in
 * the bundle for two reasons:
 *   1. the app works offline and on first launch with no key;
 *   2. ollama.com sends no CORS headers, so a browser build cannot scrape it at
 *      runtime (the Electron and Android shells could, but then the list would
 *      differ per platform — a bad trade for a catalogue this small).
 *
 * Anything not listed here can still be pulled by typing its full name: the
 * daemon accepts any registry reference, including community namespaces such as
 * `treyleo16/claude-mythos-5-1`.
 */
import type { CatalogModel } from './types';

const RAW: Array<Omit<CatalogModel, 'name'> & { name: string }> = [
  {
    name: 'treyleo16/claude-mythos-5-1',
    description:
      'Community mirror of Claude Mythos 5.1 (Anthropic flagship, 1M context). Cloud-hosted, so nothing is downloaded locally.',
    capabilities: ['cloud', 'thinking', 'vision'],
    context: '1M',
    cloud: true,
    downloads: '214',
  },
  {
    name: 'treyleo16/claude-oss',
    description:
      'Community 1B Claude-style model — the default here because it is small enough to run on a phone.',
    capabilities: ['tools'],
    sizes: ['1b'],
    context: '32K',
  },
  {
    name: 'llama3.1',
    description: 'Meta Llama 3.1, the 8B/70B/405B general-purpose family. Tools, long context, solid all-rounder.',
    capabilities: ['tools'],
    sizes: ['8b', '70b', '405b'],
    context: '128K',
    downloads: '120.8M',
  },
  {
    name: 'llama3.2',
    description: "Meta's small Llama 3.2 in 1B and 3B — the usual pick for phones and laptops.",
    capabilities: ['tools'],
    sizes: ['1b', '3b'],
    context: '128K',
    downloads: '86.7M',
  },
  { name: 'llama3.2-vision', description: 'Llama 3.2 Vision: image reasoning in 11B and 90B.', capabilities: ['vision'], sizes: ['11b', '90b'], downloads: '5.6M' },
  { name: 'llama3', description: 'Meta Llama 3 (8B/70B). Older but widely supported.', capabilities: [], sizes: ['8b', '70b'], downloads: '25.9M' },
  { name: 'llama2', description: 'Llama 2, 7B to 70B. Mostly of historical interest now.', capabilities: [], sizes: ['7b', '13b', '70b'], downloads: '7.6M' },
  {
    name: 'qwen3',
    description: 'Qwen3: dense and MoE models from 0.6B to 235B, with a thinking mode.',
    capabilities: ['tools', 'thinking'],
    sizes: ['0.6b', '1.7b', '4b', '8b', '14b', '30b', '32b', '235b'],
    context: '256K',
    downloads: '42.2M',
  },
  { name: 'qwen3.5', description: 'Qwen 3.5: multimodal family from 0.8B to 122B.', capabilities: ['vision', 'tools', 'thinking'], sizes: ['0.8b', '2b', '4b', '9b', '27b', '35b', '122b'], downloads: '24M' },
  { name: 'qwen3.6', description: 'Qwen 3.6: better agentic coding and thinking preservation, 27B and 35B.', capabilities: ['vision', 'tools', 'thinking'], sizes: ['27b', '35b'], downloads: '7.4M' },
  { name: 'qwen3.8', description: 'Qwen 3.8, 27B: gains in coding, research and long-horizon agentic work.', capabilities: ['vision', 'tools', 'thinking'], sizes: ['27b'], downloads: '5.5M' },
  { name: 'qwen3-coder', description: "Alibaba's long-context coding models, 30B and 480B.", capabilities: ['tools'], sizes: ['30b', '480b'], context: '256K', downloads: '10.5M' },
  { name: 'qwen3-vl', description: 'Qwen3 vision-language models from 2B to 235B.', capabilities: ['vision', 'tools', 'thinking'], sizes: ['2b', '4b', '8b', '30b', '32b', '235b'], downloads: '7M' },
  { name: 'qwen2.5', description: 'Qwen2.5, 0.5B to 72B, multilingual and 128K context.', capabilities: ['tools'], sizes: ['0.5b', '1.5b', '3b', '7b', '14b', '32b', '72b'], context: '128K', downloads: '44.3M' },
  { name: 'qwen2.5-coder', description: 'Qwen2.5-Coder: code generation, reasoning and fixing.', capabilities: ['tools'], sizes: ['0.5b', '1.5b', '3b', '7b', '14b', '32b'], downloads: '23.2M' },
  { name: 'qwen2.5vl', description: 'Qwen2.5-VL flagship vision models, 3B to 72B.', capabilities: ['vision'], sizes: ['3b', '7b', '32b', '72b'], downloads: '5.7M' },
  {
    name: 'gemma3',
    description: 'Gemma 3: the most capable model that still runs on a single GPU. Vision in the 4B+ sizes.',
    capabilities: ['vision'],
    sizes: ['270m', '1b', '4b', '12b', '27b'],
    context: '128K',
    downloads: '41.6M',
  },
  { name: 'gemma4:31b-cloud', aliases: ['gemma4'], description: 'Gemma 4 31B on Ollama Cloud — no download, runs on ollama.com with your key.', capabilities: ['vision', 'tools', 'thinking', 'cloud'], sizes: ['31b'], context: '256K', cloud: true },
  { name: 'gemma4', description: 'Gemma 4: frontier performance per size, reasoning, agentic work, audio and vision.', capabilities: ['vision', 'tools', 'thinking', 'audio', 'cloud'], sizes: ['e2b', 'e4b', '12b', '26b', '31b'], downloads: '28.3M' },
  { name: 'gemma2', description: 'Gemma 2 in 2B, 9B and 27B.', capabilities: [], sizes: ['2b', '9b', '27b'], downloads: '36.2M' },
  { name: 'gemma', description: 'Gemma 1.1, 2B and 7B.', capabilities: [], sizes: ['2b', '7b'], downloads: '8.4M' },
  {
    name: 'deepseek-r1',
    description: 'DeepSeek-R1 reasoning models from 1.5B to 671B — the usual local "think hard" pick.',
    capabilities: ['tools', 'thinking'],
    sizes: ['1.5b', '7b', '8b', '14b', '32b', '70b', '671b'],
    context: '128K',
    downloads: '94.6M',
  },
  { name: 'deepseek-coder', description: 'DeepSeek Coder, trained on two trillion code tokens.', capabilities: [], sizes: ['1.3b', '6.7b', '33b'], downloads: '3M' },
  { name: 'deepseek-v4.1-flash', description: 'DeepSeek V4.1 Flash: faster inference, higher throughput, 1M context. Cloud only.', capabilities: ['vision', 'tools', 'thinking', 'cloud'], context: '1M', cloud: true },
  { name: 'glm-5.3', description: "Z.ai's flagship open-weights coding model, strong on long-horizon agentic tasks. Cloud only.", capabilities: ['tools', 'thinking', 'cloud'], context: '1M', cloud: true },
  { name: 'glm-5.3-flash', description: 'Z.ai native multimodal model, 18B active parameters. Cloud only.', capabilities: ['vision', 'thinking', 'cloud'], context: '1M', cloud: true },
  { name: 'glm-ocr', description: 'GLM-OCR: multimodal OCR for complex documents.', capabilities: ['vision', 'tools'], downloads: '8.9M' },
  { name: 'gpt-oss', description: "OpenAI's open-weight reasoning models, 20B and 120B.", capabilities: ['tools', 'thinking', 'cloud'], sizes: ['20b', '120b'], context: '128K', downloads: '14.4M' },
  { name: 'mistral', description: 'Mistral 7B v0.3.', capabilities: ['tools'], sizes: ['7b'], downloads: '34.1M' },
  { name: 'mistral-nemo', description: 'Mistral NeMo 12B, 128K context, built with NVIDIA.', capabilities: ['tools'], sizes: ['12b'], context: '128K', downloads: '5.8M' },
  { name: 'phi3', description: 'Phi-3 Mini 3.8B and Medium 14B by Microsoft.', capabilities: [], sizes: ['3.8b', '14b'], downloads: '18.3M' },
  { name: 'phi4', description: 'Phi-4, 14B, Microsoft.', capabilities: [], sizes: ['14b'], downloads: '7.8M' },
  { name: 'codellama', description: 'Code Llama, 7B to 70B.', capabilities: [], sizes: ['7b', '13b', '34b', '70b'], downloads: '7.7M' },
  { name: 'llava', description: 'LLaVA 1.6: vision + Vicuna for general visual understanding.', capabilities: ['vision'], sizes: ['7b', '13b', '34b'], downloads: '15.3M' },
  { name: 'minicpm-v', description: 'MiniCPM-V: compact multimodal model, 8B.', capabilities: ['vision'], sizes: ['8b'], downloads: '5.6M' },
  { name: 'tinyllama', description: 'TinyLlama 1.1B — tiny, fast, good for smoke tests.', capabilities: [], sizes: ['1.1b'], downloads: '6.5M' },
  { name: 'lfm3', description: 'LFM3-1.7B tri-hybrid model for local agents.', capabilities: ['tools', 'thinking'], sizes: ['1.7b'], downloads: '31K' },
  { name: 'lfm3-vl', description: 'LFM3-VL-2B, on-device visual understanding.', capabilities: ['vision', 'tools', 'thinking'], sizes: ['2b'], downloads: '9,780' },
  { name: 'lfm3-omni', description: 'LFM3-OMNI: one model for text, images, video and audio in, text and speech out.', capabilities: ['vision', 'tools', 'audio'], sizes: ['2b'], downloads: '21.2K' },
  { name: 'bonsai-2', description: 'Bonsai 2 by Prism ML: ternary-weight vision models, 2B to 27B.', capabilities: ['vision', 'tools', 'thinking'], sizes: ['2b', '4b', '9b', '27b'], downloads: '95K' },
  { name: 'flint', description: 'Flint: 39.8B MoE from Recursive, built for coding agents.', capabilities: ['tools', 'thinking'], sizes: ['40b'], downloads: '43.9K' },
  { name: 'nemotron-3.5-bolt', description: "NVIDIA's compact vision-language model for local coding and tool use.", capabilities: ['vision', 'tools', 'thinking', 'audio'], sizes: ['e4b'], downloads: '41.4K' },
  { name: 'muse-spark-open', description: 'Muse Spark Open: 816B total / 42B active, natively multimodal, 1M context. Cloud only.', capabilities: ['vision', 'tools', 'thinking', 'cloud'], context: '1M', cloud: true },
  { name: 'minimax-m3.1-flash', description: 'MiniMax M3.1 Flash: agentic tasks, coding, computer use. Cloud only.', capabilities: ['vision', 'tools', 'thinking', 'cloud'], context: '976K', cloud: true },
  { name: 'beam', description: 'Beam by Reflection: agentic tool use and coding with token-efficient output.', capabilities: ['tools', 'thinking', 'cloud'], context: '1M', cloud: true },
  { name: 'nomic-embed-text', description: 'Open embedding model with a large token context window.', capabilities: ['embedding'], downloads: '95M' },
  { name: 'mxbai-embed-large', description: 'Large embedding model from mixedbread.ai, 335M.', capabilities: ['embedding'], sizes: ['335m'], downloads: '16.5M' },
  { name: 'bge-m3', description: 'BAAI BGE-M3: multi-function, multi-lingual, multi-granularity embeddings.', capabilities: ['embedding'], sizes: ['567m'], downloads: '8.1M' },
  { name: 'embeddinggemma-2', description: 'Multimodal embedding model from Google, 270M to 740M.', capabilities: ['embedding', 'vision', 'audio'], sizes: ['270m', '440m', '570m', '740m'], downloads: '117.8K' },
  { name: 'd1', description: 'd1: 3B decision model from Liquid AI for scored choices and ratings.', capabilities: ['vision', 'decision'], sizes: ['3b'], downloads: '29.9K' },
  { name: 'd3', description: 'd3: turn text and images into yes/no answers and ratings.', capabilities: ['vision', 'decision'], sizes: ['2b', '4b', '9b', '27b'], downloads: '32.2K' },
  { name: 'nimble-v3', description: 'Nimble v3: 9B decision model for classification, routing and scoring.', capabilities: ['tools', 'thinking', 'decision'], sizes: ['9b'], downloads: '21.5K' },
  { name: 'phonon', description: "Gradium's text-to-speech family; speaks as it generates.", capabilities: ['audio'], downloads: '26.7K' },
];

export const CATALOG_SNAPSHOT = '2026-11-01';

export const OLLAMA_CATALOG: CatalogModel[] = RAW;

/** Case-insensitive search across name and description. */
export function searchCatalog(catalog: CatalogModel[], query: string): CatalogModel[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return catalog;
  }
  return catalog.filter(
    (model) =>
      model.name.toLowerCase().includes(needle) ||
      model.description.toLowerCase().includes(needle) ||
      (model.aliases ?? []).some((alias) => alias.includes(needle)),
  );
}

/** Filter helper for the catalog chips. */
export function filterCatalog(
  catalog: CatalogModel[],
  filters: { where?: 'any' | 'local' | 'cloud'; capability?: string },
): CatalogModel[] {
  return catalog.filter((model) => {
    if (filters.where === 'cloud' && !model.cloud) {
      return false;
    }
    if (filters.where === 'local' && model.cloud) {
      return false;
    }
    if (filters.capability && !model.capabilities.includes(filters.capability)) {
      return false;
    }
    return true;
  });
}

/** The three skills the user asked to ship pre-installed, kept near the top. */
export const PINNED_CATALOG = ['treyleo16/claude-oss', 'treyleo16/claude-mythos-5-1', 'gemma4:31b-cloud', 'llama3.1'];
