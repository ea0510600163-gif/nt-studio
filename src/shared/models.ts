import type { ApiStyle, ModelInfo } from './types.ts'
import { CODECRAFT, OPENCODE_GO } from './catalogs.ts'

export function inferModel(id: string): ModelInfo {
  const s = id.toLowerCase()
  const vision = /vision|-vl|vl-|gpt-4o|gpt-4\.1|gpt-5|claude|gemini|pixtral|llava|omni|gemma-3|llama-4|grok-4/.test(s)
  let contextWindow = 128000
  if (/claude/.test(s)) contextWindow = 200000
  else if (/gemini|gpt-4\.1|llama-4/.test(s)) contextWindow = 1000000
  else if (/gpt-4-turbo|gpt-4o|gpt-5|deepseek|qwen|kimi|glm|mistral|grok/.test(s)) contextWindow = 128000
  else if (/gpt-3\.5/.test(s)) contextWindow = 16000
  return { id, tools: !/instruct-v0|base$|embed|whisper|tts|dall/.test(s), vision, contextWindow, maxOutput: 64_000 }
}

export interface Preset {
  name: string
  baseUrl: string
  apiStyle: ApiStyle
  opencode?: boolean
  models?: ModelInfo[]
}

export const PRESETS: Preset[] = [
  { name: 'OpenCode Go', baseUrl: OPENCODE_GO.baseUrl, apiStyle: OPENCODE_GO.apiStyle, opencode: true, models: OPENCODE_GO.models },
  { name: 'CodeCraft API', baseUrl: CODECRAFT.baseUrl, apiStyle: CODECRAFT.apiStyle, models: CODECRAFT.models },
  { name: 'Anthropic', baseUrl: 'https://api.anthropic.com', apiStyle: 'anthropic' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiStyle: 'openai' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiStyle: 'openai' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiStyle: 'openai' },
  { name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiStyle: 'openai' },
  { name: 'محلي (Ollama)', baseUrl: 'http://localhost:11434/v1', apiStyle: 'openai' }
]
