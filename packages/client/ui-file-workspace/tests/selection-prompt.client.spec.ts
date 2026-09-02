/** Replacement extraction tests (pure). */
import { describe, expect, it } from 'vitest'
import { extractReplacement } from '../src/client/selection-prompt.ts'

describe('extractReplacement', () => {
  it('extracts one complete four-backtick Markdown fence', () => {
    expect(extractReplacement('````markdown\nnew text\n````')).toBe('new text')
  })

  it('accepts one common three-backtick fence with surrounding explanation', () => {
    expect(extractReplacement([
      '下面是修改后的内容：',
      '```md',
      '# New heading',
      '',
      'Body',
      '```',
      '请确认。',
    ].join('\n'))).toBe('# New heading\n\nBody')
  })

  it('allows nested three-backtick content inside a four-backtick replacement fence', () => {
    expect(extractReplacement([
      '````markdown',
      '```ts',
      'const value = 1',
      '```',
      '````',
    ].join('\n'))).toBe('```ts\nconst value = 1\n```')
  })

  it.each([
    'just prose, no replacement',
    '<replacement_markdown>old format</replacement_markdown>',
    '````markdown\none\n````\n````markdown\ntwo\n````',
    '````text\nreplacement\n````',
    '```markdown\nunterminated',
  ])('rejects a reply that is not exactly the required fence: %s', (reply) => {
    expect(extractReplacement(reply)).toBeUndefined()
  })
})
