import { NextRequest, NextResponse } from 'next/server'
import { currentUserId } from '@/lib/auth'
import { readRepoJson, RepoRequestError } from '@/lib/repo/agentHttp'
import { analyzeAptitude } from '@/lib/aptitude/analyze'
import { AptitudeServiceError } from '@/lib/aptitude/modelPolicy'
import { APTITUDE_CONTRACT_HEADER, APTITUDE_CONTRACT_VERSION, AptitudeValidationError, MAX_APTITUDE_BODY_BYTES, parseAptitudeRequest } from '@/lib/aptitude/schema'
import { recordUsage } from '@/lib/usage'

export const runtime = 'nodejs'
export const maxDuration = 40
const headers = { 'Cache-Control': 'no-store' }

export async function POST(req: NextRequest) {
  try {
    const userId = await currentUserId()
    if (!userId) return NextResponse.json({ error: 'Sign in to analyze an aptitude question.', code: 'UNAUTHENTICATED' }, { status: 401, headers })
    const origin = req.headers.get('origin')
    if ((origin && origin !== req.nextUrl.origin) || req.headers.get('sec-fetch-site') === 'cross-site') return NextResponse.json({ error: 'Cross-origin requests are not allowed.', code: 'INVALID_ORIGIN' }, { status: 403, headers })
    const request = parseAptitudeRequest(await readRepoJson(req, MAX_APTITUDE_BODY_BYTES))
    if (req.headers.get(APTITUDE_CONTRACT_HEADER) !== APTITUDE_CONTRACT_VERSION) return NextResponse.json({ error: 'Aptitude has been updated. Refresh this tab once, then retry your capture.', code: 'CLIENT_UPDATE_REQUIRED' }, { status: 409, headers })
    const result = await analyzeAptitude(request, req.signal, { onAttempt: attempt => recordUsage('aptitude', userId, attempt) })
    return NextResponse.json(result, { headers })
  } catch (error) {
    if (error instanceof AptitudeServiceError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers })
    if (error instanceof AptitudeValidationError || error instanceof RepoRequestError) return NextResponse.json({ error: error.message, code: 'INVALID_REQUEST' }, { status: error instanceof RepoRequestError ? error.status : 400, headers })
    return NextResponse.json({ error: 'Aptitude analysis is temporarily unavailable.', code: 'INTERNAL_ERROR' }, { status: 500, headers })
  }
}
