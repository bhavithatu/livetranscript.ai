import Link from 'next/link'
import { ArrowUpRight, AudioLines, BrainCircuit, Code2, FileText, FlaskConical, FolderCode, GraduationCap, MessageSquareText, MonitorUp, Network, Palette, Settings2, Sparkles, Users, type LucideIcon } from 'lucide-react'
import { WorkspaceShell } from '@/components/nav/WorkspaceShell'

type Tool = { title: string; href: string; description: string; action: string; icon: LucideIcon }
const GROUPS: { id: string; title: string; description: string; tools: Tool[] }[] = [
  {
    id: 'questions', title: 'Questions and analysis', description: 'Choose the workspace that fits the question in front of you.',
    tools: [
      { title: 'Aptitude', href: '/copilot?mode=aptitude', icon: BrainCircuit, description: 'Capture changing questions automatically, inspect the exact screenshot, and read an answer with its worked explanation and checks.', action: 'Open Aptitude' },
      { title: 'General questions', href: '/copilot', icon: Sparkles, description: 'Type a question without starting a meeting. Add documents, instructions, or optional audio context.', action: 'Ask a question' },
      { title: 'Coding', href: '/copilot?mode=coding', icon: Code2, description: 'Work through an approach, code, complexity, and edge cases. Screen capture and generated tests are available inside this mode.', action: 'Open Coding' },
      { title: 'System design', href: '/copilot?mode=systemDesign', icon: Network, description: 'Explore requirements, architecture diagrams, capacity, and failure tradeoffs with your question and context.', action: 'Explore a design' },
      { title: 'Behavioral answers', href: '/copilot?mode=behavioral', icon: MessageSquareText, description: 'Use your profile and real stories to structure interview answers, with supporting details and follow-up questions.', action: 'Work on a story' },
      { title: 'Repository coach', href: '/interview/repository', icon: FolderCode, description: 'Practice a code investigation, replay observed code, and follow evidence through a repository.', action: 'Open Repository coach' },
      { title: 'Repository screen tools', href: '/copilot?mode=repoInterview', icon: Code2, description: 'Capture an IDE view, watch changed code, ask about specific files, and review the evidence attached to an answer.', action: 'Inspect repository code' },
    ],
  },
  {
    id: 'practice', title: 'Practice and evaluation', description: 'Rehearse your own answers or inspect how the assistant performs.',
    tools: [
      { title: 'Candidate practice', href: '/practice', icon: GraduationCap, description: 'Answer practice questions and review feedback grounded in what you actually said. Audio starts only when you choose it.', action: 'Start practice' },
      { title: 'Mock Lab', href: '/interview#mock', icon: FlaskConical, description: 'Run assistant scenarios, review results against expected criteria, and refine draft instructions before promoting them.', action: 'Open Mock Lab' },
      { title: 'Session feedback', href: '/interview#feedback', icon: MessageSquareText, description: 'Review feedback from your saved sessions and see the evidence behind it.', action: 'Review feedback' },
      { title: 'Aptitude practice and checks', href: '/copilot?mode=aptitude#aptitude-practice', icon: BrainCircuit, description: 'Start with an original sample question or your own screenshot. Inspect the captured input and the checks shown with each answer.', action: 'Try an aptitude question' },
    ],
  },
  {
    id: 'capture', title: 'Capture and collaboration', description: 'Keep recording, shared sessions, and remote assistance within reach.',
    tools: [
      { title: 'Live interview', href: '/interview#live', icon: AudioLines, description: 'Use the live interview workspace for transcript context and assistant answers, with explicit audio and screen controls.', action: 'Open Live' },
      { title: 'New transcript', href: '/record', icon: FileText, description: 'Choose microphone or supported system audio, then record a conversation and follow its transcript.', action: 'Set up recording' },
      { title: 'Meeting room', href: '/room/new', icon: Users, description: 'Create or join a shared meeting using its invitation and visible recording controls.', action: 'Open a meeting' },
      { title: 'Transcript library', href: '/dashboard', icon: FileText, description: 'Find your saved transcripts, open summaries and full text, and manage individual sessions.', action: 'Browse transcripts' },
      { title: 'Remote assist', href: '/remote', icon: MonitorUp, description: 'Connect through an invitation, verify the participant, and explicitly control viewing and supported desktop input permissions.', action: 'Open Remote assist' },
    ],
  },
  {
    id: 'preferences', title: 'Make it yours', description: 'Find the settings that shape context, recognition, and presentation.',
    tools: [
      { title: 'Profile and story bank', href: '/settings#profile', icon: FileText, description: 'Add your background, resume, job description, and real experience so personal answers have a source.', action: 'Edit your profile' },
      { title: 'Answer preferences', href: '/settings#answers', icon: Settings2, description: 'Choose keywords, concise or detailed answers, tone, and follow-ups for the conversational modes.', action: 'Set answer preferences' },
      { title: 'Audio and vocabulary', href: '/settings#audio', icon: AudioLines, description: 'Find recording setup, choose technical vocabulary packs, and add names and terms that recognition should expect.', action: 'Configure recognition' },
      { title: 'Appearance', href: '/settings#appearance', icon: Palette, description: 'Choose the app name, icon, and other supported device appearance preferences.', action: 'Change appearance' },
      { title: 'Desktop app', href: '/download', icon: MonitorUp, description: 'Find the installer and platform details for native audio, window controls, and desktop-only capabilities.', action: 'View desktop options' },
    ],
  },
]

export function ToolsWorkspace() {
  return <WorkspaceShell active="tools">
    <main className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-6 sm:px-6 lg:px-8 lg:pt-8">
      <header className="max-w-3xl">
        <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[color:var(--signal)]">Your workspace</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Explore all tools</h1>
        <p className="mt-3 text-base leading-relaxed text-[color:var(--muted)]">Every workspace and its useful controls, in one place. Choose a task to go straight to the right screen.</p>
      </header>
      <nav aria-label="Tool categories" className="mt-6 flex flex-wrap gap-2">
        {GROUPS.map(group => <a key={group.id} href={`#${group.id}`} className="inline-flex min-h-11 items-center rounded-lg border border-[color:var(--line)] bg-[color:var(--reader)] px-3 text-sm hover:border-[color:var(--signal)]">{group.title}</a>)}
      </nav>
      {GROUPS.map(group => <section key={group.id} id={group.id} aria-labelledby={`tools-${group.id}`} className="scroll-mt-6 pt-9">
        <h2 id={`tools-${group.id}`} className="text-xl font-semibold tracking-tight">{group.title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-[color:var(--muted)]">{group.description}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {group.tools.map(({ title, href, description, action, icon: Icon }) => <article key={href} className="flex min-w-0 flex-col rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-5">
            <div className="flex items-start gap-3"><Icon size={20} aria-hidden className="mt-0.5 shrink-0 text-[color:var(--signal)]" /><h3 className="text-base font-semibold">{title}</h3></div>
            <p className="mt-3 flex-1 text-sm leading-relaxed text-[color:var(--muted)]">{description}</p>
            <Link href={href} className="mt-3 inline-flex min-h-11 items-center justify-between gap-3 rounded-md text-sm font-medium text-[color:var(--signal)] underline-offset-4 hover:underline">{action}<ArrowUpRight size={16} aria-hidden className="shrink-0" /></Link>
          </article>)}
        </div>
      </section>)}
    </main>
  </WorkspaceShell>
}
