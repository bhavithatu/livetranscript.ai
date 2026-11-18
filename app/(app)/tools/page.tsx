import type { Metadata } from 'next'
import { ToolsWorkspace } from '@/components/workspace/ToolsWorkspace'

export const metadata: Metadata = {
  title: 'Explore all tools — LiveTranscript',
  description: 'Find Aptitude, coding, repository coaching, practice, Mock Lab, transcripts, remote assistance, and workspace settings.',
}

export default function ToolsPage() {
  return <ToolsWorkspace />
}
