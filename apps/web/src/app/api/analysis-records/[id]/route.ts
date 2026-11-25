import { NextRequest, NextResponse } from 'next/server'
import { deleteAnalysisRecord, getAnalysisRecordById } from '@stock/database'
import { getCurrentUserFromReq, isAdminUser } from '../../../../lib/auth'

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const recordId = parseInt(id, 10)
    if (!Number.isInteger(recordId) || recordId <= 0) {
      return NextResponse.json({ success: false, error: 'invalid record id' }, { status: 400 })
    }

    const user = await getCurrentUserFromReq(req)
    if (!user) {
      return NextResponse.json({ success: false, error: 'not authenticated' }, { status: 401 })
    }

    const existing = await getAnalysisRecordById(recordId)
    if (!existing) {
      return NextResponse.json({ success: false, error: 'record not found' }, { status: 404 })
    }

    const isAdmin = await isAdminUser(user)
    const isOwner = existing.user_id != null && existing.user_id === user.id
    if (!isAdmin && !isOwner) {
      return NextResponse.json({ success: false, error: 'forbidden: owner or admin only' }, { status: 403 })
    }

    const deleted = await deleteAnalysisRecord(recordId, user.id)
    if (!deleted) {
      return NextResponse.json({ success: false, error: 'record not found' }, { status: 404 })
    }
    return NextResponse.json({ success: true, softDeleted: true })
  } catch (error) {
    console.error('[API/Analysis-Records/Delete] Failed:', error)
    return NextResponse.json({ success: false, error: 'internal error' }, { status: 500 })
  }
}
