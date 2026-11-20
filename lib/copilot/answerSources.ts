import type { useModeContext } from './useModeContext'
import type { CopilotMode } from './modes'
import type { BehavioralSource } from '@/lib/behavioral/sources'

/** Keep whole stories attached to their original titles. Reusing an identical
 * paragraph in a different story must not detach its ownership or outcome. */
export async function retrieveAnswerSources(context: ReturnType<typeof useModeContext>, mode: CopilotMode, question: string): Promise<BehavioralSource[]> {
  if (mode === 'behavioral' && context.storyCount > 0) {
    return (await context.retrieveStories(question, 2)).map((story) => ({ label: `Source story: ${story.title}`.slice(0, 160), text: story.fullText }))
  }
  const text = context.count > 0 ? await context.retrieve(question) : null
  return text ? [{ label: 'Uploaded reference material', text }] : []
}
