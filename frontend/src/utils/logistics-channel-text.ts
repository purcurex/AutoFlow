const words = new Intl.Segmenter('zh', { granularity: 'word' })
const closingBrackets: Record<string, string> = { '(': ')', '（': '）', '[': ']', '【': '】' }

/** Keep words and bracketed qualifiers together without changing the source text. */
export function channelNameParts(name: string): string[] {
  const parts: string[] = []
  const appendWords = (text: string) => parts.push(...Array.from(words.segment(text), part => part.segment))
  let start = 0
  for (let index = 0; index < name.length; index++) {
    const close = closingBrackets[name[index]!]
    if (!close) continue
    const stack = [close]
    let end = index + 1
    for (; end < name.length && stack.length; end++) {
      const char = name[end]!
      if (closingBrackets[char]) stack.push(closingBrackets[char]!)
      else if (char === stack.at(-1)) stack.pop()
    }
    // Incomplete brackets remain ordinary text rather than swallowing the rest.
    if (stack.length) continue
    appendWords(name.slice(start, index))
    parts.push(name.slice(index, end))
    start = end
    index = end - 1
  }
  appendWords(name.slice(start))
  return parts
}
