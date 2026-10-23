const CHARS_PER_TOKEN = 3.2

function estimateOutputTokens(reported: number, chars: number): number {
  return reported > 0 ? reported : Math.ceil(chars / CHARS_PER_TOKEN)
}

export function truncationVerdict({
  finish,
  usageOutput,
  estimatedChars,
  maxTokens,
  toolArgs
}: {
  finish: string
  usageOutput: number
  estimatedChars: number
  maxTokens: number
  toolArgs: boolean
}): boolean {
  const outTokens = estimateOutputTokens(usageOutput, estimatedChars)
  const nearBudget = maxTokens > 0 && outTokens >= Math.floor(maxTokens * 0.9)
  return finish === 'length' || finish === 'max_tokens' || (!finish && (nearBudget || toolArgs))
}
