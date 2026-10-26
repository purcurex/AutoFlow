import { onSessionReset } from './session'
// Stored outside the view: the access guard can unmount a workbench during navigation.
const locks = new Set<symbol>()
export const approvalNavigationBlocked = () => locks.size > 0
export function lockApprovalNavigation() { const key = Symbol('approval'); locks.add(key); return () => { locks.delete(key) } }
onSessionReset(() => locks.clear())
