/**
 * Hugging Face GGUF browsing.
 *
 * This is the "download a model from Hugging Face" path, and it needs no file
 * handling of our own: modern Ollama pulls GGUFs straight from the Hub, so the
 * app only has to find the repository, work out which file the user meant, and
 * hand `hf.co/<repo>:<quant>` to the local daemon's /api/pull.
 */
import { transportFetch } from './transport';

export interface HfRepo {
  id: string;
  downloads: number;
  likes: number;
  updated?: string;
}

export interface HfFile {
  /** File name inside the repository. */
  name: string;
  size?: number;
  /** Quantisation tag, e.g. `Q4_K_M`, when the file name carries one. */
  quant?: string;
}

export interface HfRepoDetail {
  id: string;
  files: HfFile[];
  /** The reference to hand to Ollama, e.g. `hf.co/user/repo:Q4_K_M`. */
  refs: { file: HfFile; ref: string }[];
}

const API = 'https://huggingface.co/api';

export function isGgufName(name: string): boolean {
  return /\.gguf$/i.test(name);
}

/** Splits a GGUF file name into `{ base, quant }`; quant is undefined when unknown. */
export function quantFromFilename(name: string): string | undefined {
  const stem = name.replace(/\.gguf$/i, '');
  const match = /(IQ\d[_A-Z0-9]*|Q\d[_A-Z0-9]*|BF16|F16|F32|FP16)$/i.exec(stem);
  return match ? match[1].toUpperCase() : undefined;
}

/**
 * The `hf.co` reference Ollama accepts for one file.
 *
 * A repository with a single GGUF needs no tag; several files need the
 * quantisation (or, if the name carries none, the file name itself).
 */
export function hfModelRef(repoId: string, file: HfFile, totalGgufs: number): string {
  const base = `hf.co/${repoId}`;
  if (totalGgufs <= 1) {
    return base;
  }
  if (file.quant) {
    return `${base}:${file.quant}`;
  }
  return `${base}:${file.name}`;
}

export async function searchHuggingFace(query: string, signal?: AbortSignal): Promise<HfRepo[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  const url = `${API}/models?search=${encodeURIComponent(trimmed)}&filter=gguf&sort=downloads&direction=-1&limit=20`;
  const response = await transportFetch(url, { headers: { Accept: 'application/json' } }, signal);
  if (!response.ok) {
    throw new Error(`Hugging Face search failed (HTTP ${response.status}).`);
  }
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload
    .map((entry) => {
      const record = entry as Record<string, unknown>;
      return {
        id: String(record.id ?? ''),
        downloads: Number(record.downloads ?? 0) || 0,
        likes: Number(record.likes ?? 0) || 0,
        updated: typeof record.lastModified === 'string' ? record.lastModified : undefined,
      };
    })
    .filter((repo) => repo.id.includes('/'));
}

export async function huggingFaceRepo(repoId: string, signal?: AbortSignal): Promise<HfRepoDetail> {
  const url = `${API}/models/${repoId.split('/').map(encodeURIComponent).join('/')}?blobs=true`;
  const response = await transportFetch(url, { headers: { Accept: 'application/json' } }, signal);
  if (!response.ok) {
    throw new Error(`Cannot read ${repoId} (HTTP ${response.status}).`);
  }
  const payload = (await response.json()) as Record<string, unknown>;
  const siblings = Array.isArray(payload.siblings) ? payload.siblings : [];
  const files: HfFile[] = siblings
    .map((entry) => {
      const record = entry as Record<string, unknown>;
      const name = String(record.rfilename ?? '');
      return {
        name,
        size: Number(record.size ?? 0) || undefined,
        quant: quantFromFilename(name),
      };
    })
    .filter((file) => isGgufName(file.name))
    .sort((a, b) => (b.size ?? 0) - (a.size ?? 0));

  return {
    id: repoId,
    files,
    refs: files.map((file) => ({ file, ref: hfModelRef(repoId, file, files.length) })),
  };
}
