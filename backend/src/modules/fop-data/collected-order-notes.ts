/** Only the fulfillment order's own hzkj_note is the order remark. */
export function collectedOrderNotes(raw: Record<string, unknown> | undefined) {
 const provided=!!raw&&Object.prototype.hasOwnProperty.call(raw,'hzkj_note')
 return {orderRemark:typeof raw?.hzkj_note==='string'?raw.hzkj_note.trim():null,orderRemarkProvided:provided}
}
