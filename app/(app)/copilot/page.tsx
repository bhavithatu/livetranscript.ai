import { MODE_ORDER, type CopilotMode } from '@/lib/copilot/modes'
import type { Metadata } from 'next'
import { CopilotWorkspace } from '@/components/workspace/CopilotWorkspace'
import { currentUserId } from '@/lib/auth'

type PageProps = { searchParams: Promise<{ mode?: string | string[] }> }

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { mode } = await searchParams
  return mode === 'aptitude' ? {
    title: 'Aptitude — LiveTranscript',
    description: 'Capture aptitude questions, inspect the choices, and follow worked explanations and answer checks.',
  } : {
    title: 'AI workspace — LiveTranscript',
    description: 'A dedicated workspace for interview questions, code and repository context. Start with a question or optionally add live audio.',
  }
}

export default async function CopilotPage({ searchParams }: PageProps) {
  const [{ mode }, archiveOwnerId] = await Promise.all([searchParams, currentUserId()])
  const initialMode = typeof mode === 'string' && MODE_ORDER.includes(mode as CopilotMode) ? mode as CopilotMode : 'general'
  return <CopilotWorkspace key={initialMode} initialMode={initialMode} archiveOwnerId={archiveOwnerId} />
}
